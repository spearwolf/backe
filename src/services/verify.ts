/**
 * `verify` (backe.md §2.13): prüft jeden Commit seit dem Vertrauensanker — Signatur, `Backe-Actor`,
 * Identitätsschutz — gegen den letzten vertrauenswürdigen Stand und lässt Commits passieren, die
 * ein Admin in `.backe/quarantine.jsonc` eingetragen hat.
 *
 * Ein ungültiger Commit verleiht keine Rechte: Ab dem ersten ungültigen Commit gilt für alle
 * folgenden der Stand vor ihm (eingefroren), bis eine gültige Quarantäne alle bis dahin ungültigen
 * Commits deckt; danach zählt wieder der Stand des jeweiligen Parents.
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { type Quarantine, QuarantineSchema } from '../core/schemas.ts';
import {
  type CommitInfo,
  isAncestor,
  listCommits,
  type RawChange,
  readBlobs,
  removedHandles,
  resolveCommit,
  rootCommits,
  type Signature,
  treeChanges,
} from '../git/history.ts';
import { readLocalState, writeLocalState } from '../git/local-state.ts';
import { parseCommitMessage, TRAILER_ACTOR, TRAILER_OP } from '../git/message.ts';
import { parseOpTrailer } from '../ops/operation.ts';
import { propViolations } from '../ops/props.ts';
import { checkCommitPolicy, type TreeChange } from '../ops/verify-policy.ts';
import { BACKLOG_CONFIG, classifyPath, QUARANTINE } from '../store/layout.ts';
import { loadSnapshot } from '../store/snapshot.ts';
import { requireRoot } from './read.ts';
import {
  loadStates,
  parseJsoncAs,
  REGULAR_FILE,
  type State,
  signatureCache,
  signatureReasons,
} from './verify-state.ts';

export type VerifyFinding = { sha: string; subject: string; reasons: string[] };
export type QuarantinedFinding = VerifyFinding & {
  decision: 'accepted' | 'reverted';
  note: string;
};
export type VerifyReport = {
  anchor: string;
  to: string;
  checked: number;
  invalid: VerifyFinding[];
  quarantined: QuarantinedFinding[];
  notices: string[];
};
export type VerifyOptions = { since?: string; to?: string; record?: boolean };

type Checked = VerifyFinding & { notices: string[]; quarantine?: Quarantine };

const short = (sha: string) => sha.slice(0, 7);

// --- Bereich und Anker ----------------------------------------------------------------------

async function resolveRange(wc: string, opts: VerifyOptions) {
  const anchor = await readLocalState(wc, 'anchor');
  if (anchor === undefined) throw new BackeError('verify', `Kein Vertrauensanker in ${wc}`);
  const toRev = opts.to ?? 'HEAD';
  const to = await resolveCommit(wc, toRev);
  const roots = await rootCommits(wc, to);
  if (roots.length !== 1 || roots[0] !== anchor) {
    throw new BackeError('verify', `Historie von ${toRev} passt nicht zum Vertrauensanker`);
  }
  const verified = await readLocalState(wc, 'verified');
  if (verified !== undefined && !(await isAncestor(wc, verified, to))) {
    throw new BackeError(
      'verify',
      `${toRev} ist kein Nachfahre des zuletzt verifizierten Stands ${short(verified)}`,
    );
  }
  const since = opts.since === undefined ? undefined : await resolveCommit(wc, opts.since);
  if (since !== undefined && !(await isAncestor(wc, since, to))) {
    throw new BackeError('usage', `since ${short(since)} ist kein Vorfahre von ${short(to)}`);
  }
  if (opts.record && since !== undefined) {
    const covered = verified !== undefined && (await isAncestor(wc, since, verified));
    if (!covered) {
      throw new BackeError(
        'usage',
        `Aufzeichnen mit --since ${opts.since} geht nur, wenn ${opts.since} schon verifiziert ist`,
        { hint: 'Ohne --since prüfen oder ab dem zuletzt verifizierten Stand.' },
      );
    }
  }
  return { anchor, to, since };
}

// --- Einzelner Commit -----------------------------------------------------------------------

function actorReasons(actors: readonly string[], sig: Signature | undefined): string[] {
  if (actors.length === 0) return ['Backe-Actor fehlt'];
  if (actors.length > 1) return ['Backe-Actor mehrfach'];
  if (sig?.status === 'G' && sig.principal !== actors[0]) {
    return [`signiert von ${sig.principal}, Backe-Actor ist ${actors[0]}`];
  }
  return [];
}

function opNotice(sha: string, ops: readonly string[]): string[] {
  if (ops.length === 0) return [`${short(sha)}: Backe-Op fehlt`];
  try {
    if (ops.length > 1) throw new Error('mehrfach');
    parseOpTrailer(ops[0] as string);
    return [];
  } catch {
    return [`${short(sha)}: Backe-Op nicht dekodierbar`];
  }
}

function anchorReasons(state: State, actor: string | undefined, ops: readonly string[]): string[] {
  const reasons: string[] = [];
  if (ops.length !== 1 || ops[0] !== 'init') reasons.push('Vertrauensanker ohne Backe-Op init');
  if (typeof state.config === 'string') {
    reasons.push(`nicht prüfbar: ${BACKLOG_CONFIG}: ${state.config}`);
  } else if (
    actor !== undefined &&
    !(state.config.admins.includes(actor) && state.users.get(actor)?.kind === 'human')
  ) {
    reasons.push(`Akteur ${actor} ist im Vertrauensanker kein Admin`);
  }
  return reasons;
}

const policyRelevant = (path: string) =>
  path === BACKLOG_CONFIG || ['user', 'issue', 'comment'].includes(classifyPath(path).kind);

/** Liest Blobs je Pfad (fehlend → `null`); eine Seite einer Änderung, vor oder nach dem Commit. */
export type BlobSide = (paths: readonly string[]) => Promise<Map<string, Buffer | null>>;

/** Blob-Seite einer Revision. */
export const blobsAt =
  (wc: string, rev: string): BlobSide =>
  async (paths) => {
    const blobs = await readBlobs(
      wc,
      paths.map((p) => `${rev}:${p}`),
    );
    return new Map(paths.map((p) => [p, blobs.get(`${rev}:${p}`) ?? null]));
  };

/**
 * Tree-Änderungen mit Inhalt davor/danach für Users, Issues, Kommentare und die Config. Gemeinsam
 * für `verify` und die Vorabprüfung einer Quarantäne-Umkehr, damit beide dasselbe beurteilen.
 */
export async function treeChangesWithContent(
  raw: readonly RawChange[],
  before: BlobSide,
  after: BlobSide,
): Promise<TreeChange[]> {
  const relevant = raw.filter((c) => policyRelevant(c.path));
  const side = (mode: (c: RawChange) => string) =>
    relevant.filter((c) => REGULAR_FILE.test(mode(c))).map((c) => c.path);
  const [was, now] = await Promise.all([
    before(side((c) => c.oldMode)),
    after(side((c) => c.newMode)),
  ]);
  const text = (blobs: Map<string, Buffer | null>, path: string) =>
    blobs.get(path)?.toString('utf8') ?? null;
  return raw.map((c) => ({ ...c, before: text(was, c.path), after: text(now, c.path) }));
}

async function changesOf(wc: string, parent: string, sha: string): Promise<TreeChange[]> {
  return treeChangesWithContent(
    await treeChanges(wc, parent, sha),
    blobsAt(wc, parent),
    blobsAt(wc, sha),
  );
}

/**
 * Identitätsschutz und Quarantäne-Datei eines Nicht-Anker-Commits. `before` ist der Stand, gegen
 * den er beurteilt wird; die Änderungen sind seine eigenen gegenüber seinem Parent.
 */
async function contentReasons(
  wc: string,
  commit: CommitInfo,
  actor: string,
  { before, after }: { before: State; after: State },
): Promise<{ reasons: string[]; quarantine?: Quarantine }> {
  const parent = commit.parents[0] as string;
  const changes = await changesOf(wc, parent, commit.sha);
  const reasons: string[] = [];
  if (typeof before.config === 'string' || typeof after.config === 'string') {
    const message = typeof after.config === 'string' ? after.config : before.config;
    reasons.push(`nicht prüfbar: ${BACKLOG_CONFIG}: ${message}`);
  } else {
    const addsUser = changes.some((c) => c.status === 'A' && classifyPath(c.path).kind === 'user');
    reasons.push(
      ...checkCommitPolicy({
        actor,
        parent: { config: before.config, users: before.users },
        after: { config: after.config, users: after.users },
        changes,
        removedHandles: addsUser ? await removedHandles(wc, parent) : new Set(),
      }),
    );
  }
  const change = changes.find((c) => c.path === QUARANTINE);
  if (change === undefined) return { reasons };
  if (change.status === 'D') return { reasons, quarantine: { entries: [] } };
  const quarantine = await quarantineAt(wc, commit.sha);
  if (typeof quarantine === 'string') {
    return { reasons: [...reasons, `quarantine.jsonc ungültig: ${quarantine}`] };
  }
  return { reasons, quarantine };
}

/** Prüft `commit` gegen den Stand `before`; `after` ist der Stand seines eigenen Baums. */
async function checkCommit(
  wc: string,
  commit: CommitInfo,
  anchor: string,
  states: { before: State; after: State },
  sig: Signature | undefined,
): Promise<Checked> {
  const { subject, trailers } = parseCommitMessage(commit.message);
  const base = { sha: commit.sha, subject, notices: [] as string[] };
  if (commit.parents.length > 1) return { ...base, reasons: ['Merge-Commit'] };
  const actors = trailers.get(TRAILER_ACTOR) ?? [];
  const ops = trailers.get(TRAILER_OP) ?? [];
  const actor = actors.length === 1 ? actors[0] : undefined;
  const reasons = [
    ...signatureReasons(sig, commit.gpgsig, states.before.users),
    ...actorReasons(actors, sig),
  ];
  if (commit.sha === anchor) {
    reasons.push(...anchorReasons(states.before, actor, ops));
    return { ...base, reasons };
  }
  const notices = opNotice(commit.sha, ops);
  if (actor === undefined) return { ...base, reasons, notices };
  const content = await contentReasons(wc, commit, actor, states);
  return {
    ...base,
    reasons: [...reasons, ...content.reasons],
    notices,
    ...(content.quarantine && { quarantine: content.quarantine }),
  };
}

// --- Quarantäne -----------------------------------------------------------------------------

async function quarantineAt(wc: string, rev: string): Promise<Quarantine | string | undefined> {
  const spec = `${rev}:${QUARANTINE}`;
  const blob = (await readBlobs(wc, [spec])).get(spec);
  if (blob === null || blob === undefined) return undefined;
  return parseJsoncAs(QuarantineSchema, blob.toString('utf8'), QUARANTINE);
}

/** Ein gültiger Commit, der die Quarantäne-Datei ändert, setzt die maßgebliche Quarantäne. */
const governs = (c: Checked): c is Checked & { quarantine: Quarantine } =>
  c.quarantine !== undefined && c.reasons.length === 0;

// --- Der Gang durch die Historie ------------------------------------------------------------

type Walk = {
  anchor: string;
  to: string;
  checked: Checked[];
  /** Die maßgebliche Quarantäne: der Commit, der sie zuletzt gültig geändert hat, und ihre Einträge. */
  governing: { sha: string | undefined; entries: Quarantine['entries'] };
  /** Der Stand, gegen den `verify` einen Commit auf `to` beurteilen würde. */
  next: State;
};

/**
 * Ein Gang über den Bereich, älteste zuerst. Jeder Commit wird gegen den eingefrorenen Stand
 * beurteilt, sonst gegen den seines Parents (der Anker gegen sich selbst). Der erste ungültige
 * Commit friert den Stand ein, gegen den er beurteilt wurde; eine gültige Quarantäne, die alle bis
 * dahin ungültigen Commits deckt, taut ihn wieder auf. Maßgeblich ist die Quarantäne des letzten
 * gültigen Commits im Bereich, der sie ändert, sonst keine. Die Datei bei `since` kann keinen
 * Commit danach nennen: Er stammt von `since` ab, sein Hash hinge an ihrem Inhalt.
 */
async function walk(wc: string, opts: VerifyOptions): Promise<Walk> {
  const { anchor, to, since } = await resolveRange(wc, opts);
  const commits = await listCommits(wc, { from: since, to });
  const parents = commits.flatMap((c) => c.parents.slice(0, 1));
  const states = await loadStates(wc, [...new Set([...commits.map((c) => c.sha), ...parents, to])]);
  const stateOf = (sha: string) => states.get(sha) as State;
  const own = (c: CommitInfo) => stateOf(c.sha === anchor ? c.sha : (c.parents[0] as string));
  const sigs = signatureCache(wc);
  await sigs.prefetch(commits.map((commit) => ({ commit, state: own(commit) })));

  let governing: Walk['governing'] = { sha: undefined, entries: [] };
  let frozen: State | undefined;
  let open: string[] = [];
  const checked: Checked[] = [];
  for (const commit of commits) {
    const before = frozen ?? own(commit);
    const sig = await sigs.of(commit, before);
    const c = await checkCommit(wc, commit, anchor, { before, after: stateOf(commit.sha) }, sig);
    checked.push(c);
    if (c.reasons.length > 0) {
      open.push(c.sha);
      frozen ??= before;
    }
    if (governs(c)) {
      const entries = c.quarantine.entries;
      governing = { sha: c.sha, entries };
      if (open.every((sha) => entries.some((e) => e.sha === sha))) {
        open = [];
        frozen = undefined;
      }
    }
  }
  return { anchor, to, checked, governing, next: frozen ?? stateOf(to) };
}

// --- Einstieg -------------------------------------------------------------------------------

/**
 * Grundlage des nächsten Commits auf `HEAD`, genau so, wie `verifyRange` ihn beurteilen wird: der
 * Stand, gegen den er geprüft wird (eingefroren, solange ungültige Commits ungedeckt sind, sonst
 * `HEAD`), und der Text der maßgeblichen Quarantäne-Datei (ohne eine solche `undefined`).
 */
export async function nextCommitBasis(
  wc: string,
): Promise<{ state: State; quarantineText: string | undefined }> {
  const { governing, next } = await walk(wc, {});
  if (governing.sha === undefined) return { state: next, quarantineText: undefined };
  const spec = `${governing.sha}:${QUARANTINE}`;
  return { state: next, quarantineText: (await readBlobs(wc, [spec])).get(spec)?.toString('utf8') };
}

/** Prüft die Commits nach `since` (ohne: ab dem Anker) bis `to` (Default `HEAD`). */
export async function verifyRange(wc: string, opts: VerifyOptions = {}): Promise<VerifyReport> {
  const { anchor, to, checked, governing } = await walk(wc, opts);
  const report: VerifyReport = {
    anchor,
    to,
    checked: checked.length,
    invalid: [],
    quarantined: [],
    notices: [],
  };
  for (const { notices, quarantine: _, ...finding } of checked) {
    report.notices.push(...notices);
    if (finding.reasons.length === 0) continue;
    const entry = governing.entries.find((e) => e.sha === finding.sha);
    if (entry === undefined) report.invalid.push(finding);
    else report.quarantined.push({ ...finding, decision: entry.decision, note: entry.reason });
  }
  if (opts.record && report.invalid.length === 0) await writeLocalState(wc, 'verified', to);
  return report;
}

export type BacklogVerifyReport = VerifyReport & { propNotices: string[] };

/**
 * `backe verify` für die Arbeitskopie des Kontexts: der Bericht von `verifyRange`, dazu je
 * Property, deren Wert eine (inzwischen verschärfte) Deklaration verletzt, ein Hinweis
 * `<id> <key>: <meldung>` — ein Hinweis, kein Fehler (backe.md §2.24).
 */
export async function verifyBacklog(
  ctx: ResolvedContext,
  opts: VerifyOptions = {},
): Promise<BacklogVerifyReport> {
  const root = requireRoot(ctx);
  const report = await verifyRange(root, opts);
  const propNotices = propViolations(await loadSnapshot(root)).map(
    (v) => `${v.id} ${v.key}: ${v.message}`,
  );
  return { ...report, propNotices };
}

/** Wirft `verify` mit dem Bericht als Details, wenn ungültige Commits übrig sind. */
export function assertVerified(report: VerifyReport): void {
  if (report.invalid.length === 0) return;
  throw new BackeError(
    'verify',
    `${report.invalid.length} ungültige Commits seit ${short(report.anchor)}`,
    { details: report },
  );
}

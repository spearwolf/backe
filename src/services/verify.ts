/**
 * `verify` (backe.md §2.13): prüft jeden Commit seit dem Vertrauensanker — Signatur, `Backe-Actor`,
 * Identitätsschutz — gegen den letzten vertrauenswürdigen Stand und lässt Commits passieren, die
 * ein Admin in `.backe/quarantine.jsonc` eingetragen hat.
 *
 * Ein ungültiger Commit verleiht keine Rechte: Ab dem ersten ungültigen Commit gilt für alle
 * folgenden der Stand vor ihm (eingefroren), bis eine gültige Quarantäne alle bis dahin ungültigen
 * Commits deckt; danach zählt wieder der Stand des jeweiligen Parents. Solange der Stand
 * eingefroren ist, baut eine Änderung an einem Pfad, dessen Inhalt vom eingefrorenen Stand abweicht,
 * auf den ungültigen Commits auf und ist selbst ungültig (`taintReasons`).
 */
import { z } from 'zod';
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { shortSha } from '../core/ids.ts';
import { BacklogConfigSchema, type Quarantine, QuarantineSchema } from '../core/schemas.ts';
import {
  type CommitInfo,
  isAncestor,
  listCommits,
  objectInfo,
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
import { loadSnapshot, type StoredEntity } from '../store/snapshot.ts';
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
/**
 * `ancestor` ersetzt `verified` in der Abstammungsprüfung: Beim Sync ist das `upstream`, weil
 * `verified` auf ungepushte lokale Commits zeigen darf, die dem Remote fehlen.
 */
export type VerifyOptions = { since?: string; to?: string; record?: boolean; ancestor?: string };

export type VerifyMode = z.infer<typeof BacklogConfigSchema.shape.verify>;

/** `basis` ist der Commit, gegen dessen Stand der Commit beurteilt wurde. */
type Checked = VerifyFinding & { notices: string[]; quarantine?: Quarantine; basis: string };

// --- Bereich und Anker ----------------------------------------------------------------------

/** `descent: false` überlässt die Abstammungsprüfung dem Aufrufer, der den Bereich schon geprüft hat. */
async function resolveRange(wc: string, opts: VerifyOptions, descent = true) {
  const anchor = await readLocalState(wc, 'anchor');
  if (anchor === undefined) throw new BackeError('verify', `Kein Vertrauensanker in ${wc}`);
  const toRev = opts.to ?? 'HEAD';
  const to = await resolveCommit(wc, toRev);
  const roots = await rootCommits(wc, to);
  if (roots.length !== 1 || roots[0] !== anchor) {
    throw new BackeError('verify', `Historie von ${toRev} passt nicht zum Vertrauensanker`);
  }
  const verified = await readLocalState(wc, 'verified');
  const ancestor = opts.ancestor ?? verified;
  if (descent && ancestor !== undefined && !(await isAncestor(wc, ancestor, to))) {
    throw new BackeError(
      'verify',
      `${toRev} ist kein Nachfahre des zuletzt verifizierten Stands ${shortSha(ancestor)}`,
    );
  }
  const since = opts.since === undefined ? undefined : await resolveCommit(wc, opts.since);
  if (since !== undefined && !(await isAncestor(wc, since, to))) {
    throw new BackeError(
      'validation',
      `since ${shortSha(since)} ist kein Vorfahre von ${shortSha(to)}`,
    );
  }
  if (opts.record && since !== undefined) {
    const covered = verified !== undefined && (await isAncestor(wc, since, verified));
    if (!covered) {
      throw new BackeError(
        'validation',
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
  if (ops.length === 0) return [`${shortSha(sha)}: Backe-Op fehlt`];
  try {
    if (ops.length > 1) throw new Error('mehrfach');
    parseOpTrailer(ops[0] as string);
    return [];
  } catch {
    return [`${shortSha(sha)}: Backe-Op nicht dekodierbar`];
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

/**
 * Prüft `commit` gegen den Stand `before` (der von `basis`); `after` ist der Stand seines eigenen
 * Baums.
 */
async function checkCommit(
  wc: string,
  commit: CommitInfo,
  anchor: string,
  states: { before: State; after: State; basis: string },
  sig: Signature | undefined,
): Promise<Checked> {
  const { subject, trailers } = parseCommitMessage(commit.message);
  const base = { sha: commit.sha, subject, notices: [] as string[], basis: states.basis };
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

// --- Verseuchte Pfade -----------------------------------------------------------------------

/** Der eingefrorene Stand: sein Commit und die offenen ungültigen Commits, ältester zuerst. */
export type FrozenAt = { at: string; open: readonly string[] };

/** Ob `entries` alle offenen ungültigen Commits decken; ein gültiger Commit, der sie setzt, taut auf. */
export const coversOpen = (entries: Quarantine['entries'], open: readonly string[]): boolean =>
  open.every((sha) => entries.some((e) => e.sha === sha));

/**
 * Ein Commit auf einem eingefrorenen Stand baut auf den offenen ungültigen Commits auf, sobald er
 * einen Pfad ändert, dessen Blob im Parent von dem im eingefrorenen Stand `frozen.at` abweicht:
 * Sonst trüge ein gültiger Commit den Inhalt eines ungültigen weiter. Gemeinsam für `verify` und
 * die Vorabprüfung im Schreibpfad, damit beide dasselbe beurteilen.
 *
 * `changes` sind die geänderten Dateien mit ihrer Blob-ID im Parent (fehlt → `undefined`),
 * `after` liefert die Blob-ID danach; gefragt wird sie nur bei einem Commit, der die
 * Quarantäne-Datei ändert. `entries` ist die Quarantäne, die der Commit setzt, wenn er die Datei
 * ändert und sonst gültig ist.
 *
 * Die Quarantäne-Datei selbst wird nie verglichen: Sie ist das Mittel, den Stand aufzutauen, wird
 * als Ganzes gegen den eingefrorenen Stand beurteilt (nur Admins) und nennt Commits nur über ihren
 * Hash; hätte ein ungültiger Commit sie geändert, könnte sonst keine Quarantäne ihn je decken. Ein
 * Commit, dessen Quarantäne alle offenen Commits deckt und damit auftaut, ist ganz ausgenommen.
 * Ändert er sie, ohne aufzutauen, darf er Pfade nur zurücksetzen: auf den Blob im eingefrorenen
 * Stand, auf den Blob eines offenen ungültigen Commits, über den ohnehin noch entschieden werden
 * muss, oder auf den Blob im Parent eines solchen Commits — den schreibt eine echte Umkehr, und er
 * kann aus einem gültigen Commit nach dem Einfrieren stammen. So kehrt eine Quarantäne mit
 * `reverted` einen Commit um, während andere noch offen sind. Jede andere Änderung trüge Neues auf
 * dem ungültigen Stand weiter.
 */
export async function pathTaintReasons(
  wc: string,
  changes: readonly { path: string; parent: string | undefined }[],
  after: (path: string) => Promise<string | undefined>,
  frozen: FrozenAt,
  entries: Quarantine['entries'] | undefined,
): Promise<string[]> {
  if (entries !== undefined && coversOpen(entries, frozen.open)) return [];
  const decides = changes.some((c) => c.path === QUARANTINE);
  const paths = changes.filter((c) => c.path !== QUARANTINE);
  const back = decides ? [frozen.at, ...frozen.open.flatMap((o) => [o, `${o}^`])] : [];
  const info = await objectInfo(
    wc,
    paths.flatMap((c) => [frozen.at, ...back].map((rev) => `${rev}:${c.path}`)),
  );
  const oid = (rev: string, path: string) => info.get(`${rev}:${path}`)?.oid;
  for (const c of paths) {
    if (c.parent === oid(frozen.at, c.path)) continue;
    const now = decides ? await after(c.path) : undefined;
    if (!decides || !back.some((rev) => oid(rev, c.path) === now)) {
      return [`baut auf ungültigem Commit ${shortSha(frozen.open[0] as string)} auf`];
    }
  }
  return [];
}

/** `pathTaintReasons` für einen Commit der Historie. */
async function taintReasons(
  wc: string,
  commit: CommitInfo,
  frozen: FrozenAt,
  entries: Quarantine['entries'] | undefined,
): Promise<string[]> {
  const parent = commit.parents[0] as string;
  if (parent === frozen.at) return [];
  const raw = await treeChanges(wc, parent, commit.sha);
  const info = await objectInfo(
    wc,
    raw.flatMap((c) => [`${parent}:${c.path}`, `${commit.sha}:${c.path}`]),
  );
  const oid = (rev: string, path: string) => info.get(`${rev}:${path}`)?.oid;
  return pathTaintReasons(
    wc,
    raw.map((c) => ({ path: c.path, parent: oid(parent, c.path) })),
    async (path) => oid(commit.sha, path),
    frozen,
    entries,
  );
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

/** `c` setzt eine Quarantäne, die alle offenen ungültigen Commits deckt, und taut den Stand auf. */
const thaws = (c: Checked, open: readonly string[]): boolean =>
  governs(c) && coversOpen(c.quarantine.entries, open);

// --- Der Gang durch die Historie ------------------------------------------------------------

type Walk = {
  anchor: string;
  to: string;
  checked: Checked[];
  /** Die maßgebliche Quarantäne: der Commit, der sie zuletzt gültig geändert hat, und ihre Einträge. */
  governing: { sha: string | undefined; entries: Quarantine['entries'] };
  /** Der Stand, gegen den `verify` einen Commit auf `to` beurteilen würde. */
  next: State;
  /** Die offenen ungültigen Commits, ältester zuerst; ohne eingefrorenen Stand leer. */
  open: string[];
  /** Der Commit, dessen Stand eingefroren ist; ohne eingefrorenen Stand `undefined`. */
  frozenAt: string | undefined;
};

/**
 * Ein Gang über den Bereich, älteste zuerst. Jeder Commit wird gegen den eingefrorenen Stand
 * beurteilt, sonst gegen den seines Parents (der Anker gegen sich selbst). Der erste ungültige
 * Commit friert den Stand ein, gegen den er beurteilt wurde; eine gültige Quarantäne, die alle bis
 * dahin ungültigen Commits deckt, taut ihn wieder auf. Solange er eingefroren ist, gilt zusätzlich
 * `taintReasons`. Maßgeblich ist die Quarantäne des letzten gültigen Commits im Bereich, der sie
 * ändert, sonst keine. Die Datei bei `since` kann keinen Commit danach nennen: Er stammt von
 * `since` ab, sein Hash hinge an ihrem Inhalt.
 */
async function walk(wc: string, opts: VerifyOptions, descent = true): Promise<Walk> {
  const { anchor, to, since } = await resolveRange(wc, opts, descent);
  const commits = await listCommits(wc, { from: since, to });
  const parents = commits.flatMap((c) => c.parents.slice(0, 1));
  const states = await loadStates(wc, [...new Set([...commits.map((c) => c.sha), ...parents, to])]);
  const stateOf = (sha: string) => states.get(sha) as State;
  const ownBasis = (c: CommitInfo) => (c.sha === anchor ? c.sha : (c.parents[0] as string));
  const own = (c: CommitInfo) => stateOf(ownBasis(c));
  const sigs = signatureCache(wc);
  await sigs.prefetch(commits.map((commit) => ({ commit, state: own(commit) })));

  let governing: Walk['governing'] = { sha: undefined, entries: [] };
  let frozenAt: string | undefined;
  let open: string[] = [];
  const checked: Checked[] = [];
  for (const commit of commits) {
    const basis = frozenAt ?? ownBasis(commit);
    const before = stateOf(basis);
    const sig = await sigs.of(commit, before);
    const states = { before, after: stateOf(commit.sha), basis };
    const c = await checkCommit(wc, commit, anchor, states, sig);
    if (frozenAt !== undefined && commit.parents.length === 1) {
      const entries = governs(c) ? c.quarantine.entries : undefined;
      c.reasons.push(...(await taintReasons(wc, commit, { at: frozenAt, open }, entries)));
    }
    checked.push(c);
    if (c.reasons.length > 0) {
      open.push(c.sha);
      frozenAt ??= basis;
    }
    if (governs(c)) {
      governing = { sha: c.sha, entries: c.quarantine.entries };
      if (thaws(c, open)) {
        open = [];
        frozenAt = undefined;
      }
    }
  }
  return {
    anchor,
    to,
    checked,
    governing,
    next: stateOf(frozenAt ?? to),
    open,
    frozenAt,
  };
}

// --- Einstieg -------------------------------------------------------------------------------

/** Der eingefrorene Stand für den nächsten Commit; `firstOpen` steht im Grund `baut auf …`. */
export type FrozenBasis = { at: string; firstOpen: string; open: string[] };

function frozenOf(w: Walk): { frozen?: FrozenBasis } {
  if (w.frozenAt === undefined) return {};
  return { frozen: { at: w.frozenAt, firstOpen: w.open[0] as string, open: w.open } };
}

/**
 * Grundlage des nächsten Commits auf `HEAD`: der Stand, gegen den `verifyRange` ihn für Rechte,
 * Signatur und Identitätsschutz beurteilen wird (eingefroren, solange ungültige Commits ungedeckt
 * sind, sonst `HEAD`), und der Text der maßgeblichen Quarantäne-Datei (ohne eine solche
 * `undefined`). Ob er verseuchte Pfade ändert, prüft das nicht; dafür nennt `frozen` den
 * eingefrorenen Commit und die offenen ungültigen Commits (`pathTaintReasons`).
 */
export async function nextCommitBasis(wc: string): Promise<{
  state: State;
  quarantineText: string | undefined;
  frozen?: FrozenBasis;
}> {
  const w = await walk(wc, {});
  const { governing, next } = w;
  const frozen = frozenOf(w);
  if (governing.sha === undefined) return { state: next, quarantineText: undefined, ...frozen };
  const spec = `${governing.sha}:${QUARANTINE}`;
  const text = (await readBlobs(wc, [spec])).get(spec)?.toString('utf8');
  return { state: next, quarantineText: text, ...frozen };
}

/**
 * Grundlage für den Schreibpfad: Stand und eingefrorener Stand wie bei `nextCommitBasis`, ohne
 * Quarantäne-Text. Die Bereichsprüfung gegen `verified` gehört zu `verify`, nicht zum Schreiben:
 * Liegt HEAD nach einem lokalen Reset unter `verified`, wird trotzdem geschrieben; nur ein
 * fehlender Anker bleibt ein Fehler. Ist `verified` ein Vorfahre von HEAD, beginnt der Gang dort:
 * `verified` wird nur aufgezeichnet, wenn kein ungültiger Commit ungedeckt ist, und dann hat die
 * maßgebliche Quarantäne den Stand aufgetaut — eingefroren ist er dort nie.
 */
export async function writeCommitBasis(
  wc: string,
): Promise<{ state: State; frozen?: FrozenBasis }> {
  const verified = await readLocalState(wc, 'verified');
  const since =
    verified !== undefined && (await isAncestor(wc, verified, 'HEAD').catch(() => false))
      ? verified
      : undefined;
  const w = await walk(wc, since === undefined ? {} : { since }, false);
  return { state: w.next, ...frozenOf(w) };
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
  for (const { notices, quarantine: _, basis: __, ...finding } of checked) {
    report.notices.push(...notices);
    if (finding.reasons.length === 0) continue;
    const entry = governing.entries.find((e) => e.sha === finding.sha);
    if (entry === undefined) report.invalid.push(finding);
    else report.quarantined.push({ ...finding, decision: entry.decision, note: entry.reason });
  }
  if (opts.record && report.invalid.length === 0) await writeLocalState(wc, 'verified', to);
  return report;
}

/** Nur der Modus; unbekannte Felder einer neueren Formatversion stören nicht. */
const VerifyModeSchema = z.object({ verify: BacklogConfigSchema.shape.verify });

/**
 * `verify`-Modus des letzten vertrauenswürdigen Stands bis `to` (Default `HEAD`): der Config im
 * Stand, gegen den der erste verbliebene ungültige Commit beurteilt wurde — der eingefrorene Stand,
 * nicht der Parent dieses Commits, denn ein ungültiger Commit darf den Modus, nach dem er beurteilt
 * wird, nicht selbst setzen. Ohne verbliebene ungültige Commits gilt der Stand von `to`; ohne
 * lesbare Config `strict`. Die Abstammung prüft der Aufrufer, der den Bereich schon geprüft hat.
 */
export async function trustedVerifyMode(wc: string, to?: string): Promise<VerifyMode> {
  const range = await walk(wc, to === undefined ? {} : { to }, false);
  const first = range.checked.find(
    (c) => c.reasons.length > 0 && !range.governing.entries.some((e) => e.sha === c.sha),
  );
  const spec = `${first?.basis ?? range.to}:${BACKLOG_CONFIG}`;
  const blob = (await readBlobs(wc, [spec])).get(spec);
  if (blob === null || blob === undefined) return 'strict';
  const config = parseJsoncAs(VerifyModeSchema, blob.toString('utf8'), BACKLOG_CONFIG);
  return typeof config === 'string' ? 'strict' : config.verify;
}

/** Eine Datei mit Top-Level-Keys, die das Schema nicht kennt (backe.md §2.3), in Dateireihenfolge. */
export type UnknownKeys = { path: string; keys: string[] };

export type BacklogVerifyReport = VerifyReport & {
  propNotices: string[];
  unknownKeys: UnknownKeys[];
};

/**
 * `backe verify` für die Arbeitskopie des Kontexts: der Bericht von `verifyRange`, dazu je
 * Property, deren Wert eine (inzwischen verschärfte) Deklaration verletzt, ein Hinweis
 * `<id> <key>: <meldung>` — ein Hinweis, kein Fehler (backe.md §2.24) — und je Datei mit unbekannten
 * Keys ein Eintrag in `unknownKeys` (backe.md §2.3), nach Pfad sortiert.
 */
export async function verifyBacklog(
  ctx: ResolvedContext,
  opts: VerifyOptions = {},
): Promise<BacklogVerifyReport> {
  const root = requireRoot(ctx);
  const report = await verifyRange(root, opts);
  const snapshot = await loadSnapshot(root);
  const propNotices = propViolations(snapshot).map((v) => `${v.id} ${v.key}: ${v.message}`);
  const unknownKeys = [
    snapshot.users,
    snapshot.projects,
    snapshot.sprints,
    snapshot.repos,
    snapshot.issues,
  ]
    .flatMap((entities) => [...entities.values()] as StoredEntity<unknown>[])
    .filter((e) => e.extra.length > 0)
    .map((e) => ({ path: e.path, keys: e.extra.map(([k]) => k) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { ...report, propNotices, unknownKeys };
}

/**
 * Wirft `verify`, wenn ungültige Commits übrig sind; die Details sind der Bericht oder, für eine
 * Ausgabe mit anderen Feldnamen, `details`.
 */
export function assertVerified(report: VerifyReport, details: unknown = report): void {
  if (report.invalid.length === 0) return;
  throw new BackeError(
    'verify',
    `${report.invalid.length} ungültige Commits seit ${shortSha(report.anchor)}`,
    { details },
  );
}

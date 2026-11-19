/**
 * `verify` (backe.md §2.13): prüft jeden Commit seit dem Vertrauensanker gegen den Users-Stand
 * seines Parents — Signatur, `Backe-Actor`, Identitätsschutz — und lässt Commits passieren, die
 * ein Admin in `.backe/quarantine.jsonc` eingetragen hat.
 */
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { z } from 'zod';
import { BackeError } from '../core/errors.ts';
import {
  type BacklogConfig,
  BacklogConfigSchema,
  type Quarantine,
  QuarantineSchema,
  type User,
  validateEntity,
} from '../core/schemas.ts';
import { sshFingerprint } from '../core/ssh.ts';
import {
  type CommitInfo,
  isAncestor,
  listCommits,
  listTree,
  objectInfo,
  type RawChange,
  readBlobs,
  removedHandles,
  resolveCommit,
  rootCommits,
  type Signature,
  signatures,
  treeChanges,
} from '../git/history.ts';
import { readLocalState, stateDir, writeLocalState } from '../git/local-state.ts';
import { parseCommitMessage, TRAILER_ACTOR, TRAILER_OP } from '../git/message.ts';
import { parseOpTrailer } from '../ops/operation.ts';
import { checkCommitPolicy, type TreeChange } from '../ops/verify-policy.ts';
import { writeFileAtomic } from '../store/files.ts';
import { parseEntityFile } from '../store/frontmatter.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG, classifyPath, QUARANTINE } from '../store/layout.ts';

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

/** Users- und Config-Stand eines Commits; eine kaputte Config ist ihre Fehlermeldung. */
type State = { usersTree: string; users: Map<string, User>; config: BacklogConfig | string };
type Checked = VerifyFinding & { notices: string[]; quarantine?: Quarantine };

const short = (sha: string) => sha.slice(0, 7);
const REGULAR_FILE = /^100[0-7]{3}$/;

function schemaError(error: z.ZodError): string {
  return error.issues
    .map((i) => `${i.path.length > 0 ? i.path.join('.') : '<root>'}: ${i.message}`)
    .join('; ');
}

/** JSONC lesen und gegen das Schema prüfen; ein Fehler kommt als Meldung zurück. */
function parseJsoncAs<T>(schema: z.ZodType<T>, text: string, file: string): T | string {
  try {
    const result = schema.safeParse(readJsonc(text, file));
    return result.success ? result.data : schemaError(result.error);
  } catch (err) {
    if (err instanceof BackeError) return err.message;
    throw err;
  }
}

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

// --- Users- und Config-Stände ---------------------------------------------------------------

async function readUsers(wc: string, tree: string): Promise<Map<string, User>> {
  const files = (await listTree(wc, tree)).filter(
    (e) => REGULAR_FILE.test(e.mode) && classifyPath(`users/${e.name}`).kind === 'user',
  );
  const blobs = await readBlobs(
    wc,
    files.map((e) => e.oid),
  );
  const users = new Map<string, User>();
  for (const { name, oid } of files) {
    const path = `users/${name}`;
    try {
      const { data } = parseEntityFile((blobs.get(oid) as Buffer).toString('utf8'), path);
      users.set(name.slice(0, -'.md'.length), validateEntity('user', data, path).data as User);
    } catch (err) {
      // Eine ungültige User-Datei verleiht keine Rechte; ihr Commit ist schon `nicht prüfbar`.
      if (!(err instanceof BackeError)) throw err;
    }
  }
  return users;
}

/** Stände je Commit; Users-Bäume und Config-Blobs werden je Objekt-ID nur einmal gelesen. */
async function loadStates(wc: string, shas: readonly string[]): Promise<Map<string, State>> {
  const info = await objectInfo(
    wc,
    shas.flatMap((s) => [`${s}:users`, `${s}:${BACKLOG_CONFIG}`]),
  );
  const usersByTree = new Map<string, Map<string, User>>([['none', new Map()]]);
  const configs = new Map<string, BacklogConfig | string>([['none', 'fehlt']]);
  const states = new Map<string, State>();
  for (const sha of shas) {
    const users = info.get(`${sha}:users`);
    const usersTree = users?.type === 'tree' ? users.oid : 'none';
    if (!usersByTree.has(usersTree)) usersByTree.set(usersTree, await readUsers(wc, usersTree));
    const config = info.get(`${sha}:${BACKLOG_CONFIG}`);
    const configBlob = config?.type === 'blob' ? config.oid : 'none';
    if (!configs.has(configBlob)) {
      const text = (await readBlobs(wc, [configBlob])).get(configBlob) as Buffer;
      configs.set(
        configBlob,
        parseJsoncAs(BacklogConfigSchema, text.toString('utf8'), BACKLOG_CONFIG),
      );
    }
    states.set(sha, {
      usersTree,
      users: usersByTree.get(usersTree) as Map<string, User>,
      config: configs.get(configBlob) as BacklogConfig | string,
    });
  }
  return states;
}

// --- Signaturen -----------------------------------------------------------------------------

/** `<stateDir>/allowed_signers/<users-tree>` aus den nicht widerrufenen Keys; einmal je Baum. */
async function allowedSigners(wc: string, state: State): Promise<string> {
  const dir = join(await stateDir(wc), 'allowed_signers');
  const file = join(dir, state.usersTree);
  const exists = await access(file).then(
    () => true,
    () => false,
  );
  if (!exists) {
    const lines: string[] = [];
    for (const [handle, user] of state.users) {
      const active = activeFingerprints(user);
      for (const key of user.keys) {
        if (active.has(sshFingerprint(key))) lines.push(`${handle} namespaces="git" ${key}`);
      }
    }
    await mkdir(dir, { recursive: true });
    await writeFileAtomic(
      file,
      lines
        .sort()
        .map((l) => `${l}\n`)
        .join(''),
    );
  }
  return file;
}

/** Der Users-Stand, gegen den ein Commit signiert sein muss: der Anker gegen sich selbst. */
function signerState(commit: CommitInfo, anchor: string, states: Map<string, State>): State {
  return states.get(commit.sha === anchor ? commit.sha : (commit.parents[0] as string)) as State;
}

/** Signaturen aller Nicht-Merge-Commits; Commits mit gleichem Users-Baum in einem Aufruf. */
async function checkSignatures(
  wc: string,
  commits: readonly CommitInfo[],
  anchor: string,
  states: Map<string, State>,
): Promise<Map<string, Signature>> {
  const groups = new Map<string, { state: State; shas: string[] }>();
  for (const commit of commits) {
    // Nur SSH-Signaturen gehen an git: andere Formate prüfte git gegen fremde Keyrings, und ein
    // unbekanntes Format bricht `git log` ab.
    if (commit.parents.length > 1 || !isSshSignature(commit.gpgsig)) continue;
    const state = signerState(commit, anchor, states);
    const group = groups.get(state.usersTree) ?? { state, shas: [] };
    group.shas.push(commit.sha);
    groups.set(state.usersTree, group);
  }
  const result = new Map<string, Signature>();
  for (const { state, shas } of groups.values()) {
    for (const [sha, sig] of await signatures(wc, shas, await allowedSigners(wc, state))) {
      result.set(sha, sig);
    }
  }
  return result;
}

const SSH_SIGNATURE = '-----BEGIN SSH SIGNATURE-----';

function isSshSignature(gpgsig: string | undefined): boolean {
  return gpgsig?.startsWith(SSH_SIGNATURE) === true;
}

/** Fingerprints der nicht widerrufenen Keys eines Users. */
function activeFingerprints(user: User | undefined): Set<string> {
  const revoked = new Set((user?.revoked_keys ?? []).map((r) => sshFingerprint(r.key)));
  return new Set((user?.keys ?? []).map(sshFingerprint).filter((fp) => !revoked.has(fp)));
}

/**
 * Gründe aus Signatur-Header und git-Ergebnis, gegen die Users des Signer-Stands. Ein `G` zählt
 * nur, wenn der Key ein aktiver Key des gemeldeten Prinzipals ist.
 */
export function signatureReasons(
  sig: Signature | undefined,
  gpgsig: string | undefined,
  users: ReadonlyMap<string, User>,
): string[] {
  if (gpgsig === undefined) return ['unsigniert'];
  if (!isSshSignature(gpgsig)) return ['Signatur ist keine SSH-Signatur'];
  if (sig === undefined || sig.status === 'N') return ['unsigniert'];
  if (sig.status === 'B') return ['Signatur ungültig'];
  if (sig.status === 'G') {
    return activeFingerprints(users.get(sig.principal)).has(sig.fingerprint)
      ? []
      : [`Key ${sig.fingerprint} gehört nicht zu ${sig.principal}`];
  }
  for (const [handle, user] of users) {
    if ((user.revoked_keys ?? []).some((r) => sshFingerprint(r.key) === sig.fingerprint)) {
      return [`Key ${sig.fingerprint} von ${handle} ist widerrufen`];
    }
  }
  return [`Key ${sig.fingerprint} gehört zu keinem User`];
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

/** Identitätsschutz und Quarantäne-Datei eines Nicht-Anker-Commits. */
async function contentReasons(
  wc: string,
  commit: CommitInfo,
  actor: string,
  states: Map<string, State>,
): Promise<{ reasons: string[]; quarantine?: Quarantine }> {
  const parent = commit.parents[0] as string;
  const changes = await changesOf(wc, parent, commit.sha);
  const before = states.get(parent) as State;
  const after = states.get(commit.sha) as State;
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

async function checkCommit(
  wc: string,
  commit: CommitInfo,
  anchor: string,
  states: Map<string, State>,
  sigs: Map<string, Signature>,
): Promise<Checked> {
  const { subject, trailers } = parseCommitMessage(commit.message);
  const base = { sha: commit.sha, subject, notices: [] as string[] };
  if (commit.parents.length > 1) return { ...base, reasons: ['Merge-Commit'] };
  const sig = sigs.get(commit.sha);
  const actors = trailers.get(TRAILER_ACTOR) ?? [];
  const ops = trailers.get(TRAILER_OP) ?? [];
  const actor = actors.length === 1 ? actors[0] : undefined;
  const reasons = [
    ...signatureReasons(sig, commit.gpgsig, signerState(commit, anchor, states).users),
    ...actorReasons(actors, sig),
  ];
  if (commit.sha === anchor) {
    reasons.push(...anchorReasons(states.get(commit.sha) as State, actor, ops));
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

/**
 * Maßgeblich ist die Quarantäne-Datei des letzten gültigen Commits im Bereich, der sie ändert;
 * ohne einen solchen der Stand bei `since`, sonst keine.
 */
async function governingQuarantine(
  wc: string,
  checked: readonly Checked[],
  since: string | undefined,
): Promise<Quarantine['entries']> {
  const last = checked.findLast((c) => c.quarantine !== undefined && c.reasons.length === 0);
  if (last !== undefined) return (last.quarantine as Quarantine).entries;
  if (since === undefined) return [];
  const atSince = await quarantineAt(wc, since);
  return typeof atSince === 'object' ? atSince.entries : [];
}

// --- Einstieg -------------------------------------------------------------------------------

async function checkRange(wc: string, opts: VerifyOptions) {
  const { anchor, to, since } = await resolveRange(wc, opts);
  const commits = await listCommits(wc, { from: since, to });
  const parents = commits.flatMap((c) => c.parents.slice(0, 1));
  const states = await loadStates(wc, [...new Set([...commits.map((c) => c.sha), ...parents])]);
  const sigs = await checkSignatures(wc, commits, anchor, states);
  const checked: Checked[] = [];
  for (const commit of commits) checked.push(await checkCommit(wc, commit, anchor, states, sigs));
  return { anchor, to, since, commits, checked };
}

/**
 * Text der maßgeblichen Quarantäne-Datei bei `HEAD`, genau nach der Regel von `verifyRange`: die
 * Datei im letzten Commit der Historie, der sie ändert und ohne Quarantäne gültig ist; ohne einen
 * solchen `undefined`.
 */
export async function governingQuarantineText(wc: string): Promise<string | undefined> {
  const { checked } = await checkRange(wc, {});
  const last = checked.findLast((c) => c.quarantine !== undefined && c.reasons.length === 0);
  if (last === undefined) return undefined;
  const spec = `${last.sha}:${QUARANTINE}`;
  return (await readBlobs(wc, [spec])).get(spec)?.toString('utf8');
}

/** Prüft die Commits nach `since` (ohne: ab dem Anker) bis `to` (Default `HEAD`). */
export async function verifyRange(wc: string, opts: VerifyOptions = {}): Promise<VerifyReport> {
  const { anchor, to, since, commits, checked } = await checkRange(wc, opts);
  const entries = await governingQuarantine(wc, checked, since);
  const report: VerifyReport = {
    anchor,
    to,
    checked: commits.length,
    invalid: [],
    quarantined: [],
    notices: [],
  };
  for (const { notices, quarantine: _, ...finding } of checked) {
    report.notices.push(...notices);
    if (finding.reasons.length === 0) continue;
    const entry = entries.find((e) => e.sha === finding.sha);
    if (entry === undefined) report.invalid.push(finding);
    else report.quarantined.push({ ...finding, decision: entry.decision, note: entry.reason });
  }
  if (opts.record && report.invalid.length === 0) await writeLocalState(wc, 'verified', to);
  return report;
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

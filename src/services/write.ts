/**
 * Der Schreibpfad (backe.md §2.16.1): jede Änderung am Backlog läuft hierüber, unter dem
 * Write-Lock der Arbeitskopie, mit Journal für Abstürze und genau einem signierten Commit.
 */
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type LockOptions, withFileLock } from '../context/lock.ts';
import { exists } from '../context/paths.ts';
import { workingCopyPath } from '../context/registry.ts';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { userConfigPath } from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import {
  BACKLOG_FORMAT_VERSION,
  type BacklogConfig,
  BacklogConfigSchema,
  type Comment,
  type Quarantine,
  QuarantineSchema,
  type User,
  validateEntity,
} from '../core/schemas.ts';
import { sshFingerprint } from '../core/ssh.ts';
import { commitPaths } from '../git/commit.ts';
import { git } from '../git/exec.ts';
import { objectInfo, readBlobs, removedHandles } from '../git/history.ts';
import { readLocalState, stateDir, writeLocalState } from '../git/local-state.ts';
import {
  formatCommitMessage,
  parseCommitMessage,
  TRAILER_ACTOR,
  TRAILER_OP,
} from '../git/message.ts';
import { assertOnBranch, dirtyPaths, headState, rollbackPaths } from '../git/repo.ts';
import { readPublicKey } from '../git/ssh.ts';
import {
  type ApplyContext,
  applyOperation,
  assertActorIsUser,
  commentsNeeded,
} from '../ops/apply.ts';
import { applyBatch } from '../ops/batch.ts';
import type { Notice } from '../ops/notice.ts';
import {
  encodeBatchBody,
  encodeOp,
  type Operation,
  summarizeBatch,
  summarizeOp,
} from '../ops/operation.ts';
import { checkCommitPolicy, type PolicyState, type TreeChange } from '../ops/verify-policy.ts';
import {
  applyFileChanges,
  type FileChange,
  isIssueDirPath,
  writeFileAtomic,
} from '../store/files.ts';
import { parseEntityFile } from '../store/frontmatter.ts';
import { readJsonc } from '../store/jsonc.ts';
import {
  BACKLOG_CONFIG,
  classifyPath,
  GITATTRIBUTES,
  hasLfsRule,
  isLfsPath,
  QUARANTINE,
} from '../store/layout.ts';
import {
  type BacklogSnapshot,
  listComments,
  loadSnapshot,
  type StoredEntity,
} from '../store/snapshot.ts';
import { authorOf, isoNow } from './env.ts';
import {
  commentsAfterManual,
  type HandEdits,
  type Rewritten,
  readHandEdits,
  settleEdits,
} from './hand-edits.ts';
import { raiseSignal, withDeferredSignals } from './signals.ts';
import { coversOpen, type FrozenBasis, pathTaintReasons, writeCommitBasis } from './verify.ts';
import { activeFingerprints, parseJsoncAs, type State } from './verify-state.ts';
import { ensureWorkingCopy, identityMismatch } from './working-copy.ts';

export type WriteInput =
  | { kind: 'op'; op: Operation }
  | { kind: 'batch'; ops: readonly Operation[] }
  | {
      kind: 'derive';
      /**
       * Leitet die Operation(en) unter dem Write-Lock aus dem frisch geladenen Snapshot ab; wirft
       * sie, wird nichts geschrieben. Eine Operation (auch als Array der Länge 1) läuft danach wie
       * `kind: 'op'`, ab zwei wie `kind: 'batch'`; ein leeres Array schreibt nichts.
       */
      derive: (snapshot: BacklogSnapshot, actor: string) => Operation | readonly Operation[];
    }
  | {
      kind: 'manual';
      subject: string;
      changes: readonly FileChange[];
      /**
       * Users-Stand, gegen den `verify` diesen Commit beurteilt und in dem der Signier-Key aktiv
       * sein muss; ohne: der Stand von HEAD.
       */
      signers?: ReadonlyMap<string, User>;
      /** Der Stand, gegen den der Aufrufer geprüft hat; steht HEAD unter dem Lock woanders → `conflict`. */
      expectHead?: string;
    }
  | {
      /**
       * Hand-Edits der Arbeitskopie (backe.md §2.13): erst ein `manual`-Commit (Subject `subject`,
       * sonst `manual: <n> Dateien`), dann die übersetzten Operationen; HEAD springt einmal.
       */
      kind: 'edits';
      subject?: string;
    };

/** Ein Commit dieses Writes; nur `edits` erzeugt mehr als einen. */
export type ChainEntry = {
  commit: string;
  kind: 'manual' | 'op' | 'batch';
  recorded: Operation[];
  paths: string[];
};

export type WriteResult = {
  /** Der letzte Commit dieses Writes. */
  commit: string | undefined;
  recorded: Operation[];
  refs: Record<string, string>;
  notices: Notice[];
  /** Alle committeten Pfade, sortiert. */
  paths: string[];
  /** Gründe ungültiger Commits, wenn dieser Write die Arbeitskopie im Modus `warn` geklont hat. */
  verifyNotices: string[];
  chain: ChainEntry[];
  /** Hand-Edits mit unbekannten Keys (nur `edits`). */
  warnings: { path: string; unknownKeys: string[] }[];
  /** Hand-Edits, die nicht so committet wurden, wie sie dastanden (nur `edits`). */
  rewritten: Rewritten[];
  /**
   * Nur `edits`, nur wenn es scheiterte: Pfade, die nach den Commits nicht auf HEAD bzw. deren Index
   * nicht angeglichen werden konnten (die Commits stehen trotzdem); `rewritten` beschreibt dann
   * das Soll, nicht den Arbeitsbaum.
   */
  unsettled?: { paths: string[]; reason: string };
};

export type WriteDeps = {
  now?: () => Date;
  randomBytes?: (n: number) => Uint8Array;
  lock?: LockOptions;
  /**
   * Nur für Tests: `beforeLock` vor dem Holen des Locks, `afterFiles` nach dem Schreiben aller
   * Dateien, `afterCommit` nach dem letzten Commit.
   */
  hooks?: {
    beforeLock?: () => Promise<void>;
    afterFiles?: () => Promise<void>;
    afterCommit?: () => Promise<void>;
  };
  raise?: (signal: NodeJS.Signals) => void;
};

type ResolvedInput = Exclude<WriteInput, { kind: 'derive' }>;

/** Ein geplanter Commit: Änderungen, Message, aufgezeichnete Operationen. */
type Step = {
  kind: ChainEntry['kind'];
  changes: readonly FileChange[];
  recorded: Operation[];
  message: string;
  paths: string[];
  /** Unveränderte Anhänge, die dieser Commit wegen der neuen LFS-Regel neu ablegt. */
  renormalize?: string[];
};

type Planned = {
  steps: Step[];
  recorded: Operation[];
  refs: Record<string, string>;
  notices: Notice[];
};

/** Ein Pfad vor dem Write: Bytes base64-kodiert, `null` = fehlte. */
type SavedFile = { path: string; content: string | null };

/**
 * Inhalt von `write.journal`: die Pfade, die ein abgebrochener Write zurücksetzen muss, die Zahl
 * seiner Commits und bei Hand-Edits deren Inhalt vor dem Schreiben.
 */
type Journal = { head: string; paths: string[]; commits?: number; saved?: SavedFile[] };

/** Erster Parent von `rev`; `undefined` beim Wurzel-Commit. */
async function firstParent(wc: string, rev: string): Promise<string | undefined> {
  const { stdout } = await git(['log', '-1', '--format=%P', '--end-of-options', rev], { cwd: wc });
  const [parent] = stdout.trim().split(' ');
  return parent === '' ? undefined : parent;
}

/**
 * Blob-ID, die `git add` für `content` unter `path` ablegt: durch den Clean-Filter, den die
 * Attribute der Arbeitskopie für `path` wählen (unter der LFS-Regel der Pointer).
 */
async function cleanBlobId(
  wc: string,
  path: string,
  content: string | Uint8Array,
): Promise<string> {
  const { stdout } = await git(['hash-object', `--path=${path}`, '--stdin'], {
    cwd: wc,
    input: content,
  });
  return stdout.trim();
}

/**
 * Ob `commit` Subject und `Backe-Actor` von `message` trägt und jeden Pfad wie geplant enthält.
 * Anhänge unter der LFS-Regel des Commits liegen dort als Pointer; sie vergleicht die Blob-ID der
 * geplanten Bytes nach dem Clean-Filter, alle anderen Pfade die Bytes selbst.
 */
async function matchesStep(
  wc: string,
  commit: string,
  step: Pick<Step, 'changes' | 'message'>,
): Promise<boolean> {
  const expected = parseCommitMessage(step.message);
  const actual = parseCommitMessage(
    (await git(['log', '-1', '--format=%B', '--end-of-options', commit], { cwd: wc })).stdout,
  );
  if (
    actual.subject !== expected.subject ||
    actual.trailers.get(TRAILER_ACTOR)?.[0] !== expected.trailers.get(TRAILER_ACTOR)?.[0]
  ) {
    return false;
  }
  const specs = step.changes.map((c) => `${commit}:${c.path}`);
  const attributes = `${commit}:${GITATTRIBUTES}`;
  const [info, blobs] = await Promise.all([
    objectInfo(wc, specs),
    readBlobs(wc, [...specs, attributes]),
  ]);
  const lfs = hasLfsRule(blobs.get(attributes)?.toString('utf8'));
  for (const [i, c] of step.changes.entries()) {
    const spec = specs[i] as string;
    if (c.content === null) {
      if (info.get(spec) !== undefined) return false;
    } else if (lfs && isLfsPath(c.path)) {
      if (info.get(spec)?.oid !== (await cleanBlobId(wc, c.path, c.content))) return false;
    } else if (blobs.get(spec)?.equals(Buffer.from(c.content)) !== true) {
      return false;
    }
  }
  return true;
}

/**
 * Die Commits dieses Writes, falls sie trotz eines Fehlers danach auf HEAD gelandet sind: HEAD
 * und seine ersten Parents tragen, vom Ende her, Subject und `Backe-Actor` je Schritt und enthalten
 * jeden geschriebenen Pfad mit genau dem geplanten Inhalt; darunter liegt `head`. Ein fremder
 * Commit mit gleichem Baum zählt nicht.
 */
async function landedChain(
  wc: string,
  head: string,
  steps: readonly Pick<Step, 'changes' | 'message'>[],
): Promise<string[] | undefined> {
  let current = (await headState(wc)).head;
  if (current === undefined || current === head) return undefined;
  const commits: string[] = [];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (current === undefined || !(await matchesStep(wc, current, steps[i] as Step))) {
      return undefined;
    }
    commits.unshift(current);
    current = await firstParent(wc, current);
  }
  return current === head ? commits : undefined;
}

/** Inhalt von `paths` vor dem Write, Verzeichnisse samt aller Dateien darunter. */
async function capture(wc: string, paths: readonly string[]): Promise<SavedFile[]> {
  const out = new Map<string, string | null>();
  const visit = async (path: string, top: boolean): Promise<void> => {
    const abs = join(wc, path);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(abs);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (top && (code === 'ENOENT' || code === 'ENOTDIR')) {
        out.set(path, null);
        return;
      }
      throw err;
    }
    if (info.isDirectory()) {
      for (const name of (await readdir(abs)).sort()) await visit(`${path}/${name}`, false);
    } else if (info.isFile()) {
      out.set(path, (await readFile(abs)).toString('base64'));
    }
  };
  for (const path of paths) await visit(path, true);
  return [...out].map(([path, content]) => ({ path, content }));
}

/**
 * Stellt den Inhalt vor dem Write wieder her: Was fehlte, wird entfernt, alles andere mit den
 * gemerkten Bytes geschrieben. Der Index bleibt, wie er war; der Write hat ihn nicht berührt.
 */
async function restoreSaved(wc: string, saved: readonly SavedFile[]): Promise<void> {
  await applyFileChanges(wc, [
    ...saved
      .filter((f) => f.content === null)
      .map(
        ({ path }): FileChange =>
          isIssueDirPath(path) ? { path, content: null, recursive: true } : { path, content: null },
      ),
    ...saved.flatMap((f): FileChange[] =>
      f.content === null ? [] : [{ path: f.path, content: Buffer.from(f.content, 'base64') }],
    ),
  ]);
}

/**
 * Setzt die Pfade eines liegengebliebenen Journals zurück (Absturz mitten im Write). Nur wenn ein
 * Branch ausgecheckt ist, keine Operation läuft und HEAD noch der Stand des Journals ist oder die
 * Commits des Writes direkt darauf. Ist nichts gelandet und hat das Journal den Inhalt vor dem
 * Write (Hand-Edits), kommt dieser zurück; sonst gleicht der Rollback Arbeitsbaum und Index an
 * HEAD an. Andernfalls bleibt das Journal liegen und der Write bricht ab, bevor etwas angefasst wird.
 */
async function recoverJournal(wc: string, journal: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(journal, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const { head, paths, commits = 1, saved } = JSON.parse(text) as Journal;
  const state = await headState(wc);
  const below = async () =>
    (
      await git(['rev-parse', '-q', '--verify', `HEAD~${commits}`], { cwd: wc, okExitCodes: [1] })
    ).stdout.trim();
  const recoverable =
    state.branch !== undefined &&
    state.operation === undefined &&
    (state.head === head || (await below()) === head);
  if (!recoverable) {
    throw new BackeError(
      'conflict',
      `Unterbrochener Write in ${wc} kann nicht zurückgesetzt werden`,
      {
        hint: `git -C ${wc} status prüfen, dann ${journal} löschen`,
      },
    );
  }
  if (state.head === head && saved !== undefined) await restoreSaved(wc, saved);
  else await rollbackPaths(wc, paths);
  await rm(journal, { force: true });
}

/** Die Arbeitskopie gehört genau einer Identität; der erste Write legt sie fest (backe.md §2.16.1). */
async function checkIdentity(ctx: ResolvedContext, wc: string, handle: string): Promise<void> {
  const identity = await readLocalState(wc, 'identity');
  if (identity === undefined) {
    await writeLocalState(wc, 'identity', handle);
    return;
  }
  if (identity !== handle) {
    const own = workingCopyPath(ctx.userConfig, ctx.homes, ctx.backlog.value, handle);
    throw identityMismatch(wc, identity, handle, own);
  }
}

/**
 * Der Signier-Key ist ein aktiver Key des Schreibenden in `users`, dem Stand, gegen den `verify`
 * den Commit beurteilt; sonst verwürfe es ihn.
 */
async function checkSigningKey(
  ctx: ResolvedContext,
  key: string,
  handle: string,
  users: ReadonlyMap<string, User>,
): Promise<void> {
  const fingerprint = sshFingerprint(await readPublicKey(key));
  if (!activeFingerprints(users.get(handle)).has(fingerprint)) {
    throw new BackeError('usage', `Der Key ${key} ist kein aktiver Key von ${handle}`, {
      hint: `identities.${ctx.backlog.value}.${handle}.key in ${userConfigPath(ctx.homes.backeHome)} prüfen`,
    });
  }
}

/**
 * Liest `version` roh, bevor das Schema greift: ein neueres Format schreibt dieses backe nicht.
 * Ohne `rev` aus der Arbeitskopie, sonst aus `rev` — bei Hand-Edits aus HEAD, denn eine von Hand
 * geänderte Config ist selbst erst ein Teil des Writes.
 */
async function checkFormatVersion(wc: string, rev?: string): Promise<void> {
  const spec = `${rev}:${BACKLOG_CONFIG}`;
  const text =
    rev === undefined
      ? await readFile(join(wc, BACKLOG_CONFIG), 'utf8')
      : (await readBlobs(wc, [spec])).get(spec)?.toString('utf8');
  // Ohne Config in `rev` scheitert schon das Laden der Arbeitskopie.
  if (text === undefined) return;
  const raw = readJsonc(text, BACKLOG_CONFIG);
  const version = (raw as { version?: unknown } | null)?.version;
  if (typeof version === 'number' && version > BACKLOG_FORMAT_VERSION) {
    throw new BackeError(
      'validation',
      `Backlog-Format ${version} ist neuer als dieses backe (${BACKLOG_FORMAT_VERSION})`,
      { hint: 'backe aktualisieren; lesen geht weiter.' },
    );
  }
}

async function loadComments(
  wc: string,
  ops: readonly Operation[],
): Promise<Map<string, StoredEntity<Comment>[]>> {
  const comments = new Map<string, StoredEntity<Comment>[]>();
  for (const id of new Set(ops.flatMap(commentsNeeded))) {
    comments.set(id, await listComments(wc, id));
  }
  return comments;
}

function isOpList(d: Operation | readonly Operation[]): d is readonly Operation[] {
  return Array.isArray(d);
}

/** Die Operation(en) aus `derive` als `op` oder `batch`; `undefined` bei einem leeren Array. */
function resolveDerived(d: Operation | readonly Operation[]): ResolvedInput | undefined {
  if (!isOpList(d)) return { kind: 'op', op: d };
  if (d.length === 0) return undefined;
  return d.length === 1 ? { kind: 'op', op: d[0] as Operation } : { kind: 'batch', ops: d };
}

function changedPathsOf(changes: readonly FileChange[]): string[] {
  return [...new Set(changes.map((c) => c.path))].sort();
}

/** Was der Commit eines Schritts aufnimmt: seine Änderungen und die neu abgelegten Anhänge. */
const committedPaths = (s: Step): string[] => [...s.paths, ...(s.renormalize ?? [])].sort();

/** Commit-Message nach backe.md §2.13 für Operationen: eine im Trailer, mehrere als Batch. */
function opMessage(kind: 'op' | 'batch', recorded: readonly Operation[], handle: string): string {
  const actor = [TRAILER_ACTOR, handle] as const;
  if (kind === 'batch') {
    return formatCommitMessage({
      subject: summarizeBatch(recorded),
      body: encodeBatchBody(recorded),
      trailers: [actor, [TRAILER_OP, 'batch']],
    });
  }
  const op = recorded[0] as Operation;
  return formatCommitMessage({
    subject: summarizeOp(op),
    trailers: [actor, [TRAILER_OP, encodeOp(op)]],
  });
}

function manualStep(subject: string, changes: readonly FileChange[], handle: string): Step {
  return {
    kind: 'manual',
    changes,
    recorded: [],
    paths: changedPathsOf(changes),
    message: formatCommitMessage({
      subject,
      trailers: [
        [TRAILER_ACTOR, handle],
        [TRAILER_OP, 'manual'],
      ],
    }),
  };
}

function opStep(
  kind: 'op' | 'batch',
  changes: readonly FileChange[],
  recorded: Operation[],
  handle: string,
): Step {
  return {
    kind,
    changes,
    recorded,
    paths: changedPathsOf(changes),
    message: opMessage(kind, recorded, handle),
  };
}

const SPLIT_HINT = 'Änderung auf zwei backe commit aufteilen';

/**
 * Wendet die übersetzten Operationen der Hand-Edits als Batch an. Ein Fehler behält Code und
 * Message, verliert aber die Batch-Zeile (`Zeile <n>: `, `details.line`): Sie zählt Operationen,
 * die der User nie gesehen hat. Eine Verletzung ohne eigenen Hinweis bekommt den, die Änderung
 * aufzuteilen.
 */
function applyEditOps(
  s: BacklogSnapshot,
  ops: readonly Operation[],
  ctx: ApplyContext,
): ReturnType<typeof applyBatch> {
  try {
    return applyBatch(s, ops, ctx);
  } catch (err) {
    if (!(err instanceof BackeError)) throw err;
    const { line: _, ...details } = (err.details ?? {}) as { line?: number; reason?: unknown };
    const hint = err.hint ?? (details.reason === undefined ? undefined : SPLIT_HINT);
    throw new BackeError(err.code, err.message.replace(/^Zeile \d+: /, ''), {
      details,
      ...(hint === undefined ? {} : { hint }),
    });
  }
}

const POLICY_KINDS: ReadonlySet<string> = new Set(['user', 'issue', 'comment']);
const policyRelevant = (path: string) =>
  path === BACKLOG_CONFIG || POLICY_KINDS.has(classifyPath(path).kind);
const utf8Text = (content: string | Uint8Array | null | undefined): string | null =>
  content == null ? null : Buffer.from(content).toString('utf8');

/**
 * Users und Config nach `changes`, ausgehend von `state`. Eine Config, die sich nicht lesen lässt,
 * scheitert schon beim Laden der Arbeitskopie; User-Dateien hat `readHandEdits` geprüft.
 */
function policyStateAfter(state: PolicyState, changes: readonly TreeChange[]): PolicyState {
  const users = new Map(state.users);
  let config: BacklogConfig = state.config;
  for (const c of changes) {
    const cls = classifyPath(c.path);
    if (cls.kind === 'user') {
      users.delete(cls.key);
      if (c.after === null) continue;
      const { data } = parseEntityFile(c.after, c.path);
      users.set(cls.key, validateEntity('user', data, c.path).data as User);
    } else if (c.path === BACKLOG_CONFIG && c.after !== null) {
      config = BacklogConfigSchema.parse(readJsonc(c.after, BACKLOG_CONFIG));
    }
  }
  return { config, users };
}

/** Der eingefrorene Stand, gegen den `verify` den nächsten Commit beurteilt. */
type Frozen = FrozenBasis & { state: State };

/**
 * Die Dateien entlang einer geplanten Kette: HEAD, überlagert mit dem, was frühere Schritte
 * schreiben. Liefert je Schritt die geänderten Dateien mit ihrer Blob-ID im Parent und die
 * Blob-ID danach (über den Clean-Filter der Arbeitskopie, wie `git add` sie ablegt).
 */
function chainTree(wc: string, head: string) {
  const written = new Map<string, string | Uint8Array | null>();
  const oidOf = async (path: string, content: string | Uint8Array | null) =>
    content === null ? undefined : cleanBlobId(wc, path, content);
  /** Dateien unter `dir` im Parent des nächsten Schritts. */
  async function filesUnder(dir: string): Promise<string[]> {
    const { stdout } = await git(
      ['ls-tree', '-r', '-z', '--name-only', '--end-of-options', head, '--', dir],
      { cwd: wc, env: { GIT_LITERAL_PATHSPECS: '1' } },
    );
    const files = new Set(stdout.split('\0').filter((f) => f !== ''));
    for (const [path, content] of written) {
      if (!path.startsWith(`${dir}/`)) continue;
      if (content === null) files.delete(path);
      else files.add(path);
    }
    return [...files];
  }
  return {
    /** Die Dateien, die `step` ändert, samt Blob-ID im Parent; `after` je Pfad. */
    async changes(step: Step) {
      const next = new Map<string, string | Uint8Array | null>();
      for (const c of step.changes) {
        if (c.recursive === true) for (const f of await filesUnder(c.path)) next.set(f, null);
        else next.set(c.path, c.content);
      }
      const unwritten = (p: string) => !written.has(p);
      const renormalize = step.renormalize ?? [];
      const fromHead = [...next.keys(), ...renormalize].filter(unwritten);
      const specs = fromHead.map((p) => `${head}:${p}`);
      const [info, blobs] = await Promise.all([
        objectInfo(wc, specs),
        readBlobs(
          wc,
          renormalize.filter(unwritten).map((p) => `${head}:${p}`),
        ),
      ]);
      // Neu abgelegt wird der Inhalt, der schon da ist — jetzt durch den Filter der neuen Regel.
      for (const p of renormalize) {
        next.set(
          p,
          written.has(p) ? (written.get(p) ?? null) : (blobs.get(`${head}:${p}`) ?? null),
        );
      }
      const files = await Promise.all(
        [...next].map(async ([path]) => ({
          path,
          parent: written.has(path)
            ? await oidOf(path, written.get(path) ?? null)
            : info.get(`${head}:${path}`)?.oid,
        })),
      );
      return {
        files,
        after: async (path: string) => oidOf(path, next.get(path) ?? null),
        apply: () => {
          for (const [path, content] of next) written.set(path, content);
        },
      };
    },
  };
}

/**
 * Prüft die geplante Kette vor dem Schreiben, wie `verify` ihre Commits beurteilen wird (backe.md
 * §2.13 Punkt 4), und liefert die Gründe. Jeder Schritt gilt gegen den Stand von HEAD bzw. nach
 * dem vorigen Schritt; solange ungültige Commits offen sind (`frozen`), wie bei `verify` gegen den
 * eingefrorenen Stand und zusätzlich auf verseuchte Pfade (`pathTaintReasons`, dieselbe Regel wie
 * in `verify`). Ein sonst gültiger Schritt, dessen Quarantäne alle offenen Commits deckt, taut auf;
 * die Schritte danach gelten wieder gegen ihren Parent. `before` ist der Inhalt bearbeiteter
 * Pfade in HEAD (Hand-Edits). Rekursiv gelöschte Issue-Verzeichnisse prüft die Policy frei (Issue
 * und Kommentare darin); für verseuchte Pfade zählt jede Datei darin.
 */
async function chainReasons(
  wc: string,
  head: string,
  snapshot: BacklogSnapshot,
  before: ReadonlyMap<string, Buffer | null> | undefined,
  steps: readonly Step[],
  actor: string,
  frozen: Frozen | undefined,
): Promise<string[]> {
  let state: PolicyState = {
    config: snapshot.config,
    users: new Map([...snapshot.users].map(([h, u]) => [h, u.data])),
  };
  const known = new Map<string, string | null>();
  for (const [path, content] of before ?? []) known.set(path, utf8Text(content));
  const tree = chainTree(wc, head);
  let open = frozen;
  let removed: ReadonlySet<string> | undefined;
  const reasons: string[] = [];
  for (const step of steps) {
    const found: string[] = [];
    const last = new Map<string, FileChange>();
    for (const c of step.changes) if (c.recursive !== true) last.set(c.path, c);
    const missing = [...last.keys()].filter((p) => policyRelevant(p) && !known.has(p));
    const blobs = await readBlobs(
      wc,
      missing.map((p) => `${head}:${p}`),
    );
    for (const p of missing) known.set(p, utf8Text(blobs.get(`${head}:${p}`)));
    const changes: TreeChange[] = [...last.values()].map((c) => {
      const after = utf8Text(c.content);
      const was = policyRelevant(c.path) ? (known.get(c.path) ?? null) : null;
      return {
        path: c.path,
        status: after === null ? 'D' : was === null && policyRelevant(c.path) ? 'A' : 'M',
        oldMode: was === null ? '000000' : '100644',
        newMode: after === null ? '000000' : '100644',
        before: was,
        after,
      };
    });
    const next = policyStateAfter(state, changes);
    const judge = open?.state ?? state;
    if (typeof judge.config === 'string') {
      found.push(`nicht prüfbar: ${BACKLOG_CONFIG}: ${judge.config}`);
    } else {
      const addsUser = changes.some(
        (c) => c.status === 'A' && classifyPath(c.path).kind === 'user',
      );
      if (addsUser) removed ??= await removedHandles(wc, head);
      found.push(
        ...checkCommitPolicy({
          actor,
          parent: { config: judge.config, users: judge.users },
          after: next,
          changes,
          removedHandles: removed ?? new Set(),
        }),
      );
    }
    const quarantine = last.get(QUARANTINE);
    let entries: Quarantine['entries'] | undefined;
    if (quarantine !== undefined) {
      const parsed =
        quarantine.content === null
          ? { entries: [] }
          : parseJsoncAs(QuarantineSchema, utf8Text(quarantine.content) as string, QUARANTINE);
      if (typeof parsed === 'string') found.push(`quarantine.jsonc ungültig: ${parsed}`);
      else entries = parsed.entries;
    }
    if (open !== undefined) {
      const valid = found.length === 0 ? entries : undefined;
      const files = await tree.changes(step);
      found.push(...(await pathTaintReasons(wc, files.files, files.after, open, valid)));
      files.apply();
      if (valid !== undefined && coversOpen(valid, open.open)) open = undefined;
    }
    for (const reason of found) if (!reasons.includes(reason)) reasons.push(reason);
    for (const c of changes) known.set(c.path, c.after);
    state = next;
  }
  return reasons;
}

/**
 * Plant die Commits: Operationen rein gegen den Snapshot, manuelle Änderungen direkt, Hand-Edits
 * als `manual`-Anteil vor den Operationen, die gegen den Stand danach laufen.
 */
async function plan(
  wc: string,
  snapshot: BacklogSnapshot,
  head: string,
  input: ResolvedInput,
  edits: HandEdits | undefined,
  handle: string,
  deps: WriteDeps,
): Promise<Planned> {
  const none: Planned = { steps: [], recorded: [], refs: {}, notices: [] };
  if (input.kind === 'manual') {
    return input.changes.length === 0
      ? none
      : { ...none, steps: [manualStep(input.subject, input.changes, handle)] };
  }
  const ops =
    input.kind === 'edits' ? (edits?.ops ?? []) : input.kind === 'op' ? [input.op] : input.ops;
  const applyCtx: ApplyContext = {
    actor: handle,
    now: isoNow((deps.now ?? (() => new Date()))()),
    randomBytes: deps.randomBytes,
    comments:
      edits === undefined
        ? await loadComments(wc, ops)
        : await commentsAfterManual(wc, edits, ops.flatMap(commentsNeeded)),
    removedHandles: ops.some((op) => op.op === 'user.add')
      ? await removedHandles(wc, head)
      : undefined,
  };
  if (input.kind === 'edits') {
    if (edits === undefined) return none;
    const steps: Step[] = [];
    if (edits.manual.length > 0) {
      const subject = input.subject ?? `manual: ${edits.manual.length} Dateien`;
      steps.push(manualStep(subject, edits.manual, handle));
    }
    if (ops.length === 0) return { ...none, steps };
    const r = applyEditOps(edits.afterManual, ops, applyCtx);
    if (r.changes.length > 0) {
      steps.push(opStep(r.recorded.length === 1 ? 'op' : 'batch', r.changes, r.recorded, handle));
    }
    return { steps, recorded: r.recorded, refs: r.refs, notices: r.notices };
  }
  if (input.kind === 'batch') {
    const r = applyBatch(snapshot, input.ops, applyCtx);
    const steps = r.changes.length === 0 ? [] : [opStep('batch', r.changes, r.recorded, handle)];
    return { steps, recorded: r.recorded, refs: r.refs, notices: r.notices };
  }
  const r = applyOperation(snapshot, input.op, applyCtx);
  const recorded = r.noop ? [] : [r.recorded];
  const steps = r.changes.length === 0 ? [] : [opStep('op', r.changes, recorded, handle)];
  return { steps, recorded, refs: {}, notices: r.notices };
}

/**
 * Mit `attachments.lfs` (backe.md §2.8) muss `git lfs` laufen, und die Arbeitskopie braucht den
 * LFS-Filter in ihrer eigenen `.git/config` (`git lfs install --local`): Sonst landeten Anhänge roh
 * im Commit, `git status` hielte jeden Anhang für geändert und ein Checkout schriebe den Pointer
 * statt der Bytes. Die globale Git-Config bleibt unberührt. Liegt schon ein fremder Hook, den
 * git-lfs nicht überschreibt, kommt nur der Filter dazu.
 */
async function setUpLfs(wc: string): Promise<void> {
  try {
    await git(['lfs', 'version'], { cwd: wc });
  } catch {
    throw new BackeError('validation', 'attachments.lfs verlangt git-lfs', {
      hint: 'backe doctor',
    });
  }
  const filter = await git(['config', '--local', '--get', 'filter.lfs.process'], {
    cwd: wc,
    okExitCodes: [1],
  });
  if (filter.exitCode === 0) return;
  await git(['lfs', 'install', '--local'], { cwd: wc }).catch(() =>
    git(['lfs', 'install', '--local', '--skip-repo'], { cwd: wc }),
  );
}

/** Ob `path` von `change` geschrieben oder (als Verzeichnis) mitgelöscht wird. */
function touches(change: FileChange, path: string): boolean {
  return change.path === path || path.startsWith(`${change.path}/`);
}

/**
 * Führt ein Schritt `LFS_RULE` in `.gitattributes` ein (backe.md §2.8), nimmt sein Commit alle
 * Anhänge auf, die schon roh im Baum liegen: Über den frischen Index des Commits legt `git add`
 * sie mit der neuen Regel als Pointer ab. Sonst hielte `git status` jeden von ihnen dauerhaft für
 * geändert, und Writes auf diese Pfade scheiterten an »ungesicherten Änderungen«. Die Bytes im
 * Arbeitsbaum bleiben, wie sie sind.
 */
async function markRenormalization(
  wc: string,
  head: string,
  attributes: string | undefined,
  steps: readonly Step[],
): Promise<void> {
  let current = attributes;
  for (const [i, step] of steps.entries()) {
    const change = step.changes.findLast((c) => c.path === GITATTRIBUTES);
    let next = current;
    if (change !== undefined) {
      next = change.content === null ? undefined : Buffer.from(change.content).toString('utf8');
    }
    if (!hasLfsRule(current) && hasLfsRule(next)) {
      const { stdout } = await git(
        ['ls-tree', '-r', '-z', '--name-only', '--end-of-options', head, '--', 'issues'],
        { cwd: wc },
      );
      const inTree = new Set(stdout.split('\0').filter(isLfsPath));
      // Was frühere Schritte der Kette an Anhängen schreiben oder löschen, liegt so im Baum.
      for (const c of steps.slice(0, i).flatMap((s) => s.changes)) {
        for (const p of inTree) if (touches(c, p)) inTree.delete(p);
        if (c.content !== null && isLfsPath(c.path)) inTree.add(c.path);
      }
      const own = [...inTree].filter((p) => !step.changes.some((c) => touches(c, p))).sort();
      if (own.length > 0) step.renormalize = own;
    }
    current = next;
  }
}

/** Die Backlog-Config in `HEAD`; `undefined` ohne Commit oder Datei. */
async function headConfig(wc: string): Promise<BacklogConfig | undefined> {
  const spec = `HEAD:${BACKLOG_CONFIG}`;
  const blob = (await readBlobs(wc, [spec])).get(spec);
  return blob == null
    ? undefined
    : BacklogConfigSchema.parse(readJsonc(blob.toString('utf8'), BACKLOG_CONFIG));
}

/**
 * Bringt die bearbeiteten Pfade auf den Stand nach den Commits: Pfade ohne wirksame Änderung
 * zurück auf HEAD, der Index aller bearbeiteten und committeten Pfade auf HEAD. Scheitert das,
 * bleiben Hand-Edits bzw. Index eben liegen — verloren geht nichts —, und das Ergebnis sagt es.
 */
async function settleWorkingCopy(
  wc: string,
  reset: readonly string[],
  paths: readonly string[],
): Promise<WriteResult['unsettled']> {
  try {
    await rollbackPaths(wc, reset);
    if (paths.length === 0) return;
    await git(['reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      cwd: wc,
      env: { GIT_LITERAL_PATHSPECS: '1' },
      input: paths.map((p) => `${p}\0`).join(''),
    });
    return undefined;
  } catch (err) {
    return { paths: [...paths], reason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Führt einen Write aus (backe.md §2.16.1): fehlt die Arbeitskopie der Identität, wird sie zuerst
 * geklont; dann Lock, Journal-Recovery, Identität, Formatversion, Branch, Änderungen berechnen,
 * Schutz ungesicherter Änderungen, Dateien schreiben und signiert committen — bei Hand-Edits als
 * Kette, bei der HEAD einmal springt. Scheitert etwas nach dem Schreiben, kommt der Inhalt vor
 * dem Write zurück (Hand-Edits bleiben Hand-Edits). Geprüft wird gegen den Stand, gegen den
 * `verify` den Commit beurteilt (`writeCommitBasis`, einmal je Write): Solange ungültige Commits
 * offen sind, ist das der eingefrorene Stand — für Signier-Key, Policy (auch von Operationen) und
 * verseuchte Pfade.
 * Quarantäne-Writes (`manual` mit `signers`) bringen ihren Stand selbst mit. SIGINT/SIGTERM im
 * kritischen Abschnitt werden aufgeschoben (`withDeferredSignals`) und, wenn dieser Write der
 * äußerste Abschnitt ist, erst nach Freigabe des Locks ausgelöst.
 */
export async function executeWrite(
  ctx: ResolvedContext,
  input: WriteInput,
  deps: WriteDeps = {},
): Promise<WriteResult> {
  const { handle, key, workingCopy } = requireWriter(ctx);
  const { root: wc, notices: verifyNotices } = (await exists(join(workingCopy, BACKLOG_CONFIG)))
    ? { root: workingCopy, notices: [] }
    : await ensureWorkingCopy(ctx, handle);
  const dir = await stateDir(wc);
  const journal = join(dir, 'write.journal');
  let deferred: NodeJS.Signals | undefined;

  async function locked(): Promise<WriteResult> {
    await recoverJournal(wc, journal);
    await checkIdentity(ctx, wc, handle);
    await checkFormatVersion(wc, input.kind === 'edits' ? 'HEAD' : undefined);
    const wcSnapshot = await loadSnapshot(wc);
    // Hand-Edits gelten erst nach ihrer Prüfung; bis dahin regiert die Config aus HEAD.
    const config =
      input.kind === 'edits' ? ((await headConfig(wc)) ?? wcSnapshot.config) : wcSnapshot.config;
    const head = await assertOnBranch(wc, config.sync.branch);
    const lfs = config.attachments.lfs;
    if (lfs) await setUpLfs(wc);
    if (input.kind === 'manual' && input.expectHead !== undefined && input.expectHead !== head) {
      throw new BackeError('conflict', 'Stand hat sich seit der Prüfung geändert');
    }
    const edits =
      input.kind === 'edits'
        ? await readHandEdits(wc, { ...wcSnapshot, config }, head, handle)
        : undefined;
    // Hand-Edits prüft backe gegen HEAD; die Arbeitskopie trägt ja gerade die Änderungen.
    const snapshot = edits?.base ?? wcSnapshot;
    assertActorIsUser(snapshot, handle);
    const resolved: ResolvedInput | undefined =
      input.kind === 'derive' ? resolveDerived(input.derive(snapshot, handle)) : input;
    // Ein Quarantäne-Write bringt den Stand mit, gegen den er geprüft hat; jeder andere fragt
    // `verify` einmal. Nur solange ungültige Commits offen sind, weicht dieser Stand von HEAD ab.
    const quarantineSigners = resolved?.kind === 'manual' ? resolved.signers : undefined;
    const basis = quarantineSigners === undefined ? await writeCommitBasis(wc) : undefined;
    const frozen =
      basis?.frozen === undefined ? undefined : { ...basis.frozen, state: basis.state };
    const signers =
      quarantineSigners ??
      frozen?.state.users ??
      new Map([...snapshot.users].map(([h, u]) => [h, u.data]));
    await checkSigningKey(ctx, key, handle, signers);

    const empty: WriteResult = {
      commit: undefined,
      recorded: [],
      refs: {},
      notices: [],
      paths: [],
      verifyNotices,
      chain: [],
      warnings: edits?.warnings ?? [],
      rewritten: [],
    };
    if (resolved === undefined) return empty;
    const planned = await plan(wc, snapshot, head, resolved, edits, handle, deps);
    const { steps } = planned;
    await markRenormalization(wc, head, snapshot.attributes, steps);
    // Operationen prüft `apply` gegen HEAD; gegen den eingefrorenen Stand nur diese Prüfung.
    const reasons =
      edits === undefined && frozen === undefined
        ? []
        : await chainReasons(wc, head, snapshot, edits?.before, steps, handle, frozen);
    if (reasons.length > 0) {
      // Vor dem Schreiben: Hand-Edits bleiben liegen, HEAD bleibt, wo er ist.
      throw new BackeError(
        'validation',
        `verify würde den Commit ablehnen: ${reasons.join('; ')}`,
        {
          details: { reasons },
        },
      );
    }
    const allChanges = steps.flatMap((s) => s.changes);
    const renormalized = steps.flatMap((s) => s.renormalize ?? []);
    const settled = edits === undefined ? undefined : settleEdits(edits, allChanges);
    const result = (commits: readonly string[]): WriteResult => ({
      ...empty,
      commit: commits.at(-1),
      recorded: planned.recorded,
      refs: planned.refs,
      notices: planned.notices,
      paths: [...new Set([...changedPathsOf(allChanges), ...renormalized])].sort(),
      chain: steps.map((s, i) => ({
        commit: commits[i] as string,
        kind: s.kind,
        recorded: s.recorded,
        paths: committedPaths(s),
      })),
      rewritten: settled?.rewritten ?? [],
    });
    /** Gleicht die bearbeiteten Pfade an und liefert das Ergebnis mit `commits`. */
    const settle = async (commits: readonly string[]): Promise<WriteResult> => {
      const r = result(commits);
      if (edits === undefined || settled === undefined) return r;
      const paths = [
        ...new Set([...edits.edited, ...changedPathsOf(allChanges), ...renormalized]),
      ].sort();
      const unsettled = await settleWorkingCopy(wc, settled.reset, paths);
      return unsettled === undefined ? r : { ...r, unsettled };
    };
    if (steps.length === 0) return settle([]);

    const paths = changedPathsOf(allChanges);
    const editedSet = new Set(edits?.edited ?? []);
    const dirty = (await dirtyPaths(wc, [...paths, ...renormalized])).filter(
      (p) => !editedSet.has(p),
    );
    if (dirty.length > 0) {
      // Erst der Weg, der nichts verwirft; `restore` löscht die Hand-Edits.
      throw new BackeError('conflict', `Ungesicherte Änderungen an ${dirty.join(', ')}`, {
        hint: `git -C ${wc} stash, oder git -C ${wc} restore --staged --worktree -- ${dirty.join(' ')}`,
      });
    }
    const author = authorOf(handle, (snapshot.users.get(handle) as StoredEntity<User>).data.name);

    /** Der kritische Abschnitt: Journal, Dateien, Commits, Angleichen der Arbeitskopie. */
    const critical = async (): Promise<WriteResult> => {
      const saved = edits === undefined ? undefined : await capture(wc, paths);
      // Auch die neu abgelegten Anhänge: Stürzt der Write nach dem Ref-Update ab, trüge ihr Index
      // sonst noch den alten Blob.
      const entry: Journal = {
        head,
        paths: [...new Set([...paths, ...renormalized])].sort(),
        ...(steps.length > 1 ? { commits: steps.length } : {}),
        ...(saved === undefined ? {} : { saved }),
      };
      await writeFileAtomic(journal, `${JSON.stringify(entry)}\n`);
      const commits: string[] = [];
      try {
        for (const [i, step] of steps.entries()) {
          const last = i === steps.length - 1;
          await applyFileChanges(wc, step.changes);
          if (last) await deps.hooks?.afterFiles?.();
          commits.push(
            await commitPaths(wc, {
              paths: committedPaths(step),
              message: step.message,
              key,
              author,
              env: ctx.env,
              parent: commits.at(-1) ?? head,
              updateRef: last ? { from: head } : false,
            }),
          );
        }
        await deps.hooks?.afterCommit?.();
      } catch (error) {
        const done = await landedChain(wc, head, steps).catch(() => undefined);
        if (done !== undefined) {
          // Die Commits stehen schon auf HEAD: Ein Rollback würde sie verfälschen, ein Retry verdoppeln.
          await rm(journal, { force: true });
          return settle(done);
        }
        try {
          if (saved === undefined) await rollbackPaths(wc, entry.paths);
          else await restoreSaved(wc, saved);
          await rm(journal, { force: true });
        } catch {
          // Das Journal bleibt liegen; der nächste Write versucht den Rollback erneut.
        }
        throw error;
      }
      await rm(journal, { force: true });
      return settle(commits);
    };
    // Ist dieser Write der äußerste Abschnitt, löst er das Signal erst nach dem Lock aus.
    return withDeferredSignals(critical, {
      raise: (signal) => {
        deferred = signal;
      },
    });
  }

  await deps.hooks?.beforeLock?.();
  try {
    return await withFileLock(join(dir, 'write.lock'), locked, deps.lock);
  } finally {
    if (deferred !== undefined) (deps.raise ?? raiseSignal)(deferred);
  }
}

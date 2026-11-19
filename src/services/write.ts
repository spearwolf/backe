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
import { BACKLOG_FORMAT_VERSION, type Comment, type User } from '../core/schemas.ts';
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
import {
  applyFileChanges,
  type FileChange,
  isIssueDirPath,
  writeFileAtomic,
} from '../store/files.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
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
import { activeFingerprints } from './verify-state.ts';
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

const DEFERRED_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

/** Merkt SIGINT/SIGTERM zwischen `install` und `release`, statt den Prozess zu beenden. */
function signalDeferral() {
  let pending: NodeJS.Signals | undefined;
  const handlers = DEFERRED_SIGNALS.map((signal) => {
    const handler = () => {
      pending ??= signal;
    };
    return [signal, handler] as const;
  });
  return {
    install(): void {
      for (const [signal, handler] of handlers) process.on(signal, handler);
    },
    /** Entfernt die Handler (auch wenn nie installiert) und liefert das gemerkte Signal. */
    release(): NodeJS.Signals | undefined {
      for (const [signal, handler] of handlers) process.off(signal, handler);
      return pending;
    },
  };
}

function raiseSignal(signal: NodeJS.Signals): void {
  process.kill(process.pid, signal);
}

/** Erster Parent von `rev`; `undefined` beim Wurzel-Commit. */
async function firstParent(wc: string, rev: string): Promise<string | undefined> {
  const { stdout } = await git(['log', '-1', '--format=%P', '--end-of-options', rev], { cwd: wc });
  const [parent] = stdout.trim().split(' ');
  return parent === '' ? undefined : parent;
}

/** Ob `commit` Subject und `Backe-Actor` von `message` trägt und jeden Pfad wie geplant enthält. */
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
  const [info, blobs] = await Promise.all([objectInfo(wc, specs), readBlobs(wc, specs)]);
  return step.changes.every((c, i) => {
    const spec = specs[i] as string;
    if (c.content === null) return info.get(spec) === undefined;
    return blobs.get(spec)?.equals(Buffer.from(c.content)) === true;
  });
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

/** Der Signier-Key ist ein aktiver Key des Schreibenden; sonst verwürfe `verify` den Commit. */
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

/** Liest `version` roh, bevor das Schema greift: ein neueres Format schreibt dieses backe nicht. */
async function checkFormatVersion(wc: string): Promise<void> {
  const raw = readJsonc(await readFile(join(wc, BACKLOG_CONFIG), 'utf8'), BACKLOG_CONFIG);
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
 * Wendet die übersetzten Operationen der Hand-Edits als Batch an. Eine Verletzung behält Code und
 * Message; ohne eigenen Hinweis bekommt sie den, die Änderung aufzuteilen.
 */
function applyEditOps(
  s: BacklogSnapshot,
  ops: readonly Operation[],
  ctx: ApplyContext,
): ReturnType<typeof applyBatch> {
  try {
    return applyBatch(s, ops, ctx);
  } catch (err) {
    const reason = (err as BackeError | undefined)?.details as { reason?: unknown } | undefined;
    if (!(err instanceof BackeError) || reason?.reason === undefined || err.hint !== undefined) {
      throw err;
    }
    throw new BackeError(err.code, err.message, { details: err.details, hint: SPLIT_HINT });
  }
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

/** Mit `attachments.lfs` muss `git lfs` laufen, sonst landeten Anhänge roh im Commit. */
async function assertLfs(wc: string): Promise<void> {
  try {
    await git(['lfs', 'version'], { cwd: wc });
  } catch {
    throw new BackeError('validation', 'attachments.lfs verlangt git-lfs', {
      hint: 'backe doctor',
    });
  }
}

/**
 * Bringt die bearbeiteten Pfade auf den Stand nach den Commits: Pfade ohne wirksame Änderung
 * zurück auf HEAD, der Index aller bearbeiteten und committeten Pfade auf HEAD. Scheitert das,
 * bleiben die Hand-Edits eben liegen; verloren geht nichts.
 */
async function settleWorkingCopy(
  wc: string,
  reset: readonly string[],
  paths: readonly string[],
): Promise<void> {
  try {
    await rollbackPaths(wc, reset);
    if (paths.length === 0) return;
    await git(['reset', '-q', '--pathspec-from-file=-', '--pathspec-file-nul'], {
      cwd: wc,
      env: { GIT_LITERAL_PATHSPECS: '1' },
      input: paths.map((p) => `${p}\0`).join(''),
    });
  } catch {
    // Kosmetik nach dem Commit; `git status` zeigt die Pfade dann als geändert.
  }
}

/**
 * Führt einen Write aus (backe.md §2.16.1): fehlt die Arbeitskopie der Identität, wird sie zuerst
 * geklont; dann Lock, Journal-Recovery, Identität, Formatversion, Branch, Änderungen berechnen,
 * Schutz ungesicherter Änderungen, Dateien schreiben und signiert committen — bei Hand-Edits als
 * Kette, bei der HEAD einmal springt. Scheitert etwas nach dem Schreiben, kommt der Inhalt vor
 * dem Write zurück (Hand-Edits bleiben Hand-Edits). SIGINT/SIGTERM im kritischen Abschnitt werden
 * erst nach Freigabe des Locks ausgelöst.
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
  const signals = signalDeferral();

  async function locked(): Promise<WriteResult> {
    await recoverJournal(wc, journal);
    await checkIdentity(ctx, wc, handle);
    await checkFormatVersion(wc);
    const wcSnapshot = await loadSnapshot(wc);
    const head = await assertOnBranch(wc, wcSnapshot.config.sync.branch);
    if (input.kind === 'manual' && input.expectHead !== undefined && input.expectHead !== head) {
      throw new BackeError('conflict', 'Stand hat sich seit der Prüfung geändert');
    }
    const edits =
      input.kind === 'edits' ? await readHandEdits(wc, wcSnapshot, head, handle) : undefined;
    // Hand-Edits prüft backe gegen HEAD; die Arbeitskopie trägt ja gerade die Änderungen.
    const snapshot = edits?.base ?? wcSnapshot;
    assertActorIsUser(snapshot, handle);
    const resolved: ResolvedInput | undefined =
      input.kind === 'derive' ? resolveDerived(input.derive(snapshot, handle)) : input;
    const signers =
      (resolved?.kind === 'manual' ? resolved.signers : undefined) ??
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
    const allChanges = steps.flatMap((s) => s.changes);
    const settled = edits === undefined ? undefined : settleEdits(edits, allChanges);
    const result = (commits: readonly string[]): WriteResult => ({
      ...empty,
      commit: commits.at(-1),
      recorded: planned.recorded,
      refs: planned.refs,
      notices: planned.notices,
      paths: changedPathsOf(allChanges),
      chain: steps.map((s, i) => ({
        commit: commits[i] as string,
        kind: s.kind,
        recorded: s.recorded,
        paths: s.paths,
      })),
      rewritten: settled?.rewritten ?? [],
    });
    const settle = async () => {
      if (edits !== undefined && settled !== undefined) {
        const paths = [...new Set([...edits.edited, ...changedPathsOf(allChanges)])].sort();
        await settleWorkingCopy(wc, settled.reset, paths);
      }
    };
    if (steps.length === 0) {
      await settle();
      return result([]);
    }

    const paths = changedPathsOf(allChanges);
    const editedSet = new Set(edits?.edited ?? []);
    const dirty = (await dirtyPaths(wc, paths)).filter((p) => !editedSet.has(p));
    if (dirty.length > 0) {
      // Erst der Weg, der nichts verwirft; `restore` löscht die Hand-Edits.
      throw new BackeError('conflict', `Ungesicherte Änderungen an ${dirty.join(', ')}`, {
        hint: `git -C ${wc} stash, oder git -C ${wc} restore --staged --worktree -- ${dirty.join(' ')}`,
      });
    }
    const lfs = wcSnapshot.config.attachments.lfs;
    if (lfs) await assertLfs(wc);
    const author = authorOf(handle, (snapshot.users.get(handle) as StoredEntity<User>).data.name);

    signals.install();
    const saved = edits === undefined ? undefined : await capture(wc, paths);
    const entry: Journal = {
      head,
      paths,
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
            paths: step.paths,
            message: step.message,
            key,
            author,
            env: ctx.env,
            parent: commits.at(-1) ?? head,
            updateRef: last ? { from: head } : false,
            lfs,
          }),
        );
      }
      await deps.hooks?.afterCommit?.();
    } catch (error) {
      const done = await landedChain(wc, head, steps).catch(() => undefined);
      if (done !== undefined) {
        // Die Commits stehen schon auf HEAD: Ein Rollback würde sie verfälschen, ein Retry verdoppeln.
        await rm(journal, { force: true });
        await settle();
        return result(done);
      }
      try {
        if (saved === undefined) await rollbackPaths(wc, paths);
        else await restoreSaved(wc, saved);
        await rm(journal, { force: true });
      } catch {
        // Das Journal bleibt liegen; der nächste Write versucht den Rollback erneut.
      }
      throw error;
    }
    await rm(journal, { force: true });
    await settle();
    return result(commits);
  }

  await deps.hooks?.beforeLock?.();
  try {
    return await withFileLock(join(dir, 'write.lock'), locked, deps.lock);
  } finally {
    const signal = signals.release();
    if (signal !== undefined) (deps.raise ?? raiseSignal)(signal);
  }
}

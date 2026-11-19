/**
 * Der Schreibpfad (backe.md §2.16.1): jede Änderung am Backlog läuft hierüber, unter dem
 * Write-Lock der Arbeitskopie, mit Journal für Abstürze und genau einem signierten Commit.
 */
import { readFile, rm } from 'node:fs/promises';
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
import { applyFileChanges, type FileChange, writeFileAtomic } from '../store/files.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import {
  type BacklogSnapshot,
  listComments,
  loadSnapshot,
  type StoredEntity,
} from '../store/snapshot.ts';
import { authorOf, isoNow } from './env.ts';
import { activeFingerprints } from './verify-state.ts';
import { ensureWorkingCopy, identityMismatch } from './working-copy.ts';

export type WriteInput =
  | { kind: 'op'; op: Operation }
  | { kind: 'batch'; ops: readonly Operation[] }
  | {
      kind: 'derive';
      /**
       * Leitet die Operation unter dem Write-Lock aus dem frisch geladenen Snapshot ab; wirft sie,
       * wird nichts geschrieben. Danach läuft der Write wie `kind: 'op'`.
       */
      derive: (snapshot: BacklogSnapshot, actor: string) => Operation;
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
    };

export type WriteResult = {
  commit: string | undefined;
  recorded: Operation[];
  refs: Record<string, string>;
  notices: Notice[];
  paths: string[];
  /** Gründe ungültiger Commits, wenn dieser Write die Arbeitskopie im Modus `warn` geklont hat. */
  verifyNotices: string[];
};

export type WriteDeps = {
  now?: () => Date;
  randomBytes?: (n: number) => Uint8Array;
  lock?: LockOptions;
  /** Nur für Tests: `afterFiles` nach dem Schreiben der Dateien, `afterCommit` nach dem Commit. */
  hooks?: { afterFiles?: () => Promise<void>; afterCommit?: () => Promise<void> };
  raise?: (signal: NodeJS.Signals) => void;
};

type ResolvedInput = Exclude<WriteInput, { kind: 'derive' }>;

type Planned = Omit<WriteResult, 'commit' | 'paths' | 'verifyNotices'> & {
  changes: readonly FileChange[];
};

/** Inhalt von `write.journal`: die Pfade, die ein abgebrochener Write zurücksetzen muss. */
type Journal = { head: string; paths: string[] };

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

/** Erster Parent von HEAD; `undefined` beim Wurzel-Commit. */
async function firstParent(wc: string): Promise<string | undefined> {
  const { stdout } = await git(['log', '-1', '--format=%P', 'HEAD'], { cwd: wc });
  const [parent] = stdout.trim().split(' ');
  return parent === '' ? undefined : parent;
}

/**
 * Der Commit dieses Writes, falls er trotz eines Fehlers danach auf HEAD gelandet ist: HEAD steht
 * direkt auf `head`, trägt Subject und `Backe-Actor` dieses Writes und enthält jeden geschriebenen
 * Pfad mit genau dem geplanten Inhalt. Ein fremder Commit mit gleichem Baum zählt nicht.
 */
async function landedCommit(
  wc: string,
  head: string,
  changes: readonly FileChange[],
  message: string,
): Promise<string | undefined> {
  const now = (await headState(wc)).head;
  if (now === undefined || now === head || (await firstParent(wc)) !== head) return undefined;
  const expected = parseCommitMessage(message);
  const actual = parseCommitMessage(
    (await git(['log', '-1', '--format=%B', now], { cwd: wc })).stdout,
  );
  if (
    actual.subject !== expected.subject ||
    actual.trailers.get(TRAILER_ACTOR)?.[0] !== expected.trailers.get(TRAILER_ACTOR)?.[0]
  ) {
    return undefined;
  }
  const specs = changes.map((c) => `${now}:${c.path}`);
  const [info, blobs] = await Promise.all([objectInfo(wc, specs), readBlobs(wc, specs)]);
  const matches = changes.every((c, i) => {
    const spec = specs[i] as string;
    if (c.content === null) return info.get(spec) === undefined;
    return blobs.get(spec)?.equals(Buffer.from(c.content)) === true;
  });
  return matches ? now : undefined;
}

/**
 * Setzt die Pfade eines liegengebliebenen Journals zurück (Absturz mitten im Write). Nur wenn ein
 * Branch ausgecheckt ist, keine Operation läuft und HEAD noch der Stand des Journals ist oder der
 * Commit des Writes direkt darauf (dann gleicht der Rollback Arbeitsbaum und Index an HEAD an).
 * Sonst bleibt das Journal liegen und der Write bricht ab, bevor etwas angefasst wird.
 */
async function recoverJournal(wc: string, journal: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(journal, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const { head, paths } = JSON.parse(text) as Journal;
  const state = await headState(wc);
  const recoverable =
    state.branch !== undefined &&
    state.operation === undefined &&
    (state.head === head || (await firstParent(wc)) === head);
  if (!recoverable) {
    throw new BackeError(
      'conflict',
      `Unterbrochener Write in ${wc} kann nicht zurückgesetzt werden`,
      {
        hint: `git -C ${wc} status prüfen, dann ${journal} löschen`,
      },
    );
  }
  await rollbackPaths(wc, paths);
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

/** Berechnet die Änderungen: Operationen rein gegen den Snapshot, manuelle Änderungen direkt. */
async function plan(
  wc: string,
  snapshot: BacklogSnapshot,
  head: string,
  input: ResolvedInput,
  handle: string,
  deps: WriteDeps,
): Promise<Planned> {
  if (input.kind === 'manual') {
    return { changes: input.changes, recorded: [], refs: {}, notices: [] };
  }
  const ops = input.kind === 'op' ? [input.op] : input.ops;
  const applyCtx: ApplyContext = {
    actor: handle,
    now: isoNow((deps.now ?? (() => new Date()))()),
    randomBytes: deps.randomBytes,
    comments: await loadComments(wc, ops),
    removedHandles: ops.some((op) => op.op === 'user.add')
      ? await removedHandles(wc, head)
      : undefined,
  };
  if (input.kind === 'batch') {
    const { changes, recorded, refs, notices } = applyBatch(snapshot, input.ops, applyCtx);
    return { changes, recorded, refs, notices };
  }
  const r = applyOperation(snapshot, input.op, applyCtx);
  return { changes: r.changes, recorded: r.noop ? [] : [r.recorded], refs: {}, notices: r.notices };
}

/** Commit-Message nach backe.md §2.13; `recorded` ist hier nie leer, wenn Operationen schreiben. */
function commitMessage(
  input: ResolvedInput,
  recorded: readonly Operation[],
  handle: string,
): string {
  const actor = [TRAILER_ACTOR, handle] as const;
  if (input.kind === 'manual') {
    return formatCommitMessage({
      subject: input.subject,
      trailers: [actor, [TRAILER_OP, 'manual']],
    });
  }
  if (input.kind === 'batch') {
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

/**
 * Führt einen Write aus (backe.md §2.16.1): fehlt die Arbeitskopie der Identität, wird sie zuerst
 * geklont; dann Lock, Journal-Recovery, Identität, Formatversion,
 * Branch, Änderungen berechnen, Schutz ungesicherter Änderungen, Dateien schreiben und signiert
 * committen. Scheitert etwas nach dem Schreiben, werden die betroffenen Pfade zurückgesetzt.
 * SIGINT/SIGTERM im kritischen Abschnitt werden erst nach Freigabe des Locks ausgelöst.
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
    const snapshot = await loadSnapshot(wc);
    assertActorIsUser(snapshot, handle);
    const resolved: ResolvedInput =
      input.kind === 'derive' ? { kind: 'op', op: input.derive(snapshot, handle) } : input;
    const signers =
      (resolved.kind === 'manual' ? resolved.signers : undefined) ??
      new Map([...snapshot.users].map(([h, u]) => [h, u.data]));
    await checkSigningKey(ctx, key, handle, signers);
    const head = await assertOnBranch(wc, snapshot.config.sync.branch);

    const { changes, ...planned } = await plan(wc, snapshot, head, resolved, handle, deps);
    if (changes.length === 0) return { commit: undefined, ...planned, paths: [], verifyNotices };

    const paths = [...new Set(changes.map((c) => c.path))].sort();
    const dirty = await dirtyPaths(wc, paths);
    if (dirty.length > 0) {
      throw new BackeError('conflict', `Ungesicherte Änderungen an ${dirty.join(', ')}`, {
        hint: `backe commit, oder git -C ${wc} restore --staged --worktree -- ${dirty.join(' ')}`,
      });
    }
    const message = commitMessage(resolved, planned.recorded, handle);
    const author = authorOf(handle, (snapshot.users.get(handle) as StoredEntity<User>).data.name);

    signals.install();
    await writeFileAtomic(journal, `${JSON.stringify({ head, paths } satisfies Journal)}\n`);
    let commit: string;
    try {
      await applyFileChanges(wc, changes);
      await deps.hooks?.afterFiles?.();
      commit = await commitPaths(wc, { paths, message, key, author, env: ctx.env, parent: head });
      await deps.hooks?.afterCommit?.();
    } catch (error) {
      const done = await landedCommit(wc, head, changes, message).catch(() => undefined);
      if (done !== undefined) {
        // Der Commit steht schon auf HEAD: Ein Rollback würde ihn verfälschen, ein Retry verdoppeln.
        await rm(journal, { force: true });
        return { commit: done, ...planned, paths, verifyNotices };
      }
      try {
        await rollbackPaths(wc, paths);
        await rm(journal, { force: true });
      } catch {
        // Das Journal bleibt liegen; der nächste Write versucht den Rollback erneut.
      }
      throw error;
    }
    await rm(journal, { force: true });
    return { commit, ...planned, paths, verifyNotices };
  }

  try {
    return await withFileLock(join(dir, 'write.lock'), locked, deps.lock);
  } finally {
    const signal = signals.release();
    if (signal !== undefined) (deps.raise ?? raiseSignal)(signal);
  }
}

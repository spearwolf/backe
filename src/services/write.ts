/**
 * Der Schreibpfad (backe.md §2.16.1): jede Änderung am Backlog läuft hierüber, unter dem
 * Write-Lock der Arbeitskopie, mit Journal für Abstürze und genau einem signierten Commit.
 */
import { access, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type LockOptions, withFileLock } from '../context/lock.ts';
import { workingCopyPath } from '../context/registry.ts';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { BACKLOG_FORMAT_VERSION, type Comment } from '../core/schemas.ts';
import { commitPaths } from '../git/commit.ts';
import { removedHandles } from '../git/history.ts';
import { readLocalState, stateDir, writeLocalState } from '../git/local-state.ts';
import { formatCommitMessage, TRAILER_ACTOR, TRAILER_OP } from '../git/message.ts';
import { assertOnBranch, dirtyPaths, rollbackPaths } from '../git/repo.ts';
import { type ApplyContext, applyOperation, commentsNeeded } from '../ops/apply.ts';
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

export type WriteInput =
  | { kind: 'op'; op: Operation }
  | { kind: 'batch'; ops: readonly Operation[] }
  | { kind: 'manual'; subject: string; changes: readonly FileChange[] };

export type WriteResult = {
  commit: string | undefined;
  recorded: Operation[];
  refs: Record<string, string>;
  notices: Notice[];
  paths: string[];
};

export type WriteDeps = {
  now?: () => Date;
  randomBytes?: (n: number) => Uint8Array;
  lock?: LockOptions;
  hooks?: { afterFiles?: () => Promise<void> };
  raise?: (signal: NodeJS.Signals) => void;
};

type Planned = Omit<WriteResult, 'commit' | 'paths'> & { changes: readonly FileChange[] };

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

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Setzt die Pfade eines liegengebliebenen Journals zurück (Absturz mitten im Write). */
async function recoverJournal(wc: string, journal: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(journal, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  const { paths } = JSON.parse(text) as Journal;
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
    throw new BackeError(
      'usage',
      `Die Arbeitskopie ${wc} gehört "${identity}"; die Arbeitskopie von "${handle}" ist ${own}`,
    );
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
  input: WriteInput,
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
function commitMessage(input: WriteInput, recorded: readonly Operation[], handle: string): string {
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
 * Führt einen Write aus (backe.md §2.16.1): Lock, Journal-Recovery, Identität, Formatversion,
 * Branch, Änderungen berechnen, Schutz ungesicherter Änderungen, Dateien schreiben und signiert
 * committen. Scheitert etwas nach dem Schreiben, werden die betroffenen Pfade zurückgesetzt.
 * SIGINT/SIGTERM im kritischen Abschnitt werden erst nach Freigabe des Locks ausgelöst.
 */
export async function executeWrite(
  ctx: ResolvedContext,
  input: WriteInput,
  deps: WriteDeps = {},
): Promise<WriteResult> {
  const { handle, key, workingCopy: wc } = requireWriter(ctx);
  if (!(await exists(join(wc, BACKLOG_CONFIG)))) {
    throw new BackeError('not_found', `Arbeitskopie ${wc} fehlt`);
  }
  const dir = await stateDir(wc);
  const journal = join(dir, 'write.journal');
  const signals = signalDeferral();

  async function locked(): Promise<WriteResult> {
    await recoverJournal(wc, journal);
    await checkIdentity(ctx, wc, handle);
    await checkFormatVersion(wc);
    const snapshot = await loadSnapshot(wc);
    const head = await assertOnBranch(wc, snapshot.config.sync.branch);

    const { changes, ...planned } = await plan(wc, snapshot, head, input, handle, deps);
    if (changes.length === 0) return { commit: undefined, ...planned, paths: [] };

    const paths = [...new Set(changes.map((c) => c.path))].sort();
    const dirty = await dirtyPaths(wc, paths);
    if (dirty.length > 0) {
      throw new BackeError('conflict', `Ungesicherte Änderungen an ${dirty.join(', ')}`, {
        hint: `backe commit, oder git -C ${wc} restore -- ${dirty.join(' ')}`,
      });
    }
    const message = commitMessage(input, planned.recorded, handle);
    const author = authorOf(handle, snapshot.users.get(handle)?.data.name ?? handle);

    signals.install();
    await writeFileAtomic(journal, `${JSON.stringify({ head, paths } satisfies Journal)}\n`);
    let commit: string;
    try {
      await applyFileChanges(wc, changes);
      await deps.hooks?.afterFiles?.();
      commit = await commitPaths(wc, { paths, message, key, author, env: ctx.env, parent: head });
    } catch (error) {
      try {
        await rollbackPaths(wc, paths);
        await rm(journal, { force: true });
      } catch {
        // Das Journal bleibt liegen; der nächste Write versucht den Rollback erneut.
      }
      throw error;
    }
    await rm(journal, { force: true });
    return { commit, ...planned, paths };
  }

  try {
    return await withFileLock(join(dir, 'write.lock'), locked, deps.lock);
  } finally {
    const signal = signals.release();
    if (signal !== undefined) (deps.raise ?? raiseSignal)(signal);
  }
}

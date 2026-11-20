/**
 * Die Sync-Runde (backe.md §2.16.2): `fetch`, Eingehendes prüfen, unter dem Write-Lock
 * Fast-Forward oder Replay der lokalen Commits und genau ein `git reset --keep`, dann `push`.
 * Netz läuft nie unter dem Write-Lock; bis zum `reset --keep` entstehen nur Git-Objekte, ein
 * Abbruch davor lässt Arbeitskopie und HEAD, wie sie waren.
 */
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { type LockOptions, withFileLock } from '../context/lock.ts';
import { exists } from '../context/paths.ts';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { BacklogConfig } from '../core/schemas.ts';
import { git, transportEnv } from '../git/exec.ts';
import { isAncestor, readBlobs, resolveCommit } from '../git/history.ts';
import { readLocalState, stateDir, writeLocalState } from '../git/local-state.ts';
import { remoteUrl } from '../git/query.ts';
import { assertOnBranch, dirtyPaths } from '../git/repo.ts';
import { parseEntityFile } from '../store/frontmatter.ts';
import { BACKLOG_CONFIG, userFile } from '../store/layout.ts';
import { authorOf, isoNow } from './env.ts';
import { firstStderrLine } from './init.ts';
import { type ManualResolver, readUnits, replayOnto } from './replay.ts';
import { raiseSignal, withDeferredSignals } from './signals.ts';
import { readSyncState, type SyncState, writeConflicts, writeSyncState } from './sync-state.ts';
import { ensureWorkingCopy, verifyAndJudge } from './working-copy.ts';
import { headConfig } from './write.ts';

/** Nur für Tests: Reihenfolge und Pausen zwischen den Schritten einer Runde. */
export type SyncHooks = {
  afterFetch?: (round: number) => Promise<void>;
  beforePush?: (round: number, sha: string) => Promise<void>;
  afterRound?: () => Promise<void>;
};

export type SyncDeps = {
  now?: () => Date;
  randomBytes?: (n: number) => Uint8Array;
  /** Wartet den Backoff zwischen zwei Runden ab. */
  sleep?: (ms: number) => Promise<void>;
  hooks?: SyncHooks;
  lock?: LockOptions;
  resolveManual?: ManualResolver;
};

export type SyncOutcome = {
  fetched: number;
  replayed: number;
  /** IDs der neu abgelegten Konflikt-Einträge. */
  conflicts: string[];
  pushed: string | undefined;
  rounds: number;
  skipped?: 'no_remote';
  notices: string[];
  claimLost?: { id: string; error: BackeError };
};

const MAX_ROUNDS = 5;
const BACKOFF_MS = 200;
const FETCH_TIMEOUT_MS = 60_000;

/** Wirksamer Modus (backe.md §2.16.2): die User-Config vor `sync.mode` des Backlogs. */
export function effectiveMode(ctx: ResolvedContext, config: BacklogConfig): 'auto' | 'manual' {
  return ctx.userConfig.backlogs?.[ctx.backlog.value]?.sync?.mode ?? config.sync.mode;
}

/** URL des Git-Remotes `remote` der Arbeitskopie; ohne ihn `undefined` (»kein Remote«). */
export function syncRemote(wc: string, remote: string): Promise<string | undefined> {
  return remoteUrl(wc, remote);
}

type Env = ResolvedContext['env'];

/** Ein Git-Aufruf ist mit einem Exit-Code gescheitert und hat dabei `pattern` auf stderr gemeldet. */
function stderrMatches(err: unknown, pattern: RegExp): boolean {
  const stderr = err instanceof BackeError ? (err.details as { stderr?: string })?.stderr : '';
  return pattern.test(stderr ?? '');
}

/**
 * Holt den Sync-Branch in seinen Remote-Tracking-Ref und liefert dessen Commit; einen leeren
 * Remote-Branch (frischer Hub, frisches Remote) gibt es nicht, dann `undefined`.
 */
async function fetchTip(
  wc: string,
  env: Env,
  remote: string,
  branch: string,
): Promise<string | undefined> {
  const tracking = `refs/remotes/${remote}/${branch}`;
  const refspec = `+refs/heads/${branch}:${tracking}`;
  try {
    await git(['fetch', '-q', '--no-tags', '--end-of-options', remote, refspec], {
      cwd: wc,
      env: transportEnv(env),
      timeoutMs: FETCH_TIMEOUT_MS,
    });
  } catch (err) {
    if (stderrMatches(err, /couldn't find remote ref/)) return undefined;
    throw new BackeError('sync', `Fetch von ${remote} fehlgeschlagen: ${firstStderrLine(err)}`);
  }
  return resolveCommit(wc, tracking);
}

/**
 * Prüft Eingehendes bis `tip` (backe.md §2.13): Abstammung von `upstream` (ohne ihn genügt der
 * Anker), dann die Commits — ab `clean`, wenn das ein geprüfter Vorfahre ist, sonst ab dem Anker.
 * Ohne ungültigen Commit rücken `verified` und `clean` auf `tip`; mit ungültigen entscheidet der
 * Modus (`verifyAndJudge`), und `clean` bleibt stehen.
 */
async function verifyIncoming(wc: string, tip: string, upstream: string | undefined) {
  const ancestor = upstream ?? (await readLocalState(wc, 'anchor'));
  const clean = await readLocalState(wc, 'clean');
  const verified = await readLocalState(wc, 'verified');
  const fromClean =
    clean !== undefined &&
    verified !== undefined &&
    (await isAncestor(wc, clean, tip).catch(() => false)) &&
    (await isAncestor(wc, clean, verified).catch(() => false));
  return verifyAndJudge(wc, {
    to: tip,
    ...(ancestor === undefined ? {} : { ancestor }),
    ...(fromClean ? { since: clean } : {}),
  });
}

/** Commit-Autor aus `users/<handle>.md` in `rev`; ohne lesbaren Namen der Handle. */
async function authorAt(wc: string, rev: string, handle: string) {
  const spec = `${rev}:${userFile(handle)}`;
  const blob = (await readBlobs(wc, [spec])).get(spec);
  let name: unknown;
  try {
    name = blob == null ? undefined : parseEntityFile(blob.toString('utf8'), spec).data.name;
  } catch {
    name = undefined;
  }
  return authorOf(handle, typeof name === 'string' ? name : handle);
}

/**
 * Die einzige Änderung der Arbeitskopie: `git reset --keep <to>`. Vorher dürfen die Pfade, die
 * sich zwischen `from` und `to` unterscheiden, keine ungesicherten Änderungen tragen; sonst
 * bleibt alles, wie es ist. Hand-Edits auf anderen Pfaden überstehen den Reset.
 */
async function resetKeep(wc: string, from: string, to: string): Promise<void> {
  const { stdout } = await git(['diff', '--name-only', '-z', '--no-renames', from, to, '--'], {
    cwd: wc,
  });
  const paths = stdout.split('\0').filter((p) => p !== '');
  const dirty = await dirtyPaths(wc, paths);
  if (dirty.length > 0) {
    throw new BackeError(
      'conflict',
      `Ungesicherte Änderungen an ${dirty.join(', ')} verhindern den Sync`,
      {
        hint: `backe commit oder git -C ${wc} stash`,
        details: { paths: dirty },
      },
    );
  }
  await git(['reset', '-q', '--keep', to], { cwd: wc });
}

type Local = {
  fetched: number;
  replayed: number;
  conflicts: string[];
  notices: string[];
  claimLost?: SyncOutcome['claimLost'];
  /** Zu pushen; ohne lokale Commits `undefined`. */
  push: string | undefined;
  /** HEAD und Arbeitsbaum sind auf einen anderen Stand gesprungen. */
  moved: boolean;
};

type Round = { ctx: ResolvedContext; wc: string; handle: string; key: string; deps: SyncDeps };

/**
 * Der lokale Abschnitt unter dem Write-Lock: lokale Commits sind `HEAD --not tip`. Keine →
 * Fast-Forward auf `tip`; `tip` schon in HEAD → nichts zu tun, HEAD wird gepusht; sonst Replay
 * auf `tip` und `reset --keep` auf das Ergebnis. Lokale Commits müssen backe-Commits der eigenen
 * Identität sein (`readUnits`), auch ohne Replay. Abgelegte Einheiten landen erst nach dem Reset
 * in der Konfliktablage.
 */
async function localSection(r: Round, branch: string, tip: string | undefined, claimSha?: string) {
  const { wc, handle } = r;
  const head = await assertOnBranch(wc, branch);
  const local: Local = {
    fetched: 0,
    replayed: 0,
    conflicts: [],
    notices: [],
    push: head,
    moved: false,
  };
  if (tip !== undefined) {
    const { stdout } = await git(['rev-list', '--count', `${head}..${tip}`], { cwd: wc });
    local.fetched = Number(stdout.trim());
    if (await isAncestor(wc, head, tip)) {
      local.push = undefined;
      if (head !== tip) {
        await resetKeep(wc, head, tip);
        local.moved = true;
      }
      return local;
    }
  }
  const units = await readUnits(wc, { base: tip, head }, handle);
  if (tip === undefined || (await isAncestor(wc, tip, head))) return local;
  const now = r.deps.now ?? (() => new Date());
  const replay = await replayOnto(wc, {
    onto: tip,
    units,
    actor: handle,
    key: r.key,
    author: await authorAt(wc, tip, handle),
    env: r.ctx.env,
    now,
    ...(r.deps.randomBytes === undefined ? {} : { randomBytes: r.deps.randomBytes }),
    ...(claimSha === undefined ? {} : { claimSha }),
    ...(r.deps.resolveManual === undefined ? {} : { resolveManual: r.deps.resolveManual }),
  });
  await resetKeep(wc, head, replay.head);
  await writeConflicts(wc, replay.conflicts);
  return {
    ...local,
    replayed: replay.replayed,
    conflicts: replay.conflicts.map((e) => e.id),
    notices: replay.notices.map((n) => n.message),
    ...(replay.claimLost === undefined ? {} : { claimLost: replay.claimLost }),
    push: replay.head === tip ? undefined : replay.head,
    moved: true,
  };
}

/** Läuft unter dem Write-Lock der Arbeitskopie; SIGINT/SIGTERM erst nach dessen Freigabe. */
async function underWriteLock<T>(wc: string, fn: () => Promise<T>, lock?: LockOptions): Promise<T> {
  let deferred: NodeJS.Signals | undefined;
  try {
    return await withFileLock(
      join(await stateDir(wc), 'write.lock'),
      () =>
        withDeferredSignals(fn, {
          raise: (signal) => {
            deferred = signal;
          },
        }),
      lock,
    );
  } finally {
    if (deferred !== undefined) raiseSignal(deferred);
  }
}

/** Mit `attachments.lfs` nach einer Baumänderung: `git lfs pull`; Scheitern ist nur ein Hinweis. */
async function lfsPull(wc: string, env: Env): Promise<string[]> {
  try {
    await git(['lfs', 'version'], { cwd: wc });
  } catch {
    return [];
  }
  try {
    await git(['lfs', 'pull'], { cwd: wc, env: transportEnv(env) });
    return [];
  } catch (err) {
    return [`git lfs pull fehlgeschlagen: ${firstStderrLine(err)}`];
  }
}

/** Mit `attachments.lfs` vor jedem Push: `git lfs push`; ohne git-lfs wie beim Write. */
async function lfsPush(wc: string, env: Env, remote: string, sha: string): Promise<void> {
  try {
    await git(['lfs', 'version'], { cwd: wc });
  } catch {
    throw new BackeError('validation', 'attachments.lfs verlangt git-lfs', {
      hint: 'backe doctor',
    });
  }
  try {
    await git(['lfs', 'push', remote, sha], { cwd: wc, env: transportEnv(env) });
  } catch (err) {
    throw new BackeError('sync', `LFS-Push nach ${remote} fehlgeschlagen: ${firstStderrLine(err)}`);
  }
}

/** Pusht `sha` auf den Sync-Branch, nie mit `--force`; abgelehnt heißt: jemand war schneller. */
async function pushSha(
  wc: string,
  env: Env,
  remote: string,
  branch: string,
  sha: string,
): Promise<'pushed' | 'rejected'> {
  try {
    await git(['push', '-q', '--end-of-options', remote, `${sha}:refs/heads/${branch}`], {
      cwd: wc,
      env: transportEnv(env),
    });
  } catch (err) {
    if (stderrMatches(err, /\[rejected\]|non-fast-forward|fetch first/)) return 'rejected';
    throw new BackeError('sync', `Push nach ${remote} fehlgeschlagen: ${firstStderrLine(err)}`);
  }
  await git(['update-ref', `refs/remotes/${remote}/${branch}`, sha], { cwd: wc });
  return 'pushed';
}

/** Die Runden bis zum gelungenen Push, höchstens `MAX_ROUNDS`, mit Backoff dazwischen. */
async function runRounds(r: Round, config: BacklogConfig, claimSha?: string) {
  const { wc, ctx, deps } = r;
  const { remote, branch } = config.sync;
  const sleep = deps.sleep ?? ((ms: number) => delay(ms));
  const out: Omit<SyncOutcome, 'skipped'> = {
    fetched: 0,
    replayed: 0,
    conflicts: [],
    pushed: undefined,
    rounds: 0,
    notices: [],
  };
  for (let round = 1; ; round++) {
    out.rounds = round;
    const tip = await fetchTip(wc, ctx.env, remote, branch);
    await deps.hooks?.afterFetch?.(round);
    const upstream = await readLocalState(wc, 'upstream');
    if (tip !== undefined && tip !== upstream) {
      out.notices.push(...(await verifyIncoming(wc, tip, upstream)));
      await writeLocalState(wc, 'upstream', tip);
    }
    const local = await underWriteLock(wc, () => localSection(r, branch, tip, claimSha), deps.lock);
    out.fetched += local.fetched;
    out.replayed += local.replayed;
    out.conflicts.push(...local.conflicts);
    out.notices.push(...local.notices);
    if (local.claimLost !== undefined) out.claimLost = local.claimLost;
    if (local.moved && config.attachments.lfs) out.notices.push(...(await lfsPull(wc, ctx.env)));
    let rejected = false;
    if (local.push !== undefined) {
      await deps.hooks?.beforePush?.(round, local.push);
      if (config.attachments.lfs) await lfsPush(wc, ctx.env, remote, local.push);
      rejected = (await pushSha(wc, ctx.env, remote, branch, local.push)) === 'rejected';
      if (!rejected) {
        await writeLocalState(wc, 'upstream', local.push);
        out.pushed = local.push;
      }
    }
    await deps.hooks?.afterRound?.();
    if (!rejected) return out;
    if (round === MAX_ROUNDS) {
      throw new BackeError('sync', `Push nach ${MAX_ROUNDS} Runden abgelehnt`);
    }
    await sleep(BACKOFF_MS * 2 ** (round - 1));
  }
}

/** `last_error` aus einem Fehler der Runde; Pfade und Commit aus den Details, falls vorhanden. */
function lastError(err: unknown, at: string): NonNullable<SyncState['last_error']> {
  if (!(err instanceof BackeError)) {
    return { code: 'unexpected', message: err instanceof Error ? err.message : String(err), at };
  }
  const details = (err.details ?? {}) as { paths?: unknown; commit?: unknown };
  const paths = Array.isArray(details.paths) ? (details.paths as string[]) : undefined;
  const commit = typeof details.commit === 'string' ? details.commit : undefined;
  return {
    code: err.code,
    message: err.message,
    at,
    ...(paths === undefined ? {} : { paths }),
    ...(commit === undefined ? {} : { commit }),
  };
}

/**
 * Eine Sync-Runde (backe.md §2.16.2) unter `sync.lock` (wartend): bis zu fünf Durchgänge aus
 * `fetch`, Verify, lokalem Abschnitt und `push`. Ohne Git-Remote `sync.remote` → `skipped`.
 * `sync.json` hält Zeit und Ergebnis; ein Fehler steht dort als `last_error` und wird dann neu
 * geworfen. `claimSha` markiert die Claim-Einheit (backe.md §2.16.5).
 */
export async function syncNow(
  ctx: ResolvedContext,
  deps: SyncDeps = {},
  opts: { claimSha?: string } = {},
): Promise<SyncOutcome> {
  const { handle, key, workingCopy } = requireWriter(ctx);
  const { root: wc, notices } = (await exists(join(workingCopy, BACKLOG_CONFIG)))
    ? { root: workingCopy, notices: [] }
    : await ensureWorkingCopy(ctx, handle);
  const config = await headConfig(wc);
  if (config === undefined) {
    throw new BackeError('validation', `${wc} ist kein Backlog: ${BACKLOG_CONFIG} fehlt in HEAD`);
  }
  if ((await syncRemote(wc, config.sync.remote)) === undefined) {
    return {
      fetched: 0,
      replayed: 0,
      conflicts: [],
      pushed: undefined,
      rounds: 0,
      skipped: 'no_remote',
      notices,
    };
  }
  const now = deps.now ?? (() => new Date());
  const round: Round = { ctx, wc, handle, key, deps };
  return withFileLock(
    join(await stateDir(wc), 'sync.lock'),
    async () => {
      const before = await readSyncState(wc);
      const attempt = isoNow(now());
      try {
        const out = await runRounds(round, config, opts.claimSha);
        await writeSyncState(wc, { last_attempt: attempt, last_success: isoNow(now()) });
        return { ...out, notices: [...notices, ...out.notices] };
      } catch (err) {
        const { last_error: _, ...kept } = before;
        await writeSyncState(wc, {
          ...kept,
          last_attempt: attempt,
          last_error: lastError(err, attempt),
        });
        throw err;
      }
    },
    deps.lock,
  );
}

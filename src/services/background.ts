/**
 * Der Hintergrund-Sync (backe.md §2.16.2) samt Debounce über `sync.lock` und `sync.dirty`, sein
 * Start nach Writes und beim Lesen (§2.16.3) und der Sync-Status mit seiner Kopfzeile.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, openSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { lockHeld, withFileLock } from '../context/lock.ts';
import { exists } from '../context/paths.ts';
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { userConfigPath } from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import { git } from '../git/exec.ts';
import { resolveCommit } from '../git/history.ts';
import { readLocalState } from '../git/local-state.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { isoNow } from './env.ts';
import {
  effectiveMode,
  type SpawnFn,
  type SyncDeps,
  type SyncOutcome,
  syncHeld,
  syncNow,
  syncRemote,
} from './sync.ts';
import {
  appendSyncLog,
  type ConflictEntry,
  listConflicts,
  readSyncState,
  rotateSyncLog,
  type SyncState,
  syncFile,
} from './sync-state.ts';
import { requireHeadConfig } from './write.ts';

export type { SpawnFn } from './sync.ts';

/**
 * Startet `argv` als eigenständigen Prozess (detached, `unref`), stdout und stderr im
 * Append-Modus nach `log`, das vorher bei Bedarf rotiert wird. Scheitert der Start, steht das
 * im Log; den startenden Befehl stört es nicht.
 */
export const spawnDetached: SpawnFn = ({ argv, cwd, env, log }) => {
  rotateSyncLog(log);
  const fd = openSync(log, 'a');
  try {
    const [cmd, ...args] = argv;
    const child = spawn(cmd as string, args, {
      cwd,
      detached: true,
      stdio: ['ignore', fd, fd],
      env,
    });
    child.on('error', (err) => {
      try {
        appendFileSync(
          log,
          `${isoNow(new Date())} unexpected: Hintergrund-Sync nicht gestartet: ${err.message}\n`,
        );
      } catch {
        // Ohne beschreibbares Log bleibt nur, den Start still aufzugeben.
      }
    });
    child.unref();
  } finally {
    closeSync(fd);
  }
};

/** Kommandozeile des Hintergrund-Prozesses: derselbe Node, dasselbe Skript, `sync --background`. */
function backgroundArgv(backlog: string, handle: string): string[] {
  return [
    process.execPath,
    ...process.execArgv,
    ...process.argv.slice(1, 2),
    'sync',
    '--background',
    '--backlog',
    backlog,
    '--as',
    handle,
  ];
}

const errorParts = (err: unknown): { code: string; message: string } =>
  err instanceof BackeError
    ? { code: err.code, message: err.message }
    : { code: 'unexpected', message: err instanceof Error ? err.message : String(err) };

/** `sync.log` der Arbeitskopie; ohne Arbeitskopie oder Git-Dir `undefined`. */
async function logPath(wc: string | undefined): Promise<string | undefined> {
  if (wc === undefined) return undefined;
  try {
    return await syncFile(wc, 'sync.log');
  } catch {
    return undefined;
  }
}

/** Schreibt eine Logzeile, wenn es ein Log gibt; ein unschreibbares Log hält nichts auf. */
async function logLine(log: string | undefined, at: string, code: string, message: string) {
  if (log === undefined) return;
  try {
    await appendSyncLog(log, at, code, message);
  } catch {
    // Ein Log, das sich nicht schreiben lässt, hält den Sync nicht auf.
  }
}

/**
 * `backe sync --background` (backe.md §2.16.2): versucht `sync.lock` genau einmal. Gehalten →
 * `sync.dirty` anlegen und den Lock noch einmal versuchen; ist er dann immer noch gehalten, prüft
 * sein Halter das Flag nachweislich nach dem Setzen (in seiner Schleife oder nach der Freigabe),
 * und der Prozess endet (`deferred`). Mit dem Lock: Runden, solange `sync.dirty` nach einer Runde
 * wieder existiert; nach der Freigabe wird `sync.dirty` noch einmal geprüft und bei Bedarf erneut
 * der Lock versucht — das schließt die Lücke zwischen letzter Prüfung und Freigabe. Fehler einer
 * Runde stehen in `sync.json` und als Zeile `<iso> <code>: <message>` in `sync.log`, Hinweise als
 * `<iso> notice: <message>`. Wirft nie.
 */
export async function runBackground(
  ctx: ResolvedContext,
  deps: SyncDeps = {},
): Promise<{ rounds: number; deferred: boolean }> {
  const now = deps.now ?? (() => new Date());
  let log: string | undefined;
  const record = (code: string, message: string) => logLine(log, isoNow(now()), code, message);
  /** Eine Runde; liefert, ob sie gezählt wird (ohne Remote läuft keine). */
  const round = async (): Promise<number> => {
    try {
      const out = await syncHeld(ctx, deps);
      for (const notice of out.notices) await record('notice', notice);
      return out.skipped === undefined ? 1 : 0;
    } catch (err) {
      const { code, message } = errorParts(err);
      await record(code, message);
      return 1;
    }
  };

  let rounds = 0;
  try {
    log = await logPath(ctx.backlog.workingCopy);
    if (log !== undefined) rotateSyncLog(log);
    const { workingCopy: wc } = requireWriter(ctx);
    const lock = await syncFile(wc, 'sync.lock');
    const dirty = await syncFile(wc, 'sync.dirty');
    /** Mit dem Lock alle fälligen Runden; `false`, wenn ein anderer ihn hält. */
    const turn = async (): Promise<boolean> => {
      let acquired = false;
      try {
        await withFileLock(
          lock,
          async () => {
            acquired = true;
            do {
              await rm(dirty, { force: true });
              rounds += await round();
            } while (await exists(dirty));
            await deps.hooks?.beforeRelease?.();
          },
          { ...deps.lock, timeoutMs: 0 },
        );
        return true;
      } catch (err) {
        if (acquired || !(err instanceof BackeError) || err.code !== 'conflict') throw err;
        return false;
      }
    };
    let busy = false;
    for (;;) {
      if (await turn()) {
        busy = false;
        if (!(await exists(dirty))) return { rounds, deferred: false };
        continue;
      }
      await deps.hooks?.lockBusy?.();
      await writeFile(dirty, '');
      if (busy) return { rounds, deferred: true };
      busy = true;
    }
  } catch (err) {
    const { code, message } = errorParts(err);
    await record(code, message);
    return { rounds, deferred: false };
  }
}

/**
 * Seit dem letzten Versuch ist mindestens `pull_interval` vergangen. Ohne lesbaren Versuch oder
 * mit einem in der Zukunft (die Uhr wurde zurückgestellt) ist es immer fällig.
 */
async function pullDue(wc: string, pullInterval: number, deps: SyncDeps): Promise<boolean> {
  const last = Date.parse((await readSyncState(wc)).last_attempt ?? '');
  const now = (deps.now ?? (() => new Date()))().getTime();
  return Number.isNaN(last) || now < last || now - last >= pullInterval * 1000;
}

/**
 * Startet den Hintergrund-Sync (backe.md §2.16.1, §2.16.3), wenn die Arbeitskopie existiert, der
 * wirksame Modus `auto` ist und der Git-Remote `sync.remote` da ist; ein Read zusätzlich nur, wenn
 * `pull_interval` seit dem letzten Versuch verstrichen ist. Ein laufender Sync hält den Start nicht
 * auf — das Debounce im neuen Prozess fängt ihn ab. Liefert, ob gestartet wurde. Wirft nie: Ein
 * Fehler blockiert weder den Write davor noch das Lesen danach; er landet, wenn möglich, im Log.
 */
export async function scheduleSync(
  ctx: ResolvedContext,
  reason: 'write' | 'read',
  deps: SyncDeps = {},
): Promise<boolean> {
  try {
    return await startIfDue(ctx, reason, deps);
  } catch (err) {
    const { code, message } = errorParts(err);
    const at = isoNow((deps.now ?? (() => new Date()))());
    await logLine(await logPath(ctx.backlog.workingCopy), at, code, message);
    return false;
  }
}

async function startIfDue(
  ctx: ResolvedContext,
  reason: 'write' | 'read',
  deps: SyncDeps,
): Promise<boolean> {
  const wc = ctx.backlog.workingCopy;
  const handle = ctx.user.value;
  if (wc === undefined || handle === undefined) return false;
  if (!(await exists(join(wc, BACKLOG_CONFIG)))) return false;
  const config = await requireHeadConfig(wc);
  if (effectiveMode(ctx, config) === 'manual') return false;
  if ((await syncRemote(wc, config.sync.remote)) === undefined) return false;
  if (reason === 'read' && !(await pullDue(wc, config.sync.pull_interval, deps))) return false;
  (deps.spawn ?? spawnDetached)({
    argv: backgroundArgv(ctx.backlog.value, handle),
    cwd: wc,
    env: ctx.env,
    log: await syncFile(wc, 'sync.log'),
  });
  return true;
}

/**
 * Frische vor dem Lesen (backe.md §2.16.3): `force` (`--sync`) dreht eine blockierende Runde, deren
 * Fehler den Befehl abbricht; sonst startet bei Bedarf der Hintergrund-Sync, ohne je zu werfen.
 */
export async function freshen(
  ctx: ResolvedContext,
  opts: { force: boolean },
  deps: SyncDeps = {},
): Promise<SyncOutcome | undefined> {
  if (opts.force) return syncNow(ctx, deps);
  await scheduleSync(ctx, 'read', deps);
  return undefined;
}

export type SyncStatus = {
  /** URL des Git-Remotes `sync.remote`; ohne ihn `undefined`. */
  remote: string | undefined;
  mode: 'auto' | 'manual';
  unpushed: number;
  /** `sync.lock` wird von einem lebenden Prozess gehalten. */
  running: boolean;
  state: SyncState;
  conflicts: ConflictEntry[];
};

/**
 * Lokale Commits, die das Remote noch nicht hat: ab `upstream`; ohne ihn ab dem
 * Remote-Tracking-Ref, ohne den ab `verified`, ohne den alle.
 */
async function countUnpushed(wc: string, remote: string, branch: string): Promise<number> {
  const base =
    (await readLocalState(wc, 'upstream')) ??
    (await resolveCommit(wc, `refs/remotes/${remote}/${branch}`).catch(() => undefined)) ??
    (await readLocalState(wc, 'verified'));
  const range = base === undefined ? 'HEAD' : `${base}..HEAD`;
  const { stdout } = await git(['rev-list', '--count', range], { cwd: wc });
  return Number(stdout.trim());
}

/** Zustand des Syncs der Arbeitskopie (`backe sync status`, Kopfzeile). */
export async function syncStatus(
  ctx: ResolvedContext,
  deps: Pick<SyncDeps, 'lock'> = {},
): Promise<SyncStatus> {
  const wc = ctx.backlog.workingCopy;
  if (wc === undefined) {
    throw new BackeError(
      'usage',
      'Kein User aufgelöst, der Sync-Status gehört zu einer Identität',
      {
        hint: `--as <handle>, BACKE_USER oder »user« in ${userConfigPath(ctx.homes.backeHome)}`,
      },
    );
  }
  if (!(await exists(join(wc, BACKLOG_CONFIG)))) {
    throw new BackeError('not_found', `Keine Arbeitskopie unter ${wc}`, {
      hint: 'backe sync legt sie an',
    });
  }
  const config = await requireHeadConfig(wc);
  const remote = await syncRemote(wc, config.sync.remote);
  return {
    remote,
    mode: effectiveMode(ctx, config),
    unpushed:
      remote === undefined ? 0 : await countUnpushed(wc, config.sync.remote, config.sync.branch),
    running: await lockHeld(await syncFile(wc, 'sync.lock'), deps.lock),
    state: await readSyncState(wc),
    conflicts: await listConflicts(wc),
  };
}

/**
 * Die Kopfzeile (backe.md §2.16.2) ohne den Verweis auf `backe sync status`, den die CLI anhängt:
 * `Sync: ` und die offenen Teile mit ` · ` getrennt; nichts offen → `undefined`. Ungepushtes zählt
 * nur mit Remote und nur, wenn die letzte Runde fehlschlug oder der Modus `manual` ist.
 */
export function statusLine(s: SyncStatus): string | undefined {
  const parts: string[] = [];
  const error = s.state.last_error;
  if (s.remote !== undefined && s.unpushed > 0 && (error !== undefined || s.mode === 'manual')) {
    parts.push(`${s.unpushed} ungepusht`);
  }
  const n = s.conflicts.length;
  if (n > 0) parts.push(`${n} ${n === 1 ? 'Konflikt' : 'Konflikte'}`);
  if (error !== undefined) parts.push(`letzter Sync fehlgeschlagen: ${error.message}`);
  return parts.length === 0 ? undefined : `Sync: ${parts.join(' · ')}`;
}

/**
 * Der Start des Hintergrund-Syncs (backe.md §2.16.1, §2.16.3): wann ein Write oder ein Read ihn
 * anstößt, wie der Prozess losläuft, und der Nachlauf eines Vordergrund-Syncs, während dessen ein
 * Hintergrund-Lauf nur `sync.dirty` setzen konnte. Liegt unter `sync.ts`, damit die Runde selbst
 * den Nachlauf auslösen kann, ohne `background.ts` zu importieren.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { exists } from '../context/paths.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { BacklogConfig } from '../core/schemas.ts';
import { remoteUrl } from '../git/query.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { isoNow } from './env.ts';
import type { SyncDeps } from './sync.ts';
import { appendSyncLog, readSyncState, rotateSyncLog, syncFile } from './sync-state.ts';
import { requireHeadConfig } from './write.ts';

type Env = ResolvedContext['env'];

/** Startet `backe sync --background` als eigenständigen Prozess; `log` nimmt seine Ausgabe auf. */
export type SpawnFn = (args: { argv: string[]; cwd: string; env: Env; log: string }) => void;

/** Wirksamer Modus (backe.md §2.16.2): die User-Config vor `sync.mode` des Backlogs. */
export function effectiveMode(ctx: ResolvedContext, config: BacklogConfig): 'auto' | 'manual' {
  return ctx.userConfig.backlogs?.[ctx.backlog.value]?.sync?.mode ?? config.sync.mode;
}

/** URL des Git-Remotes `remote` der Arbeitskopie; ohne ihn `undefined` (»kein Remote«). */
export function syncRemote(wc: string, remote: string): Promise<string | undefined> {
  return remoteUrl(wc, remote);
}

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

export const errorParts = (err: unknown): { code: string; message: string } =>
  err instanceof BackeError
    ? { code: err.code, message: err.message }
    : { code: 'unexpected', message: err instanceof Error ? err.message : String(err) };

/** `sync.log` der Arbeitskopie; ohne Arbeitskopie oder Git-Dir `undefined`. */
export async function logPath(wc: string | undefined): Promise<string | undefined> {
  if (wc === undefined) return undefined;
  try {
    return await syncFile(wc, 'sync.log');
  } catch {
    return undefined;
  }
}

/** Schreibt eine Logzeile, wenn es ein Log gibt; ein unschreibbares Log hält nichts auf. */
export async function logLine(
  log: string | undefined,
  at: string,
  code: string,
  message: string,
): Promise<void> {
  if (log === undefined) return;
  try {
    await appendSyncLog(log, at, code, message);
  } catch {
    // Ein Log, das sich nicht schreiben lässt, hält den Sync nicht auf.
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
export function scheduleSync(
  ctx: ResolvedContext,
  reason: 'write' | 'read',
  deps: SyncDeps = {},
): Promise<boolean> {
  return neverThrows(ctx, deps, () => startIfDue(ctx, reason, deps));
}

/** Führt einen Start aus; ein Fehler landet, wenn möglich, im Log und heißt »nicht gestartet«. */
async function neverThrows(
  ctx: ResolvedContext,
  deps: SyncDeps,
  start: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await start();
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
 * Nachlauf eines Vordergrund-Syncs, nachdem er `sync.lock` freigegeben hat: Hat ein
 * Hintergrund-Lauf in der Zwischenzeit nur `sync.dirty` gesetzt (der Lock war ja gehalten), wartet
 * dessen Anlass sonst bis zum nächsten Write oder Read. Dann startet der Hintergrund-Sync wie nach
 * einem Write. `wc` ist die Arbeitskopie; der Pfad von `sync.dirty` wird innerhalb des Schutzes
 * aufgelöst, damit auch ein Fehler dabei den Aufrufer (ein `finally`) nie erreicht. Wirft nie.
 */
export function scheduleDeferred(
  ctx: ResolvedContext,
  wc: string,
  deps: SyncDeps = {},
): Promise<boolean> {
  return neverThrows(
    ctx,
    deps,
    async () => (await exists(await syncFile(wc, 'sync.dirty'))) && startIfDue(ctx, 'write', deps),
  );
}

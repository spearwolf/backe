import { randomBytes } from 'node:crypto';
import { link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, uptime } from 'node:os';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BackeError } from '../core/errors.ts';
import { m } from './lock.messages.ts';

export type LockOptions = {
  timeoutMs?: number;
  retryMs?: number;
  isAlive?: (pid: number) => boolean;
  /** Eigener Hostname (Default `os.hostname()`); nur Locks desselben Hosts werden übernommen. */
  host?: string;
  /** Boot-Zeitpunkt in ms seit Epoch (Default `Date.now() - os.uptime() * 1000`). */
  bootTime?: number;
};

/** Toleranz zwischen Boot-Zeitpunkt und Lock-Zeit (Uhr-Ungenauigkeit von `uptime`). */
const BOOT_TOLERANCE_MS = 5000;

/** Fehlercodes von `link`, die auf ein Dateisystem ohne Hardlinks hindeuten. */
const NO_HARDLINK_CODES = new Set(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS']);

type Identity = { host: string; bootTime: number; isAlive: (pid: number) => boolean };

type Holder = { pid: number | undefined; time: number; host: string | undefined };

function parseHolder(content: string): Holder {
  const [first = '', time = '', host = ''] = content.split('\n');
  const pid = Number.parseInt(first, 10);
  return {
    pid: Number.isInteger(pid) && pid > 0 ? pid : undefined,
    time: Date.parse(time),
    host: host === '' ? undefined : host,
  };
}

/** Stammt der Lock von einem anderen Host? Ein Lock ohne Host-Zeile (altes Format) zählt als eigener. */
export function foreignHost(holder: Pick<Holder, 'host'>, host: string): boolean {
  return holder.host !== undefined && holder.host !== host;
}

/** Ein Lock ist übernehmbar: gleicher Host und von vor dem Boot oder Halter tot. */
function takeable(holder: Holder, id: Identity): boolean {
  if (holder.pid === undefined) return false;
  if (foreignHost(holder, id.host)) return false;
  if (holder.time < id.bootTime - BOOT_TOLERANCE_MS) return true;
  return !id.isAlive(holder.pid);
}

function identity(opts: LockOptions): Identity {
  return {
    isAlive: opts.isAlive ?? processAlive,
    host: opts.host ?? hostname(),
    bootTime: opts.bootTime ?? Date.now() - uptime() * 1000,
  };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw error;
  }
}

async function readLock(lockPath: string): Promise<string | undefined> {
  try {
    return await readFile(lockPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Ein Reap-Lock älter als dies gilt als verwaist (Reaping dauert Millisekunden). */
const ORPHANED_REAP_MS = 10_000;

/**
 * Veröffentlicht den Lock atomar: vollständiger Inhalt in eine Temp-Datei, dann `link`.
 * Die Zieldatei existiert so nie ohne ihren Inhalt; `EEXIST` heißt: gehalten.
 */
async function publish(lockPath: string, host: string): Promise<boolean> {
  const tmp = `${lockPath}.${process.pid}.${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, `${process.pid}\n${new Date().toISOString()}\n${host}\n`, {
      flag: 'wx',
    });
    try {
      await link(tmp, lockPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== undefined && NO_HARDLINK_CODES.has(code)) {
        throw new BackeError('unexpected', m.noHardlinks(dirname(lockPath)), {
          hint: m.noHardlinksHint,
        });
      }
      throw error;
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  } finally {
    await rm(tmp, { force: true });
  }
}

/**
 * Entfernt den veralteten Lock `stale` serialisiert über `<lock>.reap`. Gelöscht wird nur, wenn
 * die Datei noch genau diesen Inhalt hat und er weiterhin übernehmbar ist. Liefert, ob gelöscht wurde.
 */
async function reap(lockPath: string, stale: string, id: Identity): Promise<boolean> {
  const reapPath = `${lockPath}.reap`;
  if (!(await publish(reapPath, id.host))) {
    try {
      const { mtimeMs } = await stat(reapPath);
      if (Date.now() - mtimeMs > ORPHANED_REAP_MS) await rm(reapPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return false;
  }
  try {
    if ((await readLock(lockPath)) !== stale || !takeable(parseHolder(stale), id)) return false;
    await rm(lockPath, { force: true });
    return true;
  } finally {
    await rm(reapPath, { force: true });
  }
}

/**
 * Führt `fn` unter einem exklusiven Lock aus (Datei mit PID, Zeit und Host, atomar veröffentlicht).
 * Übernommen wird ein Lock nur auf demselben Host und nur, wenn er von vor dem Boot stammt
 * oder sein Halter tot ist. Nicht reentrant: Steht die eigene PID in der Datei, gilt der Lock
 * als von einem lebenden Prozess gehalten. Das Reaping läuft serialisiert über `<lock>.reap`.
 *
 * Restgrenzen: Ein Reaper, der länger als 10 s angehalten wird, kann einen frischen Lock
 * entfernen; das `stat`-dann-`unlink` eines verwaisten Reap-Locks ist bei drei Konkurrenten
 * nicht atomar; Temp-Dateien eines abgestürzten Prozesses bleiben liegen (räumt `doctor` in M5);
 * Locks werden in der Reihenfolge `write.lock` vor `config.lock` genommen.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const retryMs = opts.retryMs ?? 50;
  const id = identity(opts);
  const deadline = Date.now() + timeoutMs;

  await mkdir(dirname(lockPath), { recursive: true });
  while (!(await publish(lockPath, id.host))) {
    const content = await readLock(lockPath);
    const holder = parseHolder(content ?? '');
    // Ein eigenes Reaping bringt Fortschritt und wird sofort neu versucht; jeder andere Pfad prüft die Frist.
    if (content !== undefined && takeable(holder, id) && (await reap(lockPath, content, id))) {
      continue;
    }
    if (Date.now() >= deadline) {
      const pid = holder.pid ?? m.unknownPid;
      if (holder.pid === undefined) {
        throw new BackeError('conflict', m.lockHeld(lockPath, pid), {
          hint: m.lockHolderUnknownHint(lockPath),
        });
      }
      if (foreignHost(holder, id.host)) {
        throw new BackeError('conflict', m.lockHeldOnHost(lockPath, pid, String(holder.host)), {
          hint: m.lockForeignHostHint(lockPath),
        });
      }
      throw new BackeError('conflict', m.lockHeld(lockPath, pid), {
        hint: m.lockOtherProcessHint,
      });
    }
    await sleep(retryMs);
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

/**
 * Ob `lockPath` gerade gehalten wird, so wie `withFileLock` urteilt: Die Datei existiert und ist
 * nicht übernehmbar (lebender Halter, fremder Host oder unlesbare PID).
 */
export async function lockHeld(lockPath: string, opts: LockOptions = {}): Promise<boolean> {
  const content = await readLock(lockPath);
  return content !== undefined && !takeable(parseHolder(content), identity(opts));
}

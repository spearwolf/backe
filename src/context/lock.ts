import { randomBytes } from 'node:crypto';
import { link, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { BackeError } from '../core/errors.ts';

export type LockOptions = {
  timeoutMs?: number;
  retryMs?: number;
  isAlive?: (pid: number) => boolean;
};

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
async function publish(lockPath: string): Promise<boolean> {
  const tmp = `${lockPath}.${process.pid}.${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, `${process.pid}\n${new Date().toISOString()}\n`, { flag: 'wx' });
    await link(tmp, lockPath);
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
 * die Datei noch genau diesen Inhalt hat und der Halter tot ist. Liefert, ob gelöscht wurde.
 */
async function reap(
  lockPath: string,
  stale: string,
  pid: number,
  isAlive: (pid: number) => boolean,
): Promise<boolean> {
  const reapPath = `${lockPath}.reap`;
  if (!(await publish(reapPath))) {
    try {
      const { mtimeMs } = await stat(reapPath);
      if (Date.now() - mtimeMs > ORPHANED_REAP_MS) await rm(reapPath, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return false;
  }
  try {
    if ((await readLock(lockPath)) !== stale || isAlive(pid)) return false;
    await rm(lockPath, { force: true });
    return true;
  } finally {
    await rm(reapPath, { force: true });
  }
}

/**
 * Führt `fn` unter einem exklusiven Lock aus (PID-Datei, atomar veröffentlicht).
 * Die Datei eines toten Prozesses wird übernommen. Nicht reentrant: Steht die eigene PID
 * in der Datei, gilt der Lock als von einem lebenden Prozess gehalten.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  opts: LockOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const retryMs = opts.retryMs ?? 50;
  const isAlive = opts.isAlive ?? processAlive;
  const deadline = Date.now() + timeoutMs;

  await mkdir(dirname(lockPath), { recursive: true });
  while (!(await publish(lockPath))) {
    const content = await readLock(lockPath);
    const pid = Number.parseInt((content ?? '').split('\n')[0] ?? '', 10);
    const valid = Number.isInteger(pid) && pid > 0;
    // Ein eigenes Reaping bringt Fortschritt und wird sofort neu versucht; jeder andere Pfad prüft die Frist.
    if (
      content !== undefined &&
      valid &&
      !isAlive(pid) &&
      (await reap(lockPath, content, pid, isAlive))
    ) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new BackeError(
        'conflict',
        `Lock ${lockPath} gehalten von PID ${valid ? pid : 'unbekannt'}`,
        {
          hint: 'Läuft noch ein anderer backe-Prozess?',
        },
      );
    }
    await sleep(retryMs);
  }
  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

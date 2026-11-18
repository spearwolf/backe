import { mkdir, open, readFile, rm } from 'node:fs/promises';
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

async function tryCreate(lockPath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`);
  } finally {
    await handle.close();
  }
  return true;
}

/**
 * Führt `fn` unter einem exklusiven Lock aus (PID-Datei, exklusiv angelegt).
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
  while (!(await tryCreate(lockPath))) {
    const content = await readLock(lockPath);
    // Zwischen Anlegeversuch und Lesen freigegeben: sofort neu versuchen.
    if (content === undefined) continue;
    const pid = Number.parseInt(content.split('\n')[0] ?? '', 10);
    // Ohne lesbare PID (Datei gerade erst angelegt) gilt der Lock als gehalten.
    if (Number.isInteger(pid) && pid > 0 && !isAlive(pid)) {
      // Nur löschen, wenn nicht inzwischen jemand anderes den Lock übernommen hat.
      if ((await readLock(lockPath)) === content) await rm(lockPath, { force: true });
      continue;
    }
    if (Date.now() >= deadline) {
      throw new BackeError(
        'conflict',
        `Lock ${lockPath} gehalten von PID ${Number.isInteger(pid) ? pid : 'unbekannt'}`,
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

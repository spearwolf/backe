import { existsSync, writeFileSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { withFileLock } from './lock.ts';

test('a second holder waits until the first releases', async () => {
  const lock = join(await tempDir(), 'x.lock');
  const order: string[] = [];
  let release!: () => void;
  const first = withFileLock(
    lock,
    () =>
      new Promise<void>((r) => {
        order.push('a');
        release = r;
      }),
  );
  await vi.waitFor(() => expect(order).toEqual(['a']));
  const second = withFileLock(
    lock,
    async () => {
      order.push('b');
    },
    { retryMs: 5 },
  );
  release();
  await Promise.all([first, second]);
  expect(order).toEqual(['a', 'b']);
  expect(existsSync(lock)).toBe(false);
});

test('the lock file holds pid and ISO time, parent directories are created', async () => {
  const lock = join(await tempDir(), 'sub', 'dir', 'x.lock');
  const content = await withFileLock(lock, () => readFile(lock, 'utf8'));
  const [pid, time] = content.split('\n');
  expect(pid).toBe(String(process.pid));
  expect(new Date(time ?? '').toISOString()).toBe(time);
});

test('a lock of a dead process is taken over', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, '999999\n2026-01-01T00:00:00Z\n');
  expect(await withFileLock(lock, async () => 42, { isAlive: () => false })).toBe(42);
});

test('a live holder past the timeout is a conflict naming the pid', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, `${process.pid}\n`);
  const err = await catchErrAsync(() => withFileLock(lock, async () => 1, { timeoutMs: 0 }));
  expect(err.code).toBe('conflict');
  expect(err.message).toBe(`Lock ${lock} gehalten von PID ${process.pid}`);
  expect(err.hint).toBe('Läuft noch ein anderer backe-Prozess?');
  expect(existsSync(lock)).toBe(true);
});

test('a live holder that releases within the timeout is waited for', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, `${process.pid}\n`);
  setTimeout(() => void rm(lock), 20);
  expect(await withFileLock(lock, async () => 'ok', { retryMs: 5 })).toBe('ok');
});

test('the default liveness check sees the own pid as alive and a gone pid as dead', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, `${process.pid}\n`);
  await expect(withFileLock(lock, async () => 1, { timeoutMs: 0 })).rejects.toMatchObject({
    code: 'conflict',
  });
  await writeFile(lock, '2147483646\n');
  expect(await withFileLock(lock, async () => 'taken')).toBe('taken');
});

test('a permission error from the liveness probe counts as alive', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, '1\n');
  const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('nope'), { code: 'EPERM' });
  });
  try {
    const err = await catchErrAsync(() => withFileLock(lock, async () => 1, { timeoutMs: 0 }));
    expect(err.code).toBe('conflict');
  } finally {
    spy.mockRestore();
  }
});

test('an unexpected error from the liveness probe is rethrown', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, '1\n');
  const spy = vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('boom'), { code: 'EINVAL' });
  });
  try {
    await expect(withFileLock(lock, async () => 1, { timeoutMs: 0 })).rejects.toThrow('boom');
  } finally {
    spy.mockRestore();
  }
});

test('a lock file without a readable pid is treated as held', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, '');
  const err = await catchErrAsync(() => withFileLock(lock, async () => 1, { timeoutMs: 0 }));
  expect(err.code).toBe('conflict');
  expect(err.message).toContain('unbekannt');
});

test('a stale lock whose content changed in between is not deleted', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, '111\n');
  const isAlive = (pid: number): boolean => {
    if (pid === 111) {
      // Ein anderer Prozess übernimmt den Lock zwischen erstem Lesen und Löschen.
      writeFileSync(lock, '222\n');
      return false;
    }
    return true;
  };
  const err = await catchErrAsync(() =>
    withFileLock(lock, async () => 1, { timeoutMs: 0, isAlive }),
  );
  expect(err.message).toContain('PID 222');
  expect(await readFile(lock, 'utf8')).toBe('222\n');
});

test('the lock is released when fn throws', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await expect(
    withFileLock(lock, async () => {
      throw new Error('x');
    }),
  ).rejects.toThrow('x');
  expect(existsSync(lock)).toBe(false);
});

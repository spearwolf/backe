import { existsSync, writeFileSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { withFileLock } from './lock.ts';

let linkError: Error | undefined;
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    link: (...args: Parameters<typeof actual.link>) =>
      linkError ? Promise.reject(linkError) : actual.link(...args),
  };
});

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

test('the lock file holds pid, time and host', async () => {
  const lock = join(await tempDir(), 'x.lock');
  const content = await withFileLock(lock, () => readFile(lock, 'utf8'), { host: 'host-a' });
  expect(content).toMatch(/^\d+\n\d{4}-\d\d-\d\dT[^\n]+Z\nhost-a\n$/);
});

test('a lock of another host is never taken over', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, `999999\n${new Date().toISOString()}\nhost-b\n`);
  const err = await catchErrAsync(() =>
    withFileLock(lock, async () => 1, { host: 'host-a', isAlive: () => false, timeoutMs: 0 }),
  );
  expect(err.code).toBe('conflict');
  expect(err.message).toBe(`Lock ${lock} gehalten von PID 999999 auf host-b`);
  expect(err.hint).toBe(`Läuft dort kein backe-Prozess mehr: ${lock} löschen.`);
});

test('a lock from before the boot is taken over even if its pid is alive', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, `${process.pid}\n2026-01-01T00:00:00.000Z\nhost-a\n`);
  expect(
    await withFileLock(lock, async () => 'ok', {
      host: 'host-a',
      bootTime: Date.parse('2026-06-01T00:00:00Z'),
      isAlive: () => true,
      timeoutMs: 0,
    }),
  ).toBe('ok');
});

test('a lock from after the boot with a live pid is kept', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, `${process.pid}\n2026-07-01T00:00:00.000Z\nhost-a\n`);
  const err = await catchErrAsync(() =>
    withFileLock(lock, async () => 1, {
      host: 'host-a',
      bootTime: Date.parse('2026-06-01T00:00:00Z'),
      isAlive: () => true,
      timeoutMs: 0,
    }),
  );
  expect(err.code).toBe('conflict');
  expect(err.hint).toBe('Läuft noch ein anderer backe-Prozess?');
});

test('a lock without host line from the previous format counts as the own host', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, `999999\n${new Date().toISOString()}\n`);
  expect(
    await withFileLock(lock, async () => 'ok', {
      host: 'host-a',
      bootTime: 0,
      isAlive: () => false,
      timeoutMs: 0,
    }),
  ).toBe('ok');
});

test.each(['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS'])(
  '%s from link means no hardlink support',
  async (code) => {
    const dir = await tempDir();
    linkError = Object.assign(new Error('nope'), { code });
    try {
      const err = await catchErrAsync(() => withFileLock(join(dir, 'x.lock'), async () => 1));
      expect(err.code).toBe('unexpected');
      expect(err.message).toBe(`Dateisystem ohne Hardlinks: ${dir}`);
      expect(err.hint).toBe('BACKE_HOME und Arbeitskopien auf ein lokales Dateisystem legen.');
    } finally {
      linkError = undefined;
    }
    expect(await readdir(dir)).toEqual([]);
  },
);

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
  expect(err.message).toBe(`Lock ${lock} gehalten von PID unbekannt`);
  expect(err.hint).toBe(`Falls kein backe-Prozess läuft: ${lock} löschen.`);
});

test('a stale lock whose content changed in between is not deleted', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, '111\n');
  const isAlive = (pid: number): boolean => {
    if (pid === 111) {
      // Ein anderer Prozess übernimmt den Lock zwischen erstem Lesen und Reaping.
      writeFileSync(lock, '222\n');
      return false;
    }
    return true;
  };
  const err = await catchErrAsync(() =>
    withFileLock(lock, async () => 1, { timeoutMs: 0, isAlive }),
  );
  expect(err.code).toBe('conflict');
  expect(await readFile(lock, 'utf8')).toBe('222\n');
});

test('a stale lock whose holder turns out alive during reaping is kept', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await writeFile(lock, '111\n');
  let probes = 0;
  const isAlive = (): boolean => ++probes > 1;
  const err = await catchErrAsync(() =>
    withFileLock(lock, async () => 1, { timeoutMs: 0, isAlive }),
  );
  expect(err.code).toBe('conflict');
  expect(await readFile(lock, 'utf8')).toBe('111\n');
});

test('concurrent takeovers of a stale lock never run fn at the same time', async () => {
  const dir = await tempDir();
  const lock = join(dir, 'x.lock');
  await writeFile(lock, '111\n');
  let inside = 0;
  let maxInside = 0;
  const done: number[] = [];
  const run = (n: number) =>
    withFileLock(
      lock,
      async () => {
        inside += 1;
        maxInside = Math.max(maxInside, inside);
        for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
        inside -= 1;
        done.push(n);
      },
      { isAlive: (pid) => pid !== 111, retryMs: 1 },
    );
  await Promise.all([run(1), run(2), run(3), run(4)]);
  expect(maxInside).toBe(1);
  expect(done.sort()).toEqual([1, 2, 3, 4]);
  expect(existsSync(lock)).toBe(false);
  expect(await readdir(dir)).toEqual([]);
});

test('an orphaned reap lock with an old mtime does not block a takeover', async () => {
  const dir = await tempDir();
  const lock = join(dir, 'x.lock');
  await writeFile(lock, '111\n');
  await writeFile(`${lock}.reap`, `${process.pid}\n`);
  const old = new Date(Date.now() - 60_000);
  await utimes(`${lock}.reap`, old, old);
  expect(
    await withFileLock(lock, async () => 'ok', { isAlive: (pid) => pid !== 111, retryMs: 1 }),
  ).toBe('ok');
  expect(await readdir(dir)).toEqual([]);
});

test('a fresh reap lock blocks the takeover like a held lock', async () => {
  const dir = await tempDir();
  const lock = join(dir, 'x.lock');
  await writeFile(lock, '111\n');
  await writeFile(`${lock}.reap`, `${process.pid}\n`);
  const err = await catchErrAsync(() =>
    withFileLock(lock, async () => 1, { timeoutMs: 0, isAlive: () => false }),
  );
  expect(err.code).toBe('conflict');
  expect(await readFile(lock, 'utf8')).toBe('111\n');
});

test('the lock file is published complete and no temp file is left behind', async () => {
  const dir = await tempDir();
  const lock = join(dir, 'x.lock');
  const seen = await withFileLock(lock, async () => ({
    content: await readFile(lock, 'utf8'),
    files: await readdir(dir),
  }));
  expect(seen.content).toMatch(/^\d+\n.+\n.+\n$/);
  expect(seen.files).toEqual(['x.lock']);
  expect(await readdir(dir)).toEqual([]);
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

test('a lock path that is a directory surfaces the read error', async () => {
  const lock = join(await tempDir(), 'x.lock');
  await mkdir(lock);
  await expect(withFileLock(lock, async () => 1, { timeoutMs: 0 })).rejects.toMatchObject({
    code: 'EISDIR',
  });
});

test('a failure to publish other than EEXIST is rethrown and leaves nothing behind', async () => {
  const dir = await tempDir();
  await chmod(dir, 0o500);
  try {
    await expect(withFileLock(join(dir, 'x.lock'), async () => 1)).rejects.toMatchObject({
      code: 'EACCES',
    });
  } finally {
    await chmod(dir, 0o700);
  }
  expect(await readdir(dir)).toEqual([]);
});

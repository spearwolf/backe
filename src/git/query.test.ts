import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { git } from './exec.ts';
import { gitRemotes, gitToplevel, unpushedCount } from './query.ts';

describe('gitToplevel', () => {
  test('toplevel of a nested dir, undefined outside a repo', async () => {
    const dir = await realpath(await tempDir());
    await git(['init', '-q'], { cwd: dir });
    await mkdir(join(dir, 'a/b'), { recursive: true });
    expect(await gitToplevel(join(dir, 'a/b'))).toBe(dir);
    expect(await gitToplevel(await tempDir())).toBeUndefined();
  });

  test('a GIT_DIR in the process environment does not leak into the lookup', async () => {
    const repo = await tempDir();
    await git(['init', '-q'], { cwd: repo });
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = join(repo, '.git');
    try {
      expect(await gitToplevel(await tempDir())).toBeUndefined();
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
  });
});

describe('gitRemotes', () => {
  test('remotes: origin first, then by name', async () => {
    const dir = await tempDir();
    await git(['init', '-q'], { cwd: dir });
    for (const [n, u] of [
      ['zz', 'gh:z/z'],
      ['origin', 'gh:o/o'],
      ['aa', 'gh:a/a'],
    ] as const) {
      await git(['remote', 'add', n, u], { cwd: dir });
    }
    expect(await gitRemotes(dir)).toEqual([
      { name: 'origin', url: 'gh:o/o' },
      { name: 'aa', url: 'gh:a/a' },
      { name: 'zz', url: 'gh:z/z' },
    ]);
  });

  test('no remotes yields an empty list', async () => {
    const dir = await tempDir();
    await git(['init', '-q'], { cwd: dir });
    expect(await gitRemotes(dir)).toEqual([]);
  });
});

test('a git error other than "not a git repository" is thrown', async () => {
  const dir = await tempDir();
  await git(['init', '-q'], { cwd: dir });
  await writeFile(join(dir, '.git/config'), '[broken\n');
  expect((await catchErrAsync(() => gitToplevel(dir))).code).toBe('unexpected');
});

describe('unpushedCount', () => {
  async function commit(dir: string, name: string): Promise<void> {
    await writeFile(join(dir, name), name);
    await git(['add', name], { cwd: dir });
    await git(['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-q', '-m', name], {
      cwd: dir,
    });
  }

  test('counts commits of the branch that no remote-tracking ref contains', async () => {
    const remote = join(await tempDir(), 'r.git');
    await git(['init', '--bare', '-q', '-b', 'main', remote], { cwd: await tempDir() });
    const dir = await tempDir();
    await git(['init', '-q', '-b', 'main'], { cwd: dir });
    await git(['remote', 'add', 'origin', remote], { cwd: dir });
    await commit(dir, 'a');
    await commit(dir, 'b');
    expect(await unpushedCount(dir, 'main')).toBe(2);
    await git(['push', '-q', 'origin', 'main'], { cwd: dir });
    expect(await unpushedCount(dir, 'main')).toBe(0);
    await commit(dir, 'c');
    expect(await unpushedCount(dir, 'main')).toBe(1);
  });

  test('a branch that does not exist counts zero', async () => {
    const dir = await tempDir();
    await git(['init', '-q', '-b', 'main'], { cwd: dir });
    expect(await unpushedCount(dir, 'main')).toBe(0);
  });
});

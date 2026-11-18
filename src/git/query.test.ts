import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { git } from './exec.ts';
import { gitRemotes, gitToplevel } from './query.ts';

describe('gitToplevel', () => {
  test('toplevel of a nested dir, undefined outside a repo', async () => {
    const dir = await realpath(await tempDir());
    await git(['init', '-q'], { cwd: dir });
    await mkdir(join(dir, 'a/b'), { recursive: true });
    expect(await gitToplevel(join(dir, 'a/b'))).toBe(dir);
    expect(await gitToplevel(await tempDir())).toBeUndefined();
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

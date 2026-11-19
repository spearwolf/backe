import { mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { git } from './exec.ts';
import { changedPaths } from './status.ts';

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];

async function put(wc: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(wc, path)), { recursive: true });
  await writeFile(join(wc, path), content);
}

async function repo(): Promise<string> {
  const wc = await realpath(await tempDir());
  await git(['init', '-q', '-b', 'main'], { cwd: wc });
  for (const p of ['a.md', 'b.md', 'c.md', 'd.md', 'dir/e.md']) await put(wc, p, `${p}\n`);
  await put(wc, '.gitignore', 'ignored.md\n');
  await git(['add', '.'], { cwd: wc });
  await git([...IDENT, 'commit', '-q', '-m', 'one'], { cwd: wc });
  return wc;
}

test('changedPaths lists modified, staged, untracked and deleted paths', async () => {
  const wc = await repo();
  await put(wc, 'a.md', 'geändert\n');
  await put(wc, 'b.md', 'gestaged\n');
  await git(['add', 'b.md'], { cwd: wc });
  await rm(join(wc, 'c.md'));
  await git(['rm', '-q', '--cached', 'd.md'], { cwd: wc });
  await put(wc, 'new/deep/f.md', 'neu\n');
  await put(wc, 'ignored.md', 'ignoriert\n');
  await put(wc, 'name with space.md', 'x\n');
  expect(await changedPaths(wc)).toEqual([
    'a.md',
    'b.md',
    'c.md',
    'd.md',
    'name with space.md',
    'new/deep/f.md',
  ]);
});

test('changedPaths of a clean working copy is empty', async () => {
  expect(await changedPaths(await repo())).toEqual([]);
});

test('a path staged and changed back counts as unchanged once index and tree match HEAD', async () => {
  const wc = await repo();
  await put(wc, 'a.md', 'kurz\n');
  await git(['add', 'a.md'], { cwd: wc });
  await put(wc, 'a.md', 'a.md\n');
  // Index weicht von HEAD ab, der Arbeitsbaum nicht: der Pfad gehört trotzdem dazu.
  expect(await changedPaths(wc)).toEqual(['a.md']);
});

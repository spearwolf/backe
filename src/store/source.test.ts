import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { fsSource, overlaySource, type TreeSource } from './source.ts';

async function tree(files: Record<string, string>): Promise<string> {
  const root = await tempDir();
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

async function text(src: TreeSource, path: string): Promise<string | undefined> {
  return (await src.read(path))?.toString('utf8');
}

test('fsSource lists sorted entries, reads bytes and treats missing paths as empty', async () => {
  const root = await tree({ 'b.md': 'B', 'a/x.md': 'X', 'a/b/y.md': 'Y' });
  await symlink('b.md', join(root, 'link.md'));
  const src = fsSource(root);
  expect(await src.list('')).toEqual([
    { name: 'a', dir: true },
    { name: 'b.md', dir: false },
  ]);
  expect(await src.list('a')).toEqual([
    { name: 'b', dir: true },
    { name: 'x.md', dir: false },
  ]);
  expect(await src.list('nope')).toEqual([]);
  expect(await src.list('b.md')).toEqual([]);
  expect(await text(src, 'a/x.md')).toBe('X');
  expect(await src.read('nope.md')).toBeUndefined();
  expect(await src.read('a')).toBeUndefined();
  expect(await src.read('b.md/x')).toBeUndefined();
});

test('fsSource rethrows other read errors', async () => {
  const root = await tree({ 'a.md': 'A' });
  await expect(fsSource(join(root, 'a.md', '\0')).read('x')).rejects.toThrow();
  await expect(fsSource(join(root, 'a.md', '\0')).list('x')).rejects.toThrow();
});

test('overlaySource applies writes, deletions and recursive deletions in order', async () => {
  const root = await tree({
    'issues/aa/one/issue.md': '1',
    'issues/aa/one/comments/c.md': 'c',
    'issues/aa/two/issue.md': '2',
    'users/spw.md': 'spw',
    'users/old.md': 'old',
  });
  const src = overlaySource(fsSource(root), [
    { path: 'users/spw.md', content: 'new' },
    { path: 'users/old.md', content: null },
    { path: 'users/fresh.md', content: new Uint8Array([0xff, 0x00]) },
    { path: 'issues/aa/one', content: null, recursive: true },
    { path: 'issues/aa/one/issue.md', content: 'again' },
    { path: 'issues/bb/three/issue.md', content: '3' },
    { path: 'issues/bb/three/issue.md', content: '3b' },
  ]);
  expect(await text(src, 'users/spw.md')).toBe('new');
  expect(await src.read('users/old.md')).toBeUndefined();
  expect([...((await src.read('users/fresh.md')) ?? [])]).toEqual([0xff, 0x00]);
  expect((await src.list('users')).map((e) => e.name)).toEqual(['fresh.md', 'spw.md']);
  // Die rekursive Löschung blendet den Kommentar aus, die spätere Schreibung gewinnt.
  expect(await src.read('issues/aa/one/comments/c.md')).toBeUndefined();
  expect(await text(src, 'issues/aa/one/issue.md')).toBe('again');
  expect(await src.list('issues/aa/one')).toEqual([{ name: 'issue.md', dir: false }]);
  expect((await src.list('issues')).map((e) => e.name)).toEqual(['aa', 'bb']);
  expect(await src.list('issues/bb')).toEqual([{ name: 'three', dir: true }]);
  expect(await text(src, 'issues/bb/three/issue.md')).toBe('3b');
  expect(await text(src, 'issues/aa/two/issue.md')).toBe('2');
});

test('overlaySource hides directories that lose their last entry', async () => {
  const root = await tree({ 'issues/aa/one/issue.md': '1', 'issues/bb/two/issue.md': '2' });
  const src = overlaySource(fsSource(root), [
    { path: 'issues/aa/one', content: null, recursive: true },
    { path: 'issues/bb/two/issue.md', content: null },
  ]);
  expect(await src.list('issues')).toEqual([]);
  expect(await src.list('issues/aa')).toEqual([]);
  expect(await src.list('issues/bb/two')).toEqual([]);
});

test('overlaySource keeps untouched base directories without listing them again', async () => {
  const root = await tree({ 'a/x.md': 'X', 'b/y.md': 'Y' });
  const src = overlaySource(fsSource(root), [{ path: 'c/z.md', content: 'Z' }]);
  expect(await src.list('')).toEqual([
    { name: 'a', dir: true },
    { name: 'b', dir: true },
    { name: 'c', dir: true },
  ]);
  expect(await text(src, 'a/x.md')).toBe('X');
});

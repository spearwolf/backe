import { catchErrAsync } from '../../test/helpers/catch.ts';
import { rawCommit, testBacklog } from '../../test/helpers/git.ts';
import { git } from './exec.ts';
import { gitTreeSource } from './tree-source.ts';

test('gitTreeSource lists and reads a commit, including paths outside the entity directories', async () => {
  const { root } = await testBacklog();
  const sha = await rawCommit(root, {
    files: { 'notes/deep/a.md': 'A', 'notes/b.md': 'B', link: { symlink: 'notes/b.md' } },
  });
  const src = await gitTreeSource(root, sha);
  expect((await src.list('')).map((e) => e.name)).toEqual(
    expect.arrayContaining(['.backe', 'notes', 'users']),
  );
  expect((await src.list('')).map((e) => e.name)).not.toContain('link');
  expect(await src.list('notes')).toEqual([
    { name: 'b.md', dir: false },
    { name: 'deep', dir: true },
  ]);
  expect(await src.list('missing')).toEqual([]);
  expect((await src.read('notes/deep/a.md'))?.toString()).toBe('A');
  // Zweiter Zugriff kommt aus dem Cache und liefert dasselbe.
  expect((await src.read('notes/deep/a.md'))?.toString()).toBe('A');
  expect(await src.read('notes/none.md')).toBeUndefined();
  expect(await src.read('notes')).toBeUndefined();
  expect(await src.read('link')).toBeUndefined();
});

test('gitTreeSource is pinned to the commit it resolved', async () => {
  const { root } = await testBacklog();
  const src = await gitTreeSource(root, 'HEAD');
  const before = (await src.read('users/spw.md'))?.toString();
  await rawCommit(root, { files: { 'users/spw.md': 'changed' } });
  expect((await src.read('users/spw.md'))?.toString()).toBe(before);
  expect(before).not.toBe('changed');
});

test('gitTreeSource fails for an unknown revision', async () => {
  const { root } = await testBacklog();
  const err = await catchErrAsync(() => gitTreeSource(root, 'nope'));
  expect(err.code).toBe('unexpected');
  await git(['status'], { cwd: root });
});

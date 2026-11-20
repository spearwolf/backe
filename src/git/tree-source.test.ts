import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { copyFixture } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { rawCommit, testBacklog } from '../../test/helpers/git.ts';
import {
  listComments,
  listCommentsFrom,
  loadSnapshot,
  loadSnapshotFrom,
} from '../store/snapshot.ts';
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
});

async function richBacklog(): Promise<string> {
  const root = await copyFixture('backlog-basic');
  const put = async (path: string, content: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  await put('projects/ghost/child.md', '---\nname: Kind ohne Eltern\n---\n');
  await put('users/broken.md', '---\nname: [\n---\n');
  await put('users/Bad Name.md', '---\nname: x\n---\n');
  await put('projects/web/broken.md', '---\nname: [\n---\n');
  await put('sprints/broken.md', '---\nstart: [\n---\n');
  await put('repos/broken.md', '---\nurl: [\n---\n');
  await put('issues/7f/bk-7f3k3/issue.md', '---\nid: [\n---\n');
  await put('issues/zz/bk-7f3k4/issue.md', 'x');
  await put('issues/7f/not-an-id/issue.md', 'x');
  await put('issues/7f/bk-7f3k2/comments/20261118T100500Z-claude-1-zzz.md', 'kaputt');
  await put('issues/7f/bk-7f3k2/attachments/a.bin', 'bin');
  await put('.gitattributes', 'issues/*/*/attachments/** filter=lfs diff=lfs merge=lfs -text\n');
  await rm(join(root, 'issues/7f/bk-7f3k2/comments/20261118T100500Z-claude-1-zzz.md'));
  await git(['init', '-q', '-b', 'main'], { cwd: root });
  await git(['add', '-A'], { cwd: root });
  await git(
    ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '-m', 'rich'],
    {
      cwd: root,
    },
  );
  return root;
}

test('a rich backlog loads identically from a commit and from the working tree', async () => {
  const root = await richBacklog();
  const fromDisk = await loadSnapshot(root);
  expect(fromDisk.problems.length).toBeGreaterThanOrEqual(6);
  expect(fromDisk.issues.size).toBe(3);
  expect(fromDisk.problems.map((p) => p.path)).toContain('projects/ghost/child.md');
  expect(fromDisk.attributes).toContain('filter=lfs');
  const fromGit = await loadSnapshotFrom(await gitTreeSource(root, 'HEAD'), root);
  expect(fromGit).toEqual(fromDisk);
  expect(fromGit.problems).toEqual(fromDisk.problems);
});

test('comments load identically from a commit and from the working tree', async () => {
  const root = await richBacklog();
  const src = await gitTreeSource(root, 'HEAD');
  const direct = await listComments(root, 'bk-7f3k2');
  expect(direct.length).toBeGreaterThan(0);
  expect(await listCommentsFrom(src, 'bk-7f3k2')).toEqual(direct);
  expect(await listCommentsFrom(src, 'bk-a91c0')).toEqual([]);
});

test('loadSnapshotFrom(gitTreeSource(HEAD)) equals loadSnapshot of a clean working copy', async () => {
  const { root } = await testBacklog();
  expect(await loadSnapshotFrom(await gitTreeSource(root, 'HEAD'))).toEqual(
    await loadSnapshot(root),
  );
});

test('a hand edit changes loadSnapshot but not the HEAD source', async () => {
  const { root } = await testBacklog();
  const file = join(root, 'users/spw.md');
  await writeFile(file, `${await readFile(file, 'utf8')}Body\n`);
  const fromHead = await loadSnapshotFrom(await gitTreeSource(root, 'HEAD'));
  const fromDisk = await loadSnapshot(root);
  expect(fromHead.users.get('spw')?.body).not.toBe(fromDisk.users.get('spw')?.body);
  expect(fromDisk.users.get('spw')?.body).toBe('Body\n');
});

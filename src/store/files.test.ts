import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { copyFixture, tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { applyFileChanges } from './files.ts';
import { issueFile } from './layout.ts';

test('applyFileChanges writes, deletes and prunes empty dirs', async () => {
  const root = await copyFixture('backlog-basic');
  await applyFileChanges(root, [
    { path: issueFile('bk-a91c0'), content: null },
    { path: 'repos/new.md', content: '---\nurl: gh:a/b\n---\n' },
  ]);
  expect(existsSync(join(root, 'issues/a9'))).toBe(false);
  expect(existsSync(join(root, 'issues'))).toBe(true);
  expect(await readFile(join(root, 'repos/new.md'), 'utf8')).toContain('gh:a/b');
});

test('creates missing parent dirs, writes binary content and leaves no temp files', async () => {
  const root = await tempDir();
  await applyFileChanges(root, [
    { path: 'issues/7f/bk-7f3k2/attachments/trace.bin', content: new Uint8Array([0, 255, 10]) },
  ]);
  const buf = await readFile(join(root, 'issues/7f/bk-7f3k2/attachments/trace.bin'));
  expect([...buf]).toEqual([0, 255, 10]);
  expect(await readdir(join(root, 'issues/7f/bk-7f3k2/attachments'))).toEqual(['trace.bin']);
});

test('overwrites existing files', async () => {
  const root = await tempDir();
  await applyFileChanges(root, [{ path: 'repos/a.md', content: 'eins' }]);
  await applyFileChanges(root, [{ path: 'repos/a.md', content: 'zwei' }]);
  expect(await readFile(join(root, 'repos/a.md'), 'utf8')).toBe('zwei');
});

test('deleting a missing file is a no-op', async () => {
  const root = await tempDir();
  await applyFileChanges(root, [{ path: 'repos/none.md', content: null }]);
  expect(existsSync(join(root, 'repos'))).toBe(false);
});

test('prunes upwards but never the protected top-level dirs or the root', async () => {
  const root = await tempDir();
  await applyFileChanges(root, [
    { path: 'projects/web/auth.md', content: 'x' },
    { path: 'users/spw.md', content: 'x' },
  ]);
  await applyFileChanges(root, [
    { path: 'projects/web/auth.md', content: null },
    { path: 'users/spw.md', content: null },
  ]);
  expect(existsSync(join(root, 'projects/web'))).toBe(false);
  expect(existsSync(join(root, 'projects'))).toBe(true);
  expect(existsSync(join(root, 'users'))).toBe(true);
  expect(existsSync(root)).toBe(true);
});

test('stops pruning at the first non-empty directory', async () => {
  const root = await copyFixture('backlog-basic');
  await applyFileChanges(root, [
    { path: 'issues/7f/bk-7f3k2/comments/20261118T100400Z-claude-1-q8x.md', content: null },
  ]);
  expect(existsSync(join(root, 'issues/7f/bk-7f3k2/comments'))).toBe(false);
  expect(existsSync(join(root, issueFile('bk-7f3k2')))).toBe(true);
});

test('keeps the order of changes', async () => {
  const root = await tempDir();
  await applyFileChanges(root, [
    { path: 'repos/a.md', content: 'erst' },
    { path: 'repos/a.md', content: null },
    { path: 'repos/a.md', content: 'zuletzt' },
  ]);
  expect(await readFile(join(root, 'repos/a.md'), 'utf8')).toBe('zuletzt');
});

test('rejects absolute and parent-escaping paths before writing anything', async () => {
  const root = await tempDir();
  for (const bad of [
    '',
    '.',
    './x',
    'issues/./7f/bk-7f3k2/issue.md',
    'a//b',
    '//x',
    'x/',
    '/abs',
    '/etc/x',
    'repos/../../x',
    '../x',
    'a/../b',
  ]) {
    const err = await catchErrAsync(() =>
      applyFileChanges(root, [
        { path: 'repos/ok.md', content: 'x' },
        { path: bad, content: 'y' },
      ]),
    );
    expect(err.code).toBe('validation');
  }
  expect(existsSync(join(root, 'repos'))).toBe(false);
});

test('rejects paths with a .git segment before writing anything', async () => {
  const root = await tempDir();
  for (const bad of ['.git/hooks/pre-commit', 'a/.git/x', '.git', 'a/.git']) {
    for (const content of ['y', null]) {
      const err = await catchErrAsync(() =>
        applyFileChanges(root, [
          { path: 'repos/ok.md', content: 'x' },
          { path: bad, content },
        ]),
      );
      expect(err.code).toBe('validation');
      expect(err.message).toContain(bad);
    }
  }
  expect(await readdir(root)).toEqual([]);
});

test('names that merely contain .git are fine', async () => {
  const root = await tempDir();
  await applyFileChanges(root, [
    { path: 'repos/x.git', content: 'a' },
    { path: 'a/.gitignore', content: 'b' },
    { path: 'a/.git-x/y', content: 'c' },
  ]);
  expect(await readFile(join(root, 'a/.git-x/y'), 'utf8')).toBe('c');
});

test('deleting the last file of a shard keeps issues/ in place', async () => {
  const root = await tempDir();
  await applyFileChanges(root, [{ path: issueFile('bk-7f3k2'), content: 'x' }]);
  await applyFileChanges(root, [{ path: issueFile('bk-7f3k2'), content: null }]);
  expect(existsSync(join(root, 'issues/7f'))).toBe(false);
  expect(existsSync(join(root, 'issues'))).toBe(true);
});

test('a failing write rethrows, cleans its temp file and keeps earlier changes', async () => {
  const root = await tempDir();
  await mkdir(join(root, 'repos/blocked.md'), { recursive: true });
  await writeFile(join(root, 'repos/blocked.md/keep'), 'x');
  await expect(
    applyFileChanges(root, [
      { path: 'repos/first.md', content: 'ok' },
      { path: 'repos/blocked.md', content: 'nope' },
    ]),
  ).rejects.toThrow();
  expect(await readFile(join(root, 'repos/first.md'), 'utf8')).toBe('ok');
  expect((await readdir(join(root, 'repos'))).sort()).toEqual(['blocked.md', 'first.md']);
});

test('recursive delete removes a whole issue dir', async () => {
  const root = await copyFixture('backlog-basic');
  await applyFileChanges(root, [{ path: 'issues/7f/bk-7f3k2', content: null, recursive: true }]);
  expect(existsSync(join(root, 'issues/7f'))).toBe(false);
});

test.each(['issues/7f', 'projects/web', 'issues/7f/bk-7f3k2/comments', 'issues/zz/bk-7f3k2'])(
  'recursive delete refuses %s',
  async (path) => {
    const root = await copyFixture('backlog-basic');
    expect(
      (
        await catchErrAsync(() =>
          applyFileChanges(root, [{ path, content: null, recursive: true }]),
        )
      ).code,
    ).toBe('validation');
  },
);

test('recursive without null content is refused', async () => {
  const root = await tempDir();
  expect(
    (
      await catchErrAsync(() =>
        applyFileChanges(root, [{ path: 'issues/7f/bk-7f3k2', content: 'x', recursive: true }]),
      )
    ).code,
  ).toBe('validation');
});

test.each(['.GIT/config', 'a/.Git/x'])('rejects %s case-insensitively', async (path) => {
  const root = await tempDir();
  expect((await catchErrAsync(() => applyFileChanges(root, [{ path, content: 'x' }]))).code).toBe(
    'validation',
  );
});

import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { copyFixture, tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { BackeError } from '../core/errors.ts';
import {
  applyFileChanges,
  atomicTempPath,
  exists,
  fsFailure,
  isAtomicTemp,
  isMissing,
  writeFileAtomic,
} from './files.ts';
import { issueFile } from './layout.ts';

const rmFails = vi.hoisted(() => ({ on: false }));
/** Jedes `rename` als `[von, nach]`, damit Tests die Temp-Datei von `writeFileAtomic` sehen. */
const renames = vi.hoisted((): [string, string][] => []);
vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rm: async (...args: Parameters<typeof actual.rm>) => {
      if (rmFails.on) throw new Error('cleanup kaputt');
      return actual.rm(...args);
    },
    rename: async (from: string, to: string) => {
      renames.push([String(from), String(to)]);
      return actual.rename(from, to);
    },
  };
});

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

test('writeFileAtomic replaces the target of a symlink and keeps the link', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'real.jsonc'), '{}\n');
  await symlink('real.jsonc', join(dir, 'config.jsonc'));
  await writeFileAtomic(join(dir, 'config.jsonc'), '{"a":1}\n');
  expect((await lstat(join(dir, 'config.jsonc'))).isSymbolicLink()).toBe(true);
  expect(await readFile(join(dir, 'real.jsonc'), 'utf8')).toBe('{"a":1}\n');
});

test('isAtomicTemp recognizes the temp files of writeFileAtomic', async () => {
  expect(isAtomicTemp(atomicTempPath('/b/issues/t0/x/issue.md'))).toBe(true);
  expect(isAtomicTemp(atomicTempPath('issue.md'))).toBe(true);
  expect(isAtomicTemp('issues/t0/x/issue.md')).toBe(false);
  expect(isAtomicTemp('issues/t0/x/.issue.md.swp')).toBe(false);
  expect(isAtomicTemp('.tmp-1-deadbeef')).toBe(false);
  expect(isAtomicTemp('.issue.md.tmp-1-DEADBEEF')).toBe(false);
  // `writeFileAtomic` schreibt genau über einen solchen Namen neben dem Ziel.
  const target = join(await tempDir(), 'issue.md');
  renames.length = 0;
  await writeFileAtomic(target, 'x');
  expect(renames).toHaveLength(1);
  const [[tmp, to] = ['', '']] = renames;
  expect(to).toBe(target);
  expect(dirname(tmp)).toBe(dirname(target));
  expect(isAtomicTemp(tmp)).toBe(true);
});

test('writeFileAtomic keeps the mode of an existing file', async () => {
  const f = join(await tempDir(), 'k');
  await writeFile(f, 'x', { mode: 0o600 });
  await writeFileAtomic(f, 'y');
  expect((await stat(f)).mode & 0o777).toBe(0o600);
});

test('a failing cleanup does not mask the write error', async () => {
  const dir = await tempDir();
  await mkdir(join(dir, 'target'));
  rmFails.on = true;
  try {
    const err = await writeFileAtomic(join(dir, 'target'), 'x').then(
      () => undefined,
      (e: unknown) => e as Error,
    );
    expect(err).toBeDefined();
    expect(err?.message).not.toContain('cleanup kaputt');
  } finally {
    rmFails.on = false;
  }
});

test.each([
  ['issues', 'issues/7f/bk-7f3k2/issue.md'],
  ['issues/7f/bk-7f3k2/issue.md', 'issues/7f/bk-7f3k2/issue.md'],
])('applyFileChanges refuses symlinked paths (link at %s)', async (link, path) => {
  const root = await tempDir();
  const outside = await tempDir();
  await mkdir(join(root, link, '..'), { recursive: true });
  await symlink(outside, join(root, link));
  const err = await catchErrAsync(() => applyFileChanges(root, [{ path, content: 'x' }]));
  expect(err.code).toBe('validation');
  expect(err.message).toContain('Symlink im Backlog');
  expect(await readdir(outside)).toEqual([]);
});

test('executable sets or clears the execute bits of a written file', async () => {
  const root = await tempDir();
  await applyFileChanges(root, [{ path: 'run.sh', content: 'a\n', executable: true }]);
  expect((await stat(join(root, 'run.sh'))).mode & 0o111).toBe(0o111);
  await applyFileChanges(root, [{ path: 'run.sh', content: 'b\n' }]);
  expect((await stat(join(root, 'run.sh'))).mode & 0o111).toBe(0o111);
  await applyFileChanges(root, [{ path: 'run.sh', content: 'c\n', executable: false }]);
  expect((await stat(join(root, 'run.sh'))).mode & 0o111).toBe(0);
});

test('exists reports false for a missing path and for a path below a file', async () => {
  const root = await tempDir();
  await writeFile(join(root, 'f.txt'), 'x');
  expect(await exists(join(root, 'f.txt'))).toBe(true);
  expect(await exists(join(root, 'missing'))).toBe(false);
  expect(await exists(join(root, 'f.txt/x'))).toBe(false);
});

test.skipIf(process.getuid?.() === 0)(
  'exists throws on EACCES instead of reporting false',
  async () => {
    const root = await tempDir();
    await mkdir(join(root, 'locked'));
    await writeFile(join(root, 'locked/f.txt'), 'x');
    await chmod(join(root, 'locked'), 0o000);
    try {
      const err = await catchErrAsync(() => exists(join(root, 'locked/f.txt')));
      expect([err.code, err.message]).toEqual([
        'unexpected',
        `${join(root, 'locked/f.txt')}: EACCES`,
      ]);
    } finally {
      await chmod(join(root, 'locked'), 0o700);
    }
  },
);

test('isMissing counts only ENOENT and ENOTDIR', () => {
  const err = (code: string) => Object.assign(new Error(code), { code });
  expect(isMissing(err('ENOENT'))).toBe(true);
  expect(isMissing(err('ENOTDIR'))).toBe(true);
  expect(isMissing(err('EACCES'))).toBe(false);
  expect(isMissing(undefined)).toBe(false);
});

test('fsFailure keeps a BackeError and names path and code otherwise', () => {
  const own = new BackeError('conflict', 'x');
  expect(fsFailure('/p', own)).toBe(own);
  expect(fsFailure('/p', Object.assign(new Error('e'), { code: 'EIO' })).message).toBe('/p: EIO');
  expect(fsFailure('/p', 'kaputt').message).toBe('/p: kaputt');
});

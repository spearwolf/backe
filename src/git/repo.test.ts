import { mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { git } from './exec.ts';
import { assertOnBranch, dirtyPaths, headState, rollbackPaths } from './repo.ts';

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];

async function repo(): Promise<string> {
  const dir = await realpath(await tempDir());
  await git(['init', '-q', '-b', 'main'], { cwd: dir });
  return dir;
}

async function commit(wc: string, message = 'c'): Promise<string> {
  await git([...IDENT, 'commit', '-q', '--allow-empty', '-m', message], { cwd: wc });
  return (await git(['rev-parse', 'HEAD'], { cwd: wc })).stdout.trim();
}

describe('headState', () => {
  test('head state of a fresh, a committed and a detached repo', async () => {
    const wc = await repo();
    expect(await headState(wc)).toEqual({ branch: 'main', head: undefined, operation: undefined });

    const sha = await commit(wc);
    expect(await headState(wc)).toEqual({ branch: 'main', head: sha, operation: undefined });

    await git(['checkout', '-q', '--detach'], { cwd: wc });
    expect(await headState(wc)).toEqual({ branch: undefined, head: sha, operation: undefined });
  });

  test.each([
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['MERGE_HEAD', 'merge'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
  ] as const)('%s is a running operation', async (marker, operation) => {
    const wc = await repo();
    await commit(wc);
    const path = join(wc, '.git', marker);
    if (marker.startsWith('rebase')) await mkdir(path);
    else await writeFile(path, 'x\n');
    expect((await headState(wc)).operation).toBe(operation);
    const err = await catchErrAsync(() => assertOnBranch(wc, 'main'));
    expect(err.code).toBe('conflict');
    expect(err.message).toBe(`In ${wc} läuft ein ${operation}`);
    expect(err.hint).toBe(`git -C ${wc} ${operation} --abort`);
    await rm(path, { recursive: true });
  });
});

describe('assertOnBranch', () => {
  test('returns the head on the expected branch', async () => {
    const wc = await repo();
    const sha = await commit(wc);
    expect(await assertOnBranch(wc, 'main')).toBe(sha);
  });

  test('assertOnBranch on a detached HEAD names git switch', async () => {
    const wc = await repo();
    await commit(wc);
    await git(['checkout', '-q', '--detach'], { cwd: wc });
    const err = await catchErrAsync(() => assertOnBranch(wc, 'main'));
    expect(err.code).toBe('conflict');
    expect(err.message).toBe(`${wc} steht auf keinem Branch (detached HEAD)`);
    expect(err.hint).toBe(`git -C ${wc} switch main`);
  });

  test('another branch is named in the message', async () => {
    const wc = await repo();
    await commit(wc);
    await git(['switch', '-q', '-c', 'feature'], { cwd: wc });
    const err = await catchErrAsync(() => assertOnBranch(wc, 'main'));
    expect(err.code).toBe('conflict');
    expect(err.message).toBe(`${wc} steht auf feature, erwartet main`);
    expect(err.hint).toBe(`git -C ${wc} switch main`);
  });

  test('an unborn branch has no commit yet', async () => {
    const wc = await repo();
    const err = await catchErrAsync(() => assertOnBranch(wc, 'main'));
    expect(err.code).toBe('conflict');
    expect(err.message).toBe(`${wc} hat noch keinen Commit`);
  });
});

describe('rollbackPaths', () => {
  test('rollbackPaths restores changed and deleted files and removes new ones', async () => {
    const wc = await repo();
    await writeFile(join(wc, 'a'), 'A1\n');
    await writeFile(join(wc, 'b'), 'B1\n');
    await git(['add', '.'], { cwd: wc });
    await commit(wc);

    await writeFile(join(wc, 'a'), 'A2\n');
    await rm(join(wc, 'b'));
    await mkdir(join(wc, 'issues/7f/bk-7f3k2'), { recursive: true });
    await writeFile(join(wc, 'issues/7f/bk-7f3k2/issue.md'), 'n\n');
    await writeFile(join(wc, 'fresh'), 'f\n');
    await git(['add', 'fresh'], { cwd: wc });

    await rollbackPaths(wc, ['a', 'b', 'issues/7f/bk-7f3k2', 'fresh']);

    expect(await dirtyPaths(wc, ['a', 'b', 'issues', 'fresh'])).toEqual([]);
    expect(await readFile(join(wc, 'b'), 'utf8')).toBe('B1\n');
    expect(await readFile(join(wc, 'a'), 'utf8')).toBe('A1\n');
    expect(await stat(join(wc, 'issues/7f/bk-7f3k2')).catch(() => null)).toBeNull();
    expect(await stat(join(wc, 'fresh')).catch(() => null)).toBeNull();
  });

  test('without HEAD everything is removed', async () => {
    const wc = await repo();
    await writeFile(join(wc, 'a'), 'A\n');
    await git(['add', 'a'], { cwd: wc });
    await rollbackPaths(wc, ['a']);
    expect(await stat(join(wc, 'a')).catch(() => null)).toBeNull();
    expect((await git(['status', '--short'], { cwd: wc })).stdout).toBe('');
  });
});

describe('dirtyPaths', () => {
  test('dirtyPaths sees modified, untracked, staged and deleted paths among the given ones', async () => {
    const wc = await repo();
    await mkdir(join(wc, 'a'));
    await mkdir(join(wc, 'other'));
    for (const f of ['a/mod', 'a/del', 'a/clean', 'other/x']) await writeFile(join(wc, f), '1\n');
    await git(['add', '.'], { cwd: wc });
    await commit(wc);

    await writeFile(join(wc, 'a/mod'), '2\n');
    await rm(join(wc, 'a/del'));
    await writeFile(join(wc, 'a/new'), 'n\n');
    await writeFile(join(wc, 'a/staged'), 's\n');
    await git(['add', 'a/staged'], { cwd: wc });
    await writeFile(join(wc, 'other/x'), '2\n');

    expect(await dirtyPaths(wc, ['a'])).toEqual(['a/del', 'a/mod', 'a/new', 'a/staged']);
    expect(await dirtyPaths(wc, ['a/clean'])).toEqual([]);
  });

  test('an empty path list yields nothing without asking git', async () => {
    const wc = await repo();
    await writeFile(join(wc, 'f'), 'x\n');
    expect(await dirtyPaths(wc, [])).toEqual([]);
  });

  test('a path with glob characters is taken literally', async () => {
    const wc = await repo();
    await writeFile(join(wc, 'a*'), 'x\n');
    await writeFile(join(wc, 'ab'), 'x\n');
    expect(await dirtyPaths(wc, ['a*'])).toEqual(['a*']);
  });

  test('paths with spaces and non-ASCII characters are returned verbatim', async () => {
    const wc = await repo();
    await writeFile(join(wc, 'ä b'), 'x\n');
    expect(await dirtyPaths(wc, ['ä b'])).toEqual(['ä b']);
  });
});

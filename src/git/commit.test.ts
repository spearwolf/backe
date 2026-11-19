import { mkdir, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { revParse, sigOf, statusShort, testKey } from '../../test/helpers/git.ts';
import { type CommitInput, commitPaths } from './commit.ts';
import { git } from './exec.ts';
import { stateDir } from './local-state.ts';

const AUTHOR = { name: 'Alice Author', email: 'alice@example.test' };
const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];

async function put(wc: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(wc, path)), { recursive: true });
  await writeFile(join(wc, path), content);
}

async function show(wc: string, spec: string): Promise<string> {
  return (await git(['show', spec], { cwd: wc })).stdout;
}

async function lsTree(wc: string, rev: string): Promise<string[]> {
  const { stdout } = await git(['ls-tree', '-r', '--name-only', rev], { cwd: wc });
  return stdout.split('\n').filter((l) => l !== '');
}

async function setup(): Promise<{ wc: string; head: string; older: string; input: CommitInput }> {
  const wc = await realpath(await tempDir());
  await git(['init', '-q', '-b', 'main'], { cwd: wc });
  await put(wc, 'a', 'A1');
  await put(wc, 'b', 'B1');
  await git(['add', '.'], { cwd: wc });
  await git([...IDENT, 'commit', '-q', '-m', 'one'], { cwd: wc });
  const older = await revParse(wc, 'HEAD');
  await put(wc, 'x', 'X');
  await git(['add', 'x'], { cwd: wc });
  await git([...IDENT, 'commit', '-q', '-m', 'two'], { cwd: wc });
  const head = await revParse(wc, 'HEAD');
  await put(wc, 'a', 'A2');
  await put(wc, 'b', 'B2');
  await put(wc, 'c', 'C');
  await git(['add', 'c'], { cwd: wc });
  const k = await testKey('spw');
  return {
    wc,
    head,
    older,
    input: { paths: ['a'], message: 'm\n', key: k.priv, author: AUTHOR, env: {}, parent: head },
  };
}

describe('commitPaths', () => {
  test('commit takes exactly the given paths and signs them', async () => {
    const { wc, input } = await setup();
    const k = await testKey('spw');
    const sha = await commitPaths(wc, input);
    expect(await show(wc, `${sha}:a`)).toBe('A2');
    expect(await lsTree(wc, sha)).not.toContain('c');
    expect(await show(wc, `${sha}:b`)).toBe('B1');
    expect(await statusShort(wc)).toEqual([' M b', 'A  c']);
    expect(await sigOf(wc, sha, { spw: k })).toEqual(['G', 'spw']);
    expect(await revParse(wc, 'HEAD')).toBe(sha);
    expect(await revParse(wc, `${sha}^`)).toBe(input.parent);
  });

  test('a root commit without parent', async () => {
    const wc = await realpath(await tempDir());
    await git(['init', '-q', '-b', 'main'], { cwd: wc });
    await put(wc, 'a', 'A');
    const k = await testKey('spw');
    const sha = await commitPaths(wc, {
      paths: ['a'],
      message: 'root\n',
      key: k.priv,
      author: AUTHOR,
      env: {},
      parent: undefined,
    });
    expect(await revParse(wc, 'HEAD')).toBe(sha);
    expect((await git(['rev-list', '--parents', '-n1', sha], { cwd: wc })).stdout.trim()).toBe(sha);
    expect(await statusShort(wc)).toEqual([]);
  });

  test('deleting a path and a whole issue directory', async () => {
    const wc = await realpath(await tempDir());
    await git(['init', '-q', '-b', 'main'], { cwd: wc });
    await put(wc, 'a', 'A');
    await put(wc, 'issues/7f/bk-7f3k2/issue.md', 'I');
    await put(wc, 'issues/7f/bk-7f3k2/notes.md', 'N');
    await git(['add', '.'], { cwd: wc });
    await git([...IDENT, 'commit', '-q', '-m', 'one'], { cwd: wc });
    const head = await revParse(wc, 'HEAD');
    await rm(join(wc, 'a'));
    await rm(join(wc, 'issues'), { recursive: true });
    const k = await testKey('spw');
    const sha = await commitPaths(wc, {
      paths: ['a', 'issues/7f/bk-7f3k2'],
      message: 'del\n',
      key: k.priv,
      author: AUTHOR,
      env: {},
      parent: head,
    });
    expect(await lsTree(wc, sha)).toEqual([]);
    expect(await statusShort(wc)).toEqual([]);
  });

  test('author and committer come from the input, not from git config', async () => {
    const { wc, input } = await setup();
    await git(['config', 'user.name', 'Config Name'], { cwd: wc });
    await git(['config', 'user.email', 'config@example.test'], { cwd: wc });
    const sha = await commitPaths(wc, input);
    const { stdout } = await git(['log', '-1', '--format=%an|%ae|%cn|%ce', sha], { cwd: wc });
    expect(stdout.trim()).toBe('Alice Author|alice@example.test|Alice Author|alice@example.test');
  });

  test('an unchanged tree is an unexpected error', async () => {
    const { wc, input } = await setup();
    const err = await catchErrAsync(() => commitPaths(wc, { ...input, paths: ['x'] }));
    expect(err.code).toBe('unexpected');
    expect(err.message).toBe('Write ohne Änderung am Baum');
  });

  test('a stale parent is a conflict and leaves HEAD alone', async () => {
    const { wc, head, older, input } = await setup();
    const err = await catchErrAsync(() => commitPaths(wc, { ...input, parent: older }));
    expect(err.code).toBe('conflict');
    expect(err.message).toBe('HEAD hat sich während des Writes bewegt');
    expect(await revParse(wc, 'HEAD')).toBe(head);
  });

  test('a missing key is a usage error naming the key', async () => {
    const { wc, input } = await setup();
    const key = join(wc, 'no-such-key');
    const err = await catchErrAsync(() => commitPaths(wc, { ...input, key }));
    expect(err.code).toBe('usage');
    expect(err.message).toContain(`Signieren mit ${key} fehlgeschlagen:`);
    expect(err.hint).toBe(
      'Key-Pfad in identities prüfen; ein Public Key braucht einen laufenden ssh-agent.',
    );
    expect(await revParse(wc, 'HEAD')).toBe(input.parent);
  });

  test('a failing index refresh after the ref update still returns the landed commit', async () => {
    const { wc, input } = await setup();
    const lock = join(wc, '.git', 'index.lock');
    await writeFile(lock, '');
    try {
      const sha = await commitPaths(wc, input);
      expect(await revParse(wc, 'HEAD')).toBe(sha);
    } finally {
      await rm(lock, { force: true });
    }
  });

  test('ignore rules of the repository do not keep a given path out of the commit', async () => {
    const { wc, input } = await setup();
    await put(wc, '.gitignore', '*.md\n');
    await put(wc, 'issues/x.md', 'X');
    const sha = await commitPaths(wc, { ...input, paths: ['issues/x.md'] });
    expect(await show(wc, `${sha}:issues/x.md`)).toBe('X');
  });

  test('updateRef false creates the commit without moving HEAD', async () => {
    const { wc, head, input } = await setup();
    const sha = await commitPaths(wc, { ...input, updateRef: false });
    expect(await revParse(wc, 'HEAD')).toBe(head);
    expect(await revParse(wc, `${sha}^`)).toBe(head);
    expect(await show(wc, `${sha}:a`)).toBe('A2');
    // Kein Index-Reset: der Index des Aufrufers bleibt, wie er war.
    expect(await statusShort(wc)).toEqual([' M a', ' M b', 'A  c']);
  });

  test('a chain moves HEAD once from the old head', async () => {
    const { wc, head, input } = await setup();
    const first = await commitPaths(wc, { ...input, message: 'eins\n', updateRef: false });
    const second = await commitPaths(wc, {
      ...input,
      paths: ['b'],
      message: 'zwei\n',
      parent: first,
      updateRef: { from: head },
    });
    expect(await revParse(wc, 'HEAD')).toBe(second);
    expect(await revParse(wc, 'HEAD^')).toBe(first);
    expect(await revParse(wc, 'HEAD^^')).toBe(head);
    expect(await show(wc, `${second}:a`)).toBe('A2');
    expect(await show(wc, `${second}:b`)).toBe('B2');
    expect(await lsTree(wc, first)).not.toContain('c');
    const { stdout } = await git(['reflog', '-2', '--format=%gs', 'HEAD'], { cwd: wc });
    expect(stdout.split('\n').filter((l) => l !== '')).toEqual(['zwei', 'commit: two']);
  });

  test('a chain whose old head moved is a conflict and leaves HEAD alone', async () => {
    const { wc, head, older, input } = await setup();
    const first = await commitPaths(wc, { ...input, parent: older, updateRef: false });
    const err = await catchErrAsync(() =>
      commitPaths(wc, { ...input, paths: ['b'], parent: first, updateRef: { from: older } }),
    );
    expect(err.code).toBe('conflict');
    expect(await revParse(wc, 'HEAD')).toBe(head);
  });

  test('no temp index is left behind', async () => {
    const { wc, input } = await setup();
    await commitPaths(wc, input);
    await catchErrAsync(() => commitPaths(wc, { ...input, key: join(wc, 'nope') }));
    const files = await readdir(await stateDir(wc));
    expect(files.filter((f) => f.startsWith('index-'))).toEqual([]);
  });
});

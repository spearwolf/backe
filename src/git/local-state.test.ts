import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { git } from './exec.ts';
import { clearLocalState, readLocalState, stateDir, writeLocalState } from './local-state.ts';

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@example.test'];

async function repo(): Promise<string> {
  const dir = await realpath(await tempDir());
  await git(['init', '-q'], { cwd: dir });
  return dir;
}

describe('local state', () => {
  test('state files live under the git dir, also behind a .git file', async () => {
    const wc = await repo();
    expect(await stateDir(wc)).toBe(join(wc, '.git', 'backe'));

    await git([...IDENT, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: wc });
    const linked = join(await realpath(await tempDir()), 'linked');
    await git(['worktree', 'add', '-q', '-b', 'other', linked], { cwd: wc });
    expect((await readFile(join(linked, '.git'), 'utf8')).startsWith('gitdir: ')).toBe(true);

    const dir = await stateDir(linked);
    expect(dir.startsWith(`${join(wc, '.git', 'worktrees')}/`)).toBe(true);
    expect(dir.endsWith('/backe')).toBe(true);
    await writeLocalState(linked, 'anchor', 'abc');
    expect(await readFile(join(dir, 'anchor'), 'utf8')).toBe('abc\n');
  });

  test('reading a missing state file yields undefined', async () => {
    expect(await readLocalState(await repo(), 'verified')).toBeUndefined();
  });

  test('reading and clearing leave a missing state dir missing, create: true makes it', async () => {
    const wc = await repo();
    const dir = join(wc, '.git', 'backe');
    expect(await stateDir(wc, { create: false })).toBe(dir);
    expect(await readLocalState(wc, 'verified')).toBeUndefined();
    await clearLocalState(wc, 'verified');
    expect(await stat(dir).catch(() => null)).toBeNull();
    expect(await stateDir(wc, { create: true })).toBe(dir);
    expect((await stat(dir)).isDirectory()).toBe(true);
  });

  test('a written value is read back and overwritten atomically', async () => {
    const wc = await repo();
    await writeLocalState(wc, 'identity', 'spw');
    expect(await readLocalState(wc, 'identity')).toBe('spw');
    await writeLocalState(wc, 'identity', 'other');
    expect(await readLocalState(wc, 'identity')).toBe('other');
  });
});

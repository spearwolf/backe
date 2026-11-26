import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import { git } from '../git/exec.ts';
import { fsWatch, gitDirs, type WatchFn, watchWorkingCopy } from './watch.ts';

type Recorded = {
  path: string;
  recursive: boolean;
  fire(name: string | null): void;
  closed: boolean;
};

function recorder(): { watch: WatchFn; all: Recorded[]; at(path: string): Recorded } {
  const all: Recorded[] = [];
  const watch: WatchFn = (path, opts, listener) => {
    const r: Recorded = { path, recursive: opts.recursive, fire: listener, closed: false };
    all.push(r);
    return {
      close() {
        r.closed = true;
      },
    };
  };
  const at = (path: string) => {
    const r = all.find((x) => x.path === path);
    if (r === undefined) throw new Error(`not watched: ${path}`);
    return r;
  };
  return { watch, all, at };
}

function signals() {
  const log: string[] = [];
  return {
    log,
    on: {
      ref: () => log.push('ref'),
      paths: (p: string[] | 'all') => log.push(`paths:${p === 'all' ? 'all' : p.join(',')}`),
      sync: () => log.push('sync'),
    },
  };
}

test('watches refs, head and packed refs of the common dir', async () => {
  const b = await testBacklog();
  const { gitDir } = await gitDirs(b.root);
  const rec = recorder();
  const s = signals();
  await watchWorkingCopy(b.root, { watch: rec.watch }, s.on);
  expect(rec.at(join(gitDir, 'refs', 'heads')).recursive).toBe(true);
  expect(rec.at(gitDir).recursive).toBe(false);
  expect(rec.at(b.root).recursive).toBe(true);
  expect(rec.all).toHaveLength(3);
  rec.at(join(gitDir, 'refs', 'heads')).fire('main');
  rec.at(gitDir).fire('HEAD.lock');
  rec.at(gitDir).fire('packed-refs');
  rec.at(gitDir).fire('index.lock');
  rec.at(gitDir).fire(null);
  expect(s.log).toEqual(['ref', 'ref', 'ref', 'ref']);
});

test('a linked worktree watches head and refs in different dirs', async () => {
  const b = await testBacklog();
  const wt = join(await tempDir(), 'wt');
  await git(['worktree', 'add', '-q', '-b', 'side', wt], { cwd: b.root });
  const { gitDir, commonDir } = await gitDirs(wt);
  expect(gitDir).not.toBe(commonDir);
  const rec = recorder();
  const s = signals();
  await watchWorkingCopy(wt, { watch: rec.watch }, s.on);
  rec.at(gitDir).fire('packed-refs');
  rec.at(commonDir).fire('HEAD');
  expect(s.log).toEqual([]);
  rec.at(gitDir).fire('HEAD');
  rec.at(commonDir).fire('packed-refs.lock');
  expect(s.log).toEqual(['ref', 'ref']);
});

test('worktree events are filtered and relative', async () => {
  const b = await testBacklog();
  const rec = recorder();
  const s = signals();
  await watchWorkingCopy(b.root, { watch: rec.watch }, s.on);
  const tree = rec.at(b.root);
  tree.fire('issues/t0/bk-t0001/issue.md');
  tree.fire('.git/index');
  tree.fire('.git');
  tree.fire('README.md');
  tree.fire('projects\\web.md');
  tree.fire(null);
  expect(s.log).toEqual([
    'paths:issues/t0/bk-t0001/issue.md',
    'paths:projects/web.md',
    'paths:all',
  ]);
});

test('sync dir events signal sync, close closes every handle', async () => {
  const b = await testBacklog();
  const rec = recorder();
  const s = signals();
  const syncDir = join(await tempDir(), 'backe');
  const watched = await watchWorkingCopy(b.root, { watch: rec.watch, syncDir }, s.on);
  rec.at(syncDir).fire('sync.json');
  rec.at(syncDir).fire(null);
  expect(s.log).toEqual(['sync', 'sync']);
  watched.close();
  expect(rec.all.every((r) => r.closed)).toBe(true);
});

test('a failing watch closes the handles opened before', async () => {
  const b = await testBacklog();
  const rec = recorder();
  let n = 0;
  const failing: WatchFn = (path, opts, listener) => {
    if (++n === 2) throw new Error('boom');
    return rec.watch(path, opts, listener);
  };
  await expect(watchWorkingCopy(b.root, { watch: failing }, signals().on)).rejects.toThrow('boom');
  expect(rec.all.map((r) => r.closed)).toEqual([true]);
});

test('fsWatch on a missing dir is a silent handle', async () => {
  const h = fsWatch(join(await tempDir(), 'nope'), { recursive: true }, () => {});
  expect(() => h.close()).not.toThrow();
});

test('fsWatch rethrows other errors', () => {
  expect(() => fsWatch('\0', { recursive: false }, () => {})).toThrow();
});

test('a real write in refs/heads reaches the ref signal', async () => {
  const b = await testBacklog();
  const s = signals();
  const watched = await watchWorkingCopy(b.root, {}, s.on);
  try {
    await git(['update-ref', 'refs/heads/other', 'HEAD'], { cwd: b.root });
    await mkdir(join(b.root, 'projects'), { recursive: true });
    await writeFile(join(b.root, 'projects', 'web.md'), '---\ntitle: Web\n---\n');
    await vi.waitFor(() => {
      expect(s.log).toContain('ref');
      expect(s.log).toContain('paths:projects/web.md');
    });
  } finally {
    watched.close();
  }
});

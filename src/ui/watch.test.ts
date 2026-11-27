import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import { git } from '../git/exec.ts';
import { BACKLOG_DIRS } from './delta.ts';
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
    const r = all.findLast((x) => x.path === path);
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
  expect(rec.at(b.root).recursive).toBe(false);
  for (const dir of BACKLOG_DIRS) expect(rec.at(join(b.root, dir)).recursive).toBe(true);
  expect(rec.all).toHaveLength(3 + BACKLOG_DIRS.length);
  expect(rec.all.filter((r) => r.recursive).map((r) => r.path)).toEqual([
    join(gitDir, 'refs', 'heads'),
    ...BACKLOG_DIRS.map((d) => join(b.root, d)),
  ]);
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
  rec.at(join(b.root, 'issues')).fire('t0/bk-t0001/issue.md');
  rec.at(join(b.root, 'issues')).fire('t0/bk-t0001/.issue.md.swp');
  rec.at(join(b.root, 'projects')).fire('web\\api.md');
  rec.at(join(b.root, '.backe')).fire('backlog.jsonc');
  rec.at(join(b.root, 'users')).fire(null);
  expect(s.log).toEqual([
    'paths:issues/t0/bk-t0001/issue.md',
    'paths:projects/web/api.md',
    'paths:.backe/backlog.jsonc',
    'paths:all',
  ]);
});

test('a backlog dir that appears or vanishes is reopened and reported', async () => {
  const b = await testBacklog();
  const rec = recorder();
  const s = signals();
  await watchWorkingCopy(b.root, { watch: rec.watch }, s.on);
  const first = rec.at(join(b.root, 'sprints'));
  rec.at(b.root).fire('README.md');
  rec.at(b.root).fire('.git');
  expect(s.log).toEqual([]);
  rec.at(b.root).fire('sprints');
  expect(first.closed).toBe(true);
  const second = rec.at(join(b.root, 'sprints'));
  expect(second).not.toBe(first);
  second.fire('2026-w48.md');
  expect(s.log).toEqual(['paths:sprints', 'paths:sprints/2026-w48.md']);
  rec.at(b.root).fire(null);
  expect(second.closed).toBe(true);
  expect(s.log.at(-1)).toBe('paths:all');
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

test('an event on a watched dir itself counts like one without a name', async () => {
  // libuv meldet ein Ereignis auf dem beobachteten Verzeichnis unter dessen eigenem Namen: FSEvents,
  // wenn es Änderungen zum Verzeichnis zusammenfasst, inotify etwa bei geänderten Rechten. Welche
  // Datei sich geändert hat, sagt das nicht; es zählt wie ein Ereignis ohne Namen.
  const b = await testBacklog();
  const { gitDir } = await gitDirs(b.root);
  const rec = recorder();
  const s = signals();
  const syncDir = join(await tempDir(), 'backe');
  await watchWorkingCopy(b.root, { watch: rec.watch, syncDir }, s.on);
  const self = (path: string) => rec.at(path).fire(basename(path));
  self(gitDir);
  expect(s.log).toEqual(['ref']);
  self(join(b.root, '.backe'));
  rec.at(join(b.root, 'issues')).fire('');
  expect(s.log).toEqual(['ref', 'paths:all', 'paths:all']);
  const sprints = rec.at(join(b.root, 'sprints'));
  self(b.root);
  expect(sprints.closed).toBe(true);
  expect(s.log).toEqual(['ref', 'paths:all', 'paths:all', 'paths:all']);
  self(syncDir);
  self(join(gitDir, 'refs', 'heads'));
  expect(s.log.slice(-2)).toEqual(['sync', 'ref']);
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

/**
 * Signale mit echtem `fs.watch`; `until` erfüllt sich mit dem ersten Signal, das `match` erfüllt —
 * gewartet wird auf das Ereignis selbst, nicht auf Zeit.
 */
function liveSignals() {
  const log: string[] = [];
  const waiting: { match: (signal: string) => boolean; resolve(): void }[] = [];
  const push = (signal: string) => {
    log.push(signal);
    for (const w of waiting.filter((x) => x.match(signal))) {
      waiting.splice(waiting.indexOf(w), 1);
      w.resolve();
    }
  };
  return {
    log,
    on: {
      ref: () => push('ref'),
      paths: (p: string[] | 'all') => {
        for (const path of p === 'all' ? ['*'] : p) push(`paths:${path}`);
      },
      sync: () => push('sync'),
    },
    until: (match: (signal: string) => boolean) =>
      log.some(match)
        ? Promise.resolve()
        : new Promise<void>((resolve) => waiting.push({ match, resolve })),
  };
}

/** Ein Pfad-Signal, das `path` abdeckt: der Pfad selbst, ein Verzeichnis darüber oder alles. */
const covers = (path: string) => (signal: string) =>
  signal === 'paths:*' ||
  (signal.startsWith('paths:') && `${path}/`.startsWith(`${signal.slice('paths:'.length)}/`));

test('real writes reach the signals', async () => {
  // Vertragstest des Adapters mit echtem `fs.watch`. Verlangt wird nur, was jedes System liefert:
  // Ein Ref-Update ergibt irgendwann `ref`, ein Write in einem Backlog-Verzeichnis irgendwann ein
  // Pfad-Signal, das die Datei abdeckt. Welcher Name kommt (inotify: die Datei; FSEvents oft nur
  // das Verzeichnis, sonst `null`), wie viele Ereignisse und in welcher Reihenfolge, bleibt offen.
  // Unter macOS startet libuv einen Watch asynchron in einem eigenen FSEvents-Stream für alle
  // Watches; das erste Ereignis zeigt, dass er läuft, darum kommt der Write erst danach.
  const b = await testBacklog();
  const s = liveSignals();
  const watched = await watchWorkingCopy(b.root, {}, s.on);
  try {
    await git(['update-ref', 'refs/heads/other', 'HEAD'], { cwd: b.root });
    await s.until((signal) => signal === 'ref');
    await writeFile(join(b.root, 'users', 'alice.md'), '---\nname: Alice\n---\n');
    await s.until(covers('users/alice.md'));
  } finally {
    watched.close();
  }
});

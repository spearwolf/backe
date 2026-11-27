import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { writeOp } from '../../test/helpers/context.ts';
import {
  revParse,
  type TestBacklog,
  testBacklog,
  testKey,
  twoClones,
} from '../../test/helpers/git.ts';
import { fakeTimers } from '../../test/helpers/live.ts';
import { setIdentity } from '../context/registry.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { git } from '../git/exec.ts';
import { syncNow } from '../services/sync.ts';
import { ensureWorkingCopy } from '../services/working-copy.ts';
import { executeWrite } from '../services/write.ts';
import { LIVE_TIMING } from './live.ts';
import { NeighborWatch } from './neighbors.ts';
import { fsWatch, gitDirs, type WatchFn } from './watch.ts';

vi.mock('../git/exec.ts', async (original) => {
  const real = await original<typeof import('../git/exec.ts')>();
  return { ...real, git: vi.fn(real.git) };
});

type Recorded = {
  path: string;
  recursive: boolean;
  fire(name: string | null): void;
  closed: boolean;
};

function recorder(): {
  watch: WatchFn;
  all: Recorded[];
  at(path: string): Recorded;
  has(path: string): boolean;
} {
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
  const has = (path: string) => all.some((x) => x.path === path && !x.closed);
  const at = (path: string) => {
    const r = all.findLast((x) => x.path === path);
    if (r === undefined) throw new Error(`not watched: ${path}`);
    return r;
  };
  return { watch, all, at, has };
}

type Setup = {
  b: TestBacklog;
  ctx: ResolvedContext;
  /** `claude-1`, aufgelöst in der Arbeitskopie von spw: Quelle für `ensureWorkingCopy`. */
  cloneCtx: ResolvedContext;
  backlogDir: string;
};

/** Backlog ohne Remote mit einem Agenten `claude-1`, der Push-Rechte hat; noch ohne Hub. */
async function withAgent(): Promise<Setup> {
  const b = await testBacklog();
  const ctx = await b.context();
  const claude = await testKey('claude-1');
  await executeWrite(ctx, {
    kind: 'op',
    op: {
      op: 'user.add',
      handle: 'claude-1',
      name: 'Claude',
      kind: 'agent',
      operator: 'spw',
      keys: [claude.line],
    },
  });
  await setIdentity(b.homes, 'acme', 'claude-1', claude.priv);
  const cloneCtx = await b.context({ as: 'claude-1' });
  return { b, ctx, cloneCtx, backlogDir: join(b.homes.backeHome, 'backlogs', 'acme') };
}

/** Legt die Arbeitskopie von `claude-1` an (beim ersten Mal auch den Hub) und löst darin auf. */
async function agentCopy(s: Setup): Promise<{ wc: string; agentCtx: ResolvedContext }> {
  const { root: wc } = await ensureWorkingCopy(s.cloneCtx, 'claude-1');
  return { wc, agentCtx: await s.b.context({ as: 'claude-1' }, wc) };
}

/** Wie `withAgent`, dazu die Arbeitskopie des Agenten; sie legt den Hub an. */
async function withHub(): Promise<Setup & { hub: string; wc: string; agentCtx: ResolvedContext }> {
  const s = await withAgent();
  return { ...s, ...(await agentCopy(s)), hub: join(s.backlogDir, 'hub.git') };
}

async function agentPush(agentCtx: ResolvedContext): Promise<void> {
  await writeOp(agentCtx, { op: 'issue.create', title: 'Vom Agenten' });
  await syncNow(agentCtx, { spawn: () => {} });
}

async function refsOf(dir: string): Promise<string> {
  return join((await gitDirs(dir)).commonDir, 'refs');
}

function verifyCalls(): number {
  return vi
    .mocked(git)
    .mock.calls.filter(([args]) => args[0] === 'rev-parse' && args.includes('--verify')).length;
}

const debounceMs = LIVE_TIMING.neighborMs;
const open: NeighborWatch[] = [];

async function start(
  s: Setup,
  onMove: () => void,
  watch: WatchFn = recorder().watch,
  at: { backlogDir?: string; own?: string } = {},
): Promise<NeighborWatch> {
  const w = await NeighborWatch.start({
    backlogDir: at.backlogDir ?? s.backlogDir,
    own: at.own ?? s.b.root,
    remote: 'origin',
    branch: 'main',
    debounceMs,
    watch,
    onMove,
  });
  open.push(w);
  return w;
}

afterEach(() => {
  for (const w of open.splice(0)) w.close();
  vi.useRealTimers();
});

test('a hub move starts one check after 250 ms', async () => {
  const s = await withHub();
  const rec = recorder();
  const onMove = vi.fn();
  const w = await start(s, onMove, rec.watch);
  await agentPush(s.agentCtx);
  const check = vi.spyOn(w, 'check');
  fakeTimers();

  rec.at(await refsOf(s.hub)).fire('heads/main');
  await vi.advanceTimersByTimeAsync(debounceMs - 1);
  expect(check).not.toHaveBeenCalled();
  expect(onMove).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(check).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));

  await w.check();
  expect(onMove).toHaveBeenCalledTimes(1);
});

test('events during the debounce collapse into one move', async () => {
  const s = await withHub();
  const rec = recorder();
  const onMove = vi.fn();
  const w = await start(s, onMove, rec.watch);
  await agentPush(s.agentCtx);
  const check = vi.spyOn(w, 'check');
  fakeTimers();

  const hub = rec.at(await refsOf(s.hub));
  hub.fire('heads/main.lock');
  await vi.advanceTimersByTimeAsync(100);
  rec.at((await gitDirs(s.hub)).commonDir).fire('packed-refs');
  await vi.advanceTimersByTimeAsync(100);
  hub.fire('heads/main');
  await vi.advanceTimersByTimeAsync(debounceMs);

  expect(check).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
});

test('a tracking ref of a neighbour counts as a move', async () => {
  const { spw, agent } = await twoClones();
  const s: Setup = {
    b: spw,
    ctx: spw.ctx,
    cloneCtx: agent.ctx,
    backlogDir: join(spw.homes.backeHome, 'backlogs', 'acme'),
  };
  const rec = recorder();
  const onMove = vi.fn();
  await start(s, onMove, rec.watch);
  await agentPush(agent.ctx);
  fakeTimers();

  rec.at(await refsOf(agent.wc)).fire('remotes/origin/main');
  await vi.advanceTimersByTimeAsync(debounceMs);

  await vi.waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
});

test('events outside the watched refs start no check', async () => {
  const s = await withHub();
  const rec = recorder();
  const w = await start(s, vi.fn(), rec.watch);
  const check = vi.spyOn(w, 'check');
  fakeTimers();
  const hubRefs = rec.at(await refsOf(s.hub));
  const agentRefs = rec.at(await refsOf(s.wc));
  const agentCommon = rec.at((await gitDirs(s.wc)).commonDir);

  hubRefs.fire('tags/v1');
  hubRefs.fire('remotes/origin/main');
  agentRefs.fire('heads/main');
  agentCommon.fire('index.lock');
  agentCommon.fire('FETCH_HEAD');
  await vi.advanceTimersByTimeAsync(debounceMs);
  expect(check).not.toHaveBeenCalled();

  hubRefs.fire('heads');
  await vi.advanceTimersByTimeAsync(debounceMs);
  agentRefs.fire(null);
  await vi.advanceTimersByTimeAsync(debounceMs);
  agentCommon.fire(null);
  await vi.advanceTimersByTimeAsync(debounceMs);
  agentCommon.fire('packed-refs.lock');
  await vi.advanceTimersByTimeAsync(debounceMs);
  expect(check).toHaveBeenCalledTimes(4);
});

test('a ref the own copy already has is no move', async () => {
  const s = await withHub();
  const onMove = vi.fn();
  const w = await start(s, onMove);
  const before = await revParse(s.hub, 'refs/heads/main');

  await writeOp(s.ctx, { op: 'issue.create', title: 'Von spw' });
  await syncNow(s.ctx, { spawn: () => {} });
  expect(await revParse(s.hub, 'refs/heads/main')).not.toBe(before);
  await w.check();

  expect(onMove).not.toHaveBeenCalled();
});

test('neighbour refs other than the tracking ref are ignored', async () => {
  const s = await withHub();
  const onMove = vi.fn();
  const w = await start(s, onMove);
  const before = await revParse(s.wc, 'HEAD');

  await writeOp(s.agentCtx, { op: 'issue.create', title: 'Nur lokal' });
  expect(await revParse(s.wc, 'HEAD')).not.toBe(before);
  await w.check();

  expect(onMove).not.toHaveBeenCalled();
});

test('a neighbour that appears later is watched', async () => {
  const s = await withAgent();
  const rec = recorder();
  const onMove = vi.fn();
  await start(s, onMove, rec.watch);
  expect(rec.all.map((r) => [r.path, r.recursive])).toEqual([[s.backlogDir, false]]);

  // Eine frische Arbeitskopie pusht in derselben Ruhephase, in der sie entsteht.
  const { wc, agentCtx } = await agentCopy(s);
  await agentPush(agentCtx);
  const hub = join(s.backlogDir, 'hub.git');
  fakeTimers();
  rec.at(s.backlogDir).fire('claude-1');
  await vi.advanceTimersByTimeAsync(debounceMs);

  await vi.waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
  const hubRefs = await refsOf(hub);
  expect(rec.has(hubRefs)).toBe(true);
  expect(rec.has(await refsOf(wc))).toBe(true);
  expect(rec.at(hubRefs).recursive).toBe(true);
  expect(rec.at((await gitDirs(hub)).commonDir).recursive).toBe(false);
  expect(rec.has(await refsOf(s.b.root))).toBe(false);
});

test('a new neighbour at a known state is no move', async () => {
  const s = await withAgent();
  const rec = recorder();
  const onMove = vi.fn();
  const w = await start(s, onMove, rec.watch);
  const { wc, agentCtx } = await agentCopy(s);

  await w.check();
  expect(rec.has(await refsOf(wc))).toBe(true);
  expect(rec.has(await refsOf(join(s.backlogDir, 'hub.git')))).toBe(true);
  expect(onMove).not.toHaveBeenCalled();

  await agentPush(agentCtx);
  await w.check();
  expect(onMove).toHaveBeenCalledTimes(1);
});

test('the first glance at start is no move, also on an unknown commit', async () => {
  const s = await withHub();
  await agentPush(s.agentCtx);
  const onMove = vi.fn();
  const w = await start(s, onMove);
  await w.check();

  expect(onMove).not.toHaveBeenCalled();
});

test('a vanished neighbour is dropped', async () => {
  const s = await withHub();
  const rec = recorder();
  const w = await start(s, vi.fn(), rec.watch);
  const agentRefs = await refsOf(s.wc);
  const agentCommon = (await gitDirs(s.wc)).commonDir;
  const hubRefs = await refsOf(s.hub);
  expect(rec.has(agentRefs)).toBe(true);

  await rm(s.wc, { recursive: true, force: true });
  await expect(w.check()).resolves.toBeUndefined();

  expect(rec.at(agentRefs).closed).toBe(true);
  expect(rec.at(agentCommon).closed).toBe(true);
  expect(rec.has(hubRefs)).toBe(true);
});

test('a broken neighbour is skipped without throwing', async () => {
  const s = await withHub();
  const broken = join(s.backlogDir, 'broken');
  await mkdir(broken);
  await writeFile(join(broken, '.git'), 'gitdir: /nonexistent/backe-broken\n');
  await writeFile(join(s.backlogDir, 'stray.txt'), 'kein Nachbar\n');
  const rec = recorder();
  const onMove = vi.fn();
  const w = await start(s, onMove, rec.watch);
  expect(rec.all.some((r) => r.path.startsWith(broken))).toBe(false);

  // Ohne `HEAD` ist der Hub kein Repository mehr; `rev-parse` scheitert.
  await rm(join(s.hub, 'HEAD'));
  await agentPush(s.agentCtx).catch(() => {});
  await expect(w.check()).resolves.toBeUndefined();
  expect(rec.has(await refsOf(s.wc))).toBe(true);
});

test.skipIf(process.getuid?.() === 0)('an unreadable entry is no neighbour', async () => {
  const s = await withHub();
  const locked = join(s.backlogDir, 'locked');
  await mkdir(locked);
  await chmod(locked, 0o000);
  try {
    const rec = recorder();
    await start(s, vi.fn(), rec.watch);
    expect(rec.all.some((r) => r.path.startsWith(locked))).toBe(false);
    expect(rec.has(await refsOf(s.wc))).toBe(true);
  } finally {
    await chmod(locked, 0o700);
  }
});

test('a neighbour whose watch fails leaves no handle and is retried', async () => {
  const s = await withHub();
  const rec = recorder();
  const agentCommon = (await gitDirs(s.wc)).commonDir;
  let fail = true;
  const watch: WatchFn = (path, opts, listener) => {
    if (fail && path === agentCommon) throw Object.assign(new Error('EMFILE'), { code: 'EMFILE' });
    return rec.watch(path, opts, listener);
  };
  const w = await start(s, vi.fn(), watch);
  const agentRefs = await refsOf(s.wc);
  expect(rec.at(agentRefs).closed).toBe(true);
  expect(rec.has(await refsOf(s.hub))).toBe(true);

  fail = false;
  await w.check();
  expect(rec.has(agentRefs)).toBe(true);
  expect(rec.has(agentCommon)).toBe(true);
});

test('a missing backlog dir is no error', async () => {
  const s = await withAgent();
  const onMove = vi.fn();
  const w = await NeighborWatch.start({
    backlogDir: join(s.backlogDir, 'missing'),
    own: s.b.root,
    remote: 'origin',
    branch: 'main',
    debounceMs,
    watch: fsWatch,
    onMove,
  });
  open.push(w);

  await expect(w.check()).resolves.toBeUndefined();
  expect(onMove).not.toHaveBeenCalled();
});

test('a foreign repository is never watched', async () => {
  const s = await withAgent();
  // `BACKE_HOME` liegt in einem Git-Repo; kaputte Nachbarn fänden es über die Elternverzeichnisse.
  const outer = dirname(s.b.homes.backeHome);
  await git(['init', '-q', outer], { cwd: outer });
  const outerGit = (await gitDirs(outer)).commonDir;
  await mkdir(join(s.backlogDir, 'hub.git'));
  await mkdir(join(s.backlogDir, 'stray', '.git'), { recursive: true });
  expect((await gitDirs(join(s.backlogDir, 'hub.git'))).commonDir).toBe(outerGit);
  const rec = recorder();
  const w = await start(s, vi.fn(), rec.watch);
  await w.check();

  expect(rec.all.map((r) => r.path)).toEqual([s.backlogDir]);
});

test('start never throws and the next check opens what failed', async () => {
  const s = await withHub();
  const rec = recorder();
  let fail = true;
  const watch: WatchFn = (path, opts, listener) => {
    if (fail && path === s.backlogDir) {
      throw Object.assign(new Error('EMFILE'), { code: 'EMFILE' });
    }
    return rec.watch(path, opts, listener);
  };
  const w = await start(s, vi.fn(), watch);
  expect(rec.has(s.backlogDir)).toBe(false);
  expect(rec.has(await refsOf(s.hub))).toBe(true);

  fail = false;
  await w.check();
  expect(rec.has(s.backlogDir)).toBe(true);
  const check = vi.spyOn(w, 'check');
  fakeTimers();
  rec.at(s.backlogDir).fire('claude-1');
  await vi.advanceTimersByTimeAsync(debounceMs);
  expect(check).toHaveBeenCalledTimes(1);
});

test.skipIf(process.getuid?.() === 0)(
  'an own copy that cannot be resolved yet only skips rounds',
  async () => {
    const s = await withHub();
    const locked = join(dirname(s.b.homes.backeHome), 'locked');
    await mkdir(locked);
    await chmod(locked, 0o000);
    const rec = recorder();
    let w: NeighborWatch;
    try {
      w = await start(s, vi.fn(), rec.watch, { own: join(locked, 'own') });
      expect(rec.all.map((r) => r.path)).toEqual([s.backlogDir]);
    } finally {
      await chmod(locked, 0o700);
    }
    await w.check();
    expect(rec.has(await refsOf(s.hub))).toBe(true);
  },
);

test('a backlog dir that appears later is watched', async () => {
  const s = await withAgent();
  const later = join(s.b.homes.backeHome, 'later');
  const rec = recorder();
  const w = await start(s, vi.fn(), rec.watch, { backlogDir: later });
  expect(rec.all).toEqual([]);

  await mkdir(later);
  const hub = join(later, 'hub.git');
  await git(['init', '--bare', '-q', '-b', 'main', hub], { cwd: later });
  await w.check();
  expect(rec.at(later).recursive).toBe(false);
  expect(rec.has(await refsOf(hub))).toBe(true);

  const check = vi.spyOn(w, 'check');
  fakeTimers();
  rec.at(later).fire('claude-1');
  await vi.advanceTimersByTimeAsync(debounceMs - 1);
  expect(check).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(check).toHaveBeenCalledTimes(1);
});

test('a check requested during a running one runs once more afterwards', async () => {
  const s = await withHub();
  const w = await start(s, vi.fn());
  vi.mocked(git).mockClear();

  const first = w.check();
  const second = w.check();
  const third = w.check();
  await Promise.all([first, second, third]);

  // Zwei Nachbarn (Hub und Agent), zwei Durchläufe: der erste und genau ein Nachlauf.
  expect(verifyCalls()).toBe(4);
  await w.check();
  expect(verifyCalls()).toBe(6);
});

test('a real push in the hub reaches onMove', async () => {
  const s = await withHub();
  const onMove = vi.fn();
  await start(s, onMove, fsWatch);
  await agentPush(s.agentCtx);
  fakeTimers();

  await vi.waitFor(
    async () => {
      await vi.advanceTimersByTimeAsync(debounceMs);
      expect(onMove).toHaveBeenCalled();
    },
    { timeout: 10_000, interval: 50 },
  );
});

test('close leaves no watch and no timer', async () => {
  const s = await withHub();
  const rec = recorder();
  const onMove = vi.fn();
  const w = await start(s, onMove, rec.watch);
  await agentPush(s.agentCtx);
  fakeTimers();

  rec.at(await refsOf(s.hub)).fire('heads/main');
  w.close();
  await vi.advanceTimersByTimeAsync(debounceMs);

  expect(onMove).not.toHaveBeenCalled();
  expect(rec.all.length).toBeGreaterThan(0);
  expect(rec.all.filter((r) => !r.closed)).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
  rec.at(s.backlogDir).fire('claude-1');
  expect(vi.getTimerCount()).toBe(0);
  await w.check();
  expect(onMove).not.toHaveBeenCalled();
});

test('a check running during close reports nothing', async () => {
  const s = await withHub();
  const rec = recorder();
  const onMove = vi.fn();
  const w = await start(s, onMove, rec.watch);
  await agentPush(s.agentCtx);

  const running = w.check();
  w.close();
  await running;

  expect(onMove).not.toHaveBeenCalled();
  expect(rec.all.filter((r) => !r.closed)).toEqual([]);
});

test('close during the last comparison suppresses onMove', async () => {
  const s = await withHub();
  const onMove = vi.fn();
  const w = await start(s, onMove);
  await agentPush(s.agentCtx);
  const real = (await vi.importActual<typeof import('../git/exec.ts')>('../git/exec.ts')).git;
  // Beide Nachbarn haben sich bewegt; `close` kommt während des Vergleichs des zweiten.
  let compared = 0;
  vi.mocked(git).mockImplementation(async (args, opts) => {
    if (args[0] === 'merge-base' && ++compared === 2) w.close();
    return real(args, opts);
  });
  try {
    await w.check();
  } finally {
    vi.mocked(git).mockImplementation(real);
  }

  expect(compared).toBe(2);
  expect(onMove).not.toHaveBeenCalled();
});

test('a neighbour found while closing gets no watch', async () => {
  const s = await withAgent();
  const rec = recorder();
  const w = await start(s, vi.fn(), rec.watch);
  await agentCopy(s);
  const real = (await vi.importActual<typeof import('../git/exec.ts')>('../git/exec.ts')).git;
  // Der erste Git-Aufruf des Durchlaufs liest die Git-Dirs des ersten neuen Nachbarn.
  vi.mocked(git).mockImplementationOnce(async (args, opts) => {
    w.close();
    return real(args, opts);
  });

  await w.check();

  expect(rec.all.filter((r) => !r.closed)).toEqual([]);
  expect(rec.all).toHaveLength(1);
});

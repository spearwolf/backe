import { chmod, cp, mkdir, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
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

const isVerify = (args: readonly string[]) => args[0] === 'rev-parse' && args.includes('--verify');

function verifyCalls(): number {
  return vi.mocked(git).mock.calls.filter(([args]) => isVerify(args)).length;
}

async function realGit(): Promise<typeof git> {
  return (await vi.importActual<typeof import('../git/exec.ts')>('../git/exec.ts')).git;
}

const emfile = () => Object.assign(new Error('EMFILE'), { code: 'EMFILE', errno: -24 });

/** spw und `claude-1` mit einem baren Remote außerhalb des Backlog-Verzeichnisses, ohne Hub. */
async function fromTwoClones(): Promise<{
  s: Setup;
  agentCtx: ResolvedContext;
  wc: string;
  remote: string;
}> {
  const { spw, agent, remote } = await twoClones();
  const s: Setup = {
    b: spw,
    ctx: spw.ctx,
    cloneCtx: agent.ctx,
    backlogDir: join(spw.homes.backeHome, 'backlogs', 'acme'),
  };
  return { s, agentCtx: agent.ctx, wc: agent.wc, remote };
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

afterEach(async () => {
  await Promise.all(open.splice(0).map((w) => w.close()));
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
  const { s, agentCtx, wc } = await fromTwoClones();
  const rec = recorder();
  const onMove = vi.fn();
  await start(s, onMove, rec.watch);
  await agentPush(agentCtx);
  fakeTimers();

  rec.at(await refsOf(wc)).fire('remotes/origin/main');
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

test('a neighbour ahead at start is a move', async () => {
  const s = await withHub();
  await agentPush(s.agentCtx);
  const onMove = vi.fn();
  const w = await start(s, onMove);
  expect(onMove).toHaveBeenCalledTimes(1);

  await w.check();
  expect(onMove).toHaveBeenCalledTimes(1);
});

test('a known value at start is no move', async () => {
  const s = await withHub();
  await writeOp(s.ctx, { op: 'issue.create', title: 'Von spw' });
  await syncNow(s.ctx, { spawn: () => {} });
  const onMove = vi.fn();
  const w = await start(s, onMove);
  await w.check();

  expect(onMove).not.toHaveBeenCalled();
});

test('start still runs its first check when the dir watch fails unexpectedly', async () => {
  const s = await withHub();
  await agentPush(s.agentCtx);
  const rec = recorder();
  let fail = true;
  const watch: WatchFn = (path, opts, listener) => {
    if (fail && path === s.backlogDir) {
      fail = false;
      throw new TypeError('bug');
    }
    return rec.watch(path, opts, listener);
  };
  const onMove = vi.fn();
  await start(s, onMove, watch);

  expect(fail).toBe(false);
  expect(rec.has(await refsOf(s.hub))).toBe(true);
  expect(rec.has(s.backlogDir)).toBe(true);
  expect(onMove).toHaveBeenCalledTimes(1);
});

test('a neighbour the first round could not read counts with its first value', async () => {
  const { s, agentCtx, wc } = await fromTwoClones();
  const agentCommon = (await gitDirs(wc)).commonDir;
  const rec = recorder();
  let fail = true;
  const watch: WatchFn = (path, opts, listener) => {
    if (fail && path === agentCommon) throw emfile();
    return rec.watch(path, opts, listener);
  };
  const onMove = vi.fn();
  const w = await start(s, onMove, watch);
  await agentPush(agentCtx);

  fail = false;
  await w.check();
  expect(onMove).toHaveBeenCalledTimes(1);
});

/**
 * Startet die Watch so, dass während des ersten Durchlaufs ein Nachbar `other` entsteht und ein
 * Ereignis einen Nachlauf noch innerhalb von `start` anfordert. Remote, Tracking-Ref des Agenten und
 * `other` stehen auf einem Commit, den spw nicht hat.
 */
async function startWithTrailingNeighbour(onMove: () => void) {
  const { s, agentCtx, remote } = await fromTwoClones();
  await agentPush(agentCtx);
  const other = join(s.backlogDir, 'other');
  const rec = recorder();
  const real = await realGit();
  let armed = true;
  fakeTimers();
  vi.mocked(git).mockImplementation(async (args, opts) => {
    const r = await real(args, opts);
    if (armed && isVerify(args)) {
      armed = false;
      await real(['clone', '-q', remote, other], { cwd: s.backlogDir });
      rec.at(s.backlogDir).fire('other');
      vi.advanceTimersByTime(debounceMs);
    }
    return r;
  });
  let w: NeighborWatch;
  try {
    w = await start(s, onMove, rec.watch);
  } finally {
    vi.mocked(git).mockImplementation(real);
  }
  expect(armed).toBe(false);
  vi.useRealTimers();
  return { s, agentCtx, rec, other, w };
}

test('a neighbour that appears in a trailing round of start counts', async () => {
  const onMove = vi.fn();
  const { rec, other } = await startWithTrailingNeighbour(onMove);

  expect(rec.has(await refsOf(other))).toBe(true);
  // Der erste Durchlauf meldet den Agenten, der Nachlauf den neuen Nachbarn `other`.
  expect(onMove).toHaveBeenCalledTimes(2);
});

test('start resolves even if onMove throws in its trailing round', async () => {
  const onMove = vi
    .fn<() => void>()
    .mockImplementationOnce(() => {})
    .mockImplementationOnce(() => {
      throw new Error('boom');
    });
  const { agentCtx, w } = await startWithTrailingNeighbour(onMove);
  expect(onMove).toHaveBeenCalledTimes(2);

  await agentPush(agentCtx);
  await w.check();
  expect(onMove).toHaveBeenCalledTimes(3);
});

test('a programming error mid-round keeps the moves already read', async () => {
  const s = await withHub();
  const onMove = vi.fn();
  const w = await start(s, onMove);
  await agentPush(s.agentCtx);
  const real = await realGit();
  // Beide Nachbarn haben sich bewegt; der Vergleich des zweiten scheitert an einem Programmierfehler.
  let compared = 0;
  vi.mocked(git).mockImplementation(async (args, opts) => {
    if (args[0] === 'merge-base' && ++compared === 2) throw new TypeError('bug');
    return real(args, opts);
  });
  try {
    await expect(w.check()).rejects.toThrow(TypeError);
  } finally {
    vi.mocked(git).mockImplementation(real);
  }
  expect(onMove).not.toHaveBeenCalled();

  await w.check();
  expect(onMove).toHaveBeenCalledTimes(1);
});

test("a programming error later in the round keeps an earlier neighbour's move", async () => {
  const { s, agentCtx, remote } = await fromTwoClones();
  // Eigenes Verzeichnis mit zwei Klonen; welcher zuerst gelesen wird, bestimmt `readdir`.
  const dir = join(s.b.homes.backeHome, 'pair');
  await mkdir(dir);
  for (const name of ['a', 'b']) {
    await git(['clone', '-q', remote, join(dir, name)], { cwd: dir });
  }
  const onMove = vi.fn();
  const w = await start(s, onMove, recorder().watch, { backlogDir: dir });
  const [first = '', second = ''] = (await readdir(dir)).map((name) => join(dir, name));
  await agentPush(agentCtx);
  await git(['fetch', '-q', 'origin'], { cwd: first });
  const real = await realGit();
  vi.mocked(git).mockImplementation(async (args, opts) => {
    if (isVerify(args) && opts.cwd === second) throw new TypeError('bug');
    return real(args, opts);
  });
  try {
    await expect(w.check()).rejects.toThrow(TypeError);
  } finally {
    vi.mocked(git).mockImplementation(real);
  }
  expect(onMove).not.toHaveBeenCalled();

  await w.check();
  expect(onMove).toHaveBeenCalledTimes(1);
});

test('a throwing onMove keeps a pending trailing round', async () => {
  const s = await withHub();
  const onMove = vi.fn<() => void>().mockImplementationOnce(() => {
    throw new Error('boom');
  });
  const w = await start(s, onMove);
  await agentPush(s.agentCtx);
  const real = await realGit();
  let requested: Promise<void> | undefined;
  vi.mocked(git).mockImplementation(async (args, opts) => {
    if (requested === undefined && isVerify(args)) requested = w.check();
    return real(args, opts);
  });
  vi.mocked(git).mockClear();
  try {
    await expect(w.check()).rejects.toThrow('boom');
    await expect(requested).rejects.toThrow('boom');
  } finally {
    vi.mocked(git).mockImplementation(real);
  }

  // Zwei Nachbarn, zwei Durchläufe: Der angeforderte Nachlauf lief trotz des Fehlers.
  expect(verifyCalls()).toBe(4);
  expect(onMove).toHaveBeenCalledTimes(1);
});

test('a recreated neighbour gets fresh watches and counts as new', async () => {
  const s = await withHub();
  await agentPush(s.agentCtx);
  const rec = recorder();
  const onMove = vi.fn();
  const w = await start(s, onMove, rec.watch);
  expect(onMove).toHaveBeenCalledTimes(1);
  const agentRefs = await refsOf(s.wc);
  const first = rec.at(agentRefs);

  // Gelöscht und neu geklont zwischen zwei Durchläufen; der Stand ist derselbe, spw kennt ihn nicht.
  await rm(s.wc, { recursive: true, force: true });
  await agentCopy(s);
  await w.check();

  expect(first.closed).toBe(true);
  expect(rec.at(agentRefs)).not.toBe(first);
  expect(rec.has(agentRefs)).toBe(true);
  expect(onMove).toHaveBeenCalledTimes(2);
});

test('a replaced git dir gets fresh watches', async () => {
  const s = await withHub();
  const rec = recorder();
  const w = await start(s, vi.fn(), rec.watch);
  const agentRefs = await refsOf(s.wc);
  const first = rec.at(agentRefs);

  await rename(join(s.wc, '.git'), join(s.wc, '.git-old'));
  await cp(join(s.wc, '.git-old'), join(s.wc, '.git'), { recursive: true });
  await w.check();

  expect(first.closed).toBe(true);
  expect(rec.at(agentRefs)).not.toBe(first);
  expect(rec.has(agentRefs)).toBe(true);
});

test('a throwing onMove is not swallowed', async () => {
  const s = await withHub();
  const onMove = vi.fn(() => {
    throw new Error('boom');
  });
  const w = await start(s, onMove);
  await agentPush(s.agentCtx);

  await expect(w.check()).rejects.toThrow('boom');
  await expect(w.check()).resolves.toBeUndefined();
  expect(onMove).toHaveBeenCalledTimes(1);
});

test('a throwing onMove behind the debounce does not reject unhandled', async () => {
  const s = await withHub();
  const rec = recorder();
  const onMove = vi.fn<() => void>().mockImplementationOnce(() => {
    throw new Error('boom');
  });
  await start(s, onMove, rec.watch);
  const hubRefs = await refsOf(s.hub);
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  try {
    await agentPush(s.agentCtx);
    fakeTimers();
    rec.at(hubRefs).fire('heads/main');
    await vi.advanceTimersByTimeAsync(debounceMs);
    await vi.waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
    // `unhandledRejection` kommt erst nach dem Leeren der Mikrotasks.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(unhandled).not.toHaveBeenCalled();

    vi.useRealTimers();
    await agentPush(s.agentCtx);
    fakeTimers();
    rec.at(hubRefs).fire('heads/main');
    await vi.advanceTimersByTimeAsync(debounceMs);
    await vi.waitFor(() => expect(onMove).toHaveBeenCalledTimes(2));
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});

test('an unexpected error is not swallowed', async () => {
  const s = await withAgent();
  const rec = recorder();
  let fail = false;
  const watch: WatchFn = (path, opts, listener) => {
    if (fail && path !== s.backlogDir) throw new TypeError('bug');
    return rec.watch(path, opts, listener);
  };
  const w = await start(s, vi.fn(), watch);
  await agentCopy(s);

  fail = true;
  await expect(w.check()).rejects.toThrow(TypeError);
  fail = false;
  await w.check();
  expect(rec.has(await refsOf(join(s.backlogDir, 'hub.git')))).toBe(true);
});

test('a Node argument error is not swallowed', async () => {
  const s = await withAgent();
  const rec = recorder();
  let fail = false;
  const watch: WatchFn = (path, opts, listener) => {
    if (fail && path !== s.backlogDir) {
      throw Object.assign(new TypeError('bad argument'), { code: 'ERR_INVALID_ARG_TYPE' });
    }
    return rec.watch(path, opts, listener);
  };
  const w = await start(s, vi.fn(), watch);
  await agentCopy(s);

  fail = true;
  await expect(w.check()).rejects.toMatchObject({ code: 'ERR_INVALID_ARG_TYPE' });
});

test('neighbours behind a symlinked BACKE_HOME are found, the own copy is not', async () => {
  const s = await withHub();
  const link = join(dirname(s.b.homes.backeHome), 'backe-link');
  await symlink(s.b.homes.backeHome, link);
  const rec = recorder();
  const onMove = vi.fn();
  const w = await start(s, onMove, rec.watch, { backlogDir: join(link, 'backlogs', 'acme') });

  expect(rec.has(await refsOf(s.wc))).toBe(true);
  expect(rec.has(await refsOf(s.hub))).toBe(true);
  expect(rec.has(await refsOf(s.b.root))).toBe(false);
  await agentPush(s.agentCtx);
  await w.check();
  expect(onMove).toHaveBeenCalledTimes(1);
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
    if (fail && path === agentCommon) throw emfile();
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
    if (fail && path === s.backlogDir) throw emfile();
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

test('a check requested right after a round ends gets its own round', async () => {
  const s = await withHub();
  const w = await start(s, vi.fn());
  const real = await realGit();
  try {
    // Die Anforderung kommt aus einer Fortsetzung, die nach dem letzten Lesen des Durchlaufs läuft;
    // die Tiefe verschiebt sie über alle Mikrotasks bis nach dem Ende des Durchlaufs.
    for (let depth = 0; depth < 12; depth++) {
      let seen = 0;
      let at = -1;
      let requested: Promise<void> | undefined;
      vi.mocked(git).mockImplementation(async (args, opts) => {
        const r = await real(args, opts);
        if (isVerify(args) && ++seen === 2) {
          let p = Promise.resolve();
          for (let i = 0; i < depth; i++) p = p.then(() => {});
          void p.then(() => {
            at = verifyCalls();
            requested = w.check();
          });
        }
        return r;
      });
      await w.check();
      await vi.waitFor(() => expect(requested).toBeDefined());
      await requested;
      expect({ depth, after: verifyCalls() > at }).toEqual({ depth, after: true });
    }
  } finally {
    vi.mocked(git).mockImplementation(real);
  }
});

test('a round running during close does not reopen the dir watch', async () => {
  const s = await withHub();
  const rec = recorder();
  let fail = true;
  const watch: WatchFn = (path, opts, listener) => {
    if (fail && path === s.backlogDir) throw emfile();
    return rec.watch(path, opts, listener);
  };
  const w = await start(s, vi.fn(), watch);
  fail = false;

  const running = w.check();
  void w.close();
  await running;

  expect(rec.all.some((r) => r.path === s.backlogDir)).toBe(false);
  expect(rec.all.filter((r) => !r.closed)).toEqual([]);
});

test('a real push in the hub reaches onMove', async () => {
  const s = await withHub();
  const onMove = vi.fn();
  await start(s, onMove, fsWatch);
  // Vor dem Push, damit die Entprellung des ersten Ereignisses schon auf dem Fake-Timer läuft.
  fakeTimers();
  await agentPush(s.agentCtx);

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
  void w.close();
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
  void w.close();
  await running;

  expect(onMove).not.toHaveBeenCalled();
  expect(rec.all.filter((r) => !r.closed)).toEqual([]);
});

test('close during the last comparison suppresses onMove', async () => {
  const s = await withHub();
  const onMove = vi.fn();
  const w = await start(s, onMove);
  await agentPush(s.agentCtx);
  const real = await realGit();
  // Beide Nachbarn haben sich bewegt; `close` kommt während des Vergleichs des zweiten.
  let compared = 0;
  vi.mocked(git).mockImplementation(async (args, opts) => {
    if (args[0] === 'merge-base' && ++compared === 2) void w.close();
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
  const real = await realGit();
  // Der erste Git-Aufruf des Durchlaufs liest die Git-Dirs des ersten neuen Nachbarn.
  vi.mocked(git).mockImplementationOnce(async (args, opts) => {
    void w.close();
    return real(args, opts);
  });

  await w.check();

  expect(rec.all.filter((r) => !r.closed)).toEqual([]);
  expect(rec.all).toHaveLength(1);
});

test('close resolves only after a running check, and swallows its error', async () => {
  const s = await withHub();
  const w = await start(s, vi.fn());
  const real = await realGit();
  let entered!: () => void;
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(git).mockImplementation(async (args, opts) => {
    if (isVerify(args)) {
      entered();
      await gate;
      throw new TypeError('bug');
    }
    return real(args, opts);
  });
  try {
    const outcome = w.check().then(
      () => 'resolved',
      (err: unknown) => err,
    );
    await inside;
    let closed = false;
    const closing = w.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);

    release();
    await closing;
    expect(await outcome).toBeInstanceOf(TypeError);
  } finally {
    vi.mocked(git).mockImplementation(real);
  }
});

test('a round reads its neighbours in parallel', async () => {
  const s = await withHub();
  const w = await start(s, vi.fn());
  const real = await realGit();
  let reading = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.mocked(git).mockImplementation(async (args, opts) => {
    if (isVerify(args)) {
      reading += 1;
      await gate;
    }
    return real(args, opts);
  });
  try {
    const running = w.check();
    // Hub und Agent: Beide Blicke laufen, bevor einer fertig ist.
    await vi.waitFor(() => expect(reading).toBe(2));
    release();
    await running;
  } finally {
    vi.mocked(git).mockImplementation(real);
  }
});

test('a rejected candidate is not probed again until it changes', async () => {
  const s = await withAgent();
  // Wie bei einem fremden Repository: `hub.git` ist leer, git fände das Repo darüber.
  const outer = dirname(s.b.homes.backeHome);
  await git(['init', '-q', outer], { cwd: outer });
  const hub = join(s.backlogDir, 'hub.git');
  await mkdir(hub);
  const rec = recorder();
  const w = await start(s, vi.fn(), rec.watch);
  const probes = () =>
    vi.mocked(git).mock.calls.filter(([args]) => args.includes('--git-common-dir')).length;

  vi.mocked(git).mockClear();
  await w.check();
  expect(probes()).toBe(0);
  expect(rec.all.map((r) => r.path)).toEqual([s.backlogDir]);

  // `git init` behält das Verzeichnis und seinen Inode; geprüft wird trotzdem neu.
  await git(['init', '--bare', '-q', '-b', 'main', hub], { cwd: s.backlogDir });
  await w.check();
  expect(probes()).toBe(1);
  expect(rec.has(await refsOf(hub))).toBe(true);
});

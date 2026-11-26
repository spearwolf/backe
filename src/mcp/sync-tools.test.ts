/**
 * Die Tools, die selbst mit dem Remote sprechen (Claim, `next` mit Claim, `sync_now`), und der
 * periodische Hintergrund-Sync. Zwei Arbeitskopien (`spw`, Agent `claude-1`) teilen ein bares
 * Remote, jede Seite hat ihren eigenen Server. Prozessstarts laufen über ein injiziertes `spawn`,
 * Reihenfolgen über `SyncHooks`, Timer über Fake Timers; gewartet wird nie wirklich.
 */
import { revParse, setPullInterval, twoClones } from '../../test/helpers/git.ts';
import { connectMcp } from '../../test/helpers/mcp.ts';
import { git } from '../git/exec.ts';
import { setLocale } from '../i18n/locale.ts';
import { scheduleSync } from '../services/background.ts';
import { isoNow } from '../services/env.ts';
import { createIssue } from '../services/issues.ts';
import type { SpawnFn, SyncDeps, SyncHooks } from '../services/sync.ts';
import { syncNow } from '../services/sync.ts';
import { writeSyncState } from '../services/sync-state.ts';
import { startPeriodicSync, syncResult } from '../tools/sync.ts';
import type { McpDeps } from './server.ts';

// Der MCP-Modus spricht immer Englisch (backe.md §2.18); `backe mcp` setzt die Locale beim Start.
beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

vi.mock('../services/background.ts', async (orig) => {
  const actual = await orig<typeof import('../services/background.ts')>();
  return { ...actual, scheduleSync: vi.fn(actual.scheduleSync) };
});
const schedule = vi.mocked(scheduleSync);

type Mcp = Awaited<ReturnType<typeof connectMcp>>;

let t: Awaited<ReturnType<typeof twoClones>>;
let spawned: Parameters<SpawnFn>[0][];

beforeEach(async () => {
  t = await twoClones();
  spawned = [];
});

afterEach(() => {
  vi.useRealTimers();
});

/** Ohne Backoff, Prozessstarts nur in `spawned`. */
const syncDeps = (hooks?: SyncHooks): SyncDeps => ({
  sleep: async () => {},
  spawn: (args) => {
    spawned.push(args);
  },
  ...(hooks === undefined ? {} : { hooks }),
});

const deps = (hooks?: SyncHooks): McpDeps => ({ sync: syncDeps(hooks), claim: syncDeps(hooks) });

const spwMcp = (hooks?: SyncHooks) => connectMcp(t.spw, { deps: deps(hooks) });
const agentMcp = (hooks?: SyncHooks) =>
  connectMcp(t.spw, { flags: { as: 'claude-1', backlog: 'acme' }, deps: deps(hooks) });

async function using<T>(conns: Mcp[], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    for (const c of conns) await c.close();
  }
}

/** Ein Issue von spw, das beide Arbeitskopien schon haben. */
async function shared(title: string): Promise<string> {
  const { id } = await createIssue(t.spw.ctx, { title });
  await syncNow(t.spw.ctx, syncDeps());
  await syncNow(t.agent.ctx, syncDeps());
  return id as string;
}

const remoteHead = () => revParse(t.remote, 'refs/heads/main');

async function isClaim(wc: string, sha: string): Promise<boolean> {
  const { stdout } = await git(['log', '-1', '--format=%B', sha], { cwd: wc });
  return stdout.includes('"op":"issue.claim"');
}

/** Ein Riegel: `reached` meldet die Pause, `release` hebt sie auf. */
function gate() {
  let reached!: () => void;
  const atGate = new Promise<void>((r) => {
    reached = r;
  });
  let release!: () => void;
  const open = new Promise<void>((r) => {
    release = r;
  });
  return { atGate, reached, open, release };
}

test('issue_claim pushes and reports the commit', async () => {
  const x = await shared('X');
  const m = await agentMcp();
  await using([m], async () => {
    const r = await m.call('issue_claim', { id: x });
    if (!('ok' in r)) throw new Error(JSON.stringify(r));
    expect(r.ok.commit).toBe(await remoteHead());
    expect(r.ok).toMatchObject({ op: { op: 'issue.claim', id: x }, id: x });
  });
});

test('a parallel claim has exactly one winner', async () => {
  const x = await shared('X');
  const g = gate();
  let paused = false;
  const a = await spwMcp({
    beforePush: async (_round, sha) => {
      if (paused || !(await isClaim(t.spw.root, sha))) return;
      paused = true;
      g.reached();
      await g.open;
    },
  });
  const b = await agentMcp();
  await using([a, b], async () => {
    const ra = a.call('issue_claim', { id: x });
    await g.atGate;
    const rb = await b.call('issue_claim', { id: x }).finally(g.release);
    expect(await ra).toMatchObject({
      error: { code: 'conflict', message: `${x} was taken by claude-1 in the meantime` },
    });
    expect(rb).toHaveProperty('ok.commit', await remoteHead());
  });
});

test('issue_next with claim claims the chosen issue', async () => {
  const x = await shared('X');
  const m = await agentMcp();
  await using([m], async () => {
    const r = await m.call('issue_next', { claim: true });
    if (!('ok' in r)) throw new Error(JSON.stringify(r));
    expect(r.ok.commit).toBe(await remoteHead());
    expect(r.ok.issue).toMatchObject({ id: x, state: 'in_progress', assignee: 'claude-1' });
    expect(r.ok.attempts).toEqual([x]);
  });
});

test('issue_next with claim and an unknown field claims nothing', async () => {
  const x = await shared('X');
  const head = await remoteHead();
  const local = await revParse(t.agent.wc, 'HEAD');
  const m = await agentMcp();
  await using([m], async () => {
    const r = await m.call('issue_next', { claim: true, fields: ['id', 'bogus'] });
    expect(r).toMatchObject({
      error: { code: 'usage', message: "Unknown fields for --fields: 'bogus'" },
    });
    expect(await remoteHead()).toBe(head);
    expect(await revParse(t.agent.wc, 'HEAD')).toBe(local);
    const after = await m.call('issue_get', { id: x });
    expect(after).toHaveProperty('ok.state', 'backlog');
    expect(after).not.toHaveProperty('ok.assignee');
  });
});

test('issue_next without claim reports no commit', async () => {
  const x = await shared('X');
  const head = await remoteHead();
  const m = await agentMcp();
  await using([m], async () => {
    const r = await m.call('issue_next', { claim: false });
    if (!('ok' in r)) throw new Error(JSON.stringify(r));
    expect(r.ok.issue.id).toBe(x);
    expect(r.ok.issue.state).not.toBe('in_progress');
    expect(r.ok).not.toHaveProperty('commit');
    expect(r.ok).not.toHaveProperty('attempts');
    expect(await remoteHead()).toBe(head);
  });
});

test('issue_next with claim schedules no read sync before claiming', async () => {
  await setPullInterval(t.spw, 0);
  const x = await shared('X');
  const m = await agentMcp();
  await using([m], async () => {
    // Mit pull_interval 0 ist jeder Read fällig; der Claim darf trotzdem keinen anstoßen.
    expect(await m.call('issue_next', { claim: true })).toHaveProperty('ok.attempts', [x]);
    expect(spawned).toEqual([]);
    expect(await m.call('issue_next')).toHaveProperty('ok.issue.id', x);
    expect(spawned).toHaveLength(1);
  });
});

test('close lets a running claim finish', async () => {
  const x = await shared('X');
  const g = gate();
  let paused = false;
  const m = await agentMcp({
    beforePush: async (_round, sha) => {
      if (paused || !(await isClaim(t.agent.wc, sha))) return;
      paused = true;
      g.reached();
      await g.open;
    },
  });
  // Die Antwort erreicht den Client nicht mehr, sobald die Verbindung zu ist.
  const call = m.call('issue_claim', { id: x }).catch(() => undefined);
  await g.atGate;
  let closed = false;
  const closing = m.close().then(() => {
    closed = true;
  });
  await new Promise<void>((r) => setImmediate(r));
  expect(closed).toBe(false);
  g.release();
  await closing;
  const head = await remoteHead();
  expect(await isClaim(t.remote, head)).toBe(true);
  expect(head).toBe(await revParse(t.agent.wc, 'HEAD'));
  await call;
});

test('syncResult turns string notices into objects', () => {
  expect(
    syncResult({
      fetched: 0,
      replayed: 0,
      conflicts: [],
      pushed: undefined,
      rounds: 1,
      notices: ['n'],
    }),
  ).toEqual({
    fetched: 0,
    replayed: 0,
    conflicts: [],
    pushed: null,
    rounds: 1,
    notices: [{ message: 'n' }],
  });
  expect(
    syncResult({ fetched: 0, replayed: 0, conflicts: [], pushed: 'abc', rounds: 1, notices: [] })
      .notices,
  ).toBeUndefined();
});

test('sync_now pulls what the other side pushed', async () => {
  const { id } = await createIssue(t.spw.ctx, { title: 'Von spw' });
  await syncNow(t.spw.ctx, syncDeps());
  const m = await agentMcp();
  await using([m], async () => {
    expect(await m.call('sync_now')).toHaveProperty('ok.fetched', 1);
    expect(await m.call('issue_get', { id })).toHaveProperty('ok.id', id);
  });
});

test('a write during sync_now lands', async () => {
  const x = await shared('X');
  const g = gate();
  let paused = false;
  const m = await agentMcp({
    afterFetch: async () => {
      if (paused) return;
      paused = true;
      g.reached();
      await g.open;
    },
  });
  await using([m], async () => {
    const running = m.call('sync_now');
    await g.atGate;
    const written = await m.call('comment_add', { id: x, body: 'mitten im Sync' });
    g.release();
    expect(written).toHaveProperty('ok.op.op', 'comment.add');
    expect(await running).toHaveProperty('ok.rounds');
    expect(await m.call('sync_now')).toHaveProperty('ok.rounds');
    expect(await remoteHead()).toBe(await revParse(t.agent.wc, 'HEAD'));
  });
});

test('close waits for the background start of the last write', async () => {
  const x = await shared('X');
  const m = await agentMcp();
  const r = await m.call('comment_add', { id: x, body: 'zuletzt' });
  expect(r).toHaveProperty('ok.commit');
  await m.close();
  expect(spawned.map((s) => s.argv.slice(-6))).toEqual([
    ['sync', '--background', '--backlog', 'acme', '--as', 'claude-1'],
  ]);
});

/** Das Ergebnis des letzten Ticks: ob `scheduleSync` gestartet hat (wirft nie). */
function lastTick(): Promise<boolean> {
  const i = schedule.mock.calls.findLastIndex(([, reason]) => reason === 'periodic');
  const result = schedule.mock.results[i];
  if (result?.type !== 'return') throw new Error('kein Tick');
  return result.value;
}

test('the periodic sync starts on every tick, even right after the last attempt', async () => {
  await setPullInterval(t.spw, 30);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const m = await spwMcp();
  try {
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(30_000);
    expect(await lastTick()).toBe(true);
    expect(spawned[0]?.argv.slice(-6)).toEqual([
      'sync',
      '--background',
      '--backlog',
      'acme',
      '--as',
      'spw',
    ]);
    // Der gestartete Prozess schreibt `last_attempt` kurz nach dem Tick; der nächste Tick kommt
    // genau `pull_interval` später und startet trotzdem.
    await writeSyncState(t.spw.root, { last_attempt: isoNow(new Date()) });
    vi.advanceTimersByTime(30_000);
    expect(await lastTick()).toBe(true);
    expect(spawned).toHaveLength(2);
  } finally {
    await m.close();
  }
  expect(vi.getTimerCount()).toBe(0);
});

test('pull_interval 0 starts no timer', async () => {
  await setPullInterval(t.spw, 0);
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const stop = await startPeriodicSync(await t.spw.context(), syncDeps());
  expect(vi.getTimerCount()).toBe(0);
  stop();
});

test('without a working copy the periodic sync uses the default interval', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const every = vi.spyOn(globalThis, 'setInterval');
  const ctx = await t.spw.context();
  const stop = await startPeriodicSync(
    { ...ctx, backlog: { ...ctx.backlog, workingCopy: `${t.spw.root}-fehlt` } },
    syncDeps(),
  );
  try {
    expect(vi.getTimerCount()).toBe(1);
    expect(every).toHaveBeenCalledWith(expect.any(Function), 60_000);
  } finally {
    stop();
  }
  expect(vi.getTimerCount()).toBe(0);
});

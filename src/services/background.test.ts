/**
 * Hintergrund-Sync, Debounce, Frische beim Lesen und Sync-Status (backe.md §2.16.2, §2.16.3).
 * Prozessstarts laufen über ein injiziertes `spawn`, Pausen über `SyncHooks`, die Zeit über `now`
 * bzw. Fake Timers; kein Test startet einen echten Prozess.
 */
import type * as ChildProcess from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { revParse, testBacklog, twoClones } from '../../test/helpers/git.ts';
import { seqBytes } from '../../test/helpers/snapshot.ts';
import { exists } from '../context/paths.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { git } from '../git/exec.ts';
import { clearLocalState, stateDir, writeLocalState } from '../git/local-state.ts';
import type { Operation } from '../ops/operation.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import {
  freshen,
  runBackground,
  type SpawnFn,
  type SyncStatus,
  scheduleSync,
  spawnDetached,
  statusLine,
  syncStatus,
} from './background.ts';
import { type SyncDeps, syncNow } from './sync.ts';
import { type ConflictEntry, readSyncState, writeConflicts, writeSyncState } from './sync-state.ts';
import { executeWrite } from './write.ts';

type SpawnCall = Parameters<typeof ChildProcess.spawn>;
let spawnSpy: ((...args: SpawnCall) => unknown) | undefined;
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  return {
    ...actual,
    spawn: (...args: SpawnCall) =>
      spawnSpy ? spawnSpy(...args) : (actual.spawn as (...a: SpawnCall) => unknown)(...args),
  };
});

let t: Awaited<ReturnType<typeof twoClones>>;
let spawned: Parameters<SpawnFn>[0][];
const NOW = new Date('2026-11-20T08:00:00Z');

beforeEach(async () => {
  spawnSpy = undefined;
  t = await twoClones();
  spawned = [];
});

afterEach(() => {
  spawnSpy = undefined;
  vi.useRealTimers();
});

const deps = (extra: SyncDeps = {}): SyncDeps => ({
  now: () => NOW,
  sleep: async () => {},
  spawn: (args) => {
    spawned.push(args);
  },
  ...extra,
});

const spw = () => t.spw.ctx;
const agent = () => t.agent.ctx;
const agentWc = () => t.agent.wc;
const state = async (name: string) => join(await stateDir(agentWc()), name);

async function create(ctx: ResolvedContext, title: string): Promise<string> {
  const op: Operation = { op: 'issue.create', title };
  const r = await executeWrite(ctx, { kind: 'op', op });
  return (r.recorded[0] as { id: string }).id;
}

const remoteHead = () => revParse(t.remote, 'refs/heads/main');

const manual = (ctx: ResolvedContext): ResolvedContext => ({
  ...ctx,
  userConfig: {
    ...ctx.userConfig,
    backlogs: { acme: { ...ctx.userConfig.backlogs?.acme, sync: { mode: 'manual' } } },
  },
});

/** Ein gültiger Admin-Commit von spw setzt `sync.pull_interval` in der Backlog-Config. */
async function setPullInterval(seconds: number): Promise<void> {
  const config = await readFile(join(t.spw.root, BACKLOG_CONFIG), 'utf8');
  const changed = config.replace(/\n}\n$/, `,\n  "sync": { "pull_interval": ${seconds} }\n}\n`);
  expect(changed).not.toBe(config);
  await executeWrite(spw(), {
    kind: 'manual',
    subject: `pull_interval: ${seconds}`,
    changes: [{ path: BACKLOG_CONFIG, content: changed }],
  });
}

/** Ein Git-Repo mit `.backe/backlog.jsonc` im Arbeitsbaum, aber nicht in HEAD. */
async function uncommittedBacklog(): Promise<string> {
  const dir = await tempDir();
  await git(['init', '-q', dir], { cwd: dir });
  await mkdir(join(dir, '.backe'), { recursive: true });
  await writeFile(join(dir, BACKLOG_CONFIG), '{}\n');
  return dir;
}

describe('runBackground', () => {
  test('a second background run while one holds the lock only marks dirty', async () => {
    await create(agent(), 'B');
    let reached!: () => void;
    const atFetch = new Promise<void>((r) => {
      reached = r;
    });
    let release!: () => void;
    const paused = new Promise<void>((r) => {
      release = r;
    });
    let first = true;
    const run = runBackground(
      agent(),
      deps({
        hooks: {
          afterFetch: async () => {
            if (!first) return;
            first = false;
            reached();
            await paused;
          },
        },
      }),
    );
    await atFetch;

    expect(await runBackground(agent(), deps())).toEqual({ rounds: 0, deferred: true });
    expect(await exists(await state('sync.dirty'))).toBe(true);

    release();
    expect(await run).toEqual({ rounds: 2, deferred: false });
    expect(await exists(await state('sync.dirty'))).toBe(false);
    expect(await remoteHead()).toBe(await revParse(agentWc(), 'HEAD'));
  });

  test('a dirty flag set right before release triggers another round', async () => {
    let first = true;
    const r = await runBackground(
      agent(),
      deps({
        hooks: {
          beforeRelease: async () => {
            if (!first) return;
            first = false;
            await writeFile(await state('sync.dirty'), '');
          },
        },
      }),
    );

    expect(r).toEqual({ rounds: 2, deferred: false });
    expect(await exists(await state('sync.dirty'))).toBe(false);
  });

  test('a run deferred after the holder already checked the flag retries the lock', async () => {
    let atRelease!: () => void;
    const reachedRelease = new Promise<void>((r) => {
      atRelease = r;
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const holder = runBackground(
      agent(),
      deps({
        hooks: {
          beforeRelease: async () => {
            atRelease();
            await gate;
          },
        },
      }),
    );
    await reachedRelease;

    let busy = 0;
    const late = runBackground(
      agent(),
      deps({
        hooks: {
          lockBusy: async () => {
            busy++;
            if (busy > 1) return;
            // Der Halter gibt frei und prüft das Flag, bevor es hier geschrieben wird.
            release();
            expect(await holder).toEqual({ rounds: 1, deferred: false });
            await create(agent(), 'B');
          },
        },
      }),
    );

    expect(await late).toEqual({ rounds: 1, deferred: false });
    expect(busy).toBe(1);
    expect(await remoteHead()).toBe(await revParse(agentWc(), 'HEAD'));
    expect(await exists(await state('sync.dirty'))).toBe(false);
  });

  test('a stale sync lock of a dead process is taken over', async () => {
    await create(agent(), 'B');
    await writeFile(
      await state('sync.lock'),
      `999999\n${new Date().toISOString()}\n${hostname()}\n`,
    );

    const r = await runBackground(agent(), deps({ lock: { isAlive: () => false } }));

    expect(r).toEqual({ rounds: 1, deferred: false });
    expect(await remoteHead()).toBe(await revParse(agentWc(), 'HEAD'));
    expect(await exists(await state('sync.lock'))).toBe(false);
  });

  test('a failing round is recorded and logged, never thrown', async () => {
    await git(['remote', 'set-url', 'origin', join(await tempDir(), 'gone.git')], {
      cwd: agentWc(),
    });

    const r = await runBackground(agent(), deps());

    expect(r).toEqual({ rounds: 1, deferred: false });
    expect((await readSyncState(agentWc())).last_error).toMatchObject({
      code: 'sync',
      at: '2026-11-20T08:00:00Z',
    });
    const log = await readFile(await state('sync.log'), 'utf8');
    expect(log).toMatch(/^2026-11-20T08:00:00Z sync: Fetch von origin fehlgeschlagen: .+\n$/);
  });

  test('notices of a round go to the log', async () => {
    await executeWrite(
      spw(),
      { kind: 'op', op: { op: 'issue.create', title: 'remote' } },
      { randomBytes: seqBytes() },
    );
    await git(['push', '-q', 'origin', 'main'], { cwd: t.spw.root });
    await executeWrite(
      agent(),
      { kind: 'op', op: { op: 'issue.create', title: 'lokal' } },
      { randomBytes: seqBytes() },
    );

    await runBackground(agent(), deps({ randomBytes: seqBytes(100) }));

    const log = await readFile(await state('sync.log'), 'utf8');
    expect(log).toMatch(/^2026-11-20T08:00:00Z notice: ID-Kollision: \S+ heißt jetzt \S+\n$/);
  });

  test('a log above 1 MiB is moved to sync.log.1 at start', async () => {
    const big = 'x'.repeat(1024 * 1024 + 1);
    await writeFile(await state('sync.log'), big);

    await runBackground(agent(), deps());

    expect((await stat(await state('sync.log.1'))).size).toBe(big.length);
    expect(await exists(await state('sync.log'))).toBe(false);
  });

  test('a log of exactly 1 MiB stays in place', async () => {
    await writeFile(await state('sync.log'), 'x'.repeat(1024 * 1024));

    await runBackground(agent(), deps());

    expect(await exists(await state('sync.log.1'))).toBe(false);
  });

  test('a working copy without remote runs no round', async () => {
    const solo = await testBacklog();
    expect(await runBackground(await solo.context(), deps())).toEqual({
      rounds: 0,
      deferred: false,
    });
  });

  test('a failure before the round is logged when the working copy is known', async () => {
    const ctx: ResolvedContext = { ...agent(), user: { ...agent().user, key: undefined } };

    expect(await runBackground(ctx, deps())).toEqual({ rounds: 0, deferred: false });

    const log = await readFile(await state('sync.log'), 'utf8');
    expect(log).toMatch(/^2026-11-20T08:00:00Z usage: Für »claude-1« ist kein Signing-Key/);
  });

  test('without an identity nothing happens and nothing is thrown', async () => {
    const ctx: ResolvedContext = { ...agent(), user: { ...agent().user, value: undefined } };
    expect(await runBackground(ctx, deps())).toEqual({ rounds: 0, deferred: false });
  });
});

describe('scheduleSync', () => {
  test('scheduleSync after a write spawns only in auto mode with a remote', async () => {
    expect(await scheduleSync(agent(), 'write', deps())).toBe(true);
    expect(spawned).toHaveLength(1);

    expect(await scheduleSync(manual(agent()), 'write', deps())).toBe(false);
    const solo = await testBacklog();
    expect(await scheduleSync(await solo.context(), 'write', deps())).toBe(false);
    const none: ResolvedContext = {
      ...agent(),
      backlog: { ...agent().backlog, workingCopy: undefined },
    };
    expect(await scheduleSync(none, 'write', deps())).toBe(false);
    const anonymous: ResolvedContext = { ...agent(), user: { ...agent().user, value: undefined } };
    expect(await scheduleSync(anonymous, 'write', deps())).toBe(false);
    expect(spawned).toHaveLength(1);
  });

  test('a write spawns even while a sync is running', async () => {
    await writeFile(await state('sync.lock'), `${process.pid}\n${new Date().toISOString()}\n`);
    expect(await scheduleSync(agent(), 'write', deps())).toBe(true);
  });

  test('the spawned argv names sync --background with backlog and handle', async () => {
    await scheduleSync(agent(), 'write', deps());

    const [call] = spawned;
    expect(call?.argv[0]).toBe(process.execPath);
    expect(call?.argv.slice(-6)).toEqual([
      'sync',
      '--background',
      '--backlog',
      'acme',
      '--as',
      'claude-1',
    ]);
    expect(call?.cwd).toBe(agentWc());
    expect(call?.env).toBe(agent().env);
    expect(call?.log).toBe(await state('sync.log'));
  });

  test('a failing start never throws and is logged', async () => {
    const failing = deps({
      spawn: () => {
        throw new Error('kein Prozess');
      },
    });

    expect(await scheduleSync(agent(), 'write', failing)).toBe(false);
    expect(await freshen(agent(), { force: false }, failing)).toBeUndefined();

    const log = await readFile(await state('sync.log'), 'utf8');
    expect(log).toBe(
      '2026-11-20T08:00:00Z unexpected: kein Prozess\n2026-11-20T08:00:00Z unexpected: kein Prozess\n',
    );
  });

  test('a failure without a usable working copy is swallowed', async () => {
    const ctx: ResolvedContext = {
      ...agent(),
      backlog: { ...agent().backlog, workingCopy: await tempDir() },
    };
    await mkdir(join(ctx.backlog.workingCopy as string, '.backe'));
    await writeFile(join(ctx.backlog.workingCopy as string, BACKLOG_CONFIG), '{}\n');
    expect(await scheduleSync(ctx, 'write', deps())).toBe(false);
  });

  test('without working copy on disk nothing is spawned', async () => {
    const ctx: ResolvedContext = {
      ...agent(),
      backlog: { ...agent().backlog, workingCopy: join(await tempDir(), 'missing') },
    };
    expect(await scheduleSync(ctx, 'write', deps())).toBe(false);
  });

  test('a working copy whose HEAD has no backlog config spawns nothing', async () => {
    const ctx: ResolvedContext = {
      ...agent(),
      backlog: { ...agent().backlog, workingCopy: await uncommittedBacklog() },
    };
    expect(await scheduleSync(ctx, 'write', deps())).toBe(false);
  });
});

describe('freshen', () => {
  test('freshen spawns when pull_interval has elapsed', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-19T10:00:00Z'), toFake: ['Date'] });
    await writeSyncState(agentWc(), { last_attempt: '2026-11-19T10:00:00Z' });
    const d: SyncDeps = { spawn: (args) => void spawned.push(args) };

    vi.setSystemTime(new Date('2026-11-19T10:00:59Z'));
    expect(await freshen(agent(), { force: false }, d)).toBeUndefined();
    expect(spawned).toHaveLength(0);

    vi.setSystemTime(new Date('2026-11-19T10:01:00Z'));
    expect(await freshen(agent(), { force: false }, d)).toBeUndefined();
    expect(spawned).toHaveLength(1);
  });

  test('a read without a readable last_attempt spawns', async () => {
    expect(await scheduleSync(agent(), 'read', deps())).toBe(true);
    await writeSyncState(agentWc(), { last_attempt: 'kaputt' });
    expect(await scheduleSync(agent(), 'read', deps())).toBe(true);
  });

  test('a last_attempt in the future counts as due', async () => {
    await writeSyncState(agentWc(), { last_attempt: '2026-11-20T09:00:00Z' });
    expect(await scheduleSync(agent(), 'read', deps())).toBe(true);
  });

  test('a read within pull_interval spawns nothing', async () => {
    await writeSyncState(agentWc(), { last_attempt: '2026-11-20T07:59:30Z' });
    expect(await scheduleSync(agent(), 'read', deps())).toBe(false);
  });

  test('pull_interval 0 spawns on every read', async () => {
    await setPullInterval(0);
    await writeSyncState(t.spw.root, { last_attempt: '2026-11-20T08:00:00Z' });

    expect(await scheduleSync(spw(), 'read', deps())).toBe(true);
    expect(await scheduleSync(spw(), 'read', deps())).toBe(true);
    expect(spawned).toHaveLength(2);
  });

  test('a read in manual mode never spawns', async () => {
    expect(await scheduleSync(manual(agent()), 'read', deps())).toBe(false);
  });

  test('freshen with force runs a blocking round', async () => {
    await create(agent(), 'B');

    const r = await freshen(agent(), { force: true }, deps());

    expect(r).toMatchObject({ rounds: 1, pushed: await revParse(agentWc(), 'HEAD') });
    expect(spawned).toHaveLength(0);
  });

  test('a failing forced round aborts', async () => {
    await git(['remote', 'set-url', 'origin', join(await tempDir(), 'gone.git')], {
      cwd: agentWc(),
    });
    const err = await catchErrAsync(() => freshen(agent(), { force: true }, deps()));
    expect(err.code).toBe('sync');
  });
});

describe('spawnDetached', () => {
  test('starts a detached process logging to the file and lets it go', async () => {
    const dir = await tempDir();
    const log = join(dir, 'sync.log');
    await writeFile(log, 'x'.repeat(1024 * 1024 + 1));
    const calls: SpawnCall[] = [];
    const events: string[] = [];
    spawnSpy = (...args) => {
      calls.push(args);
      return {
        on: (event: string, fn: (err: Error) => void) => {
          events.push(event);
          fn(new Error('ENOENT'));
        },
        unref: () => events.push('unref'),
      };
    };

    spawnDetached({ argv: ['/bin/node', 'cli.js', 'sync'], cwd: dir, env: { A: '1' }, log });

    const [cmd, args, opts] = calls[0] ?? [];
    expect(cmd).toBe('/bin/node');
    expect(args).toEqual(['cli.js', 'sync']);
    expect(opts).toMatchObject({ cwd: dir, detached: true, env: { A: '1' } });
    const stdio = (opts as { stdio: unknown[] }).stdio;
    expect(stdio[0]).toBe('ignore');
    expect(typeof stdio[1]).toBe('number');
    expect(stdio[2]).toBe(stdio[1]);
    expect(events).toEqual(['error', 'unref']);
    expect((await stat(`${log}.1`)).size).toBe(1024 * 1024 + 1);
    expect(await readFile(log, 'utf8')).toMatch(
      /^\S+Z unexpected: Hintergrund-Sync nicht gestartet: ENOENT\n$/,
    );
  });
});

describe('syncStatus', () => {
  test('a fresh working copy has nothing open', async () => {
    const s = await syncStatus(agent());
    expect(s).toEqual({
      remote: t.remote,
      mode: 'auto',
      unpushed: 0,
      running: false,
      state: {},
      conflicts: [],
    });
    expect(statusLine(s)).toBeUndefined();
  });

  test('unpushed counts local commits after upstream', async () => {
    await syncNow(agent(), deps());
    await create(agent(), 'B');
    await create(agent(), 'C');
    expect((await syncStatus(agent())).unpushed).toBe(2);
  });

  test('without upstream unpushed counts against the remote-tracking ref', async () => {
    await create(agent(), 'B');
    await clearLocalState(agentWc(), 'upstream');
    expect((await syncStatus(agent())).unpushed).toBe(1);
  });

  test('without upstream and tracking ref unpushed counts after verified', async () => {
    await create(agent(), 'B');
    await clearLocalState(agentWc(), 'upstream');
    await git(['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: agentWc() });
    const verified = await revParse(agentWc(), 'HEAD^');
    await writeLocalState(agentWc(), 'verified', verified);
    expect((await syncStatus(agent())).unpushed).toBe(1);
    await clearLocalState(agentWc(), 'verified');
    const { stdout } = await git(['rev-list', '--count', 'HEAD'], { cwd: agentWc() });
    expect((await syncStatus(agent())).unpushed).toBe(Number(stdout.trim()));
  });

  test('a working copy without remote has no unpushed commits', async () => {
    const solo = await testBacklog();
    const ctx = await solo.context();
    await create(ctx, 'A');
    expect(await syncStatus(ctx)).toMatchObject({ remote: undefined, unpushed: 0 });
  });

  test('running shows a live holder of sync.lock', async () => {
    await writeFile(await state('sync.lock'), `${process.pid}\n${new Date().toISOString()}\n`);
    expect((await syncStatus(agent())).running).toBe(true);
    await writeFile(
      await state('sync.lock'),
      `999999\n${new Date().toISOString()}\n${hostname()}\n`,
    );
    expect((await syncStatus(agent(), { lock: { isAlive: () => false } })).running).toBe(false);
    await rm(await state('sync.lock'));
    expect((await syncStatus(agent())).running).toBe(false);
  });

  test('state, mode and conflicts come from the working copy', async () => {
    await writeSyncState(agentWc(), {
      last_attempt: '2026-11-20T08:00:00Z',
      last_error: { code: 'sync', message: 'x', at: '2026-11-20T08:00:00Z' },
    });
    const entry: ConflictEntry = {
      version: 1,
      id: '20261120T080000Z-abcdef',
      created: '2026-11-20T08:00:00Z',
      onto: 'a'.repeat(40),
      reason: { code: 'conflict', message: 'weg' },
      units: [],
    };
    await writeConflicts(agentWc(), [entry]);

    const s = await syncStatus(manual(agent()));

    expect(s.mode).toBe('manual');
    expect(s.state.last_error?.message).toBe('x');
    expect(s.conflicts.map((c) => c.id)).toEqual([entry.id]);
  });

  test('without working copy the status is a usage error', async () => {
    const ctx: ResolvedContext = {
      ...agent(),
      backlog: { ...agent().backlog, workingCopy: undefined },
    };
    expect((await catchErrAsync(() => syncStatus(ctx))).code).toBe('usage');
  });

  test('a working copy not yet cloned is not found', async () => {
    const dir = join(await tempDir(), 'missing');
    const ctx: ResolvedContext = { ...agent(), backlog: { ...agent().backlog, workingCopy: dir } };
    expect((await catchErrAsync(() => syncStatus(ctx))).code).toBe('not_found');
  });

  test('a working copy whose HEAD has no backlog config is a validation error', async () => {
    const dir = await uncommittedBacklog();
    const ctx: ResolvedContext = { ...agent(), backlog: { ...agent().backlog, workingCopy: dir } };
    expect((await catchErrAsync(() => syncStatus(ctx))).code).toBe('validation');
  });
});

describe('statusLine', () => {
  const status = (o: {
    unpushed?: number;
    mode?: 'auto' | 'manual';
    conflicts?: number;
    lastError?: string;
    remote?: string | undefined;
  }): SyncStatus => ({
    remote: 'remote' in o ? o.remote : '/r.git',
    mode: o.mode ?? 'auto',
    unpushed: o.unpushed ?? 0,
    running: false,
    state:
      o.lastError === undefined
        ? {}
        : { last_error: { code: 'sync', message: o.lastError, at: '2026-11-20T08:00:00Z' } },
    conflicts: Array.from({ length: o.conflicts ?? 0 }, (_, i) => ({
      version: 1 as const,
      id: `20261120T080000Z-00000${i}`,
      created: '2026-11-20T08:00:00Z',
      onto: 'a'.repeat(40),
      reason: { code: 'conflict', message: 'x' },
      units: [],
    })),
  });

  test('statusLine shows conflicts, failures and unpushed only when relevant', () => {
    expect(statusLine(status({ unpushed: 2, mode: 'auto' }))).toBeUndefined();
    expect(statusLine(status({ unpushed: 2, mode: 'manual', conflicts: 1 }))).toBe(
      'Sync: 2 ungepusht · 1 Konflikt',
    );
    expect(
      statusLine(status({ lastError: 'Fetch von origin fehlgeschlagen: x', unpushed: 1 })),
    ).toBe('Sync: 1 ungepusht · letzter Sync fehlgeschlagen: Fetch von origin fehlgeschlagen: x');
  });

  test('several conflicts are plural, manual without anything open is silent', () => {
    expect(statusLine(status({ conflicts: 3 }))).toBe('Sync: 3 Konflikte');
    expect(statusLine(status({ mode: 'manual' }))).toBeUndefined();
  });

  test('without remote unpushed does not count', () => {
    expect(statusLine(status({ remote: undefined, unpushed: 2, mode: 'manual' }))).toBeUndefined();
  });
});

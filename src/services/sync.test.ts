/**
 * Die Sync-Runde (backe.md §2.16.2) mit zwei Arbeitskopien in einem Prozess: `spw` und der Agent
 * `claude-1` teilen ein bares Remote. Reihenfolge und Pausen steuern `SyncHooks` und ein
 * injiziertes `sleep`; gewartet wird nie wirklich.
 */
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import {
  rawCommit,
  revParse,
  statusShort,
  testBacklog,
  testKey,
  twoClones,
} from '../../test/helpers/git.ts';
import { seqBytes } from '../../test/helpers/snapshot.ts';
import { managedClonePath, setIdentity } from '../context/registry.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { EXIT_CODES } from '../core/errors.ts';
import { BacklogConfigSchema } from '../core/schemas.ts';
import { git } from '../git/exec.ts';
import { clearLocalState, readLocalState } from '../git/local-state.ts';
import type { Operation } from '../ops/operation.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG, issueFile } from '../store/layout.ts';
import { effectiveMode, type SyncDeps, syncNow, syncRemote } from './sync.ts';
import { listConflicts, readSyncState } from './sync-state.ts';
import { executeWrite } from './write.ts';

let t: Awaited<ReturnType<typeof twoClones>>;
let sleeps: number[];
const NOW = new Date('2026-11-20T08:00:00Z');

beforeEach(async () => {
  t = await twoClones();
  sleeps = [];
});

const deps = (extra: SyncDeps = {}): SyncDeps => ({
  now: () => NOW,
  sleep: async (ms) => {
    sleeps.push(ms);
  },
  ...extra,
});

const spw = () => t.spw.ctx;
const agent = () => t.agent.ctx;
const agentWc = () => t.agent.wc;

async function write(ctx: ResolvedContext, op: Operation): Promise<string> {
  const r = await executeWrite(ctx, { kind: 'op', op });
  return (r.recorded[0] as { id: string }).id;
}

const create = (ctx: ResolvedContext, title: string) => write(ctx, { op: 'issue.create', title });

const setTitle = (id: string, from: string, to: string): Operation => ({
  op: 'issue.edit',
  id,
  set: { title: { from, to } },
});

async function pushSpw(): Promise<void> {
  await git(['push', '-q', 'origin', 'main'], { cwd: t.spw.root });
}

const remoteHead = () => revParse(t.remote, 'refs/heads/main');

/** Ein Issue, das beide Arbeitskopien schon haben. */
async function sharedIssue(title = 'A'): Promise<string> {
  const id = await create(spw(), title);
  await pushSpw();
  await syncNow(agent(), deps());
  return id;
}

async function count(wc: string, range: string): Promise<number> {
  const { stdout } = await git(['rev-list', '--count', range], { cwd: wc });
  return Number(stdout.trim());
}

test('a round fast-forwards when only the remote moved', async () => {
  await create(spw(), 'A');
  await pushSpw();
  const tip = await revParse(t.spw.root, 'HEAD');

  const r = await syncNow(agent(), deps());

  expect(r).toEqual({
    fetched: 1,
    replayed: 0,
    conflicts: [],
    pushed: undefined,
    rounds: 1,
    notices: [],
  });
  expect(await revParse(agentWc(), 'HEAD')).toBe(tip);
  expect(await statusShort(agentWc())).toEqual([]);
  for (const name of ['upstream', 'verified', 'clean'] as const) {
    expect(await readLocalState(agentWc(), name)).toBe(tip);
  }
  expect(await readSyncState(agentWc())).toEqual({
    last_attempt: '2026-11-20T08:00:00Z',
    last_success: '2026-11-20T08:00:00Z',
  });
});

test('a round pushes local commits when the remote did not move', async () => {
  await create(agent(), 'B');
  const head = await revParse(agentWc(), 'HEAD');

  const r = await syncNow(agent(), deps());

  expect(r).toMatchObject({ fetched: 0, replayed: 0, pushed: head, rounds: 1 });
  expect(await remoteHead()).toBe(head);
  expect(await readLocalState(agentWc(), 'upstream')).toBe(head);
  expect(await revParse(agentWc(), 'refs/remotes/origin/main')).toBe(head);
});

test('a round replays local commits onto a moved remote and pushes', async () => {
  const a = await create(spw(), 'A');
  await pushSpw();
  const tip = await revParse(t.spw.root, 'HEAD');
  const b = await create(agent(), 'B');
  const before = await revParse(agentWc(), 'HEAD');

  const r = await syncNow(agent(), deps());

  const head = await revParse(agentWc(), 'HEAD');
  expect(r).toMatchObject({ fetched: 1, replayed: 1, conflicts: [], pushed: head, rounds: 1 });
  expect(head).not.toBe(before);
  expect(await revParse(agentWc(), 'HEAD^')).toBe(tip);
  expect(await remoteHead()).toBe(head);
  await readFile(join(agentWc(), issueFile(a)));
  await readFile(join(agentWc(), issueFile(b)));
  expect(await statusShort(agentWc())).toEqual([]);
});

test('hand edits on untouched paths survive a round', async () => {
  const x = await sharedIssue('X');
  const y = await sharedIssue('Y');
  const path = join(agentWc(), issueFile(x));
  const edited = `${await readFile(path, 'utf8')}\nvon Hand\n`;
  await writeFile(path, edited);
  // Ein lokaler Commit erzwingt das Replay; der Hand-Edit liegt daneben.
  await create(agent(), 'Z');
  await write(spw(), setTitle(y, 'Y', 'Y2'));
  await pushSpw();

  const r = await syncNow(agent(), deps());

  expect(r).toMatchObject({ replayed: 1, rounds: 1 });
  expect(await readFile(path, 'utf8')).toBe(edited);
  expect(await statusShort(agentWc())).toEqual([` M ${issueFile(x)}`]);
  expect(await remoteHead()).toBe(await revParse(agentWc(), 'HEAD'));
});

test('a hand edit on an incoming path stops the round untouched', async () => {
  const x = await sharedIssue('X');
  const path = issueFile(x);
  const edited = `${await readFile(join(agentWc(), path), 'utf8')}\nvon Hand\n`;
  await writeFile(join(agentWc(), path), edited);
  await write(spw(), setTitle(x, 'X', 'X2'));
  await pushSpw();
  const headBefore = await revParse(agentWc(), 'HEAD');

  const err = await catchErrAsync(() => syncNow(agent(), deps()));

  expect(err.code).toBe('conflict');
  expect(err.message).toBe(`Ungesicherte Änderungen an ${path} verhindern den Sync`);
  expect(err.hint).toBe(`backe commit oder git -C ${agentWc()} stash`);
  expect(await revParse(agentWc(), 'HEAD')).toBe(headBefore);
  expect(await readFile(join(agentWc(), path), 'utf8')).toBe(edited);
  const state = await readSyncState(agentWc());
  expect(state.last_error?.paths).toEqual([path]);
  expect(state.last_error).toMatchObject({ code: 'conflict', at: '2026-11-20T08:00:00Z' });
  expect(state.last_success).toBeDefined(); // vom Sync in sharedIssue
});

test('a push rejected by a faster client retries after replay', async () => {
  await create(spw(), 'A');
  await create(agent(), 'B');
  let agentPushed: string | undefined;

  const r = await syncNow(
    spw(),
    deps({
      hooks: {
        beforePush: async (round) => {
          if (round === 1) agentPushed = (await syncNow(agent(), deps())).pushed;
        },
      },
    }),
  );

  expect(r).toMatchObject({ rounds: 2, replayed: 1, fetched: 1 });
  expect(sleeps).toEqual([200]);
  const head = await revParse(t.spw.root, 'HEAD');
  expect(r.pushed).toBe(head);
  expect(await revParse(t.spw.root, 'HEAD^')).toBe(agentPushed);
  expect(await remoteHead()).toBe(head);
});

test('five rejected pushes end with sync', async () => {
  await create(spw(), 'A');
  let n = 0;

  const err = await catchErrAsync(() =>
    syncNow(
      spw(),
      deps({
        hooks: {
          beforePush: async () => {
            await create(agent(), `B${++n}`);
            await syncNow(agent(), deps({ sleep: async () => {} }));
          },
        },
      }),
    ),
  );

  expect(err).toMatchObject({ code: 'sync', message: 'Push nach 5 Runden abgelehnt' });
  expect(sleeps).toEqual([200, 400, 800, 1600]);
  expect(n).toBe(5);
  expect((await readSyncState(t.spw.root)).last_error).toMatchObject({
    code: 'sync',
    message: 'Push nach 5 Runden abgelehnt',
  });
});

test('an unreachable remote fails with sync and keeps local writes', async () => {
  await create(agent(), 'B1');
  const head = await revParse(agentWc(), 'HEAD');
  await git(['remote', 'set-url', 'origin', join(t.remote, 'gone.git')], { cwd: agentWc() });

  const err = await catchErrAsync(() => syncNow(agent(), deps()));

  expect(err.code).toBe('sync');
  expect(err.message).toMatch(/^Fetch von origin fehlgeschlagen: /);
  expect(await revParse(agentWc(), 'HEAD')).toBe(head);
  expect((await readSyncState(agentWc())).last_error).toMatchObject({
    code: 'sync',
    at: '2026-11-20T08:00:00Z',
  });

  await create(agent(), 'B2');
  await git(['remote', 'set-url', 'origin', t.remote], { cwd: agentWc() });
  const r = await syncNow(agent(), deps());

  expect(r.pushed).toBe(await revParse(agentWc(), 'HEAD'));
  expect(await count(t.remote, 'main')).toBe(await count(agentWc(), 'HEAD'));
  const state = await readSyncState(agentWc());
  expect(state.last_error).toBeUndefined();
  expect(state.last_success).toBe('2026-11-20T08:00:00Z');
});

test('a failed push keeps the replayed commits for the next round', async () => {
  await create(spw(), 'A');
  await pushSpw();
  const tip = await revParse(t.spw.root, 'HEAD');
  await create(agent(), 'B');
  const hook = join(t.remote, 'hooks', 'pre-receive');
  await writeFile(hook, '#!/bin/sh\necho abgelehnt >&2\nexit 1\n');
  await chmod(hook, 0o755);

  const err = await catchErrAsync(() => syncNow(agent(), deps()));

  expect(err.code).toBe('sync');
  expect(err.message).toMatch(/^Push nach origin fehlgeschlagen: /);
  expect(sleeps).toEqual([]);
  const replayed = await revParse(agentWc(), 'HEAD');
  expect(await revParse(agentWc(), 'HEAD^')).toBe(tip);
  expect(await statusShort(agentWc())).toEqual([]);
  expect(await readLocalState(agentWc(), 'upstream')).toBe(tip);

  await rm(hook);
  const r = await syncNow(agent(), deps());

  expect(r).toMatchObject({ fetched: 0, replayed: 0, pushed: replayed });
  expect(await remoteHead()).toBe(replayed);
});

test('a force-pushed remote is refused', async () => {
  await create(spw(), 'A');
  await pushSpw();
  await syncNow(agent(), deps());
  const upstream = await readLocalState(agentWc(), 'upstream');
  await git(['reset', '-q', '--hard', 'HEAD~1'], { cwd: t.spw.root });
  await create(spw(), 'A2');
  await git(['push', '-q', '-f', 'origin', 'main'], { cwd: t.spw.root });
  await create(agent(), 'B');
  const head = await revParse(agentWc(), 'HEAD');

  const err = await catchErrAsync(() => syncNow(agent(), deps()));

  expect(err.code).toBe('verify');
  expect(EXIT_CODES[err.code]).toBe(5);
  expect(await readLocalState(agentWc(), 'upstream')).toBe(upstream);
  expect(await revParse(agentWc(), 'HEAD')).toBe(head);
  expect((await readSyncState(agentWc())).last_error?.code).toBe('verify');
});

test('a remote with a foreign root commit is refused', async () => {
  const other = await testBacklog({ remote: true });
  await git(['push', '-q', '-f', other.remote as string, 'main'], { cwd: other.root });
  await git(['remote', 'set-url', 'origin', other.remote as string], { cwd: agentWc() });
  const head = await revParse(agentWc(), 'HEAD');

  const err = await catchErrAsync(() => syncNow(agent(), deps()));

  expect(err.code).toBe('verify');
  expect(await revParse(agentWc(), 'HEAD')).toBe(head);
});

/** Ein gültiger Admin-Commit von spw setzt `verify` in der Backlog-Config. */
async function setVerify(mode: 'warn' | 'off'): Promise<void> {
  const config = await readFile(join(t.spw.root, BACKLOG_CONFIG), 'utf8');
  await executeWrite(spw(), {
    kind: 'manual',
    subject: `verify: ${mode}`,
    changes: [
      {
        path: BACKLOG_CONFIG,
        content: config.replace(/\n}\n$/, `,\n  "verify": "${mode}"\n}\n`),
      },
    ],
  });
}

describe('invalid incoming commits', () => {
  test('an invalid incoming commit in warn mode is reported and taken', async () => {
    await setVerify('warn');
    await pushSpw();
    await syncNow(agent(), deps());
    const clean = await readLocalState(agentWc(), 'clean');
    const bad = await rawCommit(t.spw.root, {
      files: { 'notes.md': 'x\n' },
      actor: 'spw',
      op: 'manual',
    });
    await pushSpw();

    const r = await syncNow(agent(), deps());

    expect(r.notices).toEqual([`${bad.slice(0, 7)}: unsigniert`]);
    expect(await revParse(agentWc(), 'HEAD')).toBe(bad);
    expect(await readLocalState(agentWc(), 'upstream')).toBe(bad);
    expect(await readLocalState(agentWc(), 'clean')).toBe(clean);
  });

  test('in off mode an invalid incoming commit is taken silently', async () => {
    await setVerify('off');
    await pushSpw();
    await syncNow(agent(), deps());
    const bad = await rawCommit(t.spw.root, { files: { 'notes.md': 'x\n' } });
    await pushSpw();

    const r = await syncNow(agent(), deps());

    expect(r.notices).toEqual([]);
    expect(await revParse(agentWc(), 'HEAD')).toBe(bad);
  });

  test('in strict mode an invalid incoming commit stops the round', async () => {
    const before = await revParse(agentWc(), 'HEAD');
    const upstream = await readLocalState(agentWc(), 'upstream');
    await rawCommit(t.spw.root, { files: { 'notes.md': 'x\n' }, actor: 'spw', op: 'manual' });
    await pushSpw();

    const err = await catchErrAsync(() => syncNow(agent(), deps()));

    expect(err.code).toBe('verify');
    expect(await revParse(agentWc(), 'HEAD')).toBe(before);
    expect(await readLocalState(agentWc(), 'upstream')).toBe(upstream);
  });
});

test('a foreign local commit blocks the sync', async () => {
  const bad = await rawCommit(agentWc(), { files: { 'notes.md': 'x\n' } });

  const err = await catchErrAsync(() => syncNow(agent(), deps()));

  expect(err).toMatchObject({
    code: 'verify',
    message: `Lokaler Commit ${bad.slice(0, 7)} ist nicht von backe signiert`,
  });
  expect(await remoteHead()).not.toBe(bad);
});

test('a manual text conflict stops the round and records the commit', async () => {
  const notes = (text: string) => ({ path: 'notes.md', content: text });
  await executeWrite(spw(), { kind: 'manual', subject: 'notes', changes: [notes('a\n')] });
  await pushSpw();
  await syncNow(agent(), deps());
  await executeWrite(spw(), { kind: 'manual', subject: 'remote', changes: [notes('remote\n')] });
  await pushSpw();
  await executeWrite(agent(), { kind: 'manual', subject: 'lokal', changes: [notes('lokal\n')] });
  const head = await revParse(agentWc(), 'HEAD');

  const err = await catchErrAsync(() => syncNow(agent(), deps()));

  expect(err.code).toBe('conflict');
  expect(await revParse(agentWc(), 'HEAD')).toBe(head);
  expect((await readSyncState(agentWc())).last_error).toMatchObject({
    code: 'conflict',
    commit: head,
    paths: ['notes.md'],
  });
});

test('a violated unit goes to the conflict store and the rest is pushed', async () => {
  const x = await sharedIssue('X');
  await write(spw(), setTitle(x, 'X', 'Remote'));
  await pushSpw();
  await write(agent(), setTitle(x, 'X', 'Lokal'));
  await create(agent(), 'B');

  const r = await syncNow(agent(), deps({ randomBytes: (n) => new Uint8Array(n).fill(1) }));

  const stored = await listConflicts(agentWc());
  expect(r.conflicts).toEqual(stored.map((e) => e.id));
  expect(r.conflicts).toEqual(['20261120T080000Z-010101']);
  expect(r).toMatchObject({ replayed: 1, pushed: await revParse(agentWc(), 'HEAD') });
});

test('the claim unit lost in replay comes back as claimLost', async () => {
  const x = await sharedIssue('X');
  await write(spw(), { op: 'issue.claim', id: x });
  await pushSpw();
  await write(agent(), { op: 'issue.claim', id: x });
  const claimSha = await revParse(agentWc(), 'HEAD');

  const r = await syncNow(agent(), deps(), { claimSha });

  expect(r.claimLost?.id).toBe(x);
  expect(r.claimLost?.error.code).toBe('conflict');
  expect(r.pushed).toBeUndefined();
  expect(await revParse(agentWc(), 'HEAD')).toBe(await remoteHead());
});

test('an empty remote branch gets HEAD pushed', async () => {
  const fresh = join(t.remote, '..', 'fresh.git');
  await git(['init', '--bare', '-q', '-b', 'main', fresh], { cwd: t.remote });
  await git(['remote', 'set-url', 'origin', fresh], { cwd: t.spw.root });
  await create(spw(), 'A');

  const r = await syncNow(spw(), deps());

  expect(r).toMatchObject({ fetched: 0, pushed: await revParse(t.spw.root, 'HEAD') });
  expect(await revParse(fresh, 'refs/heads/main')).toBe(r.pushed);
});

test('a working copy without remote skips', async () => {
  const solo = await testBacklog();
  expect(await syncNow(await solo.context(), deps())).toMatchObject({
    skipped: 'no_remote',
    rounds: 0,
  });
  expect(await readSyncState(solo.root)).toEqual({});
});

test('hooks see each round', async () => {
  const seen: string[] = [];
  await create(agent(), 'B');
  await syncNow(
    agent(),
    deps({
      hooks: {
        afterFetch: async (round) => {
          seen.push(`fetch ${round}`);
        },
        beforePush: async (round) => {
          seen.push(`push ${round}`);
        },
        afterRound: async () => {
          seen.push('round');
        },
      },
    }),
  );
  expect(seen).toEqual(['fetch 1', 'push 1', 'round']);
});

test('syncRemote names the url of a git remote', async () => {
  expect(await syncRemote(agentWc(), 'origin')).toBe(t.remote);
  expect(await syncRemote(agentWc(), 'upstream')).toBeUndefined();
});

test('effectiveMode prefers the user config', async () => {
  const text = await readFile(join(t.spw.root, BACKLOG_CONFIG), 'utf8');
  const config = BacklogConfigSchema.parse(readJsonc(text, BACKLOG_CONFIG));
  expect(effectiveMode(spw(), config)).toBe('auto');
  expect(effectiveMode(spw(), { ...config, sync: { ...config.sync, mode: 'manual' } })).toBe(
    'manual',
  );
  const ctx: ResolvedContext = {
    ...spw(),
    userConfig: {
      ...spw().userConfig,
      backlogs: { acme: { ...spw().userConfig.backlogs?.acme, sync: { mode: 'manual' } } },
    },
  };
  expect(effectiveMode(ctx, config)).toBe('manual');
});

test('a round with nothing to do changes nothing', async () => {
  await syncNow(agent(), deps());
  const head = await revParse(agentWc(), 'HEAD');

  const r = await syncNow(agent(), deps());

  expect(r).toMatchObject({ fetched: 0, replayed: 0, pushed: undefined, rounds: 1 });
  expect(await revParse(agentWc(), 'HEAD')).toBe(head);
});

test('without upstream the incoming state only has to descend from the anchor', async () => {
  await clearLocalState(agentWc(), 'upstream');
  await create(spw(), 'A');
  await pushSpw();

  await syncNow(agent(), deps());

  expect(await readLocalState(agentWc(), 'upstream')).toBe(await revParse(t.spw.root, 'HEAD'));
});

test('an identity without working copy is cloned first', async () => {
  const key = await testKey('claude-2');
  await write(spw(), {
    op: 'user.add',
    handle: 'claude-2',
    name: 'Claude 2',
    kind: 'agent',
    operator: 'spw',
    keys: [key.line],
  });
  await syncNow(spw(), deps());
  await setIdentity(t.spw.homes, 'acme', 'claude-2', key.priv);
  const ctx = await t.spw.context({ as: 'claude-2', backlog: 'acme' });

  const r = await syncNow(ctx, deps());

  expect(r).toMatchObject({ fetched: 0, pushed: undefined, rounds: 1 });
  expect(await revParse(managedClonePath(t.spw.homes, 'acme', 'claude-2'), 'HEAD')).toBe(
    await remoteHead(),
  );
});

test('an id collision in the replay is reported as a notice', async () => {
  await executeWrite(
    spw(),
    { kind: 'op', op: { op: 'issue.create', title: 'remote' } },
    { randomBytes: seqBytes() },
  );
  await pushSpw();
  const mine = await executeWrite(
    agent(),
    { kind: 'op', op: { op: 'issue.create', title: 'lokal' } },
    { randomBytes: seqBytes() },
  );
  const id = (mine.recorded[0] as { id: string }).id;

  const r = await syncNow(agent(), deps({ randomBytes: seqBytes(100) }));

  expect(r.notices).toEqual([
    expect.stringMatching(new RegExp(`^ID-Kollision: ${id} heißt jetzt `)),
  ]);
  expect(r.pushed).toBe(await remoteHead());
});

test('a manual text conflict can be resolved by the resolver', async () => {
  const notes = (text: string) => ({ path: 'notes.md', content: text });
  await executeWrite(spw(), { kind: 'manual', subject: 'notes', changes: [notes('a\n')] });
  await pushSpw();
  await syncNow(agent(), deps());
  await executeWrite(spw(), { kind: 'manual', subject: 'remote', changes: [notes('remote\n')] });
  await pushSpw();
  await executeWrite(agent(), { kind: 'manual', subject: 'lokal', changes: [notes('lokal\n')] });

  const r = await syncNow(agent(), deps({ resolveManual: async () => ({ kind: 'local' }) }));

  expect(r).toMatchObject({ replayed: 1, pushed: await remoteHead() });
  expect(await readFile(join(agentWc(), 'notes.md'), 'utf8')).toBe('lokal\n');
});

const lfs = (await git(['lfs', 'version'], { cwd: '/' }).then(
  () => true,
  () => false,
)) as boolean;

describe('with attachments.lfs', () => {
  test.skipIf(!lfs)('a round pulls after moving and pushes LFS objects first', async () => {
    const config = await readFile(join(t.spw.root, BACKLOG_CONFIG), 'utf8');
    await executeWrite(spw(), {
      kind: 'manual',
      subject: 'lfs an',
      changes: [
        {
          path: BACKLOG_CONFIG,
          content: config.replace(/\n}\n$/, ',\n  "attachments": { "lfs": true }\n}\n'),
        },
      ],
    });
    await pushSpw();

    expect((await syncNow(agent(), deps())).notices).toEqual([]);
    await create(agent(), 'B');
    const r = await syncNow(agent(), deps());

    expect(r.pushed).toBe(await remoteHead());
  });
});

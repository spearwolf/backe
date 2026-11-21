/**
 * Der synchrone Claim (backe.md §2.16.5) mit zwei Arbeitskopien in einem Prozess: `spw` und der
 * Agent `claude-1` teilen ein bares Remote. Die Reihenfolge der beiden Clients steuert
 * `SyncHooks.beforePush`; gewartet wird nie wirklich.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { writeOp } from '../../test/helpers/context.ts';
import { revParse, testBacklog, testKey, twoClones } from '../../test/helpers/git.ts';
import { setIdentity } from '../context/registry.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { git } from '../git/exec.ts';
import { parseCommitMessage, TRAILER_OP } from '../git/message.ts';
import { exists } from '../store/files.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { loadSnapshot } from '../store/snapshot.ts';
import { runBackground } from './background.ts';
import { claimIssue, nextClaim } from './claim.ts';
import type { SyncDeps } from './sync.ts';
import { syncNow } from './sync.ts';
import { listConflicts, syncFile } from './sync-state.ts';
import { executeWrite } from './write.ts';

let t: Awaited<ReturnType<typeof twoClones>>;

beforeEach(async () => {
  t = await twoClones();
});

const noSleep: SyncDeps = { sleep: async () => {} };
const spw = () => t.spw.ctx;
const agent = () => t.agent.ctx;

const create = (ctx: ResolvedContext, title: string) => writeOp(ctx, { op: 'issue.create', title });

/** Issues, die beide Arbeitskopien schon haben. */
async function shared(...titles: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const title of titles) ids.push(await create(spw(), title));
  await syncNow(spw(), noSleep);
  await syncNow(agent(), noSleep);
  return ids;
}

/** Die `issue.claim`-Operation des Commits `sha`, sonst `undefined`. */
async function claimOf(wc: string, sha: string): Promise<string | undefined> {
  const { stdout } = await git(['log', '-1', '--format=%B', sha], { cwd: wc });
  const op = parseCommitMessage(stdout).trailers.get(TRAILER_OP)?.[0];
  if (op === undefined || !op.startsWith('{')) return undefined;
  const parsed = JSON.parse(op) as { op: string; id: string };
  return parsed.op === 'issue.claim' ? parsed.id : undefined;
}

/** Claim-Commits auf `rev`, neueste zuerst, je `<actor> <id>`. */
async function claims(wc: string, rev = 'HEAD'): Promise<string[]> {
  const { stdout } = await git(['log', '--format=%H', rev], { cwd: wc });
  const out: string[] = [];
  for (const sha of stdout.split('\n').filter((l) => l !== '')) {
    const id = await claimOf(wc, sha);
    if (id === undefined) continue;
    const { stdout: actor } = await git(
      ['log', '-1', '--format=%(trailers:key=Backe-Actor,valueonly)', sha],
      { cwd: wc },
    );
    out.push(`${actor.trim()} ${id}`);
  }
  return out;
}

const issueOf = async (wc: string, id: string) => (await loadSnapshot(wc)).issues.get(id)?.data;

describe('claimIssue', () => {
  test('parallel claim from two clones has exactly one winner', async () => {
    const [x] = (await shared('X')) as [string];
    let reached!: () => void;
    const atPush = new Promise<void>((r) => {
      reached = r;
    });
    let release!: () => void;
    const go = new Promise<void>((r) => {
      release = r;
    });
    let paused = false;
    const spwDeps: SyncDeps = {
      ...noSleep,
      hooks: {
        beforePush: async (_round, sha) => {
          if (paused || (await claimOf(t.spw.root, sha)) === undefined) return;
          paused = true;
          // Ein eigener Write zwischen Claim und Push: Er muss den verlorenen Claim überleben.
          await create(spw(), 'Danach');
          reached();
          await go;
        },
      },
    };

    const a = claimIssue(spw(), x, spwDeps);
    await atPush;
    const b = claimIssue(agent(), x, noSleep).finally(release);
    const [ra, rb] = await Promise.allSettled([a, b]);

    expect([ra.status, rb.status]).toEqual(['rejected', 'fulfilled']);
    const reason = (ra as PromiseRejectedResult).reason;
    expect(reason).toMatchObject({
      code: 'conflict',
      message: `${x} wurde inzwischen von claude-1 übernommen`,
    });
    expect(await claims(t.remote, 'refs/heads/main')).toEqual([`claude-1 ${x}`]);
    expect(await claims(t.spw.root)).toEqual([`claude-1 ${x}`]);
    const titles = [...(await loadSnapshot(t.spw.root)).issues.values()].map((i) => i.data.title);
    expect(titles.sort()).toEqual(['Danach', 'X']);
    expect(await revParse(t.remote, 'refs/heads/main')).toBe(await revParse(t.spw.root, 'HEAD'));
    expect(await issueOf(t.spw.root, x)).toMatchObject({
      state: 'in_progress',
      assignee: 'claude-1',
    });
  });

  test('a winning claim is pushed as the last commit', async () => {
    const [x] = (await shared('X')) as [string];

    const r = await claimIssue(agent(), x.slice(0, 6), noSleep);

    expect(r).toMatchObject({ id: x, op: { op: 'issue.claim', id: x } });
    expect(r.local).toBeUndefined();
    expect(r.pushed).toBe(await revParse(t.remote, 'refs/heads/main'));
    expect(r.commit).toBe(r.pushed);
    expect(await claimOf(t.agent.wc, r.pushed as string)).toBe(x);
  });

  test('a claim that has to be replayed is still pushed', async () => {
    const [x] = (await shared('X')) as [string];
    let moved = false;
    const r = await claimIssue(agent(), x, {
      ...noSleep,
      hooks: {
        beforePush: async (_round, sha) => {
          if (moved || (await claimOf(t.agent.wc, sha)) === undefined) return;
          moved = true;
          await create(spw(), 'Y');
          await syncNow(spw(), noSleep);
        },
      },
    });

    expect(r.pushed).toBe(await revParse(t.remote, 'refs/heads/main'));
    expect(r.commit).toBe(r.pushed);
    expect(await claims(t.remote, 'refs/heads/main')).toEqual([`claude-1 ${x}`]);
  });

  test('a claim replayed without effect while other commits are pushed is checked on the remote', async () => {
    const [x] = (await shared('X')) as [string];
    let raced = false;
    const deps: SyncDeps = {
      ...noSleep,
      hooks: {
        beforePush: async () => {
          if (raced) return;
          raced = true;
          // Inzwischen steht X auf dem Remote schon in_progress mit claude-1; dazu ein lokaler Commit.
          await executeWrite(spw(), {
            kind: 'batch',
            ops: [
              { op: 'issue.edit', id: x, set: { assignee: { from: null, to: 'claude-1' } } },
              { op: 'issue.move', id: x, from: 'backlog', to: 'in_progress' },
            ],
          });
          await syncNow(spw(), noSleep);
          await create(agent(), 'B');
        },
      },
    };

    const r = await claimIssue(agent(), x, deps);

    expect(r.pushed).toBe(await revParse(t.remote, 'refs/heads/main'));
    expect(r.commit).toBeUndefined();
    expect(await claims(t.remote, 'refs/heads/main')).toEqual([]);
    expect(await issueOf(t.agent.wc, x)).toMatchObject({
      state: 'in_progress',
      assignee: 'claude-1',
    });
  });

  test('a claim dropped in the replay reports no commit outside HEAD', async () => {
    const [x] = (await shared('X')) as [string];
    let raced = false;
    const deps: SyncDeps = {
      ...noSleep,
      hooks: {
        beforePush: async () => {
          if (raced) return;
          raced = true;
          // Ein paralleler, gleich wirkender Claim gewinnt: X steht in_progress mit claude-1.
          await executeWrite(spw(), {
            kind: 'batch',
            ops: [
              { op: 'issue.edit', id: x, set: { assignee: { from: null, to: 'claude-1' } } },
              { op: 'issue.move', id: x, from: 'backlog', to: 'in_progress' },
            ],
          });
          await syncNow(spw(), noSleep);
        },
      },
    };

    const r = await claimIssue(agent(), x, deps);

    const head = await revParse(t.agent.wc, 'HEAD');
    expect(head).toBe(await revParse(t.remote, 'refs/heads/main'));
    expect(r.pushed).toBeUndefined();
    expect(r.commit).toBeUndefined();
    expect(await issueOf(t.agent.wc, x)).toMatchObject({
      state: 'in_progress',
      assignee: 'claude-1',
    });
  });

  test('a claim waits minutes for a background round holding sync.lock', async () => {
    const [x] = (await shared('X')) as [string];
    let offset = 0;
    const now = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
    try {
      await writeFile(
        await syncFile(t.agent.wc, 'sync.lock'),
        `${process.pid}\n${new Date().toISOString()}\n`,
      );
      const isAlive = () => {
        offset += 60_000;
        return offset < 240_000;
      };

      const r = await claimIssue(agent(), x, { ...noSleep, lock: { retryMs: 1, isAlive } });

      expect(offset).toBeGreaterThanOrEqual(240_000);
      expect(r.pushed).toBe(await revParse(t.remote, 'refs/heads/main'));
    } finally {
      vi.restoreAllMocks();
    }
  });

  test('the blocking sync brings a claim of someone else first', async () => {
    const [x] = (await shared('X')) as [string];
    await writeOp(spw(), { op: 'issue.claim', id: x });
    await syncNow(spw(), noSleep);

    const err = await catchErrAsync(() => claimIssue(agent(), x, noSleep));

    expect(err.code).toBe('conflict');
    expect(await claims(t.agent.wc)).toEqual([`spw ${x}`]);
  });

  test('a failing blocking sync claims nothing', async () => {
    const [x] = (await shared('X')) as [string];
    await git(['remote', 'set-url', 'origin', join(t.remote, 'gone.git')], { cwd: t.agent.wc });
    const head = await revParse(t.agent.wc, 'HEAD');

    const err = await catchErrAsync(() => claimIssue(agent(), x, noSleep));

    expect(err.code).toBe('sync');
    expect(await revParse(t.agent.wc, 'HEAD')).toBe(head);
  });

  test('claim from backlog works with workflow.strict', async () => {
    const config = await readFile(join(t.spw.root, BACKLOG_CONFIG), 'utf8');
    await executeWrite(spw(), {
      kind: 'manual',
      subject: 'strict',
      changes: [
        {
          path: BACKLOG_CONFIG,
          content: config.replace(/\n}\n$/, ',\n  "workflow": { "strict": true }\n}\n'),
        },
      ],
    });
    const x = await create(spw(), 'X');
    expect((await issueOf(t.spw.root, x))?.state).toBe('backlog');

    const r = await claimIssue(spw(), x, noSleep);

    expect(r.pushed).toBe(await revParse(t.remote, 'refs/heads/main'));
    expect(await issueOf(t.spw.root, x)).toMatchObject({ state: 'in_progress', assignee: 'spw' });
  });

  test('claiming my own in_progress issue is unchanged without push', async () => {
    const [x] = (await shared('X')) as [string];
    await claimIssue(agent(), x, noSleep);
    const remote = await revParse(t.remote, 'refs/heads/main');
    let pushes = 0;

    const r = await claimIssue(agent(), x, {
      ...noSleep,
      hooks: {
        beforePush: async () => {
          pushes++;
        },
      },
    });

    expect(r).toMatchObject({ commit: undefined, id: x });
    expect(r.pushed).toBeUndefined();
    expect(pushes).toBe(0);
    expect(await revParse(t.remote, 'refs/heads/main')).toBe(remote);
  });

  test('claim without remote is local with a notice', async () => {
    const solo = await testBacklog();
    const ctx = await solo.context();
    const x = await create(ctx, 'X');

    const r = await claimIssue(ctx, x);

    expect(r.local).toBe('no_remote');
    expect(r.pushed).toBeUndefined();
    expect(r.commit).toBe(await revParse(solo.root, 'HEAD'));
    expect(r.notices).toContainEqual({
      code: 'claim_local',
      message: 'Claim nur lokal: kein Remote',
      ids: [x],
    });
  });

  test('claim in manual mode is local with a notice', async () => {
    const [x] = (await shared('X')) as [string];
    const remote = await revParse(t.remote, 'refs/heads/main');
    const ctx: ResolvedContext = {
      ...agent(),
      userConfig: {
        ...agent().userConfig,
        backlogs: {
          acme: { ...agent().userConfig.backlogs?.acme, sync: { mode: 'manual' } },
        },
      },
    };

    const r = await claimIssue(ctx, x, noSleep);

    expect(r.local).toBe('manual');
    expect(r.notices.map((n) => n.message)).toEqual(['Claim nur lokal: sync.mode manual']);
    expect(await claimOf(t.agent.wc, r.commit as string)).toBe(x);
    expect(await revParse(t.remote, 'refs/heads/main')).toBe(remote);
  });

  test('a non-claimable issue exits with conflict', async () => {
    const [x] = (await shared('X')) as [string];
    const y = await writeOp(agent(), { op: 'issue.create', title: 'Y', depends_on: [x] });
    const head = await revParse(t.agent.wc, 'HEAD');

    const err = await catchErrAsync(() => claimIssue(agent(), y, noSleep));

    expect(err).toMatchObject({ code: 'conflict', details: { reason: 'not_claimable' } });
    expect(await revParse(t.agent.wc, 'HEAD')).toBe(head);
  });
});

describe('claimIssue edge cases', () => {
  test('a background sync during the claim is deferred and the claim stays correct', async () => {
    const [x] = (await shared('X')) as [string];
    let background: { rounds: number; deferred: boolean } | undefined;
    const spawned: string[][] = [];

    const r = await claimIssue(agent(), x, {
      ...noSleep,
      spawn: ({ argv }) => void spawned.push(argv),
      hooks: {
        beforePush: async (_round, sha) => {
          if (background !== undefined || (await claimOf(t.agent.wc, sha)) === undefined) return;
          background = await runBackground(agent(), noSleep);
        },
      },
    });

    expect(background).toEqual({ rounds: 0, deferred: true });
    expect(await exists(await syncFile(t.agent.wc, 'sync.dirty'))).toBe(true);
    // Nach der Freigabe von `sync.lock` startet der aufgeschobene Lauf.
    expect(spawned.map((argv) => argv.slice(-6, -4))).toEqual([['sync', '--background']]);
    expect(r.pushed).toBe(await revParse(t.remote, 'refs/heads/main'));
    expect(await claimOf(t.agent.wc, r.commit as string)).toBe(x);
    expect(await listConflicts(t.agent.wc)).toEqual([]);
  });

  test('the claim commit stays the outcome commit when later local commits are pushed', async () => {
    const [x] = (await shared('X')) as [string];
    let rounds = 0;

    const r = await claimIssue(agent(), x, {
      ...noSleep,
      hooks: {
        beforePush: async (round, sha) => {
          if (round !== 1 || rounds++ > 0 || (await claimOf(t.agent.wc, sha)) === undefined) return;
          await create(agent(), 'Danach');
          await create(spw(), 'Y');
          await syncNow(spw(), noSleep);
        },
      },
    });

    expect(r.pushed).toBe(await revParse(t.remote, 'refs/heads/main'));
    expect(r.commit).not.toBe(r.pushed);
    expect(await claimOf(t.agent.wc, r.commit as string)).toBe(x);
    expect(await claimOf(t.agent.wc, r.pushed as string)).toBeUndefined();
  });

  test('a claim that is already on the remote is confirmed from the remote state', async () => {
    const [x] = (await shared('X')) as [string];

    const r = await claimIssue(agent(), x, {
      ...noSleep,
      hooks: {
        afterCommit: async () => {
          await git(['push', '-q', 'origin', 'HEAD:main'], { cwd: t.agent.wc });
        },
      },
    });

    expect(r.pushed).toBeUndefined();
    expect(r.commit).toBe(await revParse(t.remote, 'refs/heads/main'));
  });

  test('a claim on the remote that someone took over since is a conflict', async () => {
    const [x] = (await shared('X')) as [string];

    const err = await catchErrAsync(() =>
      claimIssue(agent(), x, {
        ...noSleep,
        hooks: {
          afterCommit: async () => {
            await git(['push', '-q', 'origin', 'HEAD:main'], { cwd: t.agent.wc });
            await syncNow(spw(), noSleep);
            await writeOp(spw(), {
              op: 'issue.edit',
              id: x,
              set: { assignee: { from: 'claude-1', to: 'spw' } },
            });
            await syncNow(spw(), noSleep);
          },
        },
      }),
    );

    expect(err).toMatchObject({
      code: 'conflict',
      message: `${x} wurde inzwischen von spw übernommen`,
      details: { reason: 'claim_lost', id: x, assignee: 'spw' },
    });
  });

  test('a claim lost to a deleted issue reports the violation', async () => {
    const [x] = (await shared('X')) as [string];
    let deleted = false;
    const err = await catchErrAsync(() =>
      claimIssue(agent(), x, {
        ...noSleep,
        hooks: {
          beforePush: async (_round, sha) => {
            if (deleted || (await claimOf(t.agent.wc, sha)) === undefined) return;
            deleted = true;
            await writeOp(spw(), { op: 'issue.delete', id: x });
            await syncNow(spw(), noSleep);
          },
        },
      }),
    );

    expect(err).toMatchObject({
      code: 'conflict',
      message: `Issue ${x} nicht gefunden`,
      details: { reason: 'claim_lost', id: x },
    });
  });

  test('an identity without working copy is cloned first', async () => {
    const solo = await testBacklog({ remote: true });
    const owner = await solo.context();
    const claude = await testKey('claude-1');
    await executeWrite(owner, {
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
    const x = await create(owner, 'X');
    await syncNow(owner, noSleep);
    await setIdentity(solo.homes, 'acme', 'claude-1', claude.priv);
    const ctx = await solo.context({ as: 'claude-1', backlog: 'acme' });

    const r = await claimIssue(ctx, x, noSleep);

    expect(r.pushed).toBe(await revParse(solo.remote as string, 'refs/heads/main'));
    expect(await claims(solo.remote as string, 'refs/heads/main')).toEqual([`claude-1 ${x}`]);
  });
});

describe('nextClaim', () => {
  /**
   * Hook für `spw`: Bei jedem Push eines Claim-Commits claimt der Agent dasselbe Issue zuerst,
   * höchstens `times` Mal.
   */
  function stealing(times: number): { deps: SyncDeps; stolen: string[] } {
    const stolen: string[] = [];
    return {
      stolen,
      deps: {
        ...noSleep,
        hooks: {
          beforePush: async (_round, sha) => {
            const id = await claimOf(t.spw.root, sha);
            if (id === undefined || stolen.includes(id) || stolen.length >= times) return;
            stolen.push(id);
            await claimIssue(agent(), id, noSleep);
          },
        },
      },
    };
  }

  test('next --claim tries the next candidate after a lost claim', async () => {
    const [x, y] = (await shared('X', 'Y')) as [string, string];
    const { deps, stolen } = stealing(1);

    const r = await nextClaim(spw(), {}, deps);

    // Gewählt wird nach Rang und ID, nicht nach Anlage-Reihenfolge.
    const [lost] = stolen as [string];
    const won = lost === x ? y : x;
    expect(stolen).toHaveLength(1);
    expect(r.attempts).toEqual([lost, won]);
    expect(r.issue.id).toBe(won);
    // Das Issue kommt im Stand nach dem Claim zurück.
    expect(r.issue).toMatchObject({ state: 'in_progress', assignee: 'spw' });
    expect(r.claim).toMatchObject({ id: won, pushed: await revParse(t.remote, 'refs/heads/main') });
    expect(await claims(t.remote, 'refs/heads/main')).toEqual([`spw ${won}`, `claude-1 ${lost}`]);
  });

  test('next --claim gives up after five lost claims', async () => {
    const ids = await shared('A', 'B', 'C', 'D', 'E', 'F');
    const { deps, stolen } = stealing(5);

    const err = await catchErrAsync(() => nextClaim(spw(), {}, deps));

    expect(stolen).toHaveLength(5);
    expect(err).toMatchObject({
      code: 'conflict',
      message: `Claim fünfmal verloren: ${stolen.join(', ')}`,
    });
    expect(stolen.every((id) => ids.includes(id))).toBe(true);
    expect(new Set(stolen).size).toBe(5);
  });

  test('next --claim passes on an error that is no lost claim', async () => {
    await shared('X');
    const deps: SyncDeps = {
      ...noSleep,
      hooks: {
        beforePush: async () => {
          throw new Error('Netz weg');
        },
      },
    };
    await expect(nextClaim(spw(), { exclude: [] }, deps)).rejects.toThrow('Netz weg');
  });

  test('next --claim without a candidate is not_found', async () => {
    const err = await catchErrAsync(() => nextClaim(spw(), {}, noSleep));
    expect(err).toMatchObject({ code: 'not_found', message: 'Nichts offen' });
  });

  test('next --claim resumes my own in_progress issue unchanged', async () => {
    const [x] = (await shared('X', 'Y')) as [string, string];
    await claimIssue(spw(), x, noSleep);

    const r = await nextClaim(spw(), {}, noSleep);

    expect(r).toMatchObject({ resumed: true, attempts: [x], claim: { commit: undefined } });
    expect(r.issue.id).toBe(x);
  });

  test('next --claim without remote claims locally', async () => {
    const solo = await testBacklog();
    const ctx = await solo.context();
    const x = await create(ctx, 'X');

    const r = await nextClaim(ctx, { level: 'leaf' });

    expect(r).toMatchObject({ attempts: [x], claim: { local: 'no_remote' } });
    expect(await issueOf(solo.root, x)).toMatchObject({ state: 'in_progress', assignee: 'spw' });
  });
});

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { rawCommit, type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import type { Operation } from '../ops/operation.ts';
import { issueFile } from '../store/layout.ts';
import { showIssue } from './issue-show.ts';
import { executeWrite } from './write.ts';

let b: TestBacklog;
let ctx: ResolvedContext;
let id: Record<'G' | 'P' | 'A' | 'B' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'X', string>;

let tick = 0;
async function write(op: Operation): Promise<Awaited<ReturnType<typeof executeWrite>>> {
  const at = new Date(Date.UTC(2026, 10, 19, 12, 0, tick++));
  return executeWrite(ctx, { kind: 'op', op }, { now: () => at });
}

beforeEach(async () => {
  tick = 0;
  b = await testBacklog();
  ctx = await b.context();
  const r = await executeWrite(ctx, {
    kind: 'batch',
    ops: [
      { op: 'issue.create', ref: '$G', title: 'Großeltern', state: 'todo', rank: 1 },
      { op: 'issue.create', ref: '$P', title: 'Paket', state: 'todo', rank: 2, parent: '$G' },
      { op: 'issue.create', ref: '$A', title: 'Offene Abhängigkeit', state: 'todo' },
      { op: 'issue.create', ref: '$B', title: 'Abgebrochene Abhängigkeit', state: 'cancelled' },
      {
        op: 'issue.create',
        ref: '$X',
        title: 'Hauptfall',
        state: 'todo',
        parent: '$P',
        depends_on: ['$A', '$B'],
        body: 'Beschreibung\n',
        created: '2026-11-19T10:00:00Z',
      },
      ...(['C1', 'C2', 'C3', 'C4', 'C5'] as const).map(
        (k, i): Operation => ({
          op: 'issue.create',
          ref: `$${k}`,
          title: `Kind ${i + 1}`,
          state: i < 3 ? 'done' : 'todo',
          parent: '$X',
          rank: 10 - i,
        }),
      ),
      {
        op: 'issue.create',
        title: 'Folgt auf X',
        state: 'todo',
        depends_on: ['$X'],
        rank: 3,
      },
      { op: 'issue.create', title: 'Folgt auch auf X', state: 'todo', depends_on: ['$X'], rank: 1 },
    ],
  });
  const ref = (k: string): string => r.refs[`$${k}`] as string;
  id = {
    G: ref('G'),
    P: ref('P'),
    A: ref('A'),
    B: ref('B'),
    X: ref('X'),
    C1: ref('C1'),
    C2: ref('C2'),
    C3: ref('C3'),
    C4: ref('C4'),
    C5: ref('C5'),
  };
});

test('show lists parents to the root, dependencies with state, dependents and children', async () => {
  const d = await showIssue(ctx, id.X);
  expect(d.issue.id).toBe(id.X);
  expect(d.body).toBe('Beschreibung\n');
  expect(d.parents.map((p) => p.id)).toEqual([id.P, id.G]);
  expect(d.parents[0]).toEqual({ id: id.P, state: 'todo', title: 'Paket' });
  expect(d.dependsOn).toEqual([
    { id: id.A, state: 'todo', title: 'Offene Abhängigkeit' },
    { id: id.B, state: 'cancelled', title: 'Abgebrochene Abhängigkeit' },
  ]);
  expect(d.dependents.map((x) => x.title)).toEqual(['Folgt auch auf X', 'Folgt auf X']);
  expect(d.children.map((c) => c.id)).toEqual([id.C5, id.C4, id.C3, id.C2, id.C1]);
  expect(d.notices.map((n) => n.code)).toEqual(['settled_dependency']);
  expect(d.notices[0]?.ids).toEqual([id.B]);
});

test('a dependency whose issue is gone is listed as missing, not dropped', async () => {
  await rawCommit(b.root, { files: { [issueFile(id.A)]: null }, key: b.key, actor: 'spw' });
  const d = await showIssue(ctx, id.X);
  expect(d.dependsOn).toEqual([
    { id: id.A, missing: true },
    { id: id.B, state: 'cancelled', title: 'Abgebrochene Abhängigkeit' },
  ]);
});

test('show accepts a short id', async () => {
  const d = await showIssue(ctx, id.X.slice(0, 6));
  expect(d.issue.id).toBe(id.X);
});

test('show of an unknown id is not_found', async () => {
  const err = await catchErrAsync(() => showIssue(ctx, 'zzzzzzzz'));
  expect(err.code).toBe('not_found');
});

test('show reports progress of sub-issues', async () => {
  const d = await showIssue(ctx, id.X);
  expect(d.progress).toEqual({ settled: 3, total: 5 });
  expect((await showIssue(ctx, id.A)).progress).toBeUndefined();
});

test('show flags an unblockable issue', async () => {
  const blocked = await executeWrite(ctx, {
    kind: 'batch',
    ops: [
      {
        op: 'issue.create',
        ref: '$U',
        title: 'Blockiert',
        state: 'blocked',
        paused_from: 'todo',
        blocked_by: [id.C1],
      },
    ],
  });
  const d = await showIssue(ctx, blocked.refs.$U as string);
  expect(d.notices.map((n) => n.code)).toEqual(['unblockable']);
  expect(d.blockedBy).toEqual([{ id: id.C1, state: 'done', title: 'Kind 1' }]);
  expect((await showIssue(ctx, id.X)).blockedBy).toEqual([]);
});

test('show carries the latest transition reason of the current state', async () => {
  await write({ op: 'issue.move', id: id.A, from: 'todo', to: 'in_progress', reason: 'Los' });
  await write({ op: 'comment.add', id: id.A, body: 'Zwischenstand' });
  await write({ op: 'issue.move', id: id.A, from: 'in_progress', to: 'review', reason: 'Fertig' });
  await write({ op: 'issue.move', id: id.A, from: 'review', to: 'in_progress', reason: 'Nochmal' });
  const d = await showIssue(ctx, id.A);
  expect(d.commentsCount).toBe(4);
  expect(d.lastReason).toMatchObject({
    kind: 'transition',
    from: 'review',
    to: 'in_progress',
    body: 'Nochmal\n',
    author: 'spw',
  });
  expect(d.lastReason?.file).toMatch(/\.md$/);
  expect((await showIssue(ctx, id.X)).lastReason).toBeUndefined();
});

test('lastReason is the latest transition into the current state, even if a later one led elsewhere', async () => {
  await write({ op: 'issue.move', id: id.A, from: 'todo', to: 'in_progress', reason: 'Los' });
  await write({ op: 'issue.move', id: id.A, from: 'in_progress', to: 'review', reason: 'Fertig' });
  await write({ op: 'issue.move', id: id.A, from: 'review', to: 'in_progress', reason: 'Nochmal' });
  await write({ op: 'issue.move', id: id.A, from: 'in_progress', to: 'todo', reason: 'Zurück' });
  expect((await showIssue(ctx, id.A)).lastReason?.body).toBe('Zurück\n');
  await write({ op: 'issue.move', id: id.A, from: 'todo', to: 'backlog' });
  // Kein Übergangskommentar führt nach backlog.
  expect((await showIssue(ctx, id.A)).lastReason).toBeUndefined();
});

test('unblockable notice says explicitly when a blocker was cancelled', async () => {
  const r = await executeWrite(ctx, {
    kind: 'batch',
    ops: [
      {
        op: 'issue.create',
        ref: '$U',
        title: 'Blockiert',
        state: 'blocked',
        paused_from: 'todo',
        blocked_by: [id.B],
      },
    ],
  });
  const d = await showIssue(ctx, r.refs.$U as string);
  expect(d.notices[0]?.message).toBe(
    `Alle Blocker erledigt, entblockbar: ${r.refs.$U} (nicht erledigt: ${id.B} (cancelled))`,
  );
});

test('comments: 0 by default, n the latest, all everything', async () => {
  for (const body of ['eins', 'zwei', 'drei']) {
    await write({ op: 'comment.add', id: id.A, body });
  }
  const none = await showIssue(ctx, id.A);
  expect(none.comments).toEqual([]);
  expect(none.rawComments).toEqual([]);
  expect(none.commentsCount).toBe(3);
  const two = await showIssue(ctx, id.A, { comments: 2 });
  expect(two.comments.map((c) => c.body)).toEqual(['zwei\n', 'drei\n']);
  expect(two.rawComments).toHaveLength(2);
  expect(two.rawComments[1]).toContain('drei');
  expect(two.comments[0]).toMatchObject({ author: 'spw' });
  expect(two.comments[0]?.kind).toBeUndefined();
  const all = await showIssue(ctx, id.A, { comments: 'all' });
  expect(all.comments.map((c) => c.body)).toEqual(['eins\n', 'zwei\n', 'drei\n']);
  const many = await showIssue(ctx, id.A, { comments: 10 });
  expect(many.comments).toHaveLength(3);
});

test('a negative comment count is a validation error', async () => {
  const err = await catchErrAsync(() => showIssue(ctx, id.A, { comments: -1 }));
  expect(err.code).toBe('validation');
});

test('raw is the file as on disk', async () => {
  const d = await showIssue(ctx, id.X);
  const dir = join(ctx.backlog.root as string, 'issues', id.X.slice(3, 5), id.X);
  expect(d.raw).toBe(await readFile(join(dir, 'issue.md'), 'utf8'));
});

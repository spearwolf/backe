import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog, testKey } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { nextIssue } from './next.ts';
import { executeWrite } from './write.ts';

let b: TestBacklog;
let ctx: ResolvedContext;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
  const bob = await testKey('bob');
  await executeWrite(ctx, {
    kind: 'op',
    op: { op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [bob.line] },
  });
});

async function create(...ops: Record<string, unknown>[]): Promise<Record<string, string>> {
  const r = await executeWrite(ctx, {
    kind: 'batch',
    ops: ops.map((o) => ({ op: 'issue.create', ...o })) as never,
  });
  return r.refs;
}

test('next picks the best ready issue and does not claim', async () => {
  const r = await create(
    { ref: '$A', title: 'A', state: 'todo', rank: 2 },
    { ref: '$B', title: 'B', state: 'todo', rank: 1 },
  );
  const out = await nextIssue(ctx, {});
  expect(out.issue.id).toBe(r.$B);
  expect(out.resumed).toBe(false);
  expect(out.header).toEqual({});
  expect((await nextIssue(ctx, {})).issue.id).toBe(r.$B);
});

test('next resumes own in_progress work first', async () => {
  const r = await create(
    { ref: '$A', title: 'A', state: 'todo', rank: 1 },
    { ref: '$B', title: 'B', state: 'in_progress', assignee: 'spw', rank: 5 },
  );
  const out = await nextIssue(ctx, {});
  expect(out.issue.id).toBe(r.$B);
  expect(out.resumed).toBe(true);
});

test('next without candidate names the waiting ids and exits not_found', async () => {
  const r = await create(
    { ref: '$D', title: 'Offen', state: 'in_progress', assignee: 'bob' },
    { ref: '$A', title: 'A', state: 'todo', depends_on: ['$D'] },
  );
  const err = await catchErrAsync(() => nextIssue(ctx, {}));
  expect(err.code).toBe('not_found');
  expect(err.message).toBe(`Nichts bereit: alles wartet auf Abhängigkeiten (${r.$A})`);
  expect(err.details).toEqual({ reason: 'waiting', waiting: [r.$A] });
});

test('next names the other reasons', async () => {
  await create({ title: 'Fremd', state: 'todo', assignee: 'bob' });
  const assigned = await catchErrAsync(() => nextIssue(ctx, {}));
  expect(assigned.message).toBe('Nichts frei: alle bereiten Issues sind vergeben');
  expect(assigned.details).toEqual({ reason: 'all_assigned' });
});

test('next reports blocked and empty backlogs', async () => {
  const empty = await catchErrAsync(() => nextIssue(ctx, {}));
  expect(empty.message).toBe('Nichts offen');
  expect(empty.details).toEqual({ reason: 'nothing_open' });
  await create(
    { ref: '$D', title: 'D', state: 'done' },
    { title: 'K', state: 'blocked', paused_from: 'todo', blocked_by: ['$D'] },
  );
  const blocked = await catchErrAsync(() => nextIssue(ctx, {}));
  expect(blocked.message).toBe('Nichts bereit: alles ist blockiert');
  expect(blocked.details).toEqual({ reason: 'all_blocked' });
});

test('next --level top picks a parent with open sub-issues', async () => {
  const r = await create(
    { ref: '$P', title: 'Paket', state: 'todo', rank: 9 },
    { ref: '$C', title: 'Kind', state: 'todo', parent: '$P', rank: 1 },
  );
  expect((await nextIssue(ctx, {})).issue.id).toBe(r.$C);
  expect((await nextIssue(ctx, { level: 'top' })).issue.id).toBe(r.$P);
});

test('next filters by project and shows context values in the header', async () => {
  await executeWrite(ctx, {
    kind: 'batch',
    ops: [
      { op: 'project.create', path: 'web', title: 'Web' },
      { op: 'project.create', path: 'ops', title: 'Ops' },
    ],
  });
  const r = await create(
    { ref: '$W', title: 'W', state: 'todo', projects: ['web'], rank: 2 },
    { ref: '$O', title: 'O', state: 'todo', projects: ['ops'], rank: 1 },
  );
  const fromFlag = await nextIssue(ctx, { project: 'web' });
  expect(fromFlag.issue.id).toBe(r.$W);
  expect(fromFlag.header).toEqual({});
  const withContext: ResolvedContext = {
    ...ctx,
    project: { value: 'web', source: { kind: 'env' } },
  };
  const viaContext = await nextIssue(withContext, {});
  expect(viaContext.issue.id).toBe(r.$W);
  expect(viaContext.header).toEqual({ backlog: ctx.backlog.value, project: 'web' });
  expect((await nextIssue(withContext, { all: true })).issue.id).toBe(r.$O);
});

test('next needs an identity', async () => {
  await create({ title: 'A', state: 'todo' });
  const anon: ResolvedContext = { ...ctx, user: { ...ctx.user, value: undefined } };
  expect((await catchErrAsync(() => nextIssue(anon, {}))).code).toBe('usage');
});

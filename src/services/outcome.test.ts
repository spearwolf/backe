import { testBacklog, warnModeAgent } from '../../test/helpers/git.ts';
import { seqBytes } from '../../test/helpers/snapshot.ts';
import type { Operation } from '../ops/operation.ts';
import { writeOp } from './outcome.ts';

const NOW = new Date('2026-11-19T10:00:00Z');

test('writeOp reports the issue id and the recorded operation', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const out = await writeOp(ctx, () => ({ op: 'issue.create', title: 'A' }), {
    now: () => NOW,
    randomBytes: seqBytes(),
  });
  expect(out.op.op).toBe('issue.create');
  expect(out.id).toMatch(/^bk-/);
  expect(out.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(out.warnings).toEqual([]);
  expect(out.notices).toEqual([]);
});

test('writeOp passes the actor and snapshot to derive and omits id for non-issue operations', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  let seen: string | undefined;
  const out = await writeOp(
    ctx,
    (s, actor) => {
      seen = `${actor}:${s.issues.size}`;
      const op: Operation = { op: 'sprint.create', slug: 'one', title: 'Eins' };
      return op;
    },
    { now: () => NOW },
  );
  expect(seen).toBe('spw:0');
  expect(out.op.op).toBe('sprint.create');
  expect(out.id).toBeUndefined();
});

test('writeOp with several derived operations reports them as ops', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const out = await writeOp(
    ctx,
    (): Operation[] => [
      { op: 'issue.create', title: 'A' },
      { op: 'issue.create', title: 'B' },
    ],
    { now: () => NOW, randomBytes: seqBytes() },
  );
  expect(out.ops.map((op) => op.op)).toEqual(['issue.create', 'issue.create']);
  expect('op' in out).toBe(false);
  expect(out.id).toBeUndefined();
  expect(out.commit).toMatch(/^[0-9a-f]{40}$/);
});

test('writeOp with several operations on one issue names it', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const { id } = await writeOp(ctx, () => ({ op: 'issue.create', title: 'A' }));
  const out = await writeOp(ctx, (): Operation[] => [
    { op: 'issue.edit', id: id as string, set: { title: { from: 'A', to: 'B' } } },
    { op: 'issue.edit', id: id as string, set: { title: { from: 'B', to: 'C' } } },
  ]);
  expect(out.id).toBe(id);
  expect(out.ops).toHaveLength(2);
});

test('writeOp with an empty list reports no commit and no ops', async () => {
  const b = await testBacklog();
  const out = await writeOp(await b.context(), (): Operation[] => []);
  expect(out).toMatchObject({ commit: undefined, ops: [] });
});

test('writeOp with a no-op reports the derived operation without a commit', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const { id } = await writeOp(ctx, () => ({ op: 'issue.create', title: 'A' }));
  const same: Operation = { op: 'issue.move', id: id as string, from: 'backlog', to: 'backlog' };
  const out = await writeOp(ctx, () => same);
  expect(out).toEqual({ commit: undefined, op: same, id, notices: [], warnings: [] });
  const list = await writeOp(ctx, (): Operation[] => [same, same]);
  expect(list).toEqual({ commit: undefined, ops: [same, same], id, notices: [], warnings: [] });
});

test('writeOp reports the verify notices of a fresh clone as warnings', async () => {
  const { ctx, notice } = await warnModeAgent();
  const first = await writeOp(ctx, () => ({ op: 'issue.create', title: 'A' }));
  expect(first.warnings).toEqual([notice]);
  expect((await writeOp(ctx, () => ({ op: 'issue.create', title: 'B' }))).warnings).toEqual([]);
});

test('writeOp passes the notices of the operation through', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const parent = await writeOp(ctx, () => ({ op: 'issue.create', title: 'Eltern', state: 'todo' }));
  const child = await writeOp(ctx, () => ({
    op: 'issue.create',
    title: 'Kind',
    parent: parent.id as string,
  }));
  const out = await writeOp(ctx, () => ({
    op: 'issue.move',
    id: parent.id as string,
    from: 'todo',
    to: 'cancelled',
  }));
  expect(out.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(out.notices).toEqual([
    {
      code: 'open_children',
      message: `${parent.id} ist cancelled, hat aber noch offene Sub-Issues: ${child.id}`,
      ids: [child.id],
    },
  ]);
});

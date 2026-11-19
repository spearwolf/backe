import { testBacklog } from '../../test/helpers/git.ts';
import { seqBytes } from '../../test/helpers/snapshot.ts';
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
      return { op: 'sprint.create', slug: 'one', title: 'Eins' } as never;
    },
    { now: () => NOW },
  );
  expect(seen).toBe('spw:0');
  expect(out.op.op).toBe('sprint.create');
  expect(out.id).toBeUndefined();
});

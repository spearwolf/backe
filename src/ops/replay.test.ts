/**
 * Replay (backe.md §2.16.4): Operation A (alice) geht auf den Basisstand S, Operation B
 * (claude-1) wurde gegen S aufgezeichnet und läuft auf S_A.
 */
import { catchErr } from '../../test/helpers/catch.ts';
import { I, seqBytes, snap } from '../../test/helpers/snapshot.ts';
import { serializeEntityFile } from '../store/frontmatter.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { type ApplyContext, applyOperation } from './apply.ts';
import { applyBatch } from './batch.ts';
import type { Operation } from './operation.ts';

const ctx = (actor: string): ApplyContext => ({
  actor,
  now: '2026-11-19T08:00:00Z',
  randomBytes: seqBytes(),
});

const asAlice = (s: BacklogSnapshot, op: Operation) => applyOperation(s, op, ctx('alice'));
const asAgent = (s: BacklogSnapshot, op: Operation) => applyOperation(s, op, ctx('claude-1'));
const reasonOf = (fn: () => unknown) => (catchErr(fn).details as { reason?: string }).reason;
const dataOf = (s: BacklogSnapshot, id: string) => s.issues.get(id)?.data;
const fileOf = (s: BacklogSnapshot, id: string) => {
  const e = s.issues.get(id);
  if (e === undefined) throw new Error(`Issue ${id} fehlt`);
  return serializeEntityFile('issue', e.data, e.body, e.extra);
};
const setTitle = (id: string, from: string, to: string): Operation => ({
  op: 'issue.edit',
  id,
  set: { title: { from, to } },
});

describe('replay of B recorded against S onto S_A', () => {
  test('conflicting set.title is a precondition conflict', () => {
    const s = snap({ issues: [{ id: I(1), title: 'A' }] });
    const sA = asAlice(s, setTitle(I(1), 'A', 'B')).snapshot;
    expect(reasonOf(() => asAgent(sA, setTitle(I(1), 'A', 'C')))).toBe('precondition');
  });

  test('identical set.title is a no-op', () => {
    const s = snap({ issues: [{ id: I(1), title: 'A' }] });
    const sA = asAlice(s, setTitle(I(1), 'A', 'C')).snapshot;
    const r = asAgent(sA, setTitle(I(1), 'A', 'C'));
    expect([r.noop, r.changes]).toEqual([true, []]);
  });

  test('props on different keys both apply', () => {
    const s = snap({ issues: [{ id: I(1), props: { x: 1 } }] });
    const sA = asAlice(s, {
      op: 'issue.edit',
      id: I(1),
      props: { x: { from: 1, to: 2 } },
    }).snapshot;
    const r = asAgent(sA, { op: 'issue.edit', id: I(1), props: { y: { from: null, to: 3 } } });
    expect(dataOf(r.snapshot, I(1))?.props).toEqual({ x: 2, y: 3 });
  });

  test('depends_on edges that close a cycle are refused', () => {
    const s = snap({ issues: [{ id: I(1) }, { id: I(2) }] });
    const sA = asAlice(s, {
      op: 'issue.edit',
      id: I(1),
      add: { depends_on: [I(2)] },
    }).snapshot;
    const b: Operation = { op: 'issue.edit', id: I(2), add: { depends_on: [I(1)] } };
    expect(reasonOf(() => asAgent(sA, b))).toBe('cycle');
  });

  test('add and remove on a list commute', () => {
    const s = snap({ projects: ['web', 'api'], issues: [{ id: I(1), projects: ['web'] }] });
    const a: Operation = { op: 'issue.edit', id: I(1), add: { projects: ['api'] } };
    const b: Operation = { op: 'issue.edit', id: I(1), remove: { projects: ['web'] } };
    const ab = asAgent(asAlice(s, a).snapshot, b).snapshot;
    const ba = asAlice(asAgent(s, b).snapshot, a).snapshot;
    expect(dataOf(ab, I(1))?.projects).toEqual(['api']);
    expect(fileOf(ab, I(1))).toBe(fileOf(ba, I(1)));
  });

  test('project.mv carries an issue that another writer attached to the old path', () => {
    const s = snap({ projects: ['web', 'web/auth'], issues: [{ id: I(2) }] });
    const sA = asAlice(s, {
      op: 'issue.edit',
      id: I(2),
      add: { projects: ['web/auth'] },
    }).snapshot;
    const r = asAgent(sA, { op: 'project.mv', from: 'web', to: 'platform' });
    expect(dataOf(r.snapshot, I(2))?.projects).toEqual(['platform/auth']);
  });

  test('rank before is computed against the new neighbours', () => {
    const s = snap({
      issues: [{ id: I(1), rank: 3000 }, { id: I(2), rank: 2000 }, { id: I(3) }],
    });
    const sA = asAlice(s, { op: 'issue.rank', id: I(3), from: null, value: 1500 }).snapshot;
    const r = asAgent(sA, { op: 'issue.rank', id: I(1), from: 3000, before: I(2) });
    const rank = dataOf(r.snapshot, I(1))?.rank as number;
    expect(rank).toBeGreaterThan(1500);
    expect(rank).toBeLessThan(2000);
  });

  test('deleting an issue that A made a dependency target is refused with references', () => {
    const s = snap({ issues: [{ id: I(1) }] });
    const sA = asAlice(s, {
      op: 'issue.create',
      id: I(9),
      title: 'neu',
      depends_on: [I(1)],
    }).snapshot;
    expect(reasonOf(() => asAgent(sA, { op: 'issue.delete', id: I(1) }))).toBe('references');
  });

  test('moving a parent to done after A added an open child is refused', () => {
    const s = snap({ issues: [{ id: I(1), state: 'review' }] });
    const sA = asAlice(s, { op: 'issue.create', id: I(9), title: 'Kind', parent: I(1) }).snapshot;
    const b: Operation = { op: 'issue.move', id: I(1), from: 'review', to: 'done' };
    expect(reasonOf(() => asAgent(sA, b))).toBe('open_children');
  });

  test('two creates with the same explicit id collide', () => {
    const sA = asAlice(snap({}), { op: 'issue.create', id: I(7), title: 'A' }).snapshot;
    const b: Operation = { op: 'issue.create', id: I(7), title: 'B' };
    expect(reasonOf(() => asAgent(sA, b))).toBe('id_collision');
  });

  test('commenting on an issue A deleted is a missing_ref', () => {
    const s = snap({ issues: [{ id: I(1) }] });
    const sA = asAlice(s, { op: 'issue.delete', id: I(1) }).snapshot;
    const b: Operation = { op: 'comment.add', id: I(1), body: 'hallo' };
    expect(reasonOf(() => asAgent(sA, b))).toBe('missing_ref');
  });

  test('a batch whose second operation fails on S_A fails as a whole', () => {
    const s = snap({ issues: [{ id: I(1), title: 'A' }, { id: I(2) }] });
    const sA = asAlice(s, setTitle(I(1), 'A', 'B')).snapshot;
    const err = catchErr(() =>
      applyBatch(
        sA,
        [{ op: 'issue.create', title: 'neu' }, setTitle(I(1), 'A', 'C')],
        ctx('claude-1'),
      ),
    );
    expect([err.code, (err.details as { reason?: string }).reason, err.message]).toEqual([
      'conflict',
      'precondition',
      expect.stringMatching(/^Zeile 2: /),
    ]);
    expect(sA.issues.size).toBe(2);
  });
});

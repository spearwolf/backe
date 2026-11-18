import { catchErr } from '../../test/helpers/catch.ts';
import { I, seqBytes, snap } from '../../test/helpers/snapshot.ts';
import type { Issue } from '../core/schemas.ts';
import { commentFileName, commentsDir, issueDir, issueFile } from '../store/layout.ts';
import { type ApplyContext, applyOperation } from './apply.ts';
import type { Operation } from './operation.ts';

const ctx = (actor = 'spw'): ApplyContext => ({
  actor,
  now: '2026-11-19T08:00:00Z',
  randomBytes: seqBytes(),
});

type SnapIssues = NonNullable<Parameters<typeof snap>[0]>['issues'];

const run = (issues: SnapIssues, op: Operation, actor = 'spw') =>
  applyOperation(snap({ issues }), op, ctx(actor));
const fail = (issues: SnapIssues, op: Operation, actor = 'spw') =>
  catchErr(() => run(issues, op, actor));

const data = (r: { snapshot: { issues: Map<string, { data: Issue }> } }, id: string): Issue =>
  (r.snapshot.issues.get(id) as { data: Issue }).data;

const del = (extra: Record<string, unknown> = {}, id = I(1)): Operation =>
  ({ op: 'issue.delete', id, ...extra }) as Operation;

const reasonOf = (err: { details?: unknown }) => (err.details as { reason: string }).reason;

describe('issue.delete', () => {
  test('removes the issue directory with one recursive change', () => {
    const r = run([{ id: I(1) }], del());
    expect(r.changes).toEqual([{ path: issueDir(I(1)), content: null, recursive: true }]);
    expect(r.snapshot.issues.has(I(1))).toBe(false);
  });

  test('a missing issue is not found', () => {
    const err = fail([], del());
    expect([err.exitCode, err.details]).toEqual([3, { reason: 'missing_ref', ids: [I(1)] }]);
  });

  test('deleting the last blocker puts the issue on hold', () => {
    const s = snap({
      issues: [
        { id: I(1) },
        { id: I(2), state: 'blocked', blocked_by: [I(1)], paused_from: 'in_progress' },
      ],
    });
    const r = applyOperation(s, { op: 'issue.delete', id: I(1), force: true }, ctx());
    expect(r.snapshot.issues.get(I(2))?.data).toMatchObject({
      state: 'on_hold',
      paused_from: 'in_progress',
    });
    expect(r.snapshot.issues.get(I(2))?.data.blocked_by).toBeUndefined();
    expect(r.changes[0]).toEqual({ path: issueDir(I(1)), content: null, recursive: true });
    expect(r.notices).toEqual([expect.objectContaining({ code: 'blocker_deleted', ids: [I(2)] })]);
    const comment = r.changes.find((c) => c.path.startsWith(commentsDir(I(2))));
    expect(comment?.content).toContain('kind: transition');
    expect(comment?.content).toContain('from: blocked');
    expect(comment?.content).toContain('to: on_hold');
    expect(comment?.content).toContain(`Blocker ${I(1)} gelöscht`);
    const file = comment?.path.split('/').pop();
    expect(r.recorded).toEqual({
      op: 'issue.delete',
      id: I(1),
      force: true,
      blocker_comments: { [I(2)]: file },
    });
  });

  test('a blocked issue with remaining blockers stays blocked', () => {
    const r = run(
      [{ id: I(1) }, { id: I(2) }, { id: I(3), state: 'blocked', blocked_by: [I(1), I(2)] }],
      del({ force: true }),
    );
    expect(data(r, I(3))).toMatchObject({ state: 'blocked', blocked_by: [I(2)] });
    expect(r.notices).toEqual([]);
    expect(r.changes.some((c) => c.path.startsWith(commentsDir(I(3))))).toBe(false);
  });

  test('blocker_comments names the file and the comment lists all deleted blockers sorted', () => {
    const file = commentFileName('2026-11-19T08:00:00Z', 'spw', 'abc');
    const r = run(
      [
        { id: I(1) },
        { id: I(2), parent: I(1) },
        { id: I(3), state: 'blocked', blocked_by: [I(2), I(1)] },
      ],
      del({ force: true, children: 'recursive', blocker_comments: { [I(3)]: file } }),
    );
    const c = r.changes.find((x) => x.path === `${commentsDir(I(3))}/${file}`);
    expect(c?.content).toContain(`Blocker ${I(1)}, ${I(2)} gelöscht`);
    expect(r.recorded).toMatchObject({ blocker_comments: { [I(3)]: file } });
  });

  test('a blocker comment file of another author is a policy violation', () => {
    const file = commentFileName('2026-11-19T08:00:00Z', 'alice', 'abc');
    const err = fail(
      [{ id: I(1) }, { id: I(2), state: 'blocked', blocked_by: [I(1)] }],
      del({ force: true, blocker_comments: { [I(2)]: file } }),
    );
    expect([err.exitCode, reasonOf(err)]).toEqual([2, 'policy']);
  });

  test('references require force', () => {
    const err = fail(
      [
        { id: I(1) },
        { id: I(3), depends_on: [I(1)] },
        { id: I(2), state: 'blocked', blocked_by: [I(1)] },
      ],
      del(),
    );
    expect([err.exitCode, err.details]).toEqual([4, { reason: 'references', ids: [I(2), I(3)] }]);
  });

  test('force removes dependency references and drops empty lists', () => {
    const r = run([{ id: I(1) }, { id: I(2), depends_on: [I(1)] }], del({ force: true }));
    expect(data(r, I(2)).depends_on).toBeUndefined();
  });

  test('sub-issues require orphan or recursive', () => {
    const err = fail([{ id: I(1) }, { id: I(3), parent: I(1) }, { id: I(2), parent: I(1) }], del());
    expect([err.exitCode, err.details]).toEqual([4, { reason: 'has_children', ids: [I(2), I(3)] }]);
  });

  test('recursive deletes the subtree with one change per issue dir', () => {
    const r = run(
      [{ id: I(1) }, { id: I(2), parent: I(1) }, { id: I(3), parent: I(2) }, { id: I(4) }],
      del({ children: 'recursive' }),
    );
    expect(r.changes).toEqual(
      [I(1), I(2), I(3)].map((id) => ({ path: issueDir(id), content: null, recursive: true })),
    );
    expect([...r.snapshot.issues.keys()]).toEqual([I(4)]);
  });

  test('references inside the deleted subtree do not need force', () => {
    const r = run(
      [{ id: I(1) }, { id: I(2), parent: I(1), depends_on: [I(1)] }],
      del({ children: 'recursive' }),
    );
    expect(r.snapshot.issues.size).toBe(0);
  });

  test('references from outside to a descendant need force', () => {
    const err = fail(
      [{ id: I(1) }, { id: I(2), parent: I(1) }, { id: I(3), depends_on: [I(2)] }],
      del({ children: 'recursive' }),
    );
    expect(err.details).toEqual({ reason: 'references', ids: [I(3)] });
  });

  test('orphan detaches direct children only', () => {
    const r = run(
      [{ id: I(1) }, { id: I(2), parent: I(1) }, { id: I(3), parent: I(2) }],
      del({ children: 'orphan' }),
    );
    expect(data(r, I(2)).parent).toBeUndefined();
    expect(data(r, I(3)).parent).toBe(I(2));
    expect(r.changes.map((c) => c.path)).toEqual([issueDir(I(1)), issueFile(I(2))]);
  });
});

import { catchErr, reasonOf } from '../../test/helpers/catch.ts';
import { I, seqBytes, snap } from '../../test/helpers/snapshot.ts';
import type { Issue } from '../core/schemas.ts';
import type { State } from '../core/state.ts';
import { issueFile } from '../store/layout.ts';
import { type ApplyContext, applyOperation } from './apply.ts';
import type { Operation, OpOf } from './operation.ts';

const ctx = (actor = 'spw'): ApplyContext => ({
  actor,
  now: '2026-11-19T08:00:00Z',
  randomBytes: seqBytes(),
});

type SnapIssues = NonNullable<Parameters<typeof snap>[0]>['issues'];

const run = (issues: SnapIssues, op: Operation, actor = 'spw', config = {}) =>
  applyOperation(snap({ issues, config }), op, ctx(actor));

const fail = (issues: SnapIssues, op: Operation, actor = 'spw', config = {}) =>
  catchErr(() => run(issues, op, actor, config));

const data = (r: { snapshot: { issues: Map<string, { data: Issue }> } }, id = I(1)): Issue =>
  (r.snapshot.issues.get(id) as { data: Issue }).data;

const move = (from: State, to: State, extra: Partial<OpOf<'issue.move'>> = {}): Operation => ({
  op: 'issue.move',
  id: I(1),
  from,
  to,
  ...extra,
});

describe('issue.move', () => {
  test('moves along the main line', () => {
    const r = run([{ id: I(1), state: 'todo' }], move('todo', 'in_progress'));
    expect(data(r).state).toBe('in_progress');
    expect(r.changes.map((c) => c.path)).toEqual([issueFile(I(1))]);
    expect(r.noop).toBe(false);
  });

  test('a stale from is a precondition conflict', () => {
    const err = fail([{ id: I(1), state: 'review' }], move('todo', 'in_progress'));
    expect([err.exitCode, err.details]).toEqual([4, { reason: 'precondition', ids: [I(1)] }]);
  });

  test('a missing issue is not found', () => {
    const err = fail([], move('todo', 'in_progress'));
    expect([err.exitCode, err.details]).toEqual([3, { reason: 'missing_ref', ids: [I(1)] }]);
  });

  test('reaching the target already is a no-op', () => {
    const r = run([{ id: I(1), state: 'review' }], move('todo', 'review'));
    expect([r.noop, r.changes]).toEqual([true, []]);
  });

  test('a transition the state model forbids becomes a transition violation', () => {
    const err = fail([{ id: I(1), state: 'backlog' }], move('backlog', 'review'), 'spw', {
      workflow: { strict: true },
    });
    expect([err.exitCode, reasonOf(err)]).toEqual([2, 'transition']);
  });

  test('without strict the same jump is allowed', () => {
    const r = run([{ id: I(1), state: 'backlog' }], move('backlog', 'review'));
    expect(data(r).state).toBe('review');
  });

  test('done with open sub-issues is a conflict listing them', () => {
    const issues = [
      { id: I(1), state: 'review' as const },
      { id: I(2), parent: I(1) },
    ];
    const err = fail(issues, move('review', 'done'));
    expect([err.exitCode, err.details]).toEqual([4, { reason: 'open_children', ids: [I(2)] }]);
  });

  test('done ignores settled sub-issues', () => {
    const issues = [
      { id: I(1), state: 'review' as const },
      { id: I(2), parent: I(1), state: 'cancelled' as const },
    ];
    const r = run(issues, move('review', 'done'));
    expect([data(r).state, r.notices]).toEqual(['done', []]);
  });

  test('force done records force and warns', () => {
    const issues = [
      { id: I(1), state: 'review' as const },
      { id: I(2), parent: I(1) },
      { id: I(3), parent: I(1), state: 'in_progress' as const },
    ];
    const r = run(issues, move('review', 'done', { force: true }));
    expect(data(r).state).toBe('done');
    expect(r.recorded).toMatchObject({ force: true });
    expect(r.notices).toEqual([
      { code: 'forced_done', message: expect.stringContaining(I(2)), ids: [I(2), I(3)] },
    ]);
  });

  test('an open child under a force-closed parent moves on without force', () => {
    const issues = [
      { id: I(1), state: 'done' as const },
      { id: I(2), parent: I(1), state: 'todo' as const },
    ];
    const r = run(issues, move('todo', 'in_progress', { id: I(2) }));
    expect(data(r, I(2)).state).toBe('in_progress');
  });

  test.each(['cancelled', 'rejected'] as const)('%s with open sub-issues warns only', (to) => {
    const issues = [{ id: I(1) }, { id: I(2), parent: I(1) }];
    const r = run(issues, move('todo', to));
    expect(data(r).state).toBe(to);
    expect(r.notices).toEqual([
      { code: 'open_children', message: expect.stringContaining(I(2)), ids: [I(2)] },
    ]);
  });

  test('moving to blocked takes blocked_by and remembers the origin', () => {
    const issues = [{ id: I(1), state: 'in_progress' as const }, { id: I(2) }];
    const r = run(issues, move('in_progress', 'blocked', { blocked_by: [I(2)] }));
    expect(data(r)).toMatchObject({
      state: 'blocked',
      paused_from: 'in_progress',
      blocked_by: [I(2)],
    });
  });

  test('blocked without blocked_by is a transition violation', () => {
    const err = fail([{ id: I(1) }], move('todo', 'blocked'));
    expect(reasonOf(err)).toBe('transition');
  });

  test('a blocker that does not exist is a missing reference', () => {
    const err = fail([{ id: I(1) }], move('todo', 'blocked', { blocked_by: [I(9)] }));
    expect([err.exitCode, err.details]).toEqual([3, { reason: 'missing_ref', ids: [I(9)] }]);
  });

  test('blocked_by cycle is rejected', () => {
    const issues = [
      { id: I(1) },
      { id: I(2), state: 'blocked' as const, paused_from: 'todo' as const, blocked_by: [I(1)] },
    ];
    const err = fail(issues, move('todo', 'blocked', { blocked_by: [I(2)] }));
    expect([err.exitCode, reasonOf(err)]).toEqual([2, 'cycle']);
  });

  test('leaving blocked clears paused_from and blocked_by', () => {
    const issues = [
      { id: I(1), state: 'blocked' as const, paused_from: 'todo' as const, blocked_by: [I(2)] },
      { id: I(2) },
    ];
    const r = run(issues, move('blocked', 'todo'));
    const d = data(r);
    expect([d.state, d.paused_from, d.blocked_by]).toEqual(['todo', undefined, undefined]);
  });

  test('reason becomes a transition comment', () => {
    const r = run(
      [{ id: I(1), state: 'in_progress' }],
      move('in_progress', 'on_hold', { reason: 'Warte auf IdP.' }),
      'claude-1',
    );
    const file = (r.recorded as OpOf<'issue.move'>).reason_file as string;
    expect(file).toMatch(/^20261119T080000Z-claude-1-[0-9a-hjkmnp-tv-z]{3}\.md$/);
    expect(r.changes.find((c) => c.path.endsWith(file))?.content).toBe(
      '---\nauthor: claude-1\ncreated: 2026-11-19T08:00:00Z\nkind: transition\nfrom: in_progress\nto: on_hold\n---\nWarte auf IdP.\n',
    );
  });

  test('without reason there is no comment and no reason_file', () => {
    const r = run([{ id: I(1), state: 'todo' }], move('todo', 'in_progress'));
    expect(r.changes).toHaveLength(1);
    expect(r.recorded).not.toHaveProperty('reason_file');
  });

  test('a given reason_file must belong to the actor', () => {
    const err = fail(
      [{ id: I(1), state: 'todo' }],
      move('todo', 'in_progress', { reason: 'x', reason_file: '20261119T080000Z-alice-abc.md' }),
    );
    expect([err.exitCode, reasonOf(err)]).toEqual([2, 'policy']);
  });

  test('a given reason_file is used as written', () => {
    const file = '20261119T075900Z-spw-abc.md';
    const r = run(
      [{ id: I(1), state: 'todo' }],
      move('todo', 'in_progress', { reason: 'x', reason_file: file }),
    );
    expect(r.recorded).toMatchObject({ reason_file: file });
    expect(r.changes.some((c) => c.path.endsWith(`/${file}`))).toBe(true);
  });

  test('a no-op writes no comment', () => {
    const r = run([{ id: I(1), state: 'review' }], move('todo', 'review', { reason: 'schon da' }));
    expect([r.noop, r.changes]).toEqual([true, []]);
    expect(r.recorded).not.toHaveProperty('reason_file');
  });
});

describe('issue.resume', () => {
  const paused = { id: I(1), state: 'on_hold' as const, paused_from: 'in_progress' as const };

  test('returns to paused_from', () => {
    const r = run([paused], { op: 'issue.resume', id: I(1), from: 'on_hold' });
    const d = data(r);
    expect([d.state, d.paused_from]).toEqual(['in_progress', undefined]);
  });

  test('records a transition comment for the reason', () => {
    const r = run([paused], { op: 'issue.resume', id: I(1), from: 'on_hold', reason: 'Weiter.' });
    const file = (r.recorded as OpOf<'issue.resume'>).reason_file as string;
    expect(r.changes.find((c) => c.path.endsWith(file))?.content).toContain(
      'kind: transition\nfrom: on_hold\nto: in_progress\n',
    );
  });

  test('a stale from is a precondition conflict', () => {
    const err = fail([paused], { op: 'issue.resume', id: I(1), from: 'blocked' });
    expect([err.exitCode, reasonOf(err)]).toEqual([4, 'precondition']);
  });

  test('a running issue cannot be resumed', () => {
    const err = fail([{ id: I(1), state: 'todo' }], {
      op: 'issue.resume',
      id: I(1),
      from: 'on_hold',
    });
    expect(reasonOf(err)).toBe('precondition');
  });
});

describe('issue.reopen', () => {
  test('defaults to backlog and records it', () => {
    const r = run([{ id: I(1), state: 'done' }], { op: 'issue.reopen', id: I(1), from: 'done' });
    expect(data(r).state).toBe('backlog');
    expect(r.recorded).toMatchObject({ to: 'backlog' });
  });

  test('reopens into the requested state with a reason comment', () => {
    const r = run([{ id: I(1), state: 'cancelled' }], {
      op: 'issue.reopen',
      id: I(1),
      from: 'cancelled',
      to: 'review',
      reason: 'Doch nötig.',
    });
    expect(data(r).state).toBe('review');
    const file = (r.recorded as OpOf<'issue.reopen'>).reason_file as string;
    expect(r.changes.find((c) => c.path.endsWith(file))?.content).toContain(
      'from: cancelled\nto: review\n',
    );
  });

  test('already in the target state is a no-op', () => {
    const r = run([{ id: I(1), state: 'todo' }], {
      op: 'issue.reopen',
      id: I(1),
      from: 'done',
      to: 'todo',
    });
    expect(r.noop).toBe(true);
  });

  test('a stale from is a precondition conflict', () => {
    const err = fail([{ id: I(1), state: 'rejected' }], {
      op: 'issue.reopen',
      id: I(1),
      from: 'done',
    });
    expect(reasonOf(err)).toBe('precondition');
  });
});

describe('issue.claim', () => {
  const claim: Operation = { op: 'issue.claim', id: I(1) };

  test('claim jumps from backlog even with workflow.strict', () => {
    const r = run([{ id: I(1), state: 'backlog' }], claim, 'alice', { workflow: { strict: true } });
    expect(data(r)).toMatchObject({ state: 'in_progress', assignee: 'alice' });
  });

  test('claim of an in-progress issue of mine is a no-op', () => {
    const r = run([{ id: I(1), state: 'in_progress', assignee: 'alice' }], claim, 'alice');
    expect([r.noop, r.changes]).toEqual([true, []]);
  });

  test('claim of an issue someone else holds is not claimable', () => {
    const err = fail([{ id: I(1), state: 'in_progress', assignee: 'spw' }], claim, 'alice');
    expect([err.exitCode, reasonOf(err)]).toEqual([4, 'not_claimable']);
  });

  test('claim with unsettled dependencies names them', () => {
    const err = fail([{ id: I(1), depends_on: [I(2)] }, { id: I(2) }], claim);
    expect([err.exitCode, err.details]).toEqual([4, { reason: 'not_claimable', ids: [I(2)] }]);
  });

  test('claim of an occupied sub-issue names the ancestor', () => {
    const issues = [
      { id: I(1), parent: I(2) },
      { id: I(2), state: 'in_progress' as const, assignee: 'alice' },
    ];
    const err = fail(issues, claim, 'spw');
    expect([err.exitCode, err.details]).toEqual([4, { reason: 'occupied', ids: [I(2)] }]);
  });

  test('claim by the holder of the ancestor works', () => {
    const issues = [
      { id: I(1), parent: I(2) },
      { id: I(2), state: 'in_progress' as const, assignee: 'alice' },
    ];
    const r = run(issues, claim, 'alice');
    expect(data(r)).toMatchObject({ state: 'in_progress', assignee: 'alice' });
  });
});

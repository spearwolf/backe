import { ApiError } from '../data/api-client.ts';
import { testIssue, tid } from '../test/state.ts';
import { openChildrenOf, stateActions, stateCall } from './state-actions.ts';

const to = (actions: ReturnType<typeof stateActions>) => actions.map((a) => a.to);

test('settled issues only reopen', () => {
  const actions = stateActions(testIssue(1, { state: 'done' }), false);
  expect(actions).toEqual(
    ['backlog', 'todo', 'in_progress', 'review'].map((s) => ({
      to: s,
      tool: 'issue_reopen',
      needsBlockedBy: false,
    })),
  );
  expect(stateActions(testIssue(1, { state: 'cancelled' }), true)).toEqual(actions);
});

test('paused issues resume to paused_from', () => {
  const issue = testIssue(1, {
    state: 'blocked',
    paused_from: 'in_progress',
    blocked_by: [tid(2)],
  });
  const actions = stateActions(issue, false);
  expect(actions.find((a) => a.to === 'in_progress')).toEqual({
    to: 'in_progress',
    tool: 'issue_resume',
    needsBlockedBy: false,
  });
  expect(actions.filter((a) => a.tool === 'issue_resume')).toHaveLength(1);
  expect(to(actions)).toEqual(
    expect.arrayContaining([
      'backlog',
      'todo',
      'review',
      'done',
      'on_hold',
      'cancelled',
      'rejected',
    ]),
  );
  expect(actions.find((a) => a.to === 'todo')?.tool).toBe('issue_move');
});

test('strict workflow allows neighbours only', () => {
  const actions = stateActions(testIssue(1, { state: 'todo' }), true);
  expect(to(actions)).toEqual([
    'backlog',
    'in_progress',
    'blocked',
    'on_hold',
    'cancelled',
    'rejected',
  ]);
});

test('strict paused issues resume to paused_from or step to its neighbours', () => {
  const issue = testIssue(1, { state: 'on_hold', paused_from: 'todo' });
  const actions = stateActions(issue, true);
  expect(actions.map((a) => [a.to, a.tool])).toEqual([
    ['backlog', 'issue_move'],
    ['todo', 'issue_resume'],
    ['in_progress', 'issue_move'],
    ['blocked', 'issue_move'],
    ['cancelled', 'issue_move'],
    ['rejected', 'issue_move'],
  ]);
});

test('blocked needs blocked_by', () => {
  const actions = stateActions(testIssue(1, { state: 'todo' }), false);
  expect(actions.filter((a) => a.needsBlockedBy).map((a) => a.to)).toEqual(['blocked']);
});

test('state calls carry reason, blocked_by and force', () => {
  const id = tid(1);
  const move = { to: 'blocked', tool: 'issue_move', needsBlockedBy: true } as const;
  expect(stateCall(id, move, { reason: 'r', blockedBy: [tid(2)], force: true })).toEqual({
    name: 'issue_move',
    args: { id, to: 'blocked', reason: 'r', blocked_by: [tid(2)], force: true },
  });
  expect(stateCall(id, { to: 'todo', tool: 'issue_move', needsBlockedBy: false })).toEqual({
    name: 'issue_move',
    args: { id, to: 'todo' },
  });
  const resume = { to: 'todo', tool: 'issue_resume', needsBlockedBy: false } as const;
  expect(stateCall(id, resume, { reason: 'x', force: true })).toEqual({
    name: 'issue_resume',
    args: { id, reason: 'x' },
  });
  expect(stateCall(id, { to: 'review', tool: 'issue_reopen', needsBlockedBy: false })).toEqual({
    name: 'issue_reopen',
    args: { id, to: 'review' },
  });
});

test('open children come from the error details', () => {
  const err = (details: unknown) => new ApiError(409, 'open_children', 'm', undefined, details);
  expect(openChildrenOf(err({ reason: 'open_children', ids: [tid(2)] }))).toEqual([tid(2)]);
  expect(openChildrenOf(err({ reason: 'other', ids: [tid(2)] }))).toBeUndefined();
  expect(openChildrenOf(err(undefined))).toBeUndefined();
  expect(openChildrenOf(new Error('x'))).toBeUndefined();
  expect(openChildrenOf(err({ reason: 'open_children', ids: 'x' }))).toBeUndefined();
  expect(openChildrenOf(err({ reason: 'open_children', ids: [] }))).toBeUndefined();
});

import type { IssueJson } from '@backe/ui/api.ts';
import { Store } from '../data/store.ts';
import { testIssue, testState, tid } from '../test/state.ts';
import { NO_LANE } from './board-model.ts';
import {
  anchorIn,
  type BoardDrop,
  type BoardPlan,
  boardCall,
  boardOverlay,
  laneChange,
  planDrop,
} from './board-move.ts';

type Change = Extract<BoardPlan, { kind: 'change' }>;

const drop = (from: BoardDrop['from'], to: BoardDrop['to'], extra: Partial<BoardDrop> = {}) => ({
  id: tid(1),
  from,
  to,
  ...extra,
});

function snapshotOf(issues: IssueJson[]) {
  const store = new Store();
  store.load(testState(issues));
  const s = store.toSnapshot();
  if (s === undefined) throw new Error('no snapshot');
  return s;
}

test('the same cell ranks before or after the target card', () => {
  expect(anchorIn(['a', 'b', 'c'], 'a', { card: 'c', side: 'after' })).toEqual({ after: 'c' });
  expect(anchorIn(['a', 'b', 'c'], 'c', { card: 'a', side: 'before' })).toEqual({ before: 'a' });
  expect(anchorIn(['a', 'b', 'c'], 'a', 'end')).toEqual({ after: 'c' });
  const issue = testIssue(1);
  const cell = { lane: NO_LANE, column: 'todo' as const };
  expect(planDrop(issue, drop(cell, cell, { anchor: { after: tid(2) } }), 'none', false)).toEqual({
    kind: 'rank',
    pos: { after: tid(2) },
  });
});

test('a drop that keeps the order is no move', () => {
  expect(anchorIn(['a', 'b'], 'a', { card: 'b', side: 'before' })).toBeUndefined();
  expect(anchorIn(['a', 'b'], 'b', { card: 'a', side: 'after' })).toBeUndefined();
  expect(anchorIn(['a', 'b'], 'b', 'end')).toBeUndefined();
  expect(anchorIn(['a', 'b'], 'a', { card: 'a', side: 'after' })).toBeUndefined();
  const cell = { lane: NO_LANE, column: 'todo' as const };
  expect(planDrop(testIssue(1), drop(cell, cell), 'none', false)).toBeUndefined();
});

test('another column moves the state', () => {
  const plan = planDrop(
    testIssue(1),
    drop({ lane: NO_LANE, column: 'todo' }, { lane: NO_LANE, column: 'in_progress' }),
    'none',
    false,
  );
  expect(plan).toEqual({
    kind: 'change',
    state: { to: 'in_progress', tool: 'issue_move', needsBlockedBy: false },
  });
});

test('a done card reopens into another column', () => {
  const plan = planDrop(
    testIssue(1, { state: 'done' }),
    drop({ lane: NO_LANE, column: 'done' }, { lane: NO_LANE, column: 'todo' }),
    'none',
    false,
  );
  expect(plan).toEqual({
    kind: 'change',
    state: { to: 'todo', tool: 'issue_reopen', needsBlockedBy: false },
  });
});

test('a blocked card leaves its column by issue_move', () => {
  const issue = testIssue(1, {
    state: 'blocked',
    paused_from: 'in_progress',
    blocked_by: [tid(9)],
  });
  for (const strict of [false, true]) {
    const plan = planDrop(
      issue,
      drop({ lane: NO_LANE, column: 'in_progress' }, { lane: NO_LANE, column: 'review' }),
      'none',
      strict,
    );
    expect(plan).toEqual({
      kind: 'change',
      state: { to: 'review', tool: 'issue_move', needsBlockedBy: false },
    });
  }
});

test('another lane swaps the sprint', () => {
  const issue = testIssue(1, { sprints: ['s1'] });
  expect(laneChange(issue, 'sprint', 's1', 's2')).toEqual({
    field: 'sprints',
    remove: ['s1'],
    add: ['s2'],
  });
  expect(
    planDrop(
      issue,
      drop({ lane: 's1', column: 'todo' }, { lane: 's2', column: 'todo' }),
      'sprint',
      false,
    ),
  ).toEqual({ kind: 'change', lane: { field: 'sprints', remove: ['s1'], add: ['s2'] } });
  expect(laneChange(testIssue(1, { projects: ['a/b'] }), 'project', 'a/b', 'c')).toEqual({
    field: 'projects',
    remove: ['a/b'],
    add: ['c'],
  });
});

test('a lane it already has only drops the old one', () => {
  const issue = testIssue(1, { sprints: ['s1', 's2'] });
  expect(laneChange(issue, 'sprint', 's1', 's2')).toEqual({
    field: 'sprints',
    remove: ['s1'],
    add: [],
  });
});

test('into the no-lane only removes, out of it only adds', () => {
  expect(laneChange(testIssue(1, { sprints: ['s1'] }), 'sprint', 's1', NO_LANE)).toEqual({
    field: 'sprints',
    remove: ['s1'],
    add: [],
  });
  expect(laneChange(testIssue(1), 'sprint', NO_LANE, 's2')).toEqual({
    field: 'sprints',
    remove: [],
    add: ['s2'],
  });
});

test('repo lane swap removes the exact ref entry', () => {
  expect(laneChange(testIssue(1, { repos: ['api@main'] }), 'repo', 'api', 'web')).toEqual({
    field: 'repos',
    remove: ['api@main'],
    add: ['web'],
  });
  // Ein Repo, das schon per Ref drinsteht, kommt nicht ein zweites Mal hinzu.
  expect(laneChange(testIssue(1, { repos: ['api', 'web@dev'] }), 'repo', 'api', 'web')).toEqual({
    field: 'repos',
    remove: ['api'],
    add: [],
  });
});

test('group none never changes a lane', () => {
  expect(laneChange(testIssue(1, { sprints: ['s1'] }), 'none', 's1', 's2')).toBeUndefined();
  expect(laneChange(testIssue(1), 'sprint', NO_LANE, NO_LANE)).toBeUndefined();
});

test('state only calls the state tool with reason and force', () => {
  const server = testIssue(1);
  const change: Change = {
    kind: 'change',
    state: { to: 'done', tool: 'issue_move', needsBlockedBy: false },
  };
  expect(boardCall(server, change)).toEqual({
    name: 'issue_move',
    args: { id: tid(1), to: 'done' },
  });
  expect(boardCall(server, change, { reason: 'fertig', force: true })).toEqual({
    name: 'issue_move',
    args: { id: tid(1), to: 'done', reason: 'fertig', force: true },
  });
});

test('sprint or project lane only calls issue_update', () => {
  const server = testIssue(1, { sprints: ['s1'] });
  expect(
    boardCall(server, {
      kind: 'change',
      lane: { field: 'sprints', remove: ['s1'], add: ['s2'] },
    }),
  ).toEqual({
    name: 'issue_update',
    args: { id: tid(1), add_sprints: ['s2'], rm_sprints: ['s1'] },
  });
  expect(
    boardCall(server, { kind: 'change', lane: { field: 'projects', remove: [], add: ['a/b'] } }),
  ).toEqual({ name: 'issue_update', args: { id: tid(1), add_projects: ['a/b'] } });
});

test('repo lane only goes as a batch', () => {
  const server = testIssue(1, { repos: ['api@main'] });
  expect(
    boardCall(server, {
      kind: 'change',
      lane: { field: 'repos', remove: ['api@main'], add: ['web'] },
    }),
  ).toEqual({
    name: 'batch',
    args: {
      ops: [
        { op: 'issue.edit', id: tid(1), add: { repos: ['web'] }, remove: { repos: ['api@main'] } },
      ],
    },
  });
});

test('lane and column together are one batch with the server state as from', () => {
  const lane = { field: 'sprints', remove: ['s1'], add: ['s2'] } as const;
  const edit = {
    op: 'issue.edit',
    id: tid(1),
    add: { sprints: ['s2'] },
    remove: { sprints: ['s1'] },
  };
  const todo = testIssue(1, { sprints: ['s1'] });
  const move: Change = {
    kind: 'change',
    state: { to: 'review', tool: 'issue_move', needsBlockedBy: false },
    lane: { ...lane, remove: [...lane.remove], add: [...lane.add] },
  };
  expect(boardCall(todo, move)).toEqual({
    name: 'batch',
    args: { ops: [edit, { op: 'issue.move', id: tid(1), from: 'todo', to: 'review' }] },
  });
  expect(boardCall(todo, move, { force: true, reason: 'r' })).toEqual({
    name: 'batch',
    args: {
      ops: [
        edit,
        { op: 'issue.move', id: tid(1), from: 'todo', to: 'review', reason: 'r', force: true },
      ],
    },
  });
  // `force: false` ist kein `true`: Das Schema kennt nur `z.literal(true)`, also fehlt es.
  expect(boardCall(todo, move, { force: false })).toEqual({
    name: 'batch',
    args: { ops: [edit, { op: 'issue.move', id: tid(1), from: 'todo', to: 'review' }] },
  });

  const blocked = testIssue(1, { state: 'blocked', paused_from: 'todo', sprints: ['s1'] });
  expect(
    boardCall(blocked, {
      ...move,
      state: { to: 'todo', tool: 'issue_resume', needsBlockedBy: false },
    }),
  ).toEqual({
    name: 'batch',
    args: { ops: [edit, { op: 'issue.resume', id: tid(1), from: 'blocked' }] },
  });

  const done = testIssue(1, { state: 'done', sprints: ['s1'] });
  expect(
    boardCall(
      done,
      { ...move, state: { to: 'todo', tool: 'issue_reopen', needsBlockedBy: false } },
      { reason: 'doch nicht' },
    ),
  ).toEqual({
    name: 'batch',
    args: {
      ops: [
        edit,
        { op: 'issue.reopen', id: tid(1), from: 'done', to: 'todo', reason: 'doch nicht' },
      ],
    },
  });
});

test('repo lane and column together are one batch', () => {
  const server = testIssue(1, { repos: ['api@main'] });
  expect(
    boardCall(server, {
      kind: 'change',
      state: { to: 'in_progress', tool: 'issue_move', needsBlockedBy: false },
      lane: { field: 'repos', remove: ['api@main'], add: ['web'] },
    }),
  ).toEqual({
    name: 'batch',
    args: {
      ops: [
        { op: 'issue.edit', id: tid(1), add: { repos: ['web'] }, remove: { repos: ['api@main'] } },
        { op: 'issue.move', id: tid(1), from: 'todo', to: 'in_progress' },
      ],
    },
  });
});

test('the overlay merges state and lane', () => {
  const s = snapshotOf([
    testIssue(1, { state: 'blocked', paused_from: 'todo', blocked_by: [tid(2)], sprints: ['s1'] }),
    testIssue(2),
  ]);
  const overlay = boardOverlay(s, tid(1), {
    kind: 'change',
    state: { to: 'review', tool: 'issue_move', needsBlockedBy: false },
    lane: { field: 'sprints', remove: ['s1'], add: ['s2'] },
  });
  expect(overlay).toEqual(
    new Map([
      [tid(1), { state: 'review', paused_from: undefined, blocked_by: undefined, sprints: ['s2'] }],
    ]),
  );
  // Repos: `remove` wörtlich, der Ref-Eintrag fällt weg.
  const r = snapshotOf([testIssue(1, { repos: ['api@main', 'x'] })]);
  expect(
    boardOverlay(r, tid(1), {
      kind: 'change',
      lane: { field: 'repos', remove: ['api@main'], add: ['web'] },
    }),
  ).toEqual(new Map([[tid(1), { repos: ['x', 'web'] }]]));
  // Ein Wechsel, den BK nicht rechnen kann, zeigt keine Vorschau; ein fremdes Issue auch nicht.
  expect(
    boardOverlay(s, tid(2), {
      kind: 'change',
      state: { to: 'todo', tool: 'issue_resume', needsBlockedBy: false },
    }),
  ).toBeUndefined();
  expect(
    boardOverlay(s, 'bk-gone', {
      kind: 'change',
      state: { to: 'review', tool: 'issue_move', needsBlockedBy: false },
    }),
  ).toBeUndefined();
});

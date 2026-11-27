import type { IssueJson, ProjectJson, RepoJson, SprintJson } from '@backe/ui/api.ts';
import { Store } from '../data/store.ts';
import { testIssue, testState, tid } from '../test/state.ts';
import {
  type BoardLane,
  type BoardView,
  boardColumns,
  boardLanes,
  columnOf,
  DEFAULT_BOARD_VIEW,
  laneKeysOf,
  NO_LANE,
  repoNameOf,
} from './board-model.ts';

type Known = {
  sprints?: SprintJson[];
  projects?: ProjectJson[];
  repos?: RepoJson[];
  view?: Partial<BoardView>;
};

/** Bahnen über einem geladenen Store, wie sie das Board aus `/state` rechnet. */
function lanesOf(issues: IssueJson[], known: Known = {}): BoardLane[] {
  const store = new Store();
  store.load(
    testState(issues, {
      sprints: known.sprints ?? [],
      projects: known.projects ?? [],
      repos: known.repos ?? [],
    }),
  );
  const snapshot = store.toSnapshot();
  if (snapshot === undefined) throw new Error('store not loaded');
  const lanes = boardLanes({
    snapshot,
    sprints: store.sprints.list(),
    projects: store.projects.list(),
    repos: store.repos.list(),
    view: { ...DEFAULT_BOARD_VIEW, ...known.view },
  });
  store.dispose();
  return lanes;
}

const keys = (lanes: readonly BoardLane[]) => lanes.map((l) => l.key);
const lane = (lanes: readonly BoardLane[], key: string) => {
  const found = lanes.find((l) => l.key === key);
  if (found === undefined) throw new Error(`no lane ${key}`);
  return found;
};
const cell = (l: BoardLane, column: string) =>
  (l.cells.find((c) => c.column === column)?.cards ?? []).map((c) => c.issue.id);

const sprint = (slug: string, over: Partial<SprintJson> = {}): SprintJson => ({
  slug,
  title: `Sprint ${slug}`,
  ...over,
});
const repo = (name: string): RepoJson => ({ name, url: `https://example.com/${name}.git` });
const project = (path: string): ProjectJson => ({ path, title: `Project ${path}` });

test('columns are the main line, backlog only when shown', () => {
  expect(boardColumns({ group: 'sprint', showBacklog: false })).toEqual([
    'todo',
    'in_progress',
    'review',
    'done',
  ]);
  expect(boardColumns({ group: 'sprint', showBacklog: true })).toEqual([
    'backlog',
    'todo',
    'in_progress',
    'review',
    'done',
  ]);
  expect(DEFAULT_BOARD_VIEW).toEqual({ group: 'sprint', showBacklog: false });

  const issues = [testIssue(1, { state: 'backlog' }), testIssue(2)];
  const hidden = lanesOf(issues, { view: { group: 'none' } });
  expect(hidden[0]?.cells.map((c) => c.column)).toEqual(['todo', 'in_progress', 'review', 'done']);
  expect(hidden[0]?.count).toBe(1);
  const shown = lanesOf(issues, { view: { group: 'none', showBacklog: true } });
  expect(cell(shown[0] as BoardLane, 'backlog')).toEqual([tid(1)]);
  expect(shown[0]?.count).toBe(2);
});

test('paused issues stand in their paused_from column', () => {
  const blocked = testIssue(1, { state: 'blocked', paused_from: 'in_progress' });
  const held = testIssue(2, { state: 'on_hold', paused_from: 'todo' });
  expect(columnOf(blocked)).toBe('in_progress');
  expect(columnOf(held)).toBe('todo');
  expect(columnOf(testIssue(3, { state: 'review' }))).toBe('review');
  // Ohne `paused_from` (Schema verletzt) steht die Karte nirgends, statt in einer geratenen Spalte.
  expect(columnOf(testIssue(4, { state: 'blocked' }))).toBeUndefined();

  const [only] = lanesOf([blocked, held], { view: { group: 'none' } });
  expect(cell(only as BoardLane, 'in_progress')).toEqual([tid(1)]);
  expect(cell(only as BoardLane, 'todo')).toEqual([tid(2)]);
});

test('cancelled and rejected are not on the board', () => {
  const issues = [
    testIssue(1, { state: 'cancelled' }),
    testIssue(2, { state: 'rejected' }),
    testIssue(3),
  ];
  expect(columnOf(issues[0] as IssueJson)).toBeUndefined();
  expect(columnOf(issues[1] as IssueJson)).toBeUndefined();
  const [only] = lanesOf(issues, { view: { group: 'none', showBacklog: true } });
  expect(only?.count).toBe(1);
  expect(only?.cells.flatMap((c) => c.cards.map((k) => k.issue.id))).toEqual([tid(3)]);
});

test('cards sort by rank then created', () => {
  const issues = [
    testIssue(4, { rank: undefined }),
    testIssue(1, { rank: 5000 }),
    testIssue(2, { rank: undefined }),
    testIssue(3, { rank: 2000 }),
  ];
  const [only] = lanesOf(issues, { view: { group: 'none' } });
  expect(cell(only as BoardLane, 'todo')).toEqual([tid(3), tid(1), tid(2), tid(4)]);
});

test('open sprints first by start descending, closed last', () => {
  const sprints = [
    sprint('s-closed', { start: '2026-12-01', closed: true }),
    sprint('s-none'),
    sprint('s-old', { start: '2026-10-01' }),
    sprint('s-new', { start: '2026-11-01' }),
  ];
  const lanes = lanesOf([testIssue(1, { sprints: ['s-old'] })], { sprints });
  expect(keys(lanes)).toEqual(['s-new', 's-old', 's-none', 's-closed']);
  expect(lanes.map((l) => l.closed)).toEqual([false, false, false, true]);
  expect(lane(lanes, 's-new').label).toBe('Sprint s-new');
});

test('an issue in two sprints stands in both lanes', () => {
  const lanes = lanesOf([testIssue(1, { sprints: ['s1', 's2'] }), testIssue(2)], {
    sprints: [sprint('s1'), sprint('s2')],
  });
  expect(cell(lane(lanes, 's1'), 'todo')).toEqual([tid(1)]);
  expect(cell(lane(lanes, 's2'), 'todo')).toEqual([tid(1)]);
  expect(lane(lanes, 's1').count).toBe(1);
});

test('issues without membership go to the last lane', () => {
  const lanes = lanesOf([testIssue(1), testIssue(2, { sprints: ['s1'] })], {
    sprints: [sprint('s1'), sprint('s2', { closed: true })],
  });
  expect(keys(lanes)).toEqual(['s1', 's2', NO_LANE]);
  const last = lane(lanes, NO_LANE);
  expect(last.label).toBe('');
  expect(last.closed).toBe(false);
  expect(cell(last, 'todo')).toEqual([tid(1)]);
});

test('empty known lanes are shown, an empty no-lane is not', () => {
  const lanes = lanesOf([testIssue(1, { sprints: ['s1'] })], {
    sprints: [sprint('s1'), sprint('s2')],
  });
  expect(keys(lanes)).toEqual(['s1', 's2']);
  const empty = lane(lanes, 's2');
  expect(empty.count).toBe(0);
  expect(empty.cells.map((c) => c.column)).toEqual(['todo', 'in_progress', 'review', 'done']);
  expect(empty.cells.every((c) => c.cards.length === 0)).toBe(true);
});

test('projects by path, repos by name', () => {
  const issues = [testIssue(1, { projects: ['a/x'], repos: ['api@main'] })];
  const known = {
    projects: [project('b'), project('a/x'), project('a')],
    repos: [repo('web'), repo('api')],
  };
  const byProject = lanesOf(issues, { ...known, view: { group: 'project' } });
  expect(keys(byProject)).toEqual(['a', 'a/x', 'b']);
  expect(lane(byProject, 'a/x').label).toBe('a/x');
  expect(cell(lane(byProject, 'a/x'), 'todo')).toEqual([tid(1)]);
  // Die Mitgliedschaft gilt direkt: `a/x` macht ein Issue nicht zum Mitglied von `a`.
  expect(lane(byProject, 'a').count).toBe(0);

  const byRepo = lanesOf(issues, { ...known, view: { group: 'repo' } });
  expect(keys(byRepo)).toEqual(['api', 'web']);
  expect(lane(byRepo, 'api').label).toBe('api');
  expect(cell(lane(byRepo, 'api'), 'todo')).toEqual([tid(1)]);
});

test('lane keys come from memberships, repo entries by name', () => {
  expect(repoNameOf('api@main')).toBe('api');
  expect(repoNameOf('api')).toBe('api');
  expect(repoNameOf('api@feature/x@2')).toBe('api');
  expect(repoNameOf('@broken')).toBe('');
  const issue = testIssue(1, {
    sprints: ['s1', 's2'],
    projects: ['a/x'],
    repos: ['api@main', 'api@dev', 'web'],
  });
  expect(laneKeysOf(issue, 'sprint')).toEqual(['s1', 's2']);
  expect(laneKeysOf(issue, 'project')).toEqual(['a/x']);
  // Zwei Refs desselben Repos sind eine Bahn, sonst stünde die Karte zweimal darin.
  expect(laneKeysOf(issue, 'repo')).toEqual(['api', 'web']);
  expect(laneKeysOf(issue, 'none')).toEqual([NO_LANE]);
  expect(laneKeysOf(testIssue(2), 'sprint')).toEqual([NO_LANE]);
  expect(laneKeysOf(testIssue(3, { repos: [] }), 'repo')).toEqual([NO_LANE]);
});

test('unknown memberships get their own lane', () => {
  const issues = [testIssue(1, { sprints: ['ghost'], projects: ['x/y'], repos: ['cli@dev'] })];
  const known = {
    sprints: [sprint('s-new', { start: '2026-11-01' }), sprint('s-closed', { closed: true })],
    projects: [project('a')],
    repos: [repo('web')],
  };
  const bySprint = lanesOf(issues, known);
  // Ein unbekannter Slug zählt als offen ohne `start`: hinter den datierten, vor den geschlossenen.
  expect(keys(bySprint)).toEqual(['s-new', 'ghost', 's-closed']);
  expect(lane(bySprint, 'ghost')).toMatchObject({ label: 'ghost', closed: false, count: 1 });

  const byProject = lanesOf(issues, { ...known, view: { group: 'project' } });
  expect(keys(byProject)).toEqual(['a', 'x/y']);
  expect(lane(byProject, 'x/y').label).toBe('x/y');

  const byRepo = lanesOf(issues, { ...known, view: { group: 'repo' } });
  expect(keys(byRepo)).toEqual(['cli', 'web']);
  expect(cell(lane(byRepo, 'cli'), 'todo')).toEqual([tid(1)]);
});

test('group none has one lane', () => {
  const issues = [testIssue(1, { sprints: ['s1'] }), testIssue(2, { state: 'done' })];
  const lanes = lanesOf(issues, { sprints: [sprint('s1')], view: { group: 'none' } });
  expect(keys(lanes)).toEqual([NO_LANE]);
  expect(lanes[0]).toMatchObject({ label: '', closed: false, count: 2 });
  expect(cell(lanes[0] as BoardLane, 'done')).toEqual([tid(2)]);
  // Auch ohne ein einziges Issue gibt es die eine Bahn: Sie ist das ganze Board.
  expect(keys(lanesOf([], { view: { group: 'none' } }))).toEqual([NO_LANE]);
});

test('cards carry open dependencies and sub-issue progress', () => {
  const issues = [
    testIssue(1, { depends_on: [tid(2)] }),
    testIssue(2),
    testIssue(3),
    testIssue(4, { parent: tid(3), state: 'done' }),
    testIssue(5, { parent: tid(3) }),
    testIssue(6, { depends_on: [tid(4)] }),
  ];
  const [only] = lanesOf(issues, { view: { group: 'none' } });
  const card = (id: string) => only?.cells.flatMap((c) => c.cards).find((c) => c.issue.id === id);
  expect(card(tid(1))?.openDeps).toBe(true);
  expect(card(tid(6))?.openDeps).toBe(false);
  expect(card(tid(3))?.progress).toEqual({ settled: 1, total: 2 });
  expect(card(tid(2))?.progress).toBeUndefined();
  expect(card(tid(2))).not.toHaveProperty('progress');
});

test('a card cache decides the card objects', () => {
  const store = new Store();
  store.load(testState([testIssue(1, { sprints: ['s1', 's2'] })]));
  const snapshot = store.toSnapshot();
  if (snapshot === undefined) throw new Error('store not loaded');
  const made: string[] = [];
  const lanes = boardLanes({
    snapshot,
    sprints: [],
    projects: [],
    repos: [],
    view: DEFAULT_BOARD_VIEW,
    card: (issue, openDeps, progress) => {
      made.push(issue.id);
      return { issue, openDeps, ...(progress === undefined ? {} : { progress }) };
    },
  });
  // Eine Karte je Issue, auch wenn es in zwei Bahnen steht.
  expect(made).toEqual([tid(1)]);
  expect(lane(lanes, 's1').cells[0]?.cards[0]).toBe(lane(lanes, 's2').cells[0]?.cards[0]);
  store.dispose();
});

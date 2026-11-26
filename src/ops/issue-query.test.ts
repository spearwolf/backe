import { I, snap } from '../../test/helpers/snapshot.ts';
import { selectIssues } from './issue-query.ts';

const ids = (out: ReturnType<typeof selectIssues>) => out.map((e) => e.issue.id);

test('selectIssues keeps open issues by default and orders by rank', () => {
  const s = snap({
    issues: [
      { id: I(1), state: 'done', rank: 500 },
      { id: I(2), rank: 2000 },
      { id: I(3), rank: 1000 },
    ],
  });
  expect(ids(selectIssues(s, { filter: {} }))).toEqual([I(3), I(2)]);
  expect(ids(selectIssues(s, { filter: {}, states: 'all' }))).toEqual([I(1), I(3), I(2)]);
});

test('tree puts children under a parent that is in the set, else at the root', () => {
  const s = snap({
    projects: ['web', 'ops'],
    issues: [
      { id: I(1), rank: 1, projects: ['web'] },
      { id: I(2), rank: 2, parent: I(1), projects: ['web'] },
      { id: I(3), rank: 3, parent: I(1), projects: ['ops'] },
    ],
  });
  const all = selectIssues(s, { filter: {}, tree: true });
  expect(all.map((e) => [e.issue.id, e.depth])).toEqual([
    [I(1), 0],
    [I(2), 1],
    [I(3), 1],
  ]);
  const ops = selectIssues(s, { filter: { project: ['ops'] }, tree: true });
  expect(ops.map((e) => [e.issue.id, e.depth])).toEqual([[I(3), 0]]);
});

test("assignee 'none' keeps only unassigned issues", () => {
  const s = snap({ issues: [{ id: I(1), assignee: 'spw' }, { id: I(2) }] });
  expect(ids(selectIssues(s, { filter: {}, assignee: 'none' }))).toEqual([I(2)]);
  expect(ids(selectIssues(s, { filter: {}, assignee: 'spw' }))).toEqual([I(1)]);
});

test('text matches title or body, case-insensitive', () => {
  const s = snap({
    issues: [
      { id: I(1), title: 'Login bricht' },
      { id: I(2), title: 'Anderes' },
    ],
  });
  const second = s.issues.get(I(2));
  if (second === undefined) throw new Error('fixture without I(2)');
  const withBody = {
    ...s,
    issues: new Map(s.issues).set(I(2), { ...second, body: 'Trace: LOGIN' }),
  };
  expect(ids(selectIssues(withBody, { filter: {}, text: 'login' }))).toEqual([I(1), I(2)]);
});

test('openDeps marks dependencies that are missing or not settled', () => {
  const s = snap({
    issues: [
      { id: I(1), state: 'done' },
      { id: I(2), depends_on: [I(1)] },
      { id: I(3), depends_on: [I(2)] },
    ],
  });
  expect(selectIssues(s, { filter: {} }).map((e) => [e.issue.id, e.openDeps])).toEqual([
    [I(2), false],
    [I(3), true],
  ]);
});

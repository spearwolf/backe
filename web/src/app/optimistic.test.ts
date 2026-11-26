import { BackeError } from '@backe/core/errors.ts';
import { rankPlacement } from '@backe/ops/rank.ts';
import { Store } from '../data/store.ts';
import { testIssue, testState, tid } from '../test/state.ts';
import { preview, rankOverlay, stateOverlay, updateOverlay } from './optimistic.ts';

function snapshot(...issues: ReturnType<typeof testIssue>[]) {
  const store = new Store();
  store.load(testState(issues));
  const s = store.toSnapshot();
  if (s === undefined) throw new Error('no snapshot');
  store.dispose();
  return s;
}

test('state overlay equals planTransition', () => {
  const s = snapshot(testIssue(1, { state: 'in_progress' }), testIssue(2));
  const blocked = stateOverlay(
    s,
    tid(1),
    { to: 'blocked', tool: 'issue_move', needsBlockedBy: true },
    [tid(2)],
  );
  expect(blocked.get(tid(1))).toEqual({
    state: 'blocked',
    paused_from: 'in_progress',
    blocked_by: [tid(2)],
  });
  const s2 = snapshot(
    testIssue(1, { state: 'blocked', paused_from: 'in_progress', blocked_by: [tid(2)] }),
    testIssue(2),
  );
  const resumed = stateOverlay(s2, tid(1), {
    to: 'in_progress',
    tool: 'issue_resume',
    needsBlockedBy: false,
  }).get(tid(1));
  expect(resumed).toEqual({ state: 'in_progress', paused_from: undefined, blocked_by: undefined });
  // `undefined` muss als Schlüssel dastehen: so löscht die Überlagerung das Feld.
  expect(resumed && 'paused_from' in resumed).toBe(true);
});

test('state overlay of a no-op is empty', () => {
  const s = snapshot(testIssue(1, { state: 'todo' }));
  expect(
    stateOverlay(s, tid(1), { to: 'todo', tool: 'issue_move', needsBlockedBy: false }).size,
  ).toBe(0);
});

test('rank overlay equals rankPlacement', () => {
  const s = snapshot(
    testIssue(1, { rank: 1000 }),
    testIssue(2, { rank: 1001 }),
    testIssue(3, { rank: 5000 }),
  );
  const o = rankOverlay(s, tid(3), { before: tid(2) });
  const expected = rankPlacement(s, tid(3), { before: tid(2) });
  expect(expected.size).toBeGreaterThan(1);
  expect(new Map([...o].map(([k, v]) => [k, v.rank]))).toEqual(expected);
});

test('update overlay adds, removes and unsets', () => {
  const issue = testIssue(1, {
    assignee: 'spw',
    parent: tid(9),
    projects: ['a', 'b'],
    depends_on: [tid(2)],
    sprints: ['s1'],
    props: { x: 1, y: 'z' },
  });
  const o = updateOverlay(issue, {
    id: issue.id,
    title: 'Neu',
    body: 'ignored',
    assignee: null,
    parent: tid(8),
    add_projects: ['b', 'c'],
    rm_projects: ['a'],
    rm_sprints: ['s1'],
    add_deps: [tid(3)],
    props: { x: null, w: true },
  });
  expect(o.get(issue.id)).toEqual({
    title: 'Neu',
    assignee: undefined,
    parent: tid(8),
    projects: ['b', 'c'],
    sprints: undefined,
    depends_on: [tid(2), tid(3)],
    props: { y: 'z', w: true },
  });
});

test('update overlay leaves untouched fields out and clears empty props', () => {
  const issue = testIssue(1, { props: { x: 1 } });
  expect(updateOverlay(issue, { id: issue.id }).get(issue.id)).toEqual({});
  const cleared = updateOverlay(issue, { id: issue.id, parent: null, props: { x: null } });
  expect(cleared.get(issue.id)).toEqual({ parent: undefined, props: undefined });
});

test('a preview the calculation rejects is left out, other errors fly on', () => {
  expect(preview(() => 1)).toBe(1);
  expect(
    preview(() => {
      throw new BackeError('validation', 'nein');
    }),
  ).toBeUndefined();
  expect(() =>
    preview(() => {
      throw new TypeError('bug');
    }),
  ).toThrow(TypeError);
});

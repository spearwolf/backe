import { Store } from '../data/store.ts';
import { testIssue, testState, tid } from '../test/state.ts';
import { issueRelations } from './issue-relations.ts';

const ROOT = tid(1);
const MID = tid(2);
const LEAF = tid(3);

function relations(id: string, ...issues: ReturnType<typeof testIssue>[]) {
  const store = new Store();
  store.load(testState(issues));
  const s = store.toSnapshot();
  if (s === undefined) throw new Error('no snapshot');
  const r = issueRelations(s, id);
  store.dispose();
  return r;
}

const ids = (refs: readonly { id: string }[] | undefined) => refs?.map((r) => r.id);

test('parents follow ancestors, nearest first', () => {
  const r = relations(
    LEAF,
    testIssue(1),
    testIssue(2, { parent: ROOT }),
    testIssue(3, { parent: MID }),
  );
  expect(ids(r?.parents)).toEqual([MID, ROOT]);
});

test('depends_on keeps file order and marks missing ids', () => {
  const r = relations(
    tid(1),
    testIssue(1, { depends_on: [tid(3), tid(9), tid(2)] }),
    testIssue(2),
    testIssue(3),
  );
  expect(r?.dependsOn).toEqual([
    { id: tid(3), state: 'todo', title: 'Issue 3' },
    { id: tid(9), missing: true },
    { id: tid(2), state: 'todo', title: 'Issue 2' },
  ]);
});

test('blocked_by lists only existing issues', () => {
  const r = relations(tid(1), testIssue(1, { blocked_by: [tid(9), tid(2)] }), testIssue(2));
  expect(ids(r?.blockedBy)).toEqual([tid(2)]);
});

test('dependents and children sorted like issue show', () => {
  const r = relations(
    tid(1),
    testIssue(1),
    testIssue(2, { parent: tid(1), rank: 3000 }),
    testIssue(3, { parent: tid(1), rank: 1000 }),
    testIssue(4, { depends_on: [tid(1)], rank: 2000 }),
    testIssue(5, { depends_on: [tid(1)], rank: 500 }),
  );
  expect(ids(r?.children)).toEqual([tid(3), tid(2)]);
  expect(ids(r?.dependents)).toEqual([tid(5), tid(4)]);
});

test('progress counts settled children', () => {
  const r = relations(
    tid(1),
    testIssue(1),
    testIssue(2, { parent: tid(1), state: 'done' }),
    testIssue(3, { parent: tid(1) }),
  );
  expect(r?.progress).toEqual({ settled: 1, total: 2 });
});

test('an unknown issue has no relations', () => {
  expect(relations(tid(9), testIssue(1))).toBeUndefined();
});

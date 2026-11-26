import { Store } from '../data/store.ts';
import { testIssue, testState, tid } from '../test/state.ts';
import { deletePlan } from './delete-plan.ts';

function snapshot(...issues: ReturnType<typeof testIssue>[]) {
  const store = new Store();
  store.load(testState(issues));
  const s = store.toSnapshot();
  if (s === undefined) throw new Error('no snapshot');
  store.dispose();
  return s;
}

const s = snapshot(
  testIssue(1),
  testIssue(3, { parent: tid(1) }),
  testIssue(2, { parent: tid(1) }),
  testIssue(4, { parent: tid(2) }),
  testIssue(5, { depends_on: [tid(1)] }),
  testIssue(6, { state: 'blocked', blocked_by: [tid(4)] }),
  testIssue(7),
);

test('delete plan names children and references', () => {
  expect(deletePlan(s, tid(1))).toEqual({ children: [tid(2), tid(3)], referencing: [tid(5)] });
  expect(deletePlan(s, tid(1), 'orphan')).toEqual({
    children: [tid(2), tid(3)],
    referencing: [tid(5)],
  });
});

test('recursive delete plan counts descendants as deleted', () => {
  expect(deletePlan(s, tid(1), 'recursive')).toEqual({
    children: [tid(2), tid(3)],
    referencing: [tid(5), tid(6)],
  });
});

test('a leaf has neither children nor references', () => {
  expect(deletePlan(s, tid(7))).toEqual({ children: [], referencing: [] });
});

test('references among the deleted do not count', () => {
  const t = snapshot(testIssue(1), testIssue(2, { parent: tid(1), depends_on: [tid(1)] }));
  expect(deletePlan(t, tid(1), 'recursive')).toEqual({ children: [tid(2)], referencing: [] });
});

import { Store } from '../../../data/store.ts';
import { testIssue, testPatch, testState, tid } from '../../../test/state.ts';
import { issueOptions, openSprints } from './store-options.ts';

function setup() {
  const store = new Store();
  store.load(
    testState([testIssue(1), testIssue(2)], {
      sprints: [{ slug: 's1', title: 'S1' }] as never,
    }),
  );
  return store;
}

test('issue options stay the same array while ids and titles stay', () => {
  const store = setup();
  const options = issueOptions(store);
  const first = options();
  expect(first).toEqual([
    { id: tid(1), title: 'Issue 1' },
    { id: tid(2), title: 'Issue 2' },
  ]);
  // Nur ein State ändert sich: Die Vorschlagslisten der offenen Tabs rendern nicht neu.
  store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(1, { state: 'done' })] } }));
  expect(options()).toBe(first);
  store.applyPatch(testPatch(3, { upsert: { issues: [testIssue(1, { title: 'Neu' })] } }));
  expect(options()).not.toBe(first);
  expect(options()[0]).toEqual({ id: tid(1), title: 'Neu' });
  store.applyPatch(testPatch(4, { remove: { issues: [tid(2)] } }));
  expect(options().map((o) => o.id)).toEqual([tid(1)]);
  store.dispose();
});

test('open sprints stay the same array while the slugs stay', () => {
  const store = setup();
  const sprints = openSprints(store);
  const first = sprints();
  expect(first).toEqual(['s1']);
  store.applyPatch(
    testPatch(2, { upsert: { sprints: [{ slug: 's1', title: 'Umbenannt' }] as never } }),
  );
  expect(sprints()).toBe(first);
  store.applyPatch(
    testPatch(3, { upsert: { sprints: [{ slug: 's1', title: 'S1', closed: true }] as never } }),
  );
  expect(sprints()).toEqual([]);
  store.dispose();
});

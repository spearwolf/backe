import { Store } from '../data/store.ts';
import { Writes } from '../data/writes.ts';
import { testIssue, testState, tid } from '../test/state.ts';
import { rank } from './rank-write.ts';

function setup() {
  const store = new Store();
  store.load(testState([testIssue(1), testIssue(2)]));
  const call = vi.fn(() => new Promise<never>(() => {}));
  const writes = new Writes(store, {
    call: call as never,
    upload: (async () => ({ commit: null })) as never,
    refresh: async () => {},
  });
  return { store, writes, call };
}

test('a move with a preview asks the view to follow', () => {
  const { store, writes, call } = setup();
  expect(rank(store, writes, tid(2), { before: tid(1) })).toBe(true);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(2), before: tid(1) });
  expect(store.issues.get(tid(2)).value?.rank).toBeLessThan(1000);
});

test('a move without preview leaves the view alone and the server decides', () => {
  const { store, writes, call } = setup();
  // Ein Anker, den der Client nicht kennt: Die Vorschau lehnt ab, nichts ist umsortiert.
  expect(rank(store, writes, tid(2), { before: 'bk-gone' })).toBe(false);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(2), before: 'bk-gone' });
  expect(store.issues.get(tid(2)).value?.rank).toBe(2000);
});

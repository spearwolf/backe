import { afterEach, expect, test, vi } from 'vitest';
import { Store } from '../data/store.ts';
import { testIssue, testPatch, testState, tid } from '../test/state.ts';
import { buildSearchIndex, searchStore } from './search.ts';
import { createSearchIndex } from './search-index.ts';

// Zählt jeden Aufbau des Index, ohne ihn zu verändern.
vi.mock('./search.ts', async (original) => {
  const mod = await original<typeof import('./search.ts')>();
  return { ...mod, buildSearchIndex: vi.fn(mod.buildSearchIndex) };
});
const builds = vi.mocked(buildSearchIndex);

afterEach(() => builds.mockClear());

const idsOf = (read: () => ReturnType<typeof buildSearchIndex>, q: string) =>
  searchStore(read(), q, 'bk').flatMap((g) =>
    g.hits.map((h) => (h.kind === 'issue' ? h.issue.id : '')),
  );

test('the index computes once while alive and once per patch', () => {
  const store = new Store();
  store.load(testState([testIssue(1, { title: 'Alt' })]));
  const owned = createSearchIndex(store);
  owned.index();
  owned.index();
  expect(builds).toHaveBeenCalledTimes(1);
  expect(idsOf(owned.index, 'neu')).toEqual([]);

  // Ein Patch über zwei Tabellen baut ihn genau einmal neu.
  store.applyPatch(
    testPatch(2, {
      upsert: {
        issues: [testIssue(2, { title: 'Neu' })],
        users: [{ handle: 'ana', name: 'Ana', kind: 'human', admin: false }],
      },
    }),
  );
  expect(builds).toHaveBeenCalledTimes(2);
  expect(idsOf(owned.index, 'neu')).toEqual([tid(2)]);
  owned.index();
  expect(builds).toHaveBeenCalledTimes(2);
  owned.dispose();
  store.dispose();
});

test('a disposed index no longer follows patches', () => {
  const store = new Store();
  store.load(testState([testIssue(1)]));
  createSearchIndex(store).dispose();
  expect(builds).toHaveBeenCalledTimes(1);
  store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(2)] } }));
  expect(builds).toHaveBeenCalledTimes(1);
  store.dispose();
});

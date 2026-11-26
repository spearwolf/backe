import { createSignal } from '@spearwolf/signalize';
import { Store } from '../data/store.ts';
import { testIssue, testPatch, testState, tid } from '../test/state.ts';
import { BacklogListModel, type ListRow, SEARCH_DEBOUNCE_MS, ViewPrefs } from './backlog-list.ts';
import { DEFAULT_VIEW, EMPTY_FILTER, type ListFilter, type ListView } from './list-filter.ts';

const ids = (rows: readonly ListRow[]) => rows.map((r) => r.issue.id);

type Pending = { q: string; resolve(ids: string[]): void; reject(err: Error): void };

/** Ein Listenmodell über einem geladenen Store; `search` hält jede Anfrage offen, bis der Test antwortet. */
function setup(issues = [testIssue(1), testIssue(2), testIssue(3, { state: 'done' })]) {
  const store = new Store();
  store.load(testState(issues));
  const filter = createSignal<ListFilter>(EMPTY_FILTER);
  const view = createSignal<ListView>({ tree: false, sort: 'rank' });
  const pending: Pending[] = [];
  const search = (q: string) =>
    new Promise<string[]>((resolve, reject) => {
      pending.push({ q, resolve, reject });
    });
  const model = new BacklogListModel(store, {
    filter: filter.get,
    view: view.get,
    me: 'spw',
    search,
  });
  return { store, filter, view, model, pending };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

test('rows follow selectIssues on the store snapshot', () => {
  const { model, filter, view } = setup();
  expect(ids(model.selected())).toEqual([tid(1), tid(2)]);
  filter.set({ ...EMPTY_FILTER, states: ['all'] });
  expect(ids(model.selected())).toEqual([tid(1), tid(2), tid(3)]);
  view.set({ tree: false, sort: 'created' });
  expect(model.selected().map((r) => r.depth)).toEqual([0, 0, 0]);
  model.dispose();
});

test('rows follow a patch', () => {
  const { model, store } = setup();
  store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(4, { rank: 1 })] } }));
  expect(ids(model.selected())).toEqual([tid(4), tid(1), tid(2)]);
  model.dispose();
});

test('rows carry sub-issue progress', () => {
  const { model } = setup([
    testIssue(1),
    testIssue(2, { parent: tid(1) }),
    testIssue(3, { parent: tid(1), state: 'done' }),
  ]);
  const rows = model.selected();
  expect(rows.map((r) => [r.issue.id, r.depth, r.progress])).toEqual([
    [tid(1), 0, { settled: 1, total: 2 }],
    [tid(2), 0, undefined],
  ]);
  model.dispose();
});

test('filter errors come from the selector', () => {
  const { model, filter } = setup();
  filter.set({ ...EMPTY_FILTER, mode: 'fast' });
  expect(model.errors().map((e) => e.field)).toEqual(['mode']);
  model.dispose();
});

test('body hits join after the debounce', async () => {
  const { model, filter, pending } = setup([
    testIssue(1, { title: 'Zebra' }),
    testIssue(2, { title: 'Pferd' }),
  ]);
  filter.set({ ...EMPTY_FILTER, text: 'zebra' });
  expect(ids(model.selected())).toEqual([tid(1)]);
  expect(model.bodySearch.value).toBe('pending');
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
  expect(pending).toHaveLength(0);
  vi.advanceTimersByTime(1);
  expect(pending.map((p) => p.q)).toEqual(['zebra']);
  pending[0]?.resolve([tid(2)]);
  await vi.runAllTimersAsync();
  expect(ids(model.selected())).toEqual([tid(1), tid(2)]);
  expect(model.bodySearch.value).toBe('idle');
  model.dispose();
});

test('stale search answers are ignored', async () => {
  const { model, filter, pending } = setup();
  filter.set({ ...EMPTY_FILTER, text: 'ab' });
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  filter.set({ ...EMPTY_FILTER, text: 'abc' });
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  expect(pending.map((p) => p.q)).toEqual(['ab', 'abc']);
  pending[1]?.resolve([tid(1)]);
  await vi.runAllTimersAsync();
  pending[0]?.resolve([tid(2)]);
  await vi.runAllTimersAsync();
  expect(ids(model.selected())).toEqual([tid(1)]);
  model.dispose();
});

test('a new head searches again', async () => {
  const { model, filter, store, pending } = setup();
  filter.set({ ...EMPTY_FILTER, text: 'x' });
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  pending[0]?.resolve([]);
  await vi.runAllTimersAsync();
  store.applyPatch(testPatch(2));
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  expect(pending.map((p) => p.q)).toEqual(['x', 'x']);
  model.dispose();
});

test('a failed search keeps title matches', async () => {
  const { model, filter, pending } = setup([testIssue(1, { title: 'Zebra' }), testIssue(2)]);
  filter.set({ ...EMPTY_FILTER, text: 'zebra' });
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  pending[0]?.reject(new Error('offline'));
  await vi.runAllTimersAsync();
  expect(model.bodySearch.value).toBe('failed');
  expect(ids(model.selected())).toEqual([tid(1)]);
  model.dispose();
});

test('clearing the text stops the search', () => {
  const { model, filter, pending } = setup();
  filter.set({ ...EMPTY_FILTER, text: 'x' });
  filter.set(EMPTY_FILTER);
  vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  expect(pending).toHaveLength(0);
  expect(model.bodySearch.value).toBe('idle');
  model.dispose();
});

test('view prefs default and persist per backlog', () => {
  const prefs = new ViewPrefs('acme');
  expect(prefs.view.value).toEqual(DEFAULT_VIEW);
  prefs.set({ tree: false, sort: 'created' });
  prefs.dispose();
  expect(new ViewPrefs('acme').view.value).toEqual({ tree: false, sort: 'created' });
  expect(new ViewPrefs('other').view.value).toEqual(DEFAULT_VIEW);
});

test('view prefs reject foreign json', () => {
  localStorage.setItem('backe-ui:acme:backlog-view', JSON.stringify({ tree: 'x', sort: 'rank' }));
  expect(new ViewPrefs('acme').view.value).toEqual(DEFAULT_VIEW);
});

test('view prefs survive a broken storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
  try {
    const prefs = new ViewPrefs('acme');
    expect(prefs.view.value).toEqual(DEFAULT_VIEW);
    expect(() => prefs.set({ tree: false, sort: 'rank' })).not.toThrow();
    expect(prefs.view.value).toEqual({ tree: false, sort: 'rank' });
  } finally {
    if (original !== undefined) Object.defineProperty(globalThis, 'localStorage', original);
  }
});

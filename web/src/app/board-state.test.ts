import { createSignal } from '@spearwolf/signalize';
import { Store } from '../data/store.ts';
import { testIssue, testPatch, testState, tid } from '../test/state.ts';
import { type BoardLane, type BoardView, DEFAULT_BOARD_VIEW, NO_LANE } from './board-model.ts';
import { BoardModel, BoardPrefs } from './board-state.ts';

afterEach(() => localStorage.clear());

const laneOf = (key: string, closed = false): BoardLane => ({
  key,
  label: key,
  closed,
  count: 0,
  cells: [],
});

test('prefs survive in localStorage and tolerate garbage', () => {
  localStorage.setItem('backe-ui:acme:board-view', '{broken');
  localStorage.setItem('backe-ui:acme:board-lanes', JSON.stringify({ sprint: { s1: 'yes' } }));
  const broken = new BoardPrefs('acme');
  expect(broken.view.value).toEqual(DEFAULT_BOARD_VIEW);
  expect(broken.folded.value).toEqual({});
  broken.dispose();

  localStorage.setItem(
    'backe-ui:acme:board-view',
    JSON.stringify({ group: 'nope', showBacklog: false }),
  );
  localStorage.setItem('backe-ui:acme:board-lanes', JSON.stringify([true]));
  const foreign = new BoardPrefs('acme');
  expect(foreign.view.value).toEqual(DEFAULT_BOARD_VIEW);
  expect(foreign.folded.value).toEqual({});

  foreign.setView({ group: 'repo', showBacklog: true });
  expect(foreign.view.value).toEqual({ group: 'repo', showBacklog: true });
  foreign.setFolded('repo', 'api', true);
  foreign.dispose();

  const again = new BoardPrefs('acme');
  expect(again.view.value).toEqual({ group: 'repo', showBacklog: true });
  expect(again.folded.value).toEqual({ repo: { api: true } });
  again.dispose();
  expect(new BoardPrefs('other').view.value).toEqual(DEFAULT_BOARD_VIEW);
});

test('prefs survive a broken storage', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
  try {
    const prefs = new BoardPrefs('acme');
    expect(prefs.view.value).toEqual(DEFAULT_BOARD_VIEW);
    prefs.setView({ group: 'none', showBacklog: false });
    prefs.setFolded('none', NO_LANE, true);
    expect(prefs.view.value).toEqual({ group: 'none', showBacklog: false });
    expect(prefs.isFolded('none', laneOf(NO_LANE))).toBe(true);
    prefs.dispose();
  } finally {
    if (original !== undefined) Object.defineProperty(globalThis, 'localStorage', original);
  }
});

test('closed sprints start folded, a toggle sticks per group', () => {
  const prefs = new BoardPrefs('acme');
  const closed = laneOf('s-closed', true);
  const open = laneOf('s1');
  expect(prefs.isFolded('sprint', closed)).toBe(true);
  expect(prefs.isFolded('sprint', open)).toBe(false);
  // Ein Slug wie `constructor` liest keinen geerbten Wert aus dem Objekt-Prototyp.
  expect(prefs.isFolded('sprint', laneOf('constructor'))).toBe(false);

  prefs.setFolded('sprint', 's-closed', false);
  prefs.setFolded('sprint', 's1', true);
  expect(prefs.isFolded('sprint', closed)).toBe(false);
  expect(prefs.isFolded('sprint', open)).toBe(true);
  // Dieselbe Bahn unter einer anderen Gruppierung bleibt unberührt.
  expect(prefs.isFolded('project', open)).toBe(false);
  prefs.dispose();

  const again = new BoardPrefs('acme');
  expect(again.isFolded('sprint', closed)).toBe(false);
  expect(again.isFolded('sprint', open)).toBe(true);
  expect(again.folded.value).toEqual({ sprint: { 's-closed': false, s1: true } });
  again.dispose();
});

test('a patch to one issue keeps the other cards identical', () => {
  const store = new Store();
  store.load(
    testState([testIssue(1, { sprints: ['s1'] }), testIssue(2, { sprints: ['s1'] })], {
      sprints: [{ slug: 's1', title: 'One' }],
    }),
  );
  const view = createSignal<BoardView>(DEFAULT_BOARD_VIEW);
  const model = new BoardModel(store, view.get);
  const cards = () => model.lanes()[0]?.cells[0]?.cards ?? [];
  const [one, two] = cards();
  expect(cards().map((c) => c.issue.id)).toEqual([tid(1), tid(2)]);

  store.applyPatch(
    testPatch(2, { upsert: { issues: [testIssue(2, { sprints: ['s1'], title: 'Renamed' })] } }),
  );
  const [oneAfter, twoAfter] = cards();
  expect(oneAfter).toBe(one);
  expect(twoAfter).not.toBe(two);
  expect(twoAfter?.issue.title).toBe('Renamed');

  // Ein Wechsel der Ansicht baut die Bahnen neu, die Karten bleiben dieselben Objekte.
  view.set({ group: 'none', showBacklog: false });
  expect(model.lanes().map((l) => l.key)).toEqual([NO_LANE]);
  expect(cards()[0]).toBe(one);

  // Ein neuer Sprint im Store ist sofort eine Bahn.
  view.set(DEFAULT_BOARD_VIEW);
  store.applyPatch(testPatch(3, { upsert: { sprints: [{ slug: 's2', title: 'Two' }] } }));
  expect(model.lanes().map((l) => l.key)).toEqual(['s1', 's2']);
  model.dispose();
  store.dispose();
});

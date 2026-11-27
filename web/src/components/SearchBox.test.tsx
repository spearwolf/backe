import type { StateJson } from '@backe/ui/api.ts';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Router, RouterContext } from '../app/router.ts';
import { buildSearchIndex } from '../app/search.ts';
import { Store } from '../data/store.ts';
import { StoreContext } from '../data/store-context.tsx';
import { type WriteAccess, WriteContext } from '../data/write-context.tsx';
import { testIssue, testPatch, testState, tid } from '../test/state.ts';
import { m } from '../views/search.messages.ts';
import { SearchBox } from './SearchBox.tsx';

// Zählt jeden Aufbau des Suchindex, ohne ihn zu verändern.
vi.mock('../app/search.ts', async (original) => {
  const mod = await original<typeof import('../app/search.ts')>();
  return { ...mod, buildSearchIndex: vi.fn(mod.buildSearchIndex) };
});
const builds = vi.mocked(buildSearchIndex);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let router: Router | undefined;
let store: Store;

beforeEach(() => {
  window.history.replaceState(null, '', '/b/acme/backlog');
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  router?.dispose();
  document.body.innerHTML = '';
});

function mount(over: Partial<StateJson> = {}, canWrite = true) {
  router = new Router(window);
  store = new Store();
  store.load(
    testState([testIssue(1, { title: 'Alpha Login' }), testIssue(2, { title: 'Alpha Export' })], {
      projects: [{ path: 'web', title: 'Webseite' }] as StateJson['projects'],
      sprints: [{ slug: 'sprint-1', title: 'Erster' }] as StateJson['sprints'],
      repos: [{ name: 'core', url: 'https://example.com/core.git' }] as StateJson['repos'],
      users: [{ handle: 'alice', name: 'Alice', kind: 'human', admin: false }],
      ...over,
    }),
  );
  const access = { backlog: 'acme', canWrite, me: 'spw', writes: {} } as unknown as WriteAccess;
  render(
    <RouterContext.Provider value={router}>
      <StoreContext.Provider value={store}>
        <WriteContext.Provider value={access}>
          <SearchBox backlog="acme" />
          <button type="button">outside</button>
        </WriteContext.Provider>
      </StoreContext.Provider>
    </RouterContext.Provider>,
  );
  return screen.getByRole('combobox', { name: m.label }) as HTMLInputElement;
}

const here = () => window.location.pathname + window.location.search;

test('typing shows grouped hits with the exact id first', async () => {
  const input = mount();
  await userEvent.type(input, 'bk-t0001');
  const issues = screen.getByRole('group', { name: m.groupIssues });
  const first = within(issues).getAllByRole('option')[0] as HTMLElement;
  expect(first.textContent).toContain(tid(1));
  expect(first.textContent).toContain(m.exact);
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(input.getAttribute('aria-activedescendant')).toBe(first.id);
  expect(first.getAttribute('aria-selected')).toBe('true');
});

test('arrow keys and enter open the issue tab', async () => {
  const input = mount();
  await userEvent.type(input, 'alpha');
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(here()).toBe(`/b/acme/issue/${tid(2)}`);
  expect(input.value).toBe('');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(document.activeElement).toBe(input);
});

test('arrow keys wrap around the selectable options', async () => {
  const input = mount();
  await userEvent.type(input, 'alpha');
  // Zwei Issues plus »In Beschreibungen suchen«: ↑ von der ersten Option springt zur letzten.
  await userEvent.keyboard('{ArrowUp}');
  const last = screen.getByRole('option', { name: m.searchBodies });
  expect(input.getAttribute('aria-activedescendant')).toBe(last.id);
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true');
});

test('a project opens the backlog filtered by it', async () => {
  const input = mount();
  await userEvent.type(input, 'webseite');
  await userEvent.click(screen.getByRole('option', { name: /Webseite/ }));
  expect(here()).toBe('/b/acme/backlog?project=web');
});

test('a repo hit shows its url muted next to the name', async () => {
  const input = mount();
  await userEvent.type(input, 'core');
  const repos = screen.getByRole('group', { name: m.groupRepos });
  const option = within(repos).getByRole('option');
  expect(within(option).getByText('core').className).toContain('font-mono');
  const url = within(option).getByText('https://example.com/core.git');
  expect(url.className).toContain('truncate');
  expect(url.className).toContain('text-muted-foreground');
});

test('sprint, repo and user hits filter the backlog', async () => {
  const input = mount();
  await userEvent.type(input, 'erster');
  await userEvent.click(screen.getByRole('option', { name: /Erster/ }));
  expect(here()).toBe('/b/acme/backlog?sprint=sprint-1');
  await userEvent.type(input, 'core');
  await userEvent.click(screen.getByRole('option', { name: /core/ }));
  expect(here()).toBe('/b/acme/backlog?repo=core');
  await userEvent.type(input, 'alice');
  await userEvent.click(screen.getByRole('option', { name: /alice/ }));
  expect(here()).toBe('/b/acme/backlog?assignee=alice');
});

test('cmd-k and ctrl-k focus the field but not over a dialog', () => {
  const input = mount();
  const press = (init: KeyboardEventInit) =>
    fireEvent.keyDown(document.body, { key: 'k', ...init });
  press({ metaKey: true });
  expect(document.activeElement).toBe(input);
  input.blur();
  press({ ctrlKey: true });
  expect(document.activeElement).toBe(input);
  input.blur();
  press({ ctrlKey: true, shiftKey: true });
  press({ ctrlKey: true, metaKey: true });
  expect(document.activeElement).not.toBe(input);
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.append(dialog);
  press({ metaKey: true });
  expect(document.activeElement).not.toBe(input);
});

test('escape closes first and clears second', async () => {
  const input = mount();
  await userEvent.type(input, 'alpha');
  expect(screen.getByRole('listbox')).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(input.value).toBe('alpha');
  await userEvent.keyboard('{Escape}');
  expect(input.value).toBe('');
});

test('searching descriptions shows the server hits in the list', async () => {
  const fetch = vi.fn(async () => json({ issues: [{ id: tid(2) }, { id: 'bk-gone' }] }));
  vi.stubGlobal('fetch', fetch);
  const input = mount();
  await userEvent.type(input, 'zzz');
  await userEvent.click(screen.getByRole('option', { name: m.searchBodies }));
  const group = await screen.findByRole('group', { name: m.groupBodies });
  expect(within(group).getAllByRole('option')).toHaveLength(1);
  expect(group.textContent).toContain(tid(2));
  expect(fetch).toHaveBeenCalledWith('/api/b/acme/search?q=zzz', undefined);
  await userEvent.type(input, 'y');
  expect(screen.queryByRole('group', { name: m.groupBodies })).toBeNull();
});

test('a late answer for an older query is dropped', async () => {
  const pending: ((r: Response) => void)[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))),
  );
  const input = mount();
  await userEvent.type(input, 'q1');
  await userEvent.click(screen.getByRole('option', { name: m.searchBodies }));
  await userEvent.type(input, '2');
  await userEvent.click(screen.getByRole('option', { name: m.searchBodies }));
  expect(pending).toHaveLength(2);
  await act(async () => pending[1]?.(json({ issues: [{ id: tid(2) }] })));
  await act(async () => pending[0]?.(json({ issues: [{ id: tid(1) }] })));
  const group = await screen.findByRole('group', { name: m.groupBodies });
  expect(group.textContent).toContain(tid(2));
  expect(group.textContent).not.toContain(tid(1));
});

test('a failed description search shows the message', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ error: { code: 'internal', message: 'Index kaputt' } }, 500)),
  );
  const input = mount();
  await userEvent.type(input, 'zzz');
  await userEvent.click(screen.getByRole('option', { name: m.searchBodies }));
  expect(await screen.findByText(/Index kaputt/)).toBeTruthy();
  expect(screen.getByText(new RegExp(m.bodyFailed))).toBeTruthy();
});

test('no description hits say so', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ issues: [] })),
  );
  const input = mount();
  await userEvent.type(input, 'zzz');
  await userEvent.click(screen.getByRole('option', { name: m.searchBodies }));
  expect(await screen.findByText(m.noBodyHits)).toBeTruthy();
});

test('more than eight hits show the rest as a count', async () => {
  const projects = Array.from({ length: 12 }, (_, i) => ({
    path: `proj${i}`,
    title: `Projekt ${i}`,
  })) as StateJson['projects'];
  const input = mount({ projects });
  await userEvent.type(input, 'projekt');
  const group = screen.getByRole('group', { name: m.groupProjects });
  expect(within(group).getAllByRole('option')).toHaveLength(8);
  expect(within(group).getByText(m.more(4))).toBeTruthy();
});

test('search works without write access', async () => {
  const input = mount({}, false);
  await userEvent.type(input, 'export');
  await userEvent.keyboard('{Enter}');
  expect(here()).toBe(`/b/acme/issue/${tid(2)}`);
});

test('arrow keys with nothing selectable do not break the selection', async () => {
  let answer: (r: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
  );
  const input = mount();
  await userEvent.type(input, 'zzz');
  await userEvent.click(screen.getByRole('option', { name: m.searchBodies }));
  // Keine wählbare Zeile: weder lokale Treffer noch die Beschreibungs-Option.
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  await userEvent.keyboard('{ArrowDown}{ArrowUp}');
  await act(async () => answer(json({ issues: [{ id: tid(2) }] })));
  await screen.findByRole('group', { name: m.groupBodies });
  await userEvent.keyboard('{Enter}');
  expect(here()).toBe(`/b/acme/issue/${tid(2)}`);
});

test('the active option is scrolled into view', async () => {
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const input = mount();
  await userEvent.type(input, 'alpha');
  await userEvent.keyboard('{ArrowDown}');
  const active = screen.getAllByRole('option')[1] as HTMLElement;
  expect(active.getAttribute('aria-selected')).toBe('true');
  expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
  expect(scroll.mock.contexts.at(-1)).toBe(active);
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

test('a press on a group heading keeps the list open and the focus in the field', async () => {
  const projects = Array.from({ length: 12 }, (_, i) => ({
    path: `proj${i}`,
    title: `Projekt ${i}`,
  })) as StateJson['projects'];
  const input = mount({ projects });
  await userEvent.type(input, 'projekt');
  await userEvent.click(screen.getByText(m.groupProjects));
  await userEvent.click(screen.getByText(m.more(4)));
  expect(screen.getByRole('listbox')).toBeTruthy();
  expect(document.activeElement).toBe(input);
});

test('description hits show current titles after a patch', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ issues: [{ id: tid(2) }] })),
  );
  const input = mount();
  await userEvent.type(input, 'zzz');
  await userEvent.click(screen.getByRole('option', { name: m.searchBodies }));
  const group = await screen.findByRole('group', { name: m.groupBodies });
  expect(group.textContent).toContain('Alpha Export');
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(2, { title: 'Umbenannt' })] } }));
  });
  expect(screen.getByRole('group', { name: m.groupBodies }).textContent).toContain('Umbenannt');
});

const patchIssue = (rev: number, n: number, title: string) =>
  act(() => {
    store.applyPatch(testPatch(rev, { upsert: { issues: [testIssue(n, { title })] } }));
  });

test('an idle field does not build the search index', async () => {
  builds.mockClear();
  const input = mount();
  patchIssue(2, 3, 'Neu');
  expect(builds).not.toHaveBeenCalled();
  await userEvent.type(input, 'neu');
  expect(builds).toHaveBeenCalled();
});

test('a field gone idle again stops rebuilding the index', async () => {
  const input = mount();
  await userEvent.type(input, 'neu');
  // Erst schließt Escape die Liste, dann leert es das Feld; der Fokus geht danach weg.
  await userEvent.keyboard('{Escape}{Escape}');
  expect(input.value).toBe('');
  await userEvent.click(screen.getByRole('button', { name: 'outside' }));
  builds.mockClear();
  patchIssue(2, 3, 'Neu');
  expect(builds).not.toHaveBeenCalled();
});

test('the open list follows patches', async () => {
  const input = mount();
  await userEvent.type(input, 'neu');
  expect(screen.queryByRole('group', { name: m.groupIssues })).toBeNull();
  patchIssue(2, 3, 'Neu');
  const issues = screen.getByRole('group', { name: m.groupIssues });
  expect(within(issues).getByRole('option').textContent).toContain('Neu');
});

test('a late description result is announced after the list closed', async () => {
  let answer: (r: Response) => void = () => {};
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
  );
  const input = mount();
  await userEvent.type(input, 'zzz');
  await userEvent.click(screen.getByRole('option', { name: m.searchBodies }));
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).toBeNull();
  await act(async () => answer(json({ issues: [] })));
  expect(screen.getByRole('status').textContent).toBe(m.noBodyHits);
  expect(input.value).toBe('zzz');
});

test('the description query is trimmed', async () => {
  const fetch = vi.fn(async () => json({ issues: [] }));
  vi.stubGlobal('fetch', fetch);
  const input = mount();
  await userEvent.type(input, '  zzz  ');
  await userEvent.click(screen.getByRole('option', { name: m.searchBodies }));
  expect(fetch).toHaveBeenCalledWith('/api/b/acme/search?q=zzz', undefined);
});

test('the listbox holds only options and groups, status text lives in a live region', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ issues: [] })),
  );
  const input = mount();
  expect(input.hasAttribute('aria-controls')).toBe(false);
  await userEvent.type(input, 'alpha');
  const list = screen.getByRole('listbox');
  expect(input.getAttribute('aria-controls')).toBe(list.id);
  const status = screen.getByRole('status');
  await userEvent.click(screen.getByRole('option', { name: m.searchBodies }));
  expect(await within(status).findByText(m.noBodyHits)).toBeTruthy();
  expect(list.contains(status)).toBe(false);
});

test('focus leaving the field closes the list', async () => {
  const input = mount();
  await userEvent.type(input, 'alpha');
  expect(screen.getByRole('listbox')).toBeTruthy();
  await userEvent.click(screen.getByRole('button', { name: 'outside' }));
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(input.value).toBe('alpha');
});

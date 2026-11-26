import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import type { BacklogEntryJson, IssueJson, PatchJson, StateJson } from '@backe/ui/api.ts';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { mountApp } from '../app/bootstrap.tsx';
import { fakeEventSources } from '../test/fake-event-source.ts';

function config() {
  const { $schema: _unused, ...rest } = BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
  });
  return rest;
}

const issue = (n: number): IssueJson =>
  ({
    id: `bk-${n}`,
    title: `Issue ${n}`,
    state: 'todo',
    creator: 'spw',
    created: '2026-11-18T10:00:00Z',
  }) as IssueJson;

function state(issues: IssueJson[], sync: Record<string, unknown> | null = null): StateJson {
  return {
    rev: 1,
    head: 'h1',
    context: {},
    config: config(),
    issues,
    projects: [],
    sprints: [],
    repos: [],
    users: [],
    problems: [],
    sync,
  };
}

function syncStatus(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    remote: 'git@example.org:team/backlog.git',
    mode: 'auto',
    unpushed: 0,
    last_error: null,
    running: false,
    conflicts: [],
    ...over,
  };
}

const entry = (name: string, over: Partial<BacklogEntryJson> = {}): BacklogEntryJson => ({
  name,
  current: false,
  can_write: true,
  user: 'spw',
  prefix: name === 'main' ? 'bk' : name,
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Setup = {
  path: string;
  backlogs?: BacklogEntryJson[];
  lang?: 'en' | 'de';
  states?: Record<string, StateJson>;
  list?: () => Response;
};

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  localStorage.clear();
  document.body.innerHTML = '';
});

async function setup(opts: Setup) {
  window.history.replaceState(null, '', opts.path);
  const backlogs = opts.backlogs ?? [entry('main', { current: true })];
  const states = opts.states ?? { main: state([issue(1)]) };
  const sources = fakeEventSources();
  const fetch = async (url: string): Promise<Response> => {
    if (url === '/api/backlogs')
      return opts.list?.() ?? json({ backlogs, lang: opts.lang ?? 'en' });
    const match = /^\/api\/b\/([^/]+)\/state$/.exec(url);
    const s = match === null ? undefined : states[decodeURIComponent(match[1] as string)];
    return s === undefined ? json({ error: { code: 'not_found', message: 'nope' } }, 404) : json(s);
  };
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    unmount = await mountApp(root, { fetch, eventSource: sources.create, win: window });
  });
  /** Die eine Quelle, die noch lebt; StrictMode legt im Test eine zweite an und schließt die erste. */
  const live = () => {
    const open = sources.all.filter((es) => !es.closed);
    expect(open).toHaveLength(1);
    return open[0] as (typeof sources.all)[number];
  };
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  /** Verbindung auf, `hello`, `/state` geladen. */
  const connect = async () => {
    await act(async () => {
      live().emitOpen();
      live().emitEvent('hello', { rev: 1, head: 'h1' });
      await flush();
    });
  };
  const emit = async (type: string, data: unknown) => {
    await act(async () => {
      live().emitEvent(type, data);
      await flush();
    });
  };
  return { sources, live, connect, emit, user: userEvent.setup() };
}

const path = () => window.location.pathname;
const tab = (name: string | RegExp) => screen.getByRole('tab', { name });

test('the root redirects to the start backlog', async () => {
  await setup({ path: '/', backlogs: [entry('ops'), entry('main', { current: true })] });
  expect(path()).toBe('/b/main/backlog');
  expect(tab('Backlog').getAttribute('aria-selected')).toBe('true');
});

test('a bare backlog path is completed', async () => {
  await setup({ path: '/b/main' });
  expect(path()).toBe('/b/main/backlog');
});

test('without a start backlog the switcher is shown', async () => {
  const { sources } = await setup({ path: '/', backlogs: [entry('main'), entry('ops')] });
  expect(path()).toBe('/');
  expect(screen.getByRole('heading', { name: 'Choose a backlog' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Choose a backlog/ })).toBeTruthy();
  expect(sources.all).toEqual([]);
});

test('the switcher lists names and prefixes and switches the backlog', async () => {
  const { sources, live, user } = await setup({
    path: '/b/main/backlog',
    backlogs: [entry('main', { current: true }), entry('ops', { prefix: 'op' })],
    states: { main: state([issue(1)]), ops: state([]) },
  });
  const before = live();
  expect(before.url).toBe('/api/b/main/events');

  await user.click(screen.getByRole('button', { name: /main/ }));
  const items = screen.getAllByRole('menuitemradio');
  expect(items.map((i) => i.textContent)).toEqual(['mainbk', 'opsop']);
  expect(items[0]?.getAttribute('aria-checked')).toBe('true');
  expect(items[1]?.getAttribute('aria-checked')).toBe('false');
  expect(within(items[1] as HTMLElement).getByText('op').className).toContain('font-mono');

  await user.click(items[1] as HTMLElement);
  expect(path()).toBe('/b/ops/backlog');
  expect(before.closed).toBe(true);
  expect(live().url).toBe('/api/b/ops/events');
  expect(sources.all.every((es) => es === live() || es.closed)).toBe(true);
});

test('read-only identity is marked', async () => {
  await setup({
    path: '/b/main/backlog',
    backlogs: [
      entry('main', { current: true, can_write: false, user: 'spw' }),
      entry('ops', { user: null }),
      entry('dev', { user: 'ada' }),
    ],
  });
  expect(screen.getByText('spw')).toBeTruthy();
  expect(screen.getByText('read only')).toBeTruthy();

  unmount?.();
  await setup({ path: '/b/dev/backlog', backlogs: [entry('dev', { user: 'ada' })] });
  expect(screen.getByText('ada')).toBeTruthy();
  expect(screen.queryByText('read only')).toBeNull();

  unmount?.();
  await setup({ path: '/b/ops/backlog', backlogs: [entry('ops', { user: null })] });
  expect(screen.queryByText('read only')).toBeNull();
  expect(screen.queryByText('spw')).toBeNull();
});

test('the header shows the sync state', async () => {
  const { connect, emit } = await setup({
    path: '/b/main/backlog',
    states: {
      main: state([issue(1)], syncStatus({ mode: 'manual', unpushed: 2, conflicts: [{}] })),
    },
  });
  // Vor dem ersten `/state` weiß der Client nichts über den Sync.
  expect(screen.queryByRole('status')).toBeNull();
  await connect();
  expect(screen.getByRole('status').textContent).toBe('2 unpushed · 1 conflict');

  await emit('sync', syncStatus({ last_error: { message: 'push rejected' } }));
  const failed = screen.getByText('last sync failed');
  expect(failed.getAttribute('title')).toBe('push rejected');

  await emit('sync', syncStatus());
  expect(screen.getByRole('status').textContent).toBe('up to date');
});

test('the header shows offline', async () => {
  const { connect, live } = await setup({ path: '/b/main/backlog' });
  await connect();
  act(() => live().emitError());
  expect(screen.getByRole('status').textContent).toBe('offline');
});

test('tabs have tab roles and selection', async () => {
  const { user } = await setup({ path: '/b/main/backlog' });
  const list = screen.getByRole('tablist', { name: 'Views' });
  expect(
    within(list)
      .getAllByRole('tab')
      .map((t) => t.textContent),
  ).toEqual(['Backlog', 'Board']);
  expect(tab('Backlog').getAttribute('aria-selected')).toBe('true');
  expect(tab('Board').getAttribute('aria-selected')).toBe('false');

  await user.click(tab('Board'));
  expect(path()).toBe('/b/main/board');
  expect(tab('Board').getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('heading', { name: 'Board' })).toBeTruthy();

  const settings = screen.getByRole('link', { name: 'Settings' });
  expect(settings.getAttribute('href')).toBe('/b/main/settings');
  await user.click(settings);
  expect(path()).toBe('/b/main/settings');
  expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
  expect(tab('Backlog').getAttribute('aria-selected')).toBe('false');
});

test('an issue route opens its tab', async () => {
  const { connect } = await setup({ path: '/b/main/issue/bk-1' });
  // Vor dem Laden steht nur die ID da.
  expect(tab('bk-1').getAttribute('aria-selected')).toBe('true');
  await connect();
  expect(tab('bk-1 Issue 1').getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('heading', { name: /bk-1/ })).toBeTruthy();
  expect(JSON.parse(localStorage.getItem('backe-ui:main:tabs') ?? '[]')).toEqual(['bk-1']);
});

test('closing the active tab goes to its neighbour', async () => {
  localStorage.setItem('backe-ui:main:tabs', JSON.stringify(['bk-1', 'bk-2', 'bk-3']));
  const { connect, user } = await setup({
    path: '/b/main/issue/bk-2',
    states: { main: state([issue(1), issue(2), issue(3)]) },
  });
  await connect();
  await user.click(screen.getByRole('button', { name: 'Close bk-2' }));
  expect(path()).toBe('/b/main/issue/bk-3');
  await user.click(screen.getByRole('button', { name: 'Close bk-3' }));
  expect(path()).toBe('/b/main/issue/bk-1');
  await user.click(screen.getByRole('button', { name: 'Close bk-1' }));
  expect(path()).toBe('/b/main/backlog');
  expect(screen.queryAllByRole('tab')).toHaveLength(2);
});

test('closing an inactive tab stays on the route', async () => {
  localStorage.setItem('backe-ui:main:tabs', JSON.stringify(['bk-1']));
  const { user } = await setup({ path: '/b/main/board' });
  await user.click(screen.getByRole('button', { name: 'Close bk-1' }));
  expect(path()).toBe('/b/main/board');
  expect(screen.queryByRole('tab', { name: /bk-1/ })).toBeNull();
});

test('middle click closes an issue tab', async () => {
  localStorage.setItem('backe-ui:main:tabs', JSON.stringify(['bk-1']));
  await setup({ path: '/b/main/backlog' });
  const t = tab(/bk-1/);
  fireEvent.mouseDown(t, { button: 1 });
  fireEvent(t, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
  expect(screen.queryByRole('tab', { name: /bk-1/ })).toBeNull();
  expect(path()).toBe('/b/main/backlog');
  // Ein Mittelklick auf einen festen Tab schließt nichts.
  fireEvent(tab('Board'), new MouseEvent('auxclick', { bubbles: true, button: 1 }));
  expect(screen.getAllByRole('tab')).toHaveLength(2);
});

test('a deleted issue keeps its tab', async () => {
  localStorage.setItem('backe-ui:main:tabs', JSON.stringify(['bk-1', 'bk-9']));
  const { connect, emit } = await setup({ path: '/b/main/issue/bk-9' });
  expect(screen.queryByText('deleted')).toBeNull();
  await connect();
  expect(tab('bk-9 deleted').getAttribute('aria-selected')).toBe('true');

  const gone: PatchJson = { rev: 2, head: 'h2', upsert: {}, remove: { issues: ['bk-1'] } };
  await emit('patch', gone);
  expect(tab('bk-1 deleted')).toBeTruthy();
  expect(screen.getAllByRole('tab')).toHaveLength(4);
});

test('a patch updates the issue count without reload', async () => {
  const { connect, emit, sources } = await setup({ path: '/b/main/backlog' });
  await connect();
  expect(screen.getByText('1 issue')).toBeTruthy();
  const created = sources.all.length;
  await emit('patch', { rev: 2, head: 'h2', upsert: { issues: [issue(2)] }, remove: {} });
  expect(screen.getByText('2 issues')).toBeTruthy();
  expect(sources.all).toHaveLength(created);
});

test('unknown backlog in url shows the switcher', async () => {
  const { sources } = await setup({ path: '/b/nope/backlog' });
  expect(screen.getByText('Unknown backlog: nope')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Choose a backlog/ })).toBeTruthy();
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(sources.all).toEqual([]);
});

test('an unknown path shows not found', async () => {
  await setup({ path: '/nowhere' });
  expect(screen.getByText('Page not found')).toBeTruthy();
});

test('the theme toggle switches the theme', async () => {
  const { user } = await setup({ path: '/b/main/backlog' });
  await user.click(screen.getByRole('button', { name: 'Theme' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('backe-ui-theme')).toBe('dark');
  // Esc schließt das Menü (Radix), die Wahl bleibt.
  await user.click(screen.getByRole('button', { name: 'Theme' }));
  expect(screen.getByRole('menu')).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.documentElement.dataset.theme).toBe('dark');
});

test('texts follow the server language', async () => {
  const { connect } = await setup({ path: '/b/main/backlog', lang: 'de' });
  await connect();
  expect(document.documentElement.lang).toBe('de');
  expect(screen.getByRole('tablist', { name: 'Ansichten' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Einstellungen' })).toBeTruthy();
  expect(screen.getByText('Backlogs für Menschen')).toBeTruthy();
  expect(screen.getByText('1 Issue')).toBeTruthy();
});

test('a failing backlog list shows the error with its hint', async () => {
  await setup({
    path: '/',
    list: () =>
      json(
        {
          error: {
            code: 'unauthorized',
            message: 'no session',
            hint: 'open the URL from the console',
          },
        },
        401,
      ),
  });
  expect(screen.getByRole('alert').textContent).toContain('no session');
  expect(screen.getByText('open the URL from the console')).toBeTruthy();
  expect(screen.queryByRole('tablist')).toBeNull();
});

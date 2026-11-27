/**
 * Nur lesen über alle Ansichten: die ganze App über `mountApp` mit `can_write: false`. Das `fetch`
 * schreibt jeden Aufruf mit; am Ende darf kein Tool-Aufruf und kein PUT darunter sein, und im DOM
 * steht keine Schreibaktion (Tab Backlog wie Tab Issue). Ein Gegentest mit `can_write: true` belegt,
 * dass jede gesuchte Schreibaktion sonst da ist: Ein veralteter Name fiele dort auf. Das Board lädt
 * als eigener Chunk (`React.lazy`); seine Abfragen warten darum mit `findBy…`.
 */
import type { BacklogEntryJson, IssueDetailJson, StateJson } from '@backe/ui/api.ts';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { m as app } from '../app/app.messages.ts';
import { mountApp } from '../app/bootstrap.tsx';
import { formatDate } from '../lib/format.ts';
import { linkOf, registerBacklogViewHarness, rowIds, rowOf } from '../test/backlog-view.tsx';
import { cardIds, cardLink } from '../test/board-view.tsx';
import { fakeEventSources } from '../test/fake-event-source.ts';
import { testIssue, testState, tid } from '../test/state.ts';
import { m as bm } from '../views/board.messages.ts';
import { m } from '../views/issue.messages.ts';
import { m as sm } from '../views/search.messages.ts';
import { m as st } from '../views/settings.messages.ts';
import { m as w } from './write/write.messages.ts';

vi.mock('../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

registerBacklogViewHarness();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const entry = (canWrite: boolean): BacklogEntryJson => ({
  name: 'acme',
  current: true,
  can_write: canWrite,
  user: 'spw',
  prefix: 'bk',
});

/** Issue 1 mit Kommentar von 'spw', Anhang, Repo und dem Sub-Issue 2. */
const state = (): StateJson =>
  testState([testIssue(1, { repos: ['core'] }), testIssue(2, { parent: tid(1) }), testIssue(3)], {
    repos: [{ name: 'core' }] as StateJson['repos'],
  });

/** Zustand mit allem, was Settings zum Schreiben anbietet: Repo, Projekte, Sprint, User, Sync. */
const settingsState = (): StateJson =>
  testState([testIssue(1, { repos: ['core'] }), testIssue(2), testIssue(3)], {
    repos: [{ name: 'core', url: 'https://example.org/core.git' }] as StateJson['repos'],
    projects: [
      { path: 'web', title: 'Web' },
      { path: 'api', title: 'API' },
    ] as StateJson['projects'],
    sprints: [{ slug: 'w48', title: 'W48', start: '2026-11-23' }] as StateJson['sprints'],
    users: [
      { handle: 'spw', name: 'Spw', kind: 'human', admin: true, fingerprints: ['SHA256:spwkey1'] },
      { handle: 'ana', name: 'Ana', kind: 'human', admin: false, fingerprints: ['SHA256:anakey1'] },
      {
        handle: 'bot',
        name: 'Bot',
        kind: 'agent',
        operator: 'ana',
        admin: false,
        fingerprints: ['SHA256:botkey1'],
      },
    ] as StateJson['users'],
    sync: {
      remote: 'origin',
      mode: 'auto',
      unpushed: 0,
      last_attempt: null,
      last_success: null,
      last_error: null,
      running: false,
      conflicts: [],
    } as unknown as StateJson['sync'],
  });

const detail = (): IssueDetailJson => {
  const { depends_on: _deps, ...issue } = testIssue(1, { repos: ['core'] });
  return {
    ...issue,
    body: 'Beschreibung',
    comments: [
      { file: 'c1.md', author: 'spw', created: '2026-11-20T10:00:00Z', body: 'Mein Kommentar' },
    ],
    comments_count: 1,
  } as IssueDetailJson;
};

type Seen = { method: string; url: string };
let seen: Seen[] = [];
let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
  document.body.innerHTML = '';
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

async function mount(path: string, canWrite = false, full = false) {
  seen = [];
  window.history.replaceState(null, '', path);
  const sources = fakeEventSources();
  const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    seen.push({ method: init.method ?? 'GET', url });
    if (url === '/api/backlogs') return json({ backlogs: [entry(canWrite)], lang: 'de' });
    if (url === '/api/b/acme/state') return json(full ? settingsState() : state());
    if (url.startsWith('/api/b/acme/search?')) return json({ issues: [{ id: tid(2) }] });
    if (url.endsWith('/attachments')) return json([{ name: 'log.txt', file: 'log.txt', size: 3 }]);
    if (/\/issues\/[^/]+$/.test(url)) return json(detail());
    return json({ error: { code: 'not_found', message: 'nope' } }, 404);
  };
  vi.stubGlobal('fetch', fetch);
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    unmount = await mountApp(root, { fetch, eventSource: sources.create, win: window });
  });
  const es = sources.all.filter((s) => !s.closed)[0];
  await act(async () => {
    es?.emitOpen();
    es?.emitEvent('hello', { rev: 1, head: 'h1' });
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
  return { user: userEvent.setup() };
}

const commentName = m.commentBy('spw', formatDate('2026-11-20T10:00:00Z'));

/** Jede Schreibaktion des Tabs Issue mit ihrem Namen; `null`, wo sie fehlt. */
const writeControls = (): [string, HTMLElement | null][] => [
  ...[
    m.editTitle,
    m.editNamed(m.description),
    m.editNamed(commentName),
    m.deleteNamed(commentName),
    m.localPathOf('core'),
    m.upload,
    m.remove('log.txt'),
    m.claim,
    m.deleteNamed(tid(1)),
    m.changeState,
    m.addComment,
    m.addProp,
    m.setParent,
    m.addDep,
  ].map((name): [string, HTMLElement | null] => [name, screen.queryByRole('button', { name })]),
  [m.uploadFiles, screen.queryByLabelText(m.uploadFiles)],
  [m.newComment, screen.queryByRole('textbox', { name: m.newComment })],
];

test('read-only hides write actions', async () => {
  const { user } = await mount('/b/acme/backlog');
  expect(rowIds()).toEqual([tid(1), tid(2), tid(3)]);

  // Tab Backlog: kein »Neues Issue«, kein Kontextmenü, nichts zum Ziehen, Alt+↓ und `c` tun nichts.
  expect(screen.queryByRole('button', { name: w.newIssue })).toBeNull();
  fireEvent.contextMenu(linkOf(tid(1)));
  expect(screen.queryByRole('menu')).toBeNull();
  for (const id of rowIds()) expect(rowOf(id as string).hasAttribute('draggable')).toBe(false);
  linkOf(tid(1)).focus();
  await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
  await user.keyboard('c');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(rowIds()).toEqual([tid(1), tid(2), tid(3)]);

  // Tab Issue: weder Editoren noch Knöpfe noch Composer.
  await user.click(linkOf(tid(1)));
  await settle();
  expect(screen.getByText('Mein Kommentar')).toBeTruthy();
  expect(screen.getAllByText('log.txt').length).toBeGreaterThan(0);
  expect(screen.getAllByText('core').length).toBeGreaterThan(0);
  for (const [name, control] of writeControls()) expect(control, name).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.queryByRole('button', { name: /bearbeiten|löschen|entfernen/i })).toBeNull();
  await user.keyboard('c');
  expect(screen.queryByRole('dialog')).toBeNull();

  expect(seen.filter((s) => s.url.includes('/tools/'))).toEqual([]);
  expect(seen.filter((s) => s.method === 'PUT')).toEqual([]);
});

test('with write access every write action of the list is there', async () => {
  const { user } = await mount('/b/acme/backlog', true);
  expect(screen.getByRole('button', { name: w.newIssue })).toBeTruthy();
  expect(rowOf(tid(1)).getAttribute('draggable')).toBe('true');
  fireEvent.contextMenu(linkOf(tid(1)));
  expect(screen.getByRole('menu')).toBeTruthy();
  await user.keyboard('{Escape}');
  await user.click(linkOf(tid(1)));
  await settle();
  expect(screen.getByText('Mein Kommentar')).toBeTruthy();
  for (const [name, control] of writeControls()) expect(control, name).not.toBeNull();
});

/** Das `+` des Schnellanlegens in der Zelle `todo` der Bahn »ohne Sprint«. */
const quickCreate = () => screen.queryByRole('button', { name: bm.newIssue('todo', bm.noSprint) });

test('read-only hides board writes', async () => {
  const { user } = await mount('/b/acme/board');
  await screen.findByRole('region', { name: bm.noSprint });
  expect(cardIds(bm.noSprint, 'todo')).toEqual([tid(1), tid(2), tid(3)]);

  // Weder »Neues Issue« noch `+`, kein Kartenmenü, nichts zum Ziehen, Alt+→ und Umschalt+F10 tun nichts.
  expect(screen.queryByRole('button', { name: w.newIssue })).toBeNull();
  expect(quickCreate()).toBeNull();
  fireEvent.contextMenu(cardLink(tid(1)));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.querySelector('[aria-roledescription="draggable"]')).toBeNull();
  expect(cardLink(tid(1)).hasAttribute('aria-keyshortcuts')).toBe(false);
  cardLink(tid(1)).focus();
  await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
  await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
  await user.keyboard('{Shift>}{F10}{/Shift}');
  await settle();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(cardIds(bm.noSprint, 'todo')).toEqual([tid(1), tid(2), tid(3)]);
  expect(cardIds(bm.noSprint, 'in_progress')).toEqual([]);

  expect(seen.filter((s) => s.url.includes('/tools/'))).toEqual([]);
  expect(seen.filter((s) => s.method === 'PUT')).toEqual([]);
});

test('with write access every write action of the board is there', async () => {
  const { user } = await mount('/b/acme/board', true);
  await screen.findByRole('region', { name: bm.noSprint });
  expect(screen.getByRole('button', { name: w.newIssue })).toBeTruthy();
  expect(quickCreate()).not.toBeNull();
  expect(cardLink(tid(1)).hasAttribute('aria-keyshortcuts')).toBe(true);
  fireEvent.contextMenu(cardLink(tid(1)));
  expect(screen.getByRole('menu')).toBeTruthy();
  await user.keyboard('{Escape}');
});

/** Jede Schreibaktion der Settings mit ihrem Namen und der Zahl ihrer Knöpfe (»Hinzufügen« gibt es je Abschnitt). */
const settingsWrites = (): [string, number][] =>
  [
    st.addRepo,
    st.checkRepos,
    m.localPathOf('core'),
    st.removeRepoOf('core'),
    st.addProject,
    st.addSubprojectOf('api'),
    st.moveProjectOf('api'),
    st.removeProjectOf('api'),
    st.addSprint,
    st.closeSprintOf('w48'),
    st.addUser,
    st.createAgent,
    st.revokeKeyOf('SHA256:anakey1'),
    st.removeUserOf('bot'),
    st.syncNow,
  ].map((name): [string, number] => [name, screen.queryAllByRole('button', { name }).length]);

test('read-only hides settings writes', async () => {
  const { user } = await mount('/b/acme/settings', false, true);
  // Der Chunk lädt nach; erst wenn die letzte Liste steht, ist alles da.
  await screen.findByRole('region', { name: st.sectionInterface });
  expect(screen.getByRole('list', { name: st.userList })).toBeTruthy();
  expect(screen.getByRole('list', { name: st.projectList })).toBeTruthy();
  expect(screen.getByRole('list', { name: st.sprintList })).toBeTruthy();
  expect(screen.getByRole('region', { name: st.sectionBacklog })).toBeTruthy();
  for (const [name, count] of settingsWrites()) expect(count, name).toBe(0);

  // Die Oberfläche bleibt bedienbar: Theme-Radio und Sprachwahl.
  const dark = screen.getByRole('radio', { name: app.themeDark }) as HTMLInputElement;
  await user.click(dark);
  expect(dark.checked).toBe(true);
  const lang = screen.getByRole('combobox', { name: st.language }) as HTMLSelectElement;
  await user.selectOptions(lang, 'en');
  await settle();
  expect((screen.getByRole('combobox', { name: 'Language' }) as HTMLSelectElement).value).toBe(
    'en',
  );

  expect(seen.filter((s) => s.url.includes('/tools/'))).toEqual([]);
  expect(seen.filter((s) => s.method === 'PUT')).toEqual([]);
});

test('with write access the same settings offer every write', async () => {
  await mount('/b/acme/settings', true, true);
  await screen.findByRole('region', { name: st.sectionInterface });
  for (const [name, count] of settingsWrites()) expect(count, name).toBeGreaterThan(0);
});

test('search works read-only, descriptions included', async () => {
  const { user } = await mount('/b/acme/backlog');
  await user.keyboard('{Control>}k{/Control}');
  const box = screen.getByRole('combobox', { name: sm.label });
  expect(document.activeElement).toBe(box);
  await user.type(box, 'Issue');
  await settle();
  await user.click(await screen.findByRole('option', { name: sm.searchBodies }));
  await settle();
  expect(seen.filter((s) => s.url.startsWith('/api/b/acme/search?q=Issue'))).toEqual([
    { method: 'GET', url: '/api/b/acme/search?q=Issue' },
  ]);
  expect(seen.filter((s) => s.url.includes('/tools/'))).toEqual([]);
  expect(seen.filter((s) => s.method !== 'GET')).toEqual([]);
});

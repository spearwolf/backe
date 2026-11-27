import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import { setLocale } from '@backe/i18n/locale.ts';
import type { BacklogEntryJson, IssueJson, StateJson } from '@backe/ui/api.ts';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { mountApp } from '../app/bootstrap.tsx';
import { Router } from '../app/router.ts';
import { Theme } from '../app/theme.ts';
import { LANG_KEY, UiPrefs } from '../app/ui-prefs.ts';
import { fakeEventSources } from '../test/fake-event-source.ts';
import { App } from './App.tsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.body.innerHTML = '';
  setLocale('en');
});

function config() {
  const { $schema: _unused, ...rest } = BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
  });
  return rest;
}

const issue = (n: number, over: Partial<IssueJson> = {}): IssueJson =>
  ({
    id: `bk-${n}`,
    title: `Issue ${n}`,
    state: 'todo',
    creator: 'spw',
    created: '2026-11-18T10:00:00Z',
    ...over,
  }) as IssueJson;

const state: StateJson = {
  rev: 1,
  head: 'h1',
  context: {},
  config: config(),
  // Issue 2 hängt an Issue 1: Die Zeile (`memo`) zeigt das Symbol für offene Abhängigkeiten.
  issues: [issue(1), issue(2, { depends_on: ['bk-1'] } as Partial<IssueJson>)],
  projects: [],
  sprints: [],
  repos: [],
  users: [],
  problems: [],
  sync: null,
};

const backlogs: BacklogEntryJson[] = [
  { name: 'main', current: true, can_write: true, user: 'spw', prefix: 'bk' },
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

const fetchFake = async (url: string): Promise<Response> =>
  url === '/api/backlogs' ? json({ backlogs, lang: 'en' }) : json(state);

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

test('switching the language re-renders every text and keeps the session', async () => {
  // Das Board: Karten sind `memo`, und es lädt als eigener Chunk.
  window.history.replaceState(null, '', '/b/main/board');
  const sources = fakeEventSources();
  const router = new Router(window);
  const theme = new Theme(window, document.documentElement);
  const prefs = new UiPrefs('en', document.documentElement);
  const deps = { fetch: fetchFake, eventSource: sources.create };
  render(
    <StrictMode>
      <App backlogs={backlogs} router={router} theme={theme} prefs={prefs} deps={deps} />
    </StrictMode>,
  );
  const live = () => sources.all.filter((es) => !es.closed);
  expect(live()).toHaveLength(1);
  await act(async () => {
    live()[0]?.emitOpen();
    live()[0]?.emitEvent('hello', { rev: 1, head: 'h1' });
    await flush();
  });
  expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
  expect(screen.getByRole('tablist', { name: 'Views' })).toBeTruthy();
  expect(await screen.findByRole('region', { name: 'no sprint' })).toBeTruthy();
  const card = screen.getByLabelText('open dependencies');
  const tablist = screen.getByRole('tablist', { name: 'Views' });
  const created = sources.all.length;

  await act(async () => {
    prefs.setLang('de');
    await flush();
  });
  expect(document.documentElement.lang).toBe('de');
  expect(screen.getByRole('link', { name: 'Einstellungen' })).toBeTruthy();
  expect(screen.getByRole('tablist', { name: 'Ansichten' })).toBeTruthy();
  expect(screen.getByText('Backlogs für Menschen')).toBeTruthy();
  // Auch Bahnen und gemerkte Karten sprechen jetzt Deutsch.
  expect(await screen.findByRole('region', { name: 'ohne Sprint' })).toBeTruthy();
  expect(screen.getByLabelText('offene Abhängigkeiten')).toBeTruthy();
  expect(screen.queryByLabelText('open dependencies')).toBeNull();
  // Neu gemountet, nicht nur neu gerendert: `memo`-Komponenten und Caches je Locale fangen frisch an.
  expect(screen.getByLabelText('offene Abhängigkeiten')).not.toBe(card);
  expect(screen.getByRole('tablist', { name: 'Ansichten' })).not.toBe(tablist);
  expect(screen.queryByText('Backlogs for humans')).toBeNull();
  // Die Sitzung bleibt: keine neue Verbindung, die alte lebt.
  expect(sources.all).toHaveLength(created);
  expect(live()).toHaveLength(1);

  cleanup();
  prefs.dispose();
  theme.dispose();
  router.dispose();
});

test('a stored language wins over the server at start', async () => {
  window.history.replaceState(null, '', '/b/main/backlog');
  localStorage.setItem(LANG_KEY, 'de');
  const root = document.createElement('div');
  document.body.append(root);
  const sources = fakeEventSources();
  let unmount: () => void = () => {};
  await act(async () => {
    unmount = await mountApp(root, { fetch: fetchFake, eventSource: sources.create, win: window });
  });
  expect(document.documentElement.lang).toBe('de');
  expect(screen.getByRole('link', { name: 'Einstellungen' })).toBeTruthy();
  act(() => unmount());
});

test('a language switch in settings keeps the focus on the language select', async () => {
  // Die Route zeigt auf den Abschnitt; nach dem Neumounten (`key={lang}`) zeigt Settings ihn nicht
  // noch einmal, denn die Marke der zuletzt gezeigten Navigation hält `App` über dem Fragment.
  window.history.replaceState(null, '', '/b/main/settings/interface');
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled;
  const sources = fakeEventSources();
  const router = new Router(window);
  const theme = new Theme(window, document.documentElement);
  const prefs = new UiPrefs('en', document.documentElement);
  const deps = { fetch: fetchFake, eventSource: sources.create };
  render(
    <StrictMode>
      <App backlogs={backlogs} router={router} theme={theme} prefs={prefs} deps={deps} />
    </StrictMode>,
  );
  await act(async () => {
    sources.all.filter((es) => !es.closed)[0]?.emitOpen();
    await flush();
  });
  const before = (await screen.findByRole('combobox', { name: 'Language' })) as HTMLSelectElement;
  expect(scrolled).toHaveBeenCalledTimes(1);
  expect(document.activeElement?.textContent).toBe('Interface');

  await act(async () => {
    before.value = 'de';
    before.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
  });
  const after = screen.getByRole('combobox', { name: 'Sprache' });
  expect(after).not.toBe(before);
  expect(document.activeElement).toBe(after);
  expect(scrolled).toHaveBeenCalledTimes(1);

  cleanup();
  delete (Element.prototype as Partial<Element>).scrollIntoView;
  prefs.dispose();
  theme.dispose();
  router.dispose();
});

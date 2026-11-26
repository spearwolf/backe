/**
 * Nur lesen über alle Ansichten: die ganze App über `mountApp` mit `can_write: false`. Das `fetch`
 * schreibt jeden Aufruf mit; am Ende darf kein Tool-Aufruf und kein PUT darunter sein, und im DOM
 * steht keine Schreibaktion (Tab Backlog wie Tab Issue). Ein Gegentest mit `can_write: true` belegt,
 * dass jede gesuchte Schreibaktion sonst da ist: Ein veralteter Name fiele dort auf.
 */
import type { BacklogEntryJson, IssueDetailJson, StateJson } from '@backe/ui/api.ts';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { mountApp } from '../app/bootstrap.tsx';
import { formatDate } from '../lib/format.ts';
import { linkOf, registerBacklogViewHarness, rowIds, rowOf } from '../test/backlog-view.tsx';
import { fakeEventSources } from '../test/fake-event-source.ts';
import { testIssue, testState, tid } from '../test/state.ts';
import { m } from '../views/issue.messages.ts';
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

async function mount(path: string, canWrite = false) {
  seen = [];
  window.history.replaceState(null, '', path);
  const sources = fakeEventSources();
  const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    seen.push({ method: init.method ?? 'GET', url });
    if (url === '/api/backlogs') return json({ backlogs: [entry(canWrite)], lang: 'de' });
    if (url === '/api/b/acme/state') return json(state());
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

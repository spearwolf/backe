/**
 * Prüfstand für den Anlegen-Dialog: die ganze App über `mountApp`, mit einem `fetch`, das Methode,
 * URL und Body jedes Aufrufs mitschreibt. Tests prüfen, was in welcher Reihenfolge zum Server geht.
 * Wer ihn nutzt, mockt `markdown/index.tsx` selbst (`vi.mock` wird je Datei gehoben).
 */
import type { BacklogEntryJson, StateJson } from '@backe/ui/api.ts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { mountApp } from '../app/bootstrap.tsx';
import { m as w } from '../components/write/write.messages.ts';
import { m } from '../views/issue.messages.ts';
import { fakeEventSources } from './fake-event-source.ts';
import { testConfig, testIssue, testState } from './state.ts';

export const NEW_ID = 'bk-new1';
export const PARENT = testIssue(1, { projects: ['api'], sprints: ['s2'], repos: ['core'] });

export type Call = { method: string; url: string; body: unknown };
type Answer = (call: Call) => Response | undefined;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const entry = (over: Partial<BacklogEntryJson> = {}): BacklogEntryJson => ({
  name: 'acme',
  current: true,
  can_write: true,
  user: 'spw',
  prefix: 'bk',
  ...over,
});

function backlogState(): StateJson {
  return testState([PARENT, testIssue(2)], {
    config: testConfig({
      props: {
        prio: { type: 'enum', description: 'Wie dringend', values: ['low', 'high'] },
        size: { type: 'integer', description: 'Punkte' },
        flag: { type: 'boolean', description: 'Markiert' },
      },
    }),
    projects: [
      { path: 'web', title: 'Web' },
      { path: 'api', title: 'API' },
    ] as StateJson['projects'],
    sprints: [
      { slug: 's1', title: 'S1' },
      { slug: 's2', title: 'S2' },
    ] as StateJson['sprints'],
    repos: [{ name: 'core' }] as StateJson['repos'],
    users: [
      { handle: 'spw', name: 'S', kind: 'human' },
      { handle: 'anna', name: 'A', kind: 'human' },
    ] as StateJson['users'],
  });
}

let unmount: (() => void) | undefined;
// jsdom kennt keine Blob-URLs; die Tests zählen, was angelegt und wieder freigegeben wird.
const { createObjectURL, revokeObjectURL } = URL;
const calls: Call[] = [];
/** Alles außer Lesen, in Aufrufreihenfolge. */
export const writes = () => calls.filter((c) => c.method !== 'GET');

export function registerCreateHarness(): void {
  afterEach(async () => {
    await teardown();
    calls.length = 0;
    vi.unstubAllGlobals();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    localStorage.clear();
    document.body.innerHTML = '';
  });
}

export async function teardown(): Promise<void> {
  await act(async () => unmount?.());
  unmount = undefined;
}

export async function setup(
  path: string,
  opts: { entry?: Partial<BacklogEntryJson>; answer?: Answer } = {},
) {
  window.history.replaceState(null, '', path);
  const sources = fakeEventSources();
  const fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
    const call = { method, url, body };
    calls.push(call);
    const answered = opts.answer?.(call);
    if (answered !== undefined) return answered;
    if (url === '/api/backlogs') return json({ backlogs: [entry(opts.entry)], lang: 'de' });
    if (url === '/api/b/acme/state') return json(backlogState());
    if (url.endsWith('/tools/issue_create')) return json({ commit: null, id: NEW_ID });
    if (method === 'PUT') return json({ commit: null, id: NEW_ID });
    return json({ error: { code: 'not_found', message: 'nope' } }, 404);
  };
  vi.stubGlobal('fetch', fetch);
  const objectUrls: string[] = [];
  const revoked: string[] = [];
  URL.createObjectURL = () => {
    const url = `blob:${objectUrls.length + 1}`;
    objectUrls.push(url);
    return url;
  };
  URL.revokeObjectURL = (u: string) => void revoked.push(u);
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
  return { user: userEvent.setup(), revoked };
}

export const dialog = () => screen.getByRole('dialog', { name: w.newIssue });
export const queryDialog = () => screen.queryByRole('dialog');
export const inDialog = () => within(dialog());
export const titleBox = () =>
  inDialog().getByRole('textbox', { name: m.titleLabel }) as HTMLInputElement;
export const bodyBox = () =>
  inDialog().getByRole('textbox', { name: m.description }) as HTMLTextAreaElement;
export const createButton = () =>
  inDialog().getByRole('button', { name: w.create }) as HTMLButtonElement;
export const chips = (label: string) =>
  within(inDialog().getByRole('group', { name: label }))
    .queryAllByRole('listitem')
    .map((li) => li.textContent);
export const png = (name: string) => new File(['x'], name, { type: 'image/png' });

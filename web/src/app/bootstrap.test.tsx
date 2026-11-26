import { act, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { fakeEventSources } from '../test/fake-event-source.ts';
import { bootstrap, mountApp } from './bootstrap.tsx';

afterEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

const json = (body: unknown) => new Response(JSON.stringify(body));

test('an unreachable server shows the error page', async () => {
  window.history.replaceState(null, '', '/');
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    await bootstrap(root, {
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
      win: window,
    });
  });
  expect(screen.getByRole('alert').textContent).toContain('Failed to fetch');
});

test('the locale and html lang are set before the first render', async () => {
  window.history.replaceState(null, '', '/b/main/backlog');
  const root = document.createElement('div');
  document.body.append(root);
  const sources = fakeEventSources();
  const backlogs = [{ name: 'main', current: true, can_write: true, user: 'spw', prefix: 'bk' }];
  let unmount: () => void = () => {};
  await act(async () => {
    unmount = await mountApp(root, {
      fetch: async () => json({ backlogs, lang: 'de' }),
      eventSource: sources.create,
      win: window,
    });
  });
  expect(document.documentElement.lang).toBe('de');
  expect(screen.getByRole('link', { name: 'Einstellungen' })).toBeTruthy();
  act(() => unmount());
  // Abbauen schließt die Sitzung und hängt den Router ab.
  expect(sources.all.every((es) => es.closed)).toBe(true);
  expect(root.innerHTML).toBe('');
  window.history.pushState(null, '', '/b/main/board');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(root.innerHTML).toBe('');
});

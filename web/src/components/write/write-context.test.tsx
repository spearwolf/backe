import type { BacklogEntryJson } from '@backe/ui/api.ts';
import { act, cleanup, renderHook, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { mountApp } from '../../app/bootstrap.tsx';
import { useWrites } from '../../data/write-context.tsx';
import { fakeEventSources } from '../../test/fake-event-source.ts';
import { testIssue, testState } from '../../test/state.ts';

// Der Probe-Ersatz für die Backlog-Ansicht liest den Schreibkontext, den die App je Sitzung stellt.
vi.mock('../../views/BacklogView.tsx', async () => {
  const { useWrites: use } = await import('../../data/write-context.tsx');
  return {
    BacklogView: () => {
      const w = use();
      return (
        <p data-testid="probe">{`${w.backlog}|${String(w.canWrite)}|${String(w.me)}|${typeof w.writes.run}`}</p>
      );
    },
  };
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

let unmount: (() => void) | undefined;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  unmount?.();
  unmount = undefined;
  localStorage.clear();
  document.body.innerHTML = '';
});

async function mount(entry: Partial<BacklogEntryJson>) {
  window.history.replaceState(null, '', '/b/main/backlog');
  const backlogs: BacklogEntryJson[] = [
    { name: 'main', current: true, can_write: true, user: 'spw', prefix: 'bk', ...entry },
  ];
  const fetch = async (url: string): Promise<Response> =>
    url === '/api/backlogs' ? json({ backlogs, lang: 'de' }) : json(testState([testIssue(1)]));
  vi.stubGlobal('fetch', fetch);
  const sources = fakeEventSources();
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    unmount = await mountApp(root, { fetch, eventSource: sources.create, win: window });
  });
}

test('useWrites needs a provider', () => {
  const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
  expect(() => renderHook(() => useWrites())).toThrow(/WriteContext/);
  quiet.mockRestore();
});

test('the app provides can_write and me per backlog', async () => {
  await mount({ can_write: false, user: 'ada' });
  expect((await screen.findByTestId('probe')).textContent).toBe('main|false|ada|function');
});

test('the app provides write access for a writing identity', async () => {
  await mount({ can_write: true, user: null });
  expect((await screen.findByTestId('probe')).textContent).toBe('main|true|null|function');
});

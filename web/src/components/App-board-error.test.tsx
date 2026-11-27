import { act, screen } from '@testing-library/react';
import { m as app } from '../app/app.messages.ts';
import { registerCreateHarness, setup } from '../test/create-issue.tsx';

// Das Board-Chunk kommt nie, wie nach einem Upgrade mit veralteten Hashes. `React.lazy` merkt
// sich die Ablehnung für immer; darum steht der Test in einer eigenen Datei.
vi.mock('../views/BoardView.tsx', () => Promise.reject(new Error('stale chunk')));

registerCreateHarness();

test('a board chunk that fails to load shows one line and leaves the app usable', async () => {
  // React meldet den abgefangenen Fehler auf der Konsole; hier ist er erwartet.
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await setup('/b/acme/board');
    expect((await screen.findByRole('alert')).textContent).toBe(app.chunkFailed);
    expect(screen.queryByText(app.loading)).toBeNull();

    // Kopfzeile und Tabs stehen weiter; der Tab Backlog löst die Fehlerzeile ab.
    const backlog = screen.getByRole('tab', { name: app.tabBacklog });
    await act(async () => backlog.click());
    expect(window.location.pathname).toBe('/b/acme/backlog');
    expect(backlog.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: app.tabBacklog })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    logged.mockRestore();
  }
});

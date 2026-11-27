import { act, screen } from '@testing-library/react';
import { m as app } from '../app/app.messages.ts';
import { registerCreateHarness, setup } from '../test/create-issue.tsx';
import { m as board } from '../views/board.messages.ts';

// Das Settings-Chunk kommt nie, wie nach einem Upgrade mit veralteten Hashes. `React.lazy` merkt
// sich die Ablehnung für immer; darum steht der Test in einer eigenen Datei.
vi.mock('../views/SettingsView.tsx', () => Promise.reject(new Error('stale chunk')));

registerCreateHarness();

test('a settings chunk that fails to load shows a line, the tabs stay usable', async () => {
  // React meldet den abgefangenen Fehler auf der Konsole; hier ist er erwartet.
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await setup('/b/acme/settings/backlog');
    expect((await screen.findByRole('alert')).textContent).toBe(app.chunkFailed);
    expect(screen.queryByText(app.loading)).toBeNull();

    // Die Fehlerzeile gehört zu Settings: Das Board lädt sein eigenes Chunk und zeigt sich.
    await act(async () => screen.getByRole('tab', { name: app.tabBoard }).click());
    expect(await screen.findByRole('combobox', { name: board.lanes })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();

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

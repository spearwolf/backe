import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { m as app } from '../../app/app.messages.ts';
import { flush, registerReadIssueViewHarness, view } from '../../test/read-issue-view.tsx';
import { testIssue, tid } from '../../test/state.ts';
import { m } from '../../views/deps.messages.ts';

// Der Graph-Chunk kommt nie, wie nach einem Upgrade mit veralteten Hashes. `React.lazy` merkt
// sich die Ablehnung für immer; darum steht der Test in einer eigenen Datei.
vi.mock('../deps/DepPanel.tsx', () => Promise.reject(new Error('stale chunk')));

registerReadIssueViewHarness();

beforeEach(() => {
  // Ohne `IntersectionObserver` gilt der Abschnitt sofort als sichtbar, der Chunk lädt gleich.
  vi.stubGlobal('IntersectionObserver', undefined);
});

test('a graph chunk that fails to load shows one line and leaves the tab usable', async () => {
  // React meldet den abgefangenen Fehler auf der Konsole; hier ist er erwartet.
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    view([testIssue(1, { depends_on: [tid(2)] }), testIssue(2)]);
    await flush();
    const region = screen.getByRole('region', { name: m.title });
    expect((await within(region).findByRole('alert')).textContent).toBe(app.chunkFailed);
    expect(screen.queryByText(app.loading)).toBeNull();

    // Der Tab steht weiter: Der Abschnitt klappt zu und wieder auf, die Ansicht wechselt.
    const fold = within(region).getByRole('button', { name: m.title });
    await userEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(within(region).queryByRole('alert')).toBeNull();
    await userEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    const tree = within(region).getByRole('button', { name: m.viewTree });
    await userEvent.click(tree);
    expect(tree.getAttribute('aria-pressed')).toBe('true');
    expect((await within(region).findByRole('alert')).textContent).toBe(app.chunkFailed);
  } finally {
    logged.mockRestore();
  }
});

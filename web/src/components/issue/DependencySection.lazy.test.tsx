import { act, cleanup, screen, waitFor } from '@testing-library/react';
import { m as app } from '../../app/app.messages.ts';
import { writeDepPrefs } from '../../app/dep-prefs.ts';
import { flush, ID, registerReadIssueViewHarness, view } from '../../test/read-issue-view.tsx';
import { testIssue, tid } from '../../test/state.ts';
import { flushFrames, installXyflowStubs } from '../../test/xyflow.ts';
import { m } from '../../views/deps.messages.ts';

// Der Graph-Chunk kommt erst, wenn der Test das Tor öffnet; `imports` zählt, wie oft das Modul
// angefordert wird. Lüde die Hülle `DepPanel` statisch mit, zählte der Mock schon beim Laden
// von `IssueView`. `React.lazy` merkt sich ein geladenes Modul für immer; darum steht der Test in
// einer eigenen Datei, mit eigenem Modulgraphen.
const gate = vi.hoisted(() => {
  let open = () => {};
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { imports: 0, ready, open: () => open() };
});
vi.mock('../deps/DepPanel.tsx', async (importOriginal) => {
  gate.imports++;
  await gate.ready;
  return importOriginal();
});

type Callback = (entries: { isIntersecting: boolean }[]) => void;
let observers: { cb: Callback; target: Element | undefined }[] = [];

registerReadIssueViewHarness();

let uninstall: () => void;
beforeEach(() => {
  uninstall = installXyflowStubs();
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      readonly entry: { cb: Callback; target: Element | undefined };
      constructor(cb: Callback) {
        this.entry = { cb, target: undefined };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  // Erst abbauen, dann die Stubs zurück: xyflow räumt beim Unmount noch mit ihnen auf.
  cleanup();
  uninstall();
  localStorage.clear();
});

const issues = () => [testIssue(1, { depends_on: [tid(2)] }), testIssue(2)];
const region = () => screen.getByRole('region', { name: m.title });
const node = (id: string) => document.querySelector(`[data-dep-node="${id}"]`);

/** Meldet den Abschnitt als sichtbar, wie der Browser beim Hineinscrollen. */
const intersect = () =>
  act(async () => {
    for (const o of observers) {
      if (o.target !== undefined && region().contains(o.target)) o.cb([{ isIntersecting: true }]);
    }
  });

// Zuerst: Danach ist das Modul geladen, und `React.lazy` lädt es nie wieder.
test('a folded section loads nothing even when visible', async () => {
  writeDepPrefs('acme', { open: false, view: 'graph', parents: false });
  view(issues());
  await flush();
  await intersect();
  await flush();
  expect(screen.getByRole('button', { name: m.title }).getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText(app.loading)).toBeNull();
  expect(gate.imports).toBe(0);
});

test('the graph chunk loads only when the open section becomes visible', async () => {
  view(issues());
  await flush();
  expect(region()).toBeTruthy();
  expect(observers.some((o) => o.target !== undefined && region().contains(o.target))).toBe(true);
  expect(gate.imports).toBe(0);
  expect(screen.queryByText(app.loading)).toBeNull();

  await intersect();
  await waitFor(() => expect(gate.imports).toBe(1));
  // Das Issue ist geladen; »Lädt …« kann hier nur der Fallback von `Suspense` sein.
  expect(screen.getByText(app.loading)).toBeTruthy();
  expect(node(ID)).toBeNull();

  await act(async () => gate.open());
  await waitFor(() => expect(node(ID)).not.toBeNull());
  await act(async () => flushFrames());
  expect(node(tid(2))).not.toBeNull();
  expect(screen.queryByText(app.loading)).toBeNull();
});

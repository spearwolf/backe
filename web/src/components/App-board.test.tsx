import { act, screen } from '@testing-library/react';
import { m as app } from '../app/app.messages.ts';
import { registerCreateHarness, setup } from '../test/create-issue.tsx';
import { m } from '../views/board.messages.ts';

// Das Board-Chunk kommt erst, wenn der Test das Tor öffnet. Scharf ist das Tor nur im Test: Lüde
// `App.tsx` das Board statisch mit, liefe der Import vorher durch, und der Test scheiterte am
// fehlenden Fallback, statt zu hängen. `React.lazy` merkt sich ein geladenes Modul für immer;
// darum steht der Test in einer eigenen Datei, mit eigenem Modulgraphen.
const gate = vi.hoisted(() => {
  let open = () => {};
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { armed: false, ready, open: () => open() };
});
vi.mock('../views/BoardView.tsx', async (importOriginal) => {
  if (gate.armed) await gate.ready;
  return importOriginal();
});

registerCreateHarness();

test('the board loads as its own chunk behind a fallback', async () => {
  gate.armed = true;
  await setup('/b/acme/board');
  // Der Backlog ist geladen; »Lädt …« kann hier nur der Fallback von `Suspense` sein.
  expect(screen.getByText(app.loading)).toBeTruthy();
  expect(screen.queryByRole('region')).toBeNull();
  await act(async () => gate.open());
  expect(await screen.findByRole('region', { name: m.noSprint })).toBeTruthy();
  expect(screen.queryByText(app.loading)).toBeNull();
});

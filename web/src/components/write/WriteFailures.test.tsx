import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test } from 'vitest';
import { ApiError } from '../../data/api-client.ts';
import { StoreContext } from '../../data/store-context.tsx';
import { tid } from '../../test/state.ts';
import { failure, makeWrites } from '../../test/writes.ts';
import { PendingMark } from './PendingMark.tsx';
import { WriteFailures } from './WriteFailures.tsx';

afterEach(cleanup);

test('write failures are listed and dismissable', async () => {
  const user = userEvent.setup();
  const { store, writes } = makeWrites();
  render(<WriteFailures writes={writes} />);
  expect(screen.queryByRole('alert')).toBeNull();
  act(() => {
    writes.report(failure());
    writes.report(new ApiError(404, 'not_found', 'Kein solches Issue'));
  });
  const alerts = screen.getAllByRole('alert');
  expect(alerts).toHaveLength(2);
  expect(alerts[0]?.textContent).toContain('Issue ist gesperrt');
  expect(alerts[0]?.textContent).toContain('Mit backe issue claim übernehmen');
  expect(alerts[1]?.textContent).toContain('Kein solches Issue');
  await user.click(screen.getAllByRole('button', { name: 'Schließen' })[0] as HTMLElement);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.getByRole('alert').textContent).toContain('Kein solches Issue');
  writes.dispose();
  store.dispose();
});

test('pending mark follows pendingCount', () => {
  const { store, writes } = makeWrites();
  render(
    <StoreContext.Provider value={store}>
      <PendingMark id={tid(1)} />
    </StoreContext.Provider>,
  );
  expect(screen.queryByText('ausstehend')).toBeNull();
  act(() => store.setOverlay(1, new Map([[tid(1), { state: 'done' }]])));
  expect(screen.getByText('ausstehend').className).toContain('sr-only');
  act(() => store.clearOverlay(1));
  expect(screen.queryByText('ausstehend')).toBeNull();
  writes.dispose();
  store.dispose();
});

test('write failures form a labelled region', () => {
  const { store, writes } = makeWrites();
  render(<WriteFailures writes={writes} />);
  expect(screen.queryByRole('region')).toBeNull();
  act(() => writes.report(failure()));
  expect(screen.getByRole('region', { name: 'Fehlgeschlagene Aktionen' })).toBeTruthy();
  writes.dispose();
  store.dispose();
});

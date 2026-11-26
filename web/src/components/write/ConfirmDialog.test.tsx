import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { failure } from '../../test/writes.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { useAction } from './use-action.ts';

afterEach(cleanup);

function Confirm(props: { run: () => Promise<unknown>; onClosed?: () => void }) {
  const action = useAction();
  return (
    <ConfirmDialog
      open
      title="Issue löschen?"
      description="Das lässt sich nicht rückgängig machen."
      confirmLabel="Löschen"
      destructive
      busy={action.busy}
      error={action.error}
      onConfirm={() => void action.run(props.run)}
      onOpenChange={(open) => {
        if (!open) props.onClosed?.();
      }}
    />
  );
}

function Host({ closed, failFirst }: { closed: () => void; failFirst: boolean }) {
  const attempt = useRef(0);
  const action = useAction();
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      open={open}
      title="Issue löschen?"
      confirmLabel="Löschen"
      busy={action.busy}
      error={action.error}
      onConfirm={() =>
        void action
          .run(() => {
            attempt.current += 1;
            return failFirst && attempt.current === 1
              ? Promise.reject(failure())
              : Promise.resolve();
          })
          .then((ok) => {
            if (ok) {
              setOpen(false);
              closed();
            }
          })
      }
      onOpenChange={setOpen}
    />
  );
}

test('confirm dialog runs, shows errors and closes on success', async () => {
  const user = userEvent.setup();
  const closed = vi.fn();
  render(<Host closed={closed} failFirst />);
  expect(screen.getByRole('dialog', { name: 'Issue löschen?' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Löschen' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Issue ist gesperrt');
  expect(closed).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Löschen' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(closed).toHaveBeenCalledTimes(1);
});

test('confirm dialog locks buttons and Esc while busy and renders description', async () => {
  const user = userEvent.setup();
  const closed = vi.fn();
  let finish: () => void = () => {};
  render(
    <Confirm
      run={() =>
        new Promise<void>((r) => {
          finish = r;
        })
      }
      onClosed={closed}
    />,
  );
  expect(screen.getByText('Das lässt sich nicht rückgängig machen.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Löschen' }));
  const confirm = screen.getByRole('button', { name: 'Löschen' }) as HTMLButtonElement;
  const cancel = screen.getByRole('button', { name: 'Abbrechen' }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  expect(cancel.disabled).toBe(true);
  await user.keyboard('{Escape}');
  expect(closed).not.toHaveBeenCalled();
  await act(async () => finish());
  await user.keyboard('{Escape}');
  expect(closed).toHaveBeenCalledTimes(1);
});

test('cancel closes the dialog when idle', async () => {
  const user = userEvent.setup();
  const closed = vi.fn();
  render(<Confirm run={() => Promise.resolve()} onClosed={closed} />);
  await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
  expect(closed).toHaveBeenCalledTimes(1);
});

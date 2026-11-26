import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { failure } from '../../test/writes.ts';
import { ActionError } from './ActionError.tsx';
import { useAction } from './use-action.ts';

afterEach(cleanup);

function Runner({ fn }: { fn: () => Promise<unknown> }) {
  const action = useAction();
  return (
    <div>
      <button type="button" onClick={() => void action.run(fn)}>
        go
      </button>
      <button type="button" onClick={action.reset}>
        reset
      </button>
      <p data-testid="busy">{String(action.busy)}</p>
      <ActionError error={action.error} />
    </div>
  );
}

test('a failed action shows message and hint', async () => {
  const user = userEvent.setup();
  render(<Runner fn={() => Promise.reject(failure())} />);
  await user.click(screen.getByRole('button', { name: 'go' }));
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Issue ist gesperrt');
  expect(alert.textContent).toContain('Mit backe issue claim übernehmen');
  await user.click(screen.getByRole('button', { name: 'reset' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

test('a thrown plain error becomes an ApiError and a new run clears the old one', async () => {
  const user = userEvent.setup();
  let attempt = 0;
  render(
    <Runner
      fn={() => {
        attempt += 1;
        return attempt === 1 ? Promise.reject(new Error('boom')) : Promise.resolve();
      }}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'go' }));
  expect((await screen.findByRole('alert')).textContent).toContain('boom');
  await user.click(screen.getByRole('button', { name: 'go' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

test('busy is set while the action runs and run reports success', async () => {
  let finish: () => void = () => {};
  const { result } = renderHook(() => useAction());
  let outcome: Promise<boolean> | undefined;
  act(() => {
    outcome = result.current.run(
      () =>
        new Promise<void>((r) => {
          finish = r;
        }),
    );
  });
  expect(result.current.busy).toBe(true);
  await act(async () => {
    finish();
    expect(await outcome).toBe(true);
  });
  expect(result.current.busy).toBe(false);
  expect(result.current.error).toBeUndefined();
});

test('a non-ApiError throw is reported as unexpected, not offline', async () => {
  const { result } = renderHook(() => useAction());
  await act(async () => {
    await result.current.run(() => Promise.reject(new Error('boom')));
  });
  expect(result.current.error?.code).toBe('unexpected');
  expect(result.current.error?.message).toBe('boom');
});

test('a second run while busy returns false without calling the function', async () => {
  const { result } = renderHook(() => useAction());
  let finish: () => void = () => {};
  const first = vi.fn(
    () =>
      new Promise<void>((r) => {
        finish = r;
      }),
  );
  const second = vi.fn(() => Promise.resolve());
  let a: Promise<boolean> | undefined;
  let b: boolean | undefined;
  await act(async () => {
    a = result.current.run(first);
    b = await result.current.run(second);
  });
  expect(b).toBe(false);
  expect(second).not.toHaveBeenCalled();
  await act(async () => {
    finish();
    expect(await a).toBe(true);
  });
  expect(await act(() => result.current.run(second))).toBe(true);
});

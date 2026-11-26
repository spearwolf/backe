import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import type { BacklogEntryJson, IssueJson, StateJson } from '@backe/ui/api.ts';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { mountApp } from '../../app/bootstrap.tsx';
import { ApiError } from '../../data/api-client.ts';
import { Store } from '../../data/store.ts';
import { StoreContext } from '../../data/store-context.tsx';
import { useWrites } from '../../data/write-context.tsx';
import { Writes } from '../../data/writes.ts';
import { fakeEventSources } from '../../test/fake-event-source.ts';
import { ActionError } from './ActionError.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { PendingMark } from './PendingMark.tsx';
import { useAction } from './use-action.ts';
import { WriteFailures } from './WriteFailures.tsx';

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

function config() {
  const { $schema: _unused, ...rest } = BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
  });
  return rest;
}

const issue = (n: number): IssueJson =>
  ({
    id: `bk-${n}`,
    title: `Issue ${n}`,
    state: 'todo',
    creator: 'spw',
    created: '2026-11-18T10:00:00Z',
  }) as IssueJson;

function state(issues: IssueJson[]): StateJson {
  return {
    rev: 1,
    head: 'h1',
    context: {},
    config: config(),
    issues,
    projects: [],
    sprints: [],
    repos: [],
    users: [],
    problems: [],
    sync: null,
  };
}

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
    url === '/api/backlogs' ? json({ backlogs, lang: 'de' }) : json(state([issue(1)]));
  vi.stubGlobal('fetch', fetch);
  const sources = fakeEventSources();
  const root = document.createElement('div');
  document.body.append(root);
  await act(async () => {
    unmount = await mountApp(root, { fetch, eventSource: sources.create, win: window });
  });
}

function makeWrites() {
  const store = new Store();
  store.load(state([issue(1)]));
  const writes = new Writes(store, {
    call: () => Promise.reject(new Error('unused')),
    upload: () => Promise.reject(new Error('unused')),
    refresh: () => Promise.resolve(),
  });
  return { store, writes };
}

const failure = () =>
  new ApiError(409, 'conflict', 'Issue ist gesperrt', 'Mit backe issue claim übernehmen');

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
      <PendingMark id="bk-1" />
    </StoreContext.Provider>,
  );
  expect(screen.queryByText('ausstehend')).toBeNull();
  act(() => store.setOverlay(1, new Map([['bk-1', { state: 'done' }]])));
  expect(screen.getByText('ausstehend').className).toContain('sr-only');
  act(() => store.clearOverlay(1));
  expect(screen.queryByText('ausstehend')).toBeNull();
  writes.dispose();
  store.dispose();
});

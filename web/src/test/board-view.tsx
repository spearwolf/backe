/**
 * Prüfstand für den Tab Board: die echte `BoardView` mit Router, Store, einem echten `Writes`
 * (dessen `call` ein Mock ist), der globalen Fehleranzeige und dem Anlegen-Dialog, wie die App sie
 * darüber legt.
 */
import type { State } from '@backe/core/state.ts';
import type { IssueJson, StateJson } from '@backe/ui/api.ts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { type Mock, vi } from 'vitest';
import { Router, RouterContext } from '../app/router.ts';
import { CreateIssueProvider } from '../components/write/create-context.tsx';
import { WriteFailures } from '../components/write/WriteFailures.tsx';
import { Store } from '../data/store.ts';
import { StoreContext } from '../data/store-context.tsx';
import { WriteContext } from '../data/write-context.tsx';
import { Writes } from '../data/writes.ts';
import { BoardView } from '../views/BoardView.tsx';
import { m } from '../views/board.messages.ts';
import { testState } from './state.ts';

export const call: Mock<(name: string, args: unknown) => Promise<unknown>> = vi.fn();

/** Registriert die Hooks: `call` ohne Commit, danach DOM und `localStorage` leer. */
export function registerBoardViewHarness(): void {
  beforeEach(() => {
    call.mockReset();
    call.mockImplementation(async () => ({ commit: null }));
  });
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });
}

export function board(
  issues: IssueJson[],
  opts: { canWrite?: boolean; over?: Partial<StateJson>; me?: string | null } = {},
) {
  window.history.replaceState(null, '', '/b/acme/board');
  const router = new Router(window);
  const store = new Store();
  store.load(testState(issues, opts.over));
  const writes = new Writes(store, {
    call: call as never,
    upload: (async () => ({ commit: null })) as never,
    refresh: async () => {},
  });
  const me = opts.me === undefined ? 'spw' : opts.me;
  const access = { backlog: 'acme', canWrite: opts.canWrite ?? true, me, writes };
  const ui = (
    <RouterContext.Provider value={router}>
      <StoreContext.Provider value={store}>
        <WriteContext.Provider value={access}>
          <CreateIssueProvider>
            <WriteFailures writes={writes} />
            <BoardView backlog="acme" me={me} />
          </CreateIssueProvider>
        </WriteContext.Provider>
      </StoreContext.Provider>
    </RouterContext.Provider>
  );
  const result = render(ui);
  return { router, store, writes, ...result, rerender: () => result.rerender(ui) };
}

/** Bahnen in ihrer Reihenfolge, als Namen ihrer Region. */
export const laneLabels = () =>
  screen
    .queryAllByRole('region')
    .map((r) => r.getAttribute('aria-label') ?? labelOf(r.getAttribute('aria-labelledby')));
const labelOf = (id: string | null) =>
  id === null ? '' : (document.getElementById(id)?.textContent ?? '');

export const laneOf = (label: string): HTMLElement => screen.getByRole('region', { name: label });
/** Der Knopf im Kopf der Bahn, der sie auf- und zuklappt. */
export const foldOf = (label: string): HTMLElement =>
  within(laneOf(label)).getByRole('button', { name: label });
export const cellOf = (lane: string, column: State): HTMLElement =>
  within(laneOf(lane)).getByRole('list', { name: m.cell(lane, column) });
export const cardIds = (lane: string, column: State): string[] =>
  within(cellOf(lane, column))
    .queryAllByRole('listitem')
    .map((li) => li.dataset.card ?? '');
/** Spalten einer Bahn, aus `data-column` ihrer Zellen. */
export const columnsOf = (lane: string): string[] =>
  within(laneOf(lane))
    .queryAllByRole('list')
    .map((ul) => ul.dataset.column ?? '');
export const cardOf = (id: string, lane?: string): HTMLElement => {
  const scope = lane === undefined ? document.body : laneOf(lane);
  return scope.querySelector(`li[data-card="${id}"]`) as HTMLElement;
};

/** Der Link einer Karte, in Bahn `lane` (sonst die erste Karte mit dieser ID). */
export const cardLink = (id: string, lane?: string): HTMLElement =>
  within(cardOf(id, lane)).getByRole('link');

/** Ohne Antwort bleibt eine Überlagerung stehen; eine Antwort ohne Commit nähme sie sofort zurück. */
export const answerNever = () => call.mockImplementation(() => new Promise(() => {}));

let commits = 0;
/** Jede Antwort trägt einen eigenen Commit (`c1`, `c2`, …); der Write endet erst mit dessen Patch. */
export const answerCommitted = () => {
  commits = 0;
  call.mockImplementation(async () => ({ commit: `c${++commits}` }));
};

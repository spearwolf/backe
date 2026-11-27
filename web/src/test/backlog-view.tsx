/**
 * Prüfstand für den Tab Backlog: die echte `BacklogView` mit Router, Store, einem echten `Writes`
 * (dessen `call` ein Mock ist) und der globalen Fehleranzeige, wie sie die App darüber zeigt.
 */
import type { IssueJson } from '@backe/ui/api.ts';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';
import { Router, RouterContext } from '../app/router.ts';
import { WriteFailures } from '../components/write/WriteFailures.tsx';
import { Store } from '../data/store.ts';
import { StoreContext } from '../data/store-context.tsx';
import { WriteContext } from '../data/write-context.tsx';
import { Writes } from '../data/writes.ts';
import { BacklogView } from '../views/BacklogView.tsx';
import { m } from '../views/backlog.messages.ts';
import { testState } from './state.ts';

export const call = vi.fn<(name: string, args: unknown) => Promise<unknown>>();
/** URLs aller `fetch`-Aufrufe (die Suche in Beschreibungen) seit dem letzten Test. */
export const searches: string[] = [];

/** Registriert die Hooks: Layout für den Virtualizer, `fetch` für die Suche, `call` ohne Commit. */
export function registerBacklogViewHarness(): void {
  // jsdom rechnet kein Layout; der Virtualizer misst die Fläche über `clientWidth`/`clientHeight`,
  // begrenzt das Scrollen über `scrollHeight` (hier die Höhe der Liste darin) und scrollt über
  // `scrollTo`, das jsdom nicht kennt: Hier setzt es `scrollTop` und meldet `scroll`.
  const layout = ['clientHeight', 'clientWidth', 'scrollHeight', 'scrollTo'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const,
  );
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return (
          Number.parseFloat((this.firstElementChild as HTMLElement | null)?.style.height ?? '') || 0
        );
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        if (options.top !== undefined) this.scrollTop = options.top;
        this.dispatchEvent(new Event('scroll'));
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      value: 1024,
    });
  });
  afterAll(() => {
    for (const [key, desc] of layout) {
      if (desc !== undefined) Object.defineProperty(HTMLElement.prototype, key, desc);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    }
  });
  beforeEach(() => {
    searches.length = 0;
    call.mockReset();
    call.mockImplementation(async () => ({ commit: null }));
    vi.stubGlobal('fetch', async (url: string) => {
      searches.push(url);
      return new Response(JSON.stringify({ issues: [] }));
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.clear();
  });
}

export function view(
  issues: IssueJson[],
  opts: {
    search?: string;
    me?: string | null;
    canWrite?: boolean;
    over?: Parameters<typeof testState>[1];
  } = {},
) {
  window.history.replaceState(null, '', `/b/acme/backlog${opts.search ?? ''}`);
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
          <WriteFailures writes={writes} />
          <BacklogView backlog="acme" me={me} />
        </WriteContext.Provider>
      </StoreContext.Provider>
    </RouterContext.Provider>
  );
  const result = render(ui);
  return { router, store, writes, ...result, rerender: () => result.rerender(ui) };
}

export const rows = () => {
  const list = screen.queryByRole('list', { name: m.issues });
  return list === null ? [] : within(list).queryAllByRole('listitem');
};
export const rowIds = () => rows().map((r) => r.getAttribute('data-id'));
export const rowOf = (id: string) => rows().find((r) => r.dataset.id === id) as HTMLElement;
export const linkOf = (id: string) => within(rowOf(id)).getByRole('link');
/** Das scrollende Element um die Liste. */
export const scroller = () =>
  screen.getByRole('list', { name: m.issues }).parentElement as HTMLElement;
/** Ohne Antwort bleibt eine Überlagerung stehen; eine Antwort ohne Commit nähme sie sofort zurück. */
export const answerNever = () => call.mockImplementation(() => new Promise(() => {}));

let commits = 0;
/** Jede Antwort trägt einen eigenen Commit; erst `land` bringt den Patch dazu, wie der Server. */
export const answerCommitted = () => {
  commits = 0;
  call.mockImplementation(async () => ({ commit: `c${++commits}` }));
};
/** Der Patch zum letzten Commit, mit dem Stand, den die Ansicht gerade zeigt: Der Server schrieb die Vorschau. */
export function land(store: Store): void {
  act(() => {
    store.applyPatch({
      rev: store.rev.value + 1,
      head: `c${commits}`,
      upsert: { issues: [...store.issues.list()] },
      remove: {},
    });
  });
}

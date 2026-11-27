/**
 * Prüfstand für die lesende `IssueView`: Router, Store und ein `Writes` ohne Server, Schreibrecht
 * aus. `fetch` liefert das Detail des Issues samt `served`; die Editoren prüfen die Tests unter
 * `components/issue/edit/` mit `issue-view.tsx`.
 */
import { setLocale } from '@backe/i18n/locale.ts';
import type { CommentJson, IssueDetailJson, IssueJson } from '@backe/ui/api.ts';
import { act, cleanup, render } from '@testing-library/react';
import { vi } from 'vitest';
import { Router, RouterContext } from '../app/router.ts';
import { Store } from '../data/store.ts';
import { StoreContext } from '../data/store-context.tsx';
import { WriteContext } from '../data/write-context.tsx';
import { Writes } from '../data/writes.ts';
import { IssueView } from '../views/IssueView.tsx';
import { testIssue, testState, tid } from './state.ts';

/** Was der Server zum Issue zusätzlich liefert; Tests setzen es vor `view` oder vor einem Neuladen. */
export const served: {
  comments: CommentJson[];
  body: string | undefined;
  lastReason: CommentJson | undefined;
} = { comments: [], body: undefined, lastReason: undefined };

export function registerReadIssueViewHarness(): void {
  beforeEach(() => {
    served.comments = [];
    served.body = undefined;
    served.lastReason = undefined;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/attachments')) return new Response('[]');
      const id = url.split('/').pop() as string;
      const { depends_on: _deps, ...issue } = testIssue(Number(id.slice(-4)));
      const detail: IssueDetailJson = {
        ...issue,
        ...(served.body === undefined ? {} : { body: served.body }),
        ...(served.lastReason === undefined ? {} : { last_reason: served.lastReason }),
        ...(served.comments.length === 0 ? {} : { comments: served.comments }),
        comments_count: served.comments.length,
      };
      return new Response(JSON.stringify(detail));
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    setLocale('de');
  });
}

export const ID = tid(1);

export function view(issues: IssueJson[], over: Parameters<typeof testState>[1] = {}, id = ID) {
  window.history.replaceState(null, '', `/b/acme/issue/${id}`);
  const router = new Router(window);
  const store = new Store();
  store.load(testState(issues, over));
  const onClose = vi.fn();
  // Nur lesend: Die Editoren prüft `components/issue/edit/edit.test.tsx`.
  const writes = new Writes(store, { call: vi.fn(), upload: vi.fn(), refresh: async () => {} });
  render(
    <RouterContext.Provider value={router}>
      <StoreContext.Provider value={store}>
        <WriteContext.Provider value={{ backlog: 'acme', canWrite: false, me: 'spw', writes }}>
          <IssueView backlog="acme" id={id} onClose={onClose} />
        </WriteContext.Provider>
      </StoreContext.Provider>
    </RouterContext.Provider>,
  );
  return { router, store, onClose };
}

export const flush = () => act(async () => {});

/**
 * Prüfstand für die Editoren im Issue-Tab: die echte `IssueView` mit Router, Store und einem echten
 * `Writes`, dessen `call` ein Mock ist. Tests prüfen Tool-Namen und Argumente an `call`.
 */
import type { AttachmentListJson, CommentJson, IssueDetailJson, IssueJson } from '@backe/ui/api.ts';
import { act, cleanup, render } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { Router, RouterContext } from '../app/router.ts';
import { Store } from '../data/store.ts';
import { StoreContext } from '../data/store-context.tsx';
import { WriteContext } from '../data/write-context.tsx';
import { Writes } from '../data/writes.ts';
import { IssueView } from '../views/IssueView.tsx';
import { testIssue, testState, tid } from './state.ts';

export const ID = tid(1);
export const call = vi.fn<(name: string, args: unknown) => Promise<unknown>>();
export const upload = vi.fn<(id: string, name: string, bytes: Blob) => Promise<unknown>>();

/** Was der Server zum Issue zusätzlich liefert; Tests setzen es vor `view` oder vor einem Neuladen. */
export const served: {
  body: string | undefined;
  comments: CommentJson[];
  attachments: AttachmentListJson;
} = { body: undefined, comments: [], attachments: [] };

/**
 * Registriert die Hooks: `call` und `upload` antworten ohne Commit, `fetch` liefert das Detail des
 * Issues samt `served`.
 */
export function registerIssueViewHarness(): void {
  beforeEach(() => {
    call.mockReset();
    call.mockImplementation(async () => ({ commit: null, id: ID }));
    upload.mockReset();
    upload.mockImplementation(async () => ({ commit: null, id: ID }));
    served.body = undefined;
    served.comments = [];
    served.attachments = [];
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/attachments')) return new Response(JSON.stringify(served.attachments));
      const id = url.split('/').pop() as string;
      // Die Felder kommen aus dem Store; das Detail liefert nur, was der Tab zusätzlich lädt.
      const { depends_on: _deps, ...issue } = testIssue(Number(id.slice(-4)));
      const detail: IssueDetailJson = {
        ...issue,
        ...(served.body === undefined ? {} : { body: served.body }),
        ...(served.comments.length === 0 ? {} : { comments: served.comments }),
        comments_count: served.comments.length,
      };
      return new Response(JSON.stringify(detail));
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
}

export function view(
  issues: IssueJson[],
  over: Parameters<typeof testState>[1] = {},
  canWrite = true,
) {
  window.history.replaceState(null, '', `/b/acme/issue/${ID}`);
  const router = new Router(window);
  const store = new Store();
  store.load(testState(issues, over));
  const writes = new Writes(store, {
    call: call as never,
    upload: upload as never,
    refresh: async () => {},
  });
  render(
    <RouterContext.Provider value={router}>
      <StoreContext.Provider value={store}>
        <WriteContext.Provider value={{ backlog: 'acme', canWrite, me: 'spw', writes }}>
          <IssueView backlog="acme" id={ID} onClose={() => {}} />
        </WriteContext.Provider>
      </StoreContext.Provider>
    </RouterContext.Provider>,
  );
  return { store };
}

export const flush = () => act(async () => {});

/** Genau ein Aufruf seit dem letzten Prüfen, mit diesen Argumenten; danach zählt `call` neu. */
export function expectOneCall(name: string, args: unknown): void {
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith(name, args);
  call.mockClear();
}

export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

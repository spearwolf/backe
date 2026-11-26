/**
 * Prüfstand für die Editoren im Issue-Tab: die echte `IssueView` mit Router, Store und einem echten
 * `Writes`, dessen `call` ein Mock ist. Tests prüfen Tool-Namen und Argumente an `call`.
 */
import type { AttachmentListJson, CommentJson, IssueDetailJson, IssueJson } from '@backe/ui/api.ts';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { Router, RouterContext } from '../app/router.ts';
import { Store } from '../data/store.ts';
import { StoreContext } from '../data/store-context.tsx';
import { WriteContext } from '../data/write-context.tsx';
import { Writes } from '../data/writes.ts';
import { formatDate } from '../lib/format.ts';
import { IssueView } from '../views/IssueView.tsx';
import { m } from '../views/issue.messages.ts';
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

/** Der Bereich mit dieser Überschrift (`section` mit `aria-labelledby`). */
export const region = (name: string) => screen.getByRole('region', { name });

export const button = (name: string, scope: HTMLElement = document.body) =>
  within(scope).getByRole('button', { name }) as HTMLButtonElement;

export function testComment(n: number, extra: Partial<CommentJson> = {}): CommentJson {
  return {
    file: `c${n}.md`,
    author: 'spw',
    created: '2026-11-20T10:00:00Z',
    body: `Kommentar ${n}`,
    ...extra,
  };
}

/** Beschreibung, Composer und Kommentare im Tab, wie die Editor-Tests sie ansprechen. */
export const description = () => region(m.description);
export const editDescription = () => button(m.editNamed(m.description), description());
export const descriptionBox = () =>
  within(description()).getByRole('textbox', { name: m.description }) as HTMLTextAreaElement;
export const composer = () =>
  screen.getByRole('textbox', { name: m.newComment }) as HTMLTextAreaElement;
export const commentName = (author = 'spw', created = testComment(0).created) =>
  m.commentBy(author, formatDate(created));
export const png = (name = 'image.png') => new File([name], name, { type: 'image/png' });

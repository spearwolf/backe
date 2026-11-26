import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import type { IssueJson, PatchJson, StateJson } from '@backe/ui/api.ts';
import { describe, expect, it, vi } from 'vitest';
import { fakeEventSources } from '../test/fake-event-source.ts';
import { ApiError } from './api-client.ts';
import { openSession } from './session.ts';

function config() {
  const { $schema: _unused, ...rest } = BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
  });
  return rest;
}

function issue(n: number): IssueJson {
  return {
    id: `bk-t000${n}`,
    title: `Issue ${n}`,
    state: 'todo',
    creator: 'spw',
    created: '2026-11-18T10:00:00Z',
  } as IssueJson;
}

function state(rev: number, issues: IssueJson[] = [issue(1)]): StateJson {
  return {
    rev,
    head: `h${rev}`,
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

function patch(rev: number, issues: IssueJson[] = []): PatchJson {
  return { rev, head: `h${rev}`, upsert: { issues }, remove: {} };
}

/** `fetch`, dessen Antworten der Test einzeln auflöst; kein echtes Warten. */
function setup() {
  const sources = fakeEventSources();
  const pending: Array<{ resolve: (r: Response) => void; reject: (e: unknown) => void }> = [];
  const urls: string[] = [];
  const fetch = (url: string) => {
    urls.push(url);
    return new Promise<Response>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  };
  const session = openSession('main', { eventSource: sources.create, fetch });
  const es = () => sources.last();
  const flush = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  const answer = async (s: StateJson | Response) => {
    const next = pending.shift();
    next?.resolve(s instanceof Response ? s : new Response(JSON.stringify(s)));
    await flush();
  };
  return {
    sources,
    session,
    es,
    urls,
    pending,
    answer,
    flush,
    fail: (e: unknown) => pending.shift()?.reject(e),
  };
}

const hello = (rev: number) => ({ rev, head: `h${rev}` });

describe('openSession', () => {
  it('the first hello loads the state', async () => {
    const { session, es, urls, answer } = setup();
    expect(urls).toEqual([]);
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(1));
    expect(urls).toEqual(['/api/b/main/state']);
    expect(session.store.loaded.value).toBe(false);
    await answer(state(1));
    expect(session.store.loaded.value).toBe(true);
    expect(session.store.rev.value).toBe(1);
    expect(session.status.value).toBe('open');
    expect(session.error.value).toBeUndefined();
    session.dispose();
  });

  it('patches during the state load are applied after it', async () => {
    const { session, es, answer } = setup();
    es()?.emitEvent('hello', hello(1));
    es()?.emitEvent('patch', patch(2, [issue(2)]));
    es()?.emitEvent('patch', patch(3, [issue(3)]));
    expect(session.store.rev.value).toBe(0);
    await answer(state(1));
    expect(session.store.rev.value).toBe(3);
    expect(session.store.issues.keys.value).toHaveLength(3);
    session.dispose();
  });

  it('a patch not newer than the state is dropped', async () => {
    const { session, es, answer } = setup();
    es()?.emitEvent('hello', hello(2));
    es()?.emitEvent('patch', patch(2, [issue(2)]));
    es()?.emitEvent('patch', patch(3, [issue(3)]));
    await answer(state(2));
    expect(session.store.rev.value).toBe(3);
    expect(session.store.issues.keys.value).toEqual(['bk-t0001', 'bk-t0003']);
    session.dispose();
  });

  it('reset while loading loads once more', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitEvent('hello', hello(1));
    es()?.emitEvent('reset', {});
    es()?.emitEvent('reset', {});
    expect(urls).toHaveLength(1);
    await answer(state(1));
    expect(urls).toHaveLength(2);
    await answer(state(5));
    expect(urls).toHaveLength(2);
    expect(session.store.rev.value).toBe(5);
    session.dispose();
  });

  it('a gap in rev reloads the state', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitEvent('hello', hello(1));
    await answer(state(1));
    es()?.emitEvent('patch', patch(2, [issue(2)]));
    expect(session.store.rev.value).toBe(2);
    es()?.emitEvent('patch', patch(5));
    expect(urls).toHaveLength(2);
    es()?.emitEvent('patch', patch(6));
    await answer(state(6));
    expect(session.store.rev.value).toBe(6);
    expect(urls).toHaveLength(2);
    session.dispose();
  });

  it('a gap found while draining the buffer reloads and keeps the rest', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitEvent('hello', hello(1));
    es()?.emitEvent('patch', patch(4));
    es()?.emitEvent('patch', patch(5));
    await answer(state(1));
    expect(urls).toHaveLength(2);
    await answer(state(4));
    expect(session.store.rev.value).toBe(5);
    session.dispose();
  });

  it('a second hello does not reload', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(1));
    await answer(state(1));
    es()?.emitError();
    expect(session.status.value).toBe('offline');
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(1));
    expect(urls).toHaveLength(1);
    session.dispose();
  });

  it('a hello during the load does not start a second one', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitEvent('hello', hello(1));
    es()?.emitEvent('hello', hello(1));
    expect(urls).toHaveLength(1);
    await answer(state(1));
    session.dispose();
  });

  it('sync events update the store', () => {
    const { session, es } = setup();
    es()?.emitEvent('sync', { ahead: 2 });
    expect(session.store.sync.value).toEqual({ ahead: 2 });
    session.dispose();
  });

  it('a failed load sets the error and retries on reset', async () => {
    const { session, es, urls, answer, fail, flush } = setup();
    es()?.emitEvent('hello', hello(1));
    fail(new Error('boom'));
    await flush();
    expect(session.error.value).toBeInstanceOf(ApiError);
    expect(session.error.value?.code).toBe('offline');
    expect(session.store.loaded.value).toBe(false);
    es()?.emitEvent('reset', {});
    expect(urls).toHaveLength(2);
    await answer(state(1));
    expect(session.error.value).toBeUndefined();
    expect(session.store.loaded.value).toBe(true);
    session.dispose();
  });

  it('a failed load retries on the next hello', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitEvent('hello', hello(1));
    await answer(new Response('{"error":{"code":"x","message":"m"}}', { status: 500 }));
    expect(session.error.value?.status).toBe(500);
    es()?.emitEvent('hello', hello(1));
    expect(urls).toHaveLength(2);
    await answer(state(1));
    session.dispose();
  });

  it('a failed reload retries on the next hello', async () => {
    const { session, es, urls, answer, fail, flush } = setup();
    es()?.emitEvent('hello', hello(1));
    await answer(state(1));
    es()?.emitEvent('reset', {});
    fail(new Error('boom'));
    await flush();
    expect(session.error.value).toBeDefined();
    es()?.emitEvent('hello', hello(2));
    expect(urls).toHaveLength(3);
    await answer(state(2));
    expect(session.store.rev.value).toBe(2);
    es()?.emitEvent('hello', hello(2));
    expect(urls).toHaveLength(3);
    session.dispose();
  });

  it('a reset during a failed load retries once', async () => {
    const { session, es, urls, fail, flush } = setup();
    es()?.emitEvent('hello', hello(1));
    es()?.emitEvent('reset', {});
    fail(new Error('boom'));
    await flush();
    // Der Reset geht nicht verloren: ein zweiter Versuch, der Fehler bleibt bis dahin stehen.
    expect(urls).toHaveLength(2);
    expect(session.error.value?.code).toBe('offline');
    fail(new Error('boom again'));
    await flush();
    expect(urls).toHaveLength(2);
    expect(session.error.value?.message).toBe('boom again');
    session.dispose();
  });

  it('a reset during a failed load loads the state on the retry', async () => {
    const { session, es, answer, fail, flush } = setup();
    es()?.emitEvent('hello', hello(1));
    es()?.emitEvent('reset', {});
    fail(new Error('boom'));
    await flush();
    await answer(state(4));
    expect(session.store.rev.value).toBe(4);
    expect(session.error.value).toBeUndefined();
    session.dispose();
  });

  it('a failed load clears the patch buffer', async () => {
    const { session, es, urls, answer, fail, flush } = setup();
    es()?.emitEvent('hello', hello(1));
    es()?.emitEvent('patch', patch(2, [issue(2)]));
    es()?.emitEvent('patch', patch(3, [issue(3)]));
    fail(new Error('boom'));
    await flush();
    es()?.emitEvent('reset', {});
    expect(urls).toHaveLength(2);
    // Was vor dieser Anfrage kam, steckt in ihrem Zustand; der alte Puffer läuft nicht nach.
    await answer(state(1));
    expect(session.store.rev.value).toBe(1);
    expect(session.store.issues.keys.value).toEqual(['bk-t0001']);
    session.dispose();
  });

  it('an error before the stream opens sets the session error', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitError(true);
    expect(urls).toEqual(['/api/b/main/state']);
    await answer(
      new Response(
        JSON.stringify({
          error: { code: 'not_found', message: 'no working copy', hint: 'backe clone' },
        }),
        { status: 404 },
      ),
    );
    expect(session.status.value).toBe('offline');
    expect(session.error.value).toMatchObject({
      status: 404,
      code: 'not_found',
      message: 'no working copy',
      hint: 'backe clone',
    });
    expect(session.store.loaded.value).toBe(false);
    session.dispose();
  });

  it('a stream closed after open probes the state and shows a 401', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(1));
    await answer(state(1));
    es()?.emitError();
    expect(urls).toHaveLength(1);
    es()?.emitError(true);
    expect(urls).toHaveLength(2);
    await answer(
      new Response('{"error":{"code":"unauthorized","message":"no session","hint":"reopen"}}', {
        status: 401,
      }),
    );
    expect(session.error.value).toMatchObject({ status: 401, hint: 'reopen' });
    session.dispose();
  });

  it('a stream error during a load does not start a second one', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitEvent('hello', hello(1));
    es()?.emitError(true);
    expect(urls).toHaveLength(1);
    await answer(state(1));
    expect(session.store.loaded.value).toBe(true);
    session.dispose();
  });

  it('a successful probe loads the state, the next hello loads again', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitError();
    await answer(state(1));
    expect(session.store.loaded.value).toBe(true);
    expect(session.error.value).toBeUndefined();
    // Bis der Stream steht, fehlen womöglich Patches: das erste hello lädt neu.
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(3));
    expect(urls).toHaveLength(2);
    await answer(state(3));
    expect(session.store.rev.value).toBe(3);
    es()?.emitEvent('hello', hello(3));
    expect(urls).toHaveLength(2);
    session.dispose();
  });

  it('a hello during a failing probe loads again', async () => {
    const { session, es, urls, answer, fail, flush } = setup();
    es()?.emitError();
    expect(urls).toHaveLength(1);
    // Der Browser öffnet den Stream neu, während die Probe noch läuft.
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(1));
    expect(urls).toHaveLength(1);
    fail(new Error('down'));
    await flush();
    expect(urls).toHaveLength(2);
    await answer(state(1));
    expect(session.store.loaded.value).toBe(true);
    expect(session.error.value).toBeUndefined();
    session.dispose();
  });

  it('a hello during a successful probe reloads once', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitError();
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(2));
    es()?.emitEvent('hello', hello(2));
    expect(urls).toHaveLength(1);
    await answer(state(1));
    expect(urls).toHaveLength(2);
    await answer(state(2));
    expect(session.store.rev.value).toBe(2);
    expect(urls).toHaveLength(2);
    es()?.emitEvent('hello', hello(2));
    expect(urls).toHaveLength(2);
    session.dispose();
  });

  it('malformed patch and hello payloads count as reset', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitEvent('hello', 'null');
    expect(urls).toHaveLength(1);
    await answer(state(1));
    es()?.emitEvent('patch', 'null');
    expect(urls).toHaveLength(2);
    await answer(state(1));
    es()?.emitEvent('patch', '{"rev":"x"}');
    expect(urls).toHaveLength(3);
    session.dispose();
  });

  it('refresh resolves after the reload, also on failure', async () => {
    const { session, es, urls, answer, fail, flush } = setup();
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(1));
    await answer(state(1));
    let done = 0;
    const count = () => {
      done++;
    };
    void session.refresh().then(count);
    expect(urls).toHaveLength(2);
    // Ein zweites Neuladen während des ersten: beide Wartenden warten auf das letzte.
    void session.refresh().then(count);
    expect(urls).toHaveLength(2);
    await answer(state(2));
    expect(done).toBe(0);
    expect(urls).toHaveLength(3);
    await answer(state(3));
    expect(done).toBe(2);
    expect(session.store.rev.value).toBe(3);
    void session.refresh().then(count);
    fail(new Error('boom'));
    await flush();
    expect(done).toBe(3);
    expect(session.error.value?.message).toBe('boom');
    session.dispose();
  });

  it('refresh waits for a reload that a gap in the buffer starts', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(1));
    await answer(state(1));
    let done = false;
    void session.refresh().then(() => {
      done = true;
    });
    es()?.emitEvent('patch', patch(5));
    await answer(state(2));
    expect(urls).toHaveLength(3);
    expect(done).toBe(false);
    await answer(state(5));
    expect(done).toBe(true);
    expect(session.store.rev.value).toBe(5);
    session.dispose();
  });

  it('a refresh without a running stream loads again on the next hello', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(1));
    await answer(state(1));
    es()?.emitError();
    void session.refresh();
    await answer(state(2));
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(3));
    expect(urls).toHaveLength(3);
    await answer(state(3));
    expect(session.store.rev.value).toBe(3);
    session.dispose();
  });

  it('a refresh during a probe without stream loads again on the next hello', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitError();
    expect(urls).toHaveLength(1);
    void session.refresh();
    expect(urls).toHaveLength(1);
    await answer(state(1));
    // Das nachgeholte Laden läuft noch ohne Stream: wieder eine Probe.
    expect(urls).toHaveLength(2);
    await answer(state(2));
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(3));
    expect(urls).toHaveLength(3);
    await answer(state(3));
    expect(session.store.rev.value).toBe(3);
    session.dispose();
  });

  it('a refresh after dispose resolves at once', async () => {
    const { session, urls } = setup();
    session.dispose();
    await expect(session.refresh()).resolves.toBeUndefined();
    expect(urls).toHaveLength(0);
  });

  it('dispose of the session disposes its writes', async () => {
    const { session, es, urls, answer, pending, flush } = setup();
    es()?.emitOpen();
    es()?.emitEvent('hello', hello(1));
    await answer(state(1));
    const done = session.writes.run(
      'issue_move',
      { id: 'bk-t0001', to: 'in_progress' },
      { optimistic: new Map<string, Partial<IssueJson>>([['bk-t0001', { state: 'in_progress' }]]) },
    );
    expect(urls).toEqual(['/api/b/main/state', '/api/b/main/tools/issue_move']);
    expect(session.store.pendingCount('bk-t0001').value).toBe(1);
    const dispose = vi.spyOn(session.writes, 'dispose');
    let refreshed = false;
    void session.refresh().then(() => {
      refreshed = true;
    });
    session.dispose();
    expect(dispose).toHaveBeenCalledOnce();
    expect(session.store.pendingCount('bk-t0001').value).toBe(0);
    await flush();
    expect(refreshed).toBe(true);
    pending.shift()?.resolve(new Response(JSON.stringify({ commit: 'c1', id: 'bk-t0001' })));
    await expect(done).resolves.toEqual({ commit: 'c1', id: 'bk-t0001' });
  });

  it('writes upload through the session', async () => {
    const { session, urls, pending } = setup();
    const done = session.writes.upload('bk-t0001', 'shot.png', new Blob(['x']));
    expect(urls).toEqual(['/api/b/main/issues/bk-t0001/attachments/shot.png']);
    pending.shift()?.resolve(new Response(JSON.stringify({ commit: null, id: 'bk-t0001' })));
    await expect(done).resolves.toEqual({ commit: null, id: 'bk-t0001' });
    session.dispose();
  });

  it('dispose stops all updates', async () => {
    const { session, es, urls, answer } = setup();
    es()?.emitEvent('hello', hello(1));
    await answer(state(1));
    const source = es();
    session.dispose();
    expect(source?.closed).toBe(true);
    source?.emitEvent('patch', patch(2, [issue(2)]));
    source?.emitEvent('sync', { ahead: 1 });
    source?.emitEvent('reset', {});
    expect(session.store.rev.value).toBe(1);
    expect(urls).toHaveLength(1);
  });

  it('dispose during a load discards the result', async () => {
    const { session, es, answer } = setup();
    es()?.emitEvent('hello', hello(1));
    session.dispose();
    await answer(state(1));
    expect(session.store.loaded.value).toBe(false);
  });

  it('dispose during a failing load discards the error', async () => {
    const { session, es, fail, flush } = setup();
    es()?.emitEvent('hello', hello(1));
    session.dispose();
    fail(new Error('boom'));
    await flush();
    expect(session.error.value).toBeUndefined();
  });
});

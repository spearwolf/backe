import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import type { IssueJson, PatchJson, StateJson } from '@backe/ui/api.ts';
import { describe, expect, it } from 'vitest';
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

  it('a failed load drops a reset that came in meanwhile', async () => {
    const { session, es, urls, fail, flush } = setup();
    es()?.emitEvent('hello', hello(1));
    es()?.emitEvent('reset', {});
    fail(new Error('boom'));
    await flush();
    expect(urls).toHaveLength(1);
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
});

import type { IssueJson } from '@backe/ui/api.ts';
import { describe, expect, it, vi } from 'vitest';
import { hello, issue, patch, setup, state } from '../test/session-harness.ts';

describe('openSession', () => {
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

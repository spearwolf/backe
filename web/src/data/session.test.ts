import { describe, expect, it } from 'vitest';
import { hello, issue, patch, setup, state } from '../test/session-harness.ts';

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
});

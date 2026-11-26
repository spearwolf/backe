import { describe, expect, it } from 'vitest';
import { hello, issue, patch, setup, state } from '../test/session-harness.ts';
import { ApiError } from './api-client.ts';

describe('openSession', () => {
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
});

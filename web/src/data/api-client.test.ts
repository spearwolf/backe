import { describe, expect, it } from 'vitest';
import { ApiError, getJson, postJson, putBytes } from './api-client.ts';

const json = (status: number, body: unknown, statusText = '') =>
  new Response(JSON.stringify(body), { status, statusText });

describe('getJson', () => {
  it('returns the parsed body', async () => {
    const f = async () => json(200, { a: 1 });
    expect(await getJson<{ a: number }>('/api/x', f)).toEqual({ a: 1 });
  });

  it('turns error json into an ApiError', async () => {
    const f = async () => json(409, { error: { code: 'conflict', message: 'x', hint: 'h' } });
    const err = await getJson('/api/x', f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'conflict', message: 'x', hint: 'h' });
  });

  it('without error json uses the status', async () => {
    const f = async () => new Response('<html>', { status: 502, statusText: 'Bad Gateway' });
    const err = await getJson('/api/x', f).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'http', message: 'Bad Gateway' });
  });

  it('maps a network failure to offline', async () => {
    const f = async () => {
      throw new TypeError('Failed to fetch');
    };
    const err = await getJson('/api/x', f).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: 'offline' });
  });
});

describe('postJson', () => {
  it('sends json with the content type and parses the answer', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = async (input: string, init?: RequestInit) => {
      calls.push([input, init]);
      return json(200, { commit: 'abc' });
    };
    expect(await postJson<{ commit: string }>('/api/x', { a: 1 }, f)).toEqual({ commit: 'abc' });
    expect(calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
  });

  it('write errors carry code, hint and details', async () => {
    const details = { reason: 'open_children', ids: ['bk-2'] };
    const f = async () =>
      json(400, { error: { code: 'validation', message: 'm', hint: 'h', details } });
    const err = await postJson('/api/x', {}, f).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      code: 'validation',
      message: 'm',
      hint: 'h',
      details,
    });
  });

  it('no answer is offline', async () => {
    const f = async () => {
      throw new TypeError('Failed to fetch');
    };
    const err = await postJson('/api/x', {}, f).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: 'offline' });
  });
});

describe('putBytes', () => {
  it('sends octet-stream', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = async (input: string, init?: RequestInit) => {
      calls.push([input, init]);
      return json(200, { commit: null });
    };
    const blob = new Blob(['x']);
    await putBytes('/api/x', blob, f);
    expect(calls[0]?.[1]).toMatchObject({
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    expect(calls[0]?.[1]?.body).toBe(blob);
  });
});

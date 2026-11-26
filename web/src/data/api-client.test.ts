import { describe, expect, it } from 'vitest';
import { ApiError, getJson } from './api-client.ts';

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

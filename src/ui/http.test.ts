import type { ServerResponse } from 'node:http';
import { BackeError } from '../core/errors.ts';
import { errorJson } from '../services/views.ts';
import { httpStatus, JSON_TYPE, sendError, sendJson } from './http.ts';

/** Minimale Attrappe: merkt sich Status, Header und Body von `writeHead`/`end`. */
function fakeResponse() {
  const seen: { status?: number; headers?: Record<string, unknown>; body?: string } = {};
  const res = {
    writeHead(status: number, headers: Record<string, unknown>) {
      seen.status = status;
      seen.headers = headers;
      return res;
    },
    end(body: string) {
      seen.body = body;
    },
  };
  return { res: res as unknown as ServerResponse, seen };
}

test.each([
  ['usage', 400],
  ['validation', 400],
  ['ambiguous', 400],
  ['not_found', 404],
  ['conflict', 409],
  ['verify', 422],
  ['sync', 502],
  ['unexpected', 500],
] as const)('httpStatus maps %s to %i', (code, status) => {
  expect(httpStatus(new BackeError(code, 'x'))).toBe(status);
});

test('httpStatus treats foreign errors as 500', () => {
  expect(httpStatus(new Error('x'))).toBe(500);
});

test('sendJson writes compact json with length and no-store', () => {
  const { res, seen } = fakeResponse();
  sendJson(res, 200, { a: 'ä' }, { 'X-Test': '1' });
  expect(seen.status).toBe(200);
  expect(seen.body).toBe('{"a":"ä"}');
  expect(seen.headers).toEqual({
    'Content-Type': JSON_TYPE,
    'Content-Length': Buffer.byteLength('{"a":"ä"}'),
    'Cache-Control': 'no-store',
    'X-Test': '1',
  });
});

test('sendError writes the error json of the cli', () => {
  const err = new BackeError('not_found', 'weg', { hint: 'such' });
  const { res, seen } = fakeResponse();
  sendError(res, err);
  expect(seen.status).toBe(404);
  expect(seen.body).toBe(JSON.stringify(errorJson(err)));
  expect(seen.headers?.['Content-Type']).toBe(JSON_TYPE);
});

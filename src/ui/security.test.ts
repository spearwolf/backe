import type { IncomingHttpHeaders } from 'node:http';
import {
  appHeaders,
  CSP,
  checkRequest,
  cookieName,
  cookieOf,
  type Gate,
  newToken,
  ownOrigins,
  sameToken,
} from './security.ts';

const PORT = 8123;
const TOKEN = 'a'.repeat(64);
const GATE: Gate = { port: PORT, token: TOKEN, origins: ownOrigins(PORT) };
const HOST = `127.0.0.1:${PORT}`;
const COOKIE_HEADER = `backe_ui_${PORT}=${TOKEN}`;

/** Prüft eine Anfrage gegen `GATE`; `path` samt Query wie in `req.url`. */
function check(path: string, headers: IncomingHttpHeaders, method = 'GET') {
  return checkRequest({ method, url: new URL(path, 'http://127.0.0.1'), headers }, GATE);
}

test('newToken returns 64 hex characters and differs each time', () => {
  const a = newToken();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(newToken()).not.toBe(a);
});

test('sameToken compares in constant time and rejects missing or short values', () => {
  expect(sameToken(undefined, TOKEN)).toBe(false);
  expect(sameToken(TOKEN.slice(1), TOKEN)).toBe(false);
  expect(sameToken('b'.repeat(64), TOKEN)).toBe(false);
  expect(sameToken(TOKEN, TOKEN)).toBe(true);
});

test('cookieOf finds a cookie by name', () => {
  expect(cookieOf('a=1; backe_ui=x; b=2', 'backe_ui')).toBe('x');
  expect(cookieOf('backe_ui=x=y', 'backe_ui')).toBe('x=y');
  expect(cookieOf('a=1', 'backe_ui')).toBeUndefined();
  expect(cookieOf(undefined, 'backe_ui')).toBeUndefined();
});

test('cookieName carries the port', () => {
  expect(cookieName(8002)).toBe('backe_ui_8002');
});

test('ownOrigins names both loopback spellings', () => {
  expect(ownOrigins(PORT)).toEqual([`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`]);
});

test('appHeaders carries csp, nosniff and no-referrer', () => {
  expect(appHeaders()).toEqual({
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
});

test.each([
  ['a foreign host', '/', { host: `evil.example:${PORT}`, cookie: COOKIE_HEADER }, 'GET', 403],
  ['a foreign port', '/', { host: '127.0.0.1:1', cookie: COOKIE_HEADER }, 'GET', 403],
  ['no host', '/', { cookie: COOKIE_HEADER }, 'GET', 403],
  ['a foreign origin', '/', { host: HOST, origin: 'http://evil.example' }, 'GET', 403],
  ['a null origin', '/', { host: HOST, origin: 'null', cookie: COOKIE_HEADER }, 'GET', 403],
  ['a write without origin', '/api/x', { host: HOST, cookie: COOKIE_HEADER }, 'POST', 403],
  ['a foreign host before a valid token', `/?token=${TOKEN}`, { host: 'evil.example' }, 'GET', 403],
  ['a wrong token', `/?token=${'b'.repeat(64)}`, { host: HOST, cookie: COOKIE_HEADER }, 'GET', 401],
  ['an empty token', '/?token=', { host: HOST }, 'GET', 401],
  ['no cookie', '/', { host: HOST }, 'GET', 401],
  ['a wrong cookie', '/', { host: HOST, cookie: `backe_ui_${PORT}=${'b'.repeat(64)}` }, 'GET', 401],
  ['the cookie of another port', '/', { host: HOST, cookie: `backe_ui_1=${TOKEN}` }, 'GET', 401],
  ['the unscoped cookie name', '/', { host: HOST, cookie: `backe_ui=${TOKEN}` }, 'GET', 401],
  [
    'a token only in the referer',
    '/',
    { host: HOST, referer: `http://${HOST}/?token=${TOKEN}` },
    'GET',
    401,
  ],
] as const)('checkRequest denies %s', (_name, path, headers, method, status) => {
  const verdict = check(path, headers, method);
  expect(verdict.kind).toBe('deny');
  if (verdict.kind !== 'deny') return;
  expect(verdict.status).toBe(status);
  expect(verdict.code).toBe(status === 401 ? 'unauthorized' : 'forbidden');
  expect(verdict.message).not.toBe('');
  if (status === 401) expect(verdict.hint).toBeDefined();
});

test.each([
  ['a cookie', '/', { host: HOST, cookie: `a=1; ${COOKIE_HEADER}` }, 'GET'],
  ['localhost as host', '/', { host: `localhost:${PORT}`, cookie: COOKIE_HEADER }, 'GET'],
  ['HEAD without origin', '/', { host: HOST, cookie: COOKIE_HEADER }, 'HEAD'],
  [
    'a write with its own origin',
    '/api/x',
    { host: HOST, origin: `http://localhost:${PORT}`, cookie: COOKIE_HEADER },
    'POST',
  ],
] as const)('checkRequest passes %s', (_name, path, headers, method) => {
  expect(check(path, headers, method)).toEqual({ kind: 'pass' });
});

test('a valid token opens a session and redirects without it', () => {
  expect(check(`/b/acme?token=${TOKEN}&x=1`, { host: HOST })).toEqual({
    kind: 'session',
    location: '/b/acme?x=1',
    cookie: `backe_ui_${PORT}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`,
  });
  expect(check(`/?token=${TOKEN}`, { host: HOST })).toMatchObject({ location: '/' });
});

test('the redirect never leaves the own host', () => {
  expect(check(`/.//evil.example/x?token=${TOKEN}`, { host: HOST })).toMatchObject({
    location: '/evil.example/x',
  });
});

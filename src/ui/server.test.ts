import { mkdir, mkdtemp, open, rm } from 'node:fs/promises';
import { Agent, get as httpGet } from 'node:http';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { rawRequest, startUi, type UiHarness } from '../../test/helpers/ui.ts';
import { setLocale } from '../i18n/locale.ts';
import { CSP } from './security.ts';
import { createUiServer, type UiOptions } from './server.ts';

let dir: string;
let opts: Omit<UiOptions, 'port'>;
let ui: UiHarness;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'backe-ui-'));
  opts = {
    cwd: dir,
    env: { BACKE_HOME: join(dir, 'home') },
    flags: {},
    start: undefined,
  };
});
afterAll(() => rm(dir, { recursive: true, force: true }));

beforeEach(async () => {
  ui = await startUi(opts);
});
afterEach(() => ui.close());

/** Fehlercode eines Verbindungsversuchs auf `host:port`; `undefined`, wenn er gelingt. */
function connectError(host: string, port: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket: Socket = connect({ host, port });
    socket.on('connect', () => {
      socket.destroy();
      resolve(undefined);
    });
    socket.on('error', (err: NodeJS.ErrnoException) => resolve(err.code));
  });
}

test('the token sets the session cookie and redirects without it', async () => {
  const r = await rawRequest(ui.port, { path: `/b/acme?token=${ui.token}&x=1` });
  expect(r.status).toBe(303);
  expect(r.headers.location).toBe('/b/acme?x=1');
  expect(r.headers['set-cookie']).toEqual([
    `backe_ui_${ui.port}=${ui.token}; HttpOnly; SameSite=Strict; Path=/`,
  ]);
});

test('requests without the cookie get 401', async () => {
  const api = await rawRequest(ui.port, { path: '/api/backlogs' });
  expect(api.status).toBe(401);
  expect(api.json().error.code).toBe('unauthorized');
  expect(api.json().error.hint).toBeDefined();
  const html = await rawRequest(ui.port, { path: '/' });
  expect([html.status, html.headers['content-type']]).toEqual([401, 'text/html; charset=utf-8']);
  expect(html.text()).not.toContain('<script');
});

test('a wrong token gets 401 and no cookie', async () => {
  const r = await rawRequest(ui.port, { path: `/?token=${'0'.repeat(64)}` });
  expect(r.status).toBe(401);
  expect(r.headers['set-cookie']).toBeUndefined();
});

test('rejects foreign host and origin', async () => {
  const cookie = { cookie: ui.cookie };
  expect((await ui.get('/api/backlogs', { host: `evil.example:${ui.port}` })).status).toBe(403);
  expect((await ui.get('/api/backlogs', { host: `localhost:${ui.port}` })).status).not.toBe(403);
  expect((await ui.get('/api/backlogs', { origin: 'http://evil.example' })).status).toBe(403);
  const post = await rawRequest(ui.port, {
    method: 'POST',
    path: '/api/b/acme/tools/issue_create',
    headers: { ...cookie, 'content-type': 'text/plain' },
    body: '{"title":"x"}',
  });
  expect(post.status).toBe(403);
  expect(post.json().error.code).toBe('forbidden');
  const page = await ui.get('/', { host: `<b>evil</b>:${ui.port}` });
  expect([page.status, page.headers['content-type']]).toEqual([403, 'text/html; charset=utf-8']);
  expect(page.text()).toContain('&lt;b&gt;evil&lt;/b&gt;');
  expect(page.text()).not.toContain('<b>');
});

test('a session cookie only opens its own server', async () => {
  const other = await startUi({ ...opts, token: ui.token });
  try {
    expect(ui.cookie).toBe(`backe_ui_${ui.port}=${ui.token}`);
    expect(other.cookie).toBe(`backe_ui_${other.port}=${ui.token}`);
    // Der Browser schickt beide Cookies an beide Ports; jeder Server liest nur seinen Namen.
    expect((await other.get('/', { cookie: ui.cookie })).status).toBe(401);
    expect((await ui.get('/', { cookie: other.cookie })).status).toBe(401);
    const both = { cookie: `${ui.cookie}; ${other.cookie}` };
    expect((await ui.get('/', both)).status).toBe(200);
    expect((await other.get('/', both)).status).toBe(200);
  } finally {
    await other.close();
  }
});

test('a planted cookie of the same name does not lock the session out', async () => {
  const planted = `backe_ui_${ui.port}=${'0'.repeat(64)}`;
  expect((await ui.get('/', { cookie: `${planted}; ${ui.cookie}` })).status).toBe(200);
  expect((await ui.get('/api/nope', { cookie: `${planted}; ${ui.cookie}` })).status).toBe(404);
  expect((await ui.get('/', { cookie: planted })).status).toBe(401);
});

test('a token in the referer opens no session', async () => {
  const r = await rawRequest(ui.port, {
    path: '/api/backlogs',
    headers: { referer: `http://127.0.0.1:${ui.port}/?token=${ui.token}` },
  });
  expect(r.status).toBe(401);
});

test('with the cookie the api answers not_found and pages the placeholder', async () => {
  const api = await ui.get('/api/nope');
  expect(api.status).toBe(404);
  expect(api.json().error.code).toBe('not_found');
  const page = await ui.get('/b/acme');
  expect([page.status, page.headers['content-type']]).toEqual([200, 'text/html; charset=utf-8']);
  expect(page.text()).toContain('pnpm build');
});

test('every response carries the security headers', async () => {
  const responses = [
    await ui.get('/'),
    await rawRequest(ui.port, { path: `/?token=${ui.token}` }),
    await rawRequest(ui.port, { path: '/' }),
    await ui.get('/', { origin: 'http://evil.example' }),
    await ui.get('/api/nope'),
  ];
  expect(responses.map((r) => r.status)).toEqual([200, 303, 401, 403, 404]);
  for (const r of responses) {
    expect(r.headers['content-security-policy']).toBe(CSP);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  }
});

test('an unexpected error in the handler is a 500, not a crash', async () => {
  const r = await ui.get('http://[');
  expect(r.status).toBe(500);
  expect(r.json().error.code).toBe('unexpected');
  expect(r.headers['content-security-policy']).toBe(CSP);
  expect((await ui.get('/')).status).toBe(200);
});

test('a busy port is a sync error', async () => {
  const err = await catchErrAsync(() => createUiServer({ ...opts, port: ui.port }).listen());
  expect([err.code, err.exitCode, err.hint]).toEqual(['sync', 6, 'backe ui --port <n>']);
  expect(err.message).toContain(String(ui.port));
});

test('the busy-port message reads as the spec says in English', async () => {
  setLocale('en');
  try {
    const err = await catchErrAsync(() => createUiServer({ ...opts, port: ui.port }).listen());
    expect(err.message).toBe(`Port ${ui.port} is in use`);
  } finally {
    setLocale('de');
  }
});

test('listen reports the url with the token', async () => {
  const server = createUiServer({ ...opts, port: 0, token: 'f'.repeat(64) });
  const { port, url } = await server.listen();
  await server.close();
  expect(url).toBe(`http://127.0.0.1:${port}/?token=${'f'.repeat(64)}`);
});

test('listens on 127.0.0.1 only', async () => {
  expect(['ECONNREFUSED', 'EADDRNOTAVAIL']).toContain(await connectError('::1', ui.port));
});

test('close ends open connections', async () => {
  const server = createUiServer({ ...opts, port: 0 });
  const { port } = await server.listen();
  const agent = new Agent({ keepAlive: true });
  try {
    // Im Objekt verpackt: `resolve(promise)` würde auf das Schließen des Sockets warten.
    const { socketClosed } = await new Promise<{ socketClosed: Promise<void> }>(
      (resolve, reject) => {
        let socketClosed: Promise<void>;
        const req = httpGet({ host: '127.0.0.1', port, path: '/', agent }, (res) => {
          res.resume();
          res.on('end', () => resolve({ socketClosed }));
        });
        req.on('socket', (socket) => {
          socketClosed = new Promise((done) => socket.once('close', () => done()));
        });
        req.on('error', reject);
      },
    );
    expect(Object.values(agent.freeSockets).flat()).toHaveLength(1);
    await server.close();
    await socketClosed;
    expect(await connectError('127.0.0.1', port)).toBe('ECONNREFUSED');
    await server.close();
  } finally {
    agent.destroy();
  }
});

test('close does not wait for a client that stopped reading a download', async () => {
  // Dünn besetzt: 256 MiB ohne Schreiblast, mehr als Socket-Puffer beider Seiten fassen.
  const size = 256 * 1024 * 1024;
  const staticDir = join(dir, 'big');
  await mkdir(staticDir, { recursive: true });
  const fh = await open(join(staticDir, 'big.bin'), 'w');
  await fh.truncate(size);
  await fh.close();
  const big = await startUi({ ...opts, staticDir });
  const socket = connect({ host: '127.0.0.1', port: big.port });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  let received = 0;
  // Die ersten Bytes heißen: Der Handler streamt. Danach liest der Client nicht weiter.
  const head = await new Promise<string>((resolve, reject) => {
    socket.once('data', (chunk: Buffer) => {
      socket.pause();
      received += chunk.length;
      resolve(chunk.toString('latin1'));
    });
    socket.once('error', reject);
    socket.write(
      `GET /big.bin HTTP/1.1\r\nHost: 127.0.0.1:${big.port}\r\nCookie: ${big.cookie}\r\n\r\n`,
    );
  });
  expect(head).toMatch(/^HTTP\/1\.1 200/);
  await big.close();
  socket.on('data', (chunk: Buffer) => {
    received += chunk.length;
  });
  socket.on('error', () => undefined);
  socket.resume();
  await closed;
  expect(received).toBeLessThan(size);
}, 5000);

import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { rawRequest, startUi, type UiHarness } from '../../test/helpers/ui.ts';
import { serveStatic } from './static.ts';

/**
 * Eingriff gleich nach dem nächsten `stat` auf `path`, also zwischen `locate` und dem Öffnen:
 * Die Datei verschwindet (`rm`) oder schrumpft auf 1000 Bytes (`shrink`).
 */
const afterStat = vi.hoisted(() => ({
  path: undefined as string | undefined,
  action: 'rm' as 'rm' | 'shrink',
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  const stat = async (path: string) => {
    const info = await fs.stat(path);
    if (path === afterStat.path) {
      afterStat.path = undefined;
      if (afterStat.action === 'rm') await fs.rm(path);
      else await fs.truncate(path, 1000);
    }
    return info;
  };
  return { ...fs, stat };
});

const INDEX = '<!doctype html><title>app</title><div id=root></div>';
const SECRET = 'top-secret-value';

let base: string;
let dist: string;
let ui: UiHarness;

async function start(staticDir: string): Promise<UiHarness> {
  return startUi({
    cwd: base,
    env: { BACKE_HOME: join(base, 'home') },
    flags: {},
    start: undefined,
    staticDir,
  });
}

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'backe-ui-static-'));
  dist = join(base, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), INDEX);
  await writeFile(join(dist, 'assets', 'app-3f9a1c.js'), 'console.log(1);');
  await writeFile(join(dist, 'favicon.ico'), 'ico');
  await writeFile(join(base, 'secret.txt'), SECRET);
  await symlink(dirname(dist), join(dist, 'assets', 'out'));
});
afterAll(() => rm(base, { recursive: true, force: true }));

beforeEach(async () => {
  ui = await start(dist);
});
afterEach(() => ui.close());

test('serves hashed assets as immutable', async () => {
  const r = await ui.get('/assets/app-3f9a1c.js');
  expect([r.status, r.headers['content-type'], r.headers['cache-control']]).toEqual([
    200,
    'text/javascript; charset=utf-8',
    'public, max-age=31536000, immutable',
  ]);
  expect(r.headers['content-length']).toBe('15');
  expect(r.headers['x-content-type-options']).toBe('nosniff');
});

test('serves other files with no-cache and their type', async () => {
  const r = await ui.get('/favicon.ico');
  expect([r.status, r.headers['content-type'], r.headers['cache-control']]).toEqual([
    200,
    'image/x-icon',
    'no-cache',
  ]);
});

test('app routes fall back to index.html', async () => {
  for (const p of ['/b/acme/issues/bk-1', '/']) {
    const r = await ui.get(p);
    expect([r.status, r.text(), r.headers['cache-control']], p).toEqual([200, INDEX, 'no-cache']);
  }
});

test('missing files with an extension are 404', async () => {
  const r = await ui.get('/nope.js');
  expect([r.status, r.headers['content-type']]).toEqual([404, 'text/plain; charset=utf-8']);
  expect([r.text(), r.headers['content-length']]).toEqual(['nicht gefunden', '14']);
});

test('a file that vanishes before it is opened is 404 like a missing one', async () => {
  const path = join(dist, 'gone.js');
  await writeFile(path, 'console.log(2);');
  Object.assign(afterStat, { path: await realpath(path), action: 'rm' });
  const r = await ui.get('/gone.js');
  expect([r.status, r.text()]).toEqual([404, 'nicht gefunden']);
  expect(afterStat.path).toBeUndefined();
});

test('a file that shrinks before it is opened is sent with the length of the opened file', async () => {
  const path = join(dist, 'assets', 'shrink-1a2b.js');
  await writeFile(path, Buffer.alloc(300_000, 0x61));
  Object.assign(afterStat, { path: await realpath(path), action: 'shrink' });
  const r = await ui.get('/assets/shrink-1a2b.js', { connection: 'keep-alive' });
  expect([r.status, r.headers['content-length'], r.body.length]).toEqual([200, '1000', 1000]);
}, 3000);

test('an index.html that vanishes before it is opened leaves the placeholder', async () => {
  const own = join(base, 'vanishing');
  await mkdir(own);
  await writeFile(join(own, 'index.html'), INDEX);
  const u = await start(own);
  try {
    Object.assign(afterStat, { path: await realpath(join(own, 'index.html')), action: 'rm' });
    const r = await u.get('/b/acme');
    expect([r.status, r.text()]).toEqual([200, expect.stringContaining('pnpm build')]);
    expect(afterStat.path).toBeUndefined();
  } finally {
    await u.close();
  }
});

test('static paths never leave the root', async () => {
  for (const p of [
    '/%2e%2e/secret.txt',
    '/..%2fsecret.txt',
    '/assets/%00x',
    '/assets/out/secret.txt',
    '/%E0%A4%A',
    '/assets/..%5c..%5csecret.txt',
  ]) {
    const r = await ui.get(p);
    expect(r.status, p).toBe(404);
    expect(r.text(), p).not.toContain(SECRET);
  }
});

test('methods other than GET and HEAD are 404', async () => {
  const r = await rawRequest(ui.port, {
    method: 'POST',
    path: '/favicon.ico',
    headers: { cookie: ui.cookie, origin: `http://127.0.0.1:${ui.port}` },
    body: 'x',
  });
  expect(r.status).toBe(404);
});

test('head answers with headers only', async () => {
  const r = await rawRequest(ui.port, {
    method: 'HEAD',
    path: '/assets/app-3f9a1c.js',
    headers: { cookie: ui.cookie },
  });
  expect([r.status, r.headers['content-length'], r.body.length]).toEqual([200, '15', 0]);
});

describe('without a build', () => {
  test('the placeholder answers app routes for an empty directory', async () => {
    const empty = join(base, 'empty');
    await mkdir(empty);
    const u = await start(empty);
    try {
      const r = await u.get('/b/acme');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toBe('text/html; charset=utf-8');
      expect(r.text()).toContain('backe ui');
    } finally {
      await u.close();
    }
  });

  test('the placeholder answers when the directory does not exist', async () => {
    const u = await start(join(base, 'missing'));
    try {
      const r = await u.get('/');
      expect([r.status, r.text()]).toEqual([200, expect.stringContaining('backe ui')]);
      expect((await u.get('/x.js')).status).toBe(404);
    } finally {
      await u.close();
    }
  });
});

test('a client gone before the file is sent does not leave the response pending', async () => {
  const done = new Promise<void>((resolve, reject) => {
    const server = createServer((req, res) => {
      // Die Verbindung ist weg, bevor `serveStatic` die Datei anfasst.
      req.socket.destroy();
      serveStatic(req, new URL('/assets/app-3f9a1c.js', 'http://127.0.0.1'), res, dist).then(
        () => server.close(() => resolve()),
        reject,
      );
    });
    server.listen(0, '127.0.0.1', () => {
      rawRequest((server.address() as AddressInfo).port, { path: '/' }).catch(() => undefined);
    });
  });
  await done;
});

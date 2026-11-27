import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { rawRequest, startUi, type UiHarness } from '../../test/helpers/ui.ts';
import { contentTypeOf, segmentsOf, serveStatic } from './static.ts';

/**
 * Eingriff beim nächsten `stat` auf `path` in `locate`: Die Datei verschwindet davor (`vanish`,
 * also zwischen `realpath` und `stat`), danach (`rm`, also zwischen `locate` und dem Öffnen) oder
 * schrumpft danach auf 1000 Bytes (`shrink`); `fail` lässt `stat` mit `EIO` scheitern.
 */
const onStat = vi.hoisted(() => ({
  path: undefined as string | undefined,
  action: 'rm' as 'vanish' | 'rm' | 'shrink' | 'fail',
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>();
  const stat = async (...args: Parameters<typeof fs.stat>) => {
    const [path] = args;
    const hit = path === onStat.path;
    if (hit) onStat.path = undefined;
    if (hit && onStat.action === 'vanish') await fs.rm(path);
    if (hit && onStat.action === 'fail') throw Object.assign(new Error('EIO'), { code: 'EIO' });
    const info = await fs.stat(...args);
    if (hit && onStat.action === 'rm') await fs.rm(path);
    if (hit && onStat.action === 'shrink') await fs.truncate(path, 1000);
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
afterEach(async () => {
  // Ein fehlgeschlagener Test darf den Eingriff nicht an den nächsten weiterreichen.
  onStat.path = undefined;
  await ui.close();
});

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
  Object.assign(onStat, { path: await realpath(path), action: 'rm' });
  const r = await ui.get('/gone.js');
  expect([r.status, r.text()]).toEqual([404, 'nicht gefunden']);
  expect(onStat.path).toBeUndefined();
});

test('a file that vanishes between realpath and stat is 404 like a missing one', async () => {
  const path = join(dist, 'flicker.js');
  await writeFile(path, 'console.log(3);');
  Object.assign(onStat, { path: await realpath(path), action: 'vanish' });
  const r = await ui.get('/flicker.js');
  expect([r.status, r.text()]).toEqual([404, 'nicht gefunden']);
  expect(onStat.path).toBeUndefined();
});

test('any other stat error is a 500, not a 404', async () => {
  const path = join(dist, 'broken.js');
  await writeFile(path, 'console.log(5);');
  Object.assign(onStat, { path: await realpath(path), action: 'fail' });
  const r = await ui.get('/broken.js');
  expect([r.status, r.json().error.code]).toEqual([500, 'unexpected']);
});

test('the content type follows the requested name, not the symlink target', async () => {
  await writeFile(join(dist, 'plain'), 'console.log(4);');
  await symlink('plain', join(dist, 'linked.js'));
  const r = await ui.get('/linked.js');
  expect([r.status, r.headers['content-type'], r.text()]).toEqual([
    200,
    'text/javascript; charset=utf-8',
    'console.log(4);',
  ]);
});

test('a file that shrinks before it is opened is sent with the length of the opened file', async () => {
  const path = join(dist, 'assets', 'shrink-1a2b.js');
  await writeFile(path, Buffer.alloc(300_000, 0x61));
  Object.assign(onStat, { path: await realpath(path), action: 'shrink' });
  const r = await ui.get('/assets/shrink-1a2b.js', { connection: 'keep-alive' });
  expect([r.status, r.headers['content-length'], r.body.length]).toEqual([200, '1000', 1000]);
});

test('an index.html that vanishes before it is opened leaves the placeholder', async () => {
  const own = join(base, 'vanishing');
  await mkdir(own);
  await writeFile(join(own, 'index.html'), INDEX);
  const u = await start(own);
  try {
    Object.assign(onStat, { path: await realpath(join(own, 'index.html')), action: 'rm' });
    const r = await u.get('/b/acme');
    expect([r.status, r.text()]).toEqual([200, expect.stringContaining('pnpm build')]);
    expect(onStat.path).toBeUndefined();
  } finally {
    await u.close();
  }
});

test('static paths never leave the root', async () => {
  for (const p of [
    // Kommt als `/secret.txt` an: `URL` löst `%2e%2e` schon beim Parsen auf, `segmentsOf` sieht
    // es nie; 404, weil `dist/secret.txt` nicht existiert. Die Segmentprüfung testet der Test unten.
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

test('segmentsOf rejects dot-dot, NUL, separators and broken encoding', () => {
  expect(segmentsOf('/a/./b//c%20d/')).toEqual(['a', 'b', 'c d']);
  expect(segmentsOf('/')).toEqual([]);
  for (const path of [
    '/..',
    '/a/../b',
    '/%2e%2e/secret.txt',
    '/%2E%2E',
    '/a/%00x',
    '/a%2Fb',
    '/a%5Cb',
    '/%E0%A4%A',
    '/%',
  ]) {
    expect(segmentsOf(path), path).toBeUndefined();
  }
});

test.each([
  ['index.html', 'text/html; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['chunk.MJS', 'text/javascript; charset=utf-8'],
  ['app.css', 'text/css; charset=utf-8'],
  ['app.js.map', 'application/json'],
  ['logo.svg', 'image/svg+xml'],
  ['a.png', 'image/png'],
  ['a.jpg', 'image/jpeg'],
  ['a.jpeg', 'image/jpeg'],
  ['a.gif', 'image/gif'],
  ['a.webp', 'image/webp'],
  ['a.avif', 'image/avif'],
  ['favicon.ico', 'image/x-icon'],
  ['f.woff', 'font/woff'],
  ['f.woff2', 'font/woff2'],
  ['m.wasm', 'application/wasm'],
  ['robots.txt', 'text/plain; charset=utf-8'],
  ['blob.bin', 'application/octet-stream'],
  ['noext', 'application/octet-stream'],
] as const)('contentTypeOf(%s)', (name, type) => {
  expect(contentTypeOf(name)).toBe(type);
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

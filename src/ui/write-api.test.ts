/**
 * Der Tool-Endpunkt von `backe ui` (ui.md §2.3.2) über echtes HTTP gegen einen Test-Backlog mit
 * Remote. Hintergrund-Syncs starten nie wirklich: `tools.sync.spawn` zeichnet nur auf.
 */
import { readdir, stat } from 'node:fs/promises';
import { request as httpRequest, ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import {
  revParse,
  setAttachmentsMaxBytes,
  type TestBacklog,
  testBacklog,
} from '../../test/helpers/git.ts';
import { fakeTimers } from '../../test/helpers/live.ts';
import { rawRequest, startUi, streamRequest, type UiHarness } from '../../test/helpers/ui.ts';
import { git } from '../git/exec.ts';
import { setLocale } from '../i18n/locale.ts';
import { attachmentTooLarge } from '../ops/comment-ops.ts';
import { scheduleSync } from '../services/background.ts';
import type { SpawnFn } from '../services/sync.ts';
import * as catalog from '../tools/catalog.ts';
import type { ToolDeps } from '../tools/run.ts';
import { TOOL_BODY_LIMIT } from './body.ts';
import type { StartInput } from './context.ts';
import { UiTools } from './tools.ts';
import { tooLarge } from './write-api.ts';

vi.mock('../services/background.ts', async (orig) => {
  const actual = await orig<typeof import('../services/background.ts')>();
  return { ...actual, scheduleSync: vi.fn(actual.scheduleSync) };
});
const schedule = vi.mocked(scheduleSync);

const WAIT = { timeout: 10_000 };

let b: TestBacklog;
let input: StartInput;
let ui: UiHarness | undefined;
let spawned: Parameters<SpawnFn>[0][];
/** `TMPDIR` des Tests: Hier legt der Server sein Upload-Verzeichnis `backe-ui-*` an. */
let sandbox: string;

beforeEach(async () => {
  b = await testBacklog({ remote: true });
  input = { cwd: await tempDir(), env: b.env, flags: { as: 'spw' } };
  spawned = [];
  sandbox = await tempDir();
  vi.stubEnv('TMPDIR', sandbox);
});
afterEach(async () => {
  await ui?.close();
  ui = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const syncDeps = (): ToolDeps => ({
  sync: {
    spawn: (args) => {
      spawned.push(args);
    },
  },
});

async function start(
  opts: { flags?: StartInput['flags']; tools?: ToolDeps } = {},
): Promise<UiHarness> {
  ui = await startUi({
    ...input,
    flags: opts.flags ?? input.flags,
    start: 'acme',
    tools: opts.tools ?? syncDeps(),
  });
  return ui;
}

const tool = (name: string) => `/api/b/acme/tools/${name}`;
const head = () => revParse(b.root, 'HEAD');
const count = async () =>
  Number((await git(['rev-list', '--count', 'HEAD'], { cwd: b.root })).stdout.trim());

async function create(u: UiHarness, title = 'Neu'): Promise<string> {
  const r = await u.post(tool('issue_create'), { title });
  expect(r.status).toBe(200);
  return r.json().id as string;
}

test('issue_create answers with the write json', async () => {
  const u = await start();
  const r = await u.post(tool('issue_create'), { title: 'Über HTTP' });
  expect(r.status).toBe(200);
  expect(r.headers['content-type']).toBe('application/json; charset=utf-8');
  const json = r.json();
  expect(Object.keys(json)).toEqual(expect.arrayContaining(['commit', 'op', 'id']));
  expect(json.commit).toBe(await head());
  expect(json.id).toMatch(/^bk-/);
  expect(json.op).toMatchObject({ op: 'issue.create', id: json.id, title: 'Über HTTP' });
});

test('a write arrives as a patch on the event stream', async () => {
  fakeTimers();
  const u = await start();
  const s = await u.events('/api/b/acme/events');
  try {
    await vi.waitFor(() => expect(s.events()).toHaveLength(2), WAIT);
    const id = await create(u, 'Live');
    const patch = () => s.events().find((e) => e.event === 'patch');
    await vi.waitFor(() => expect(patch()).toBeDefined(), WAIT);
    expect(patch()?.data).toMatchObject({
      upsert: { issues: [{ id, title: 'Live' }] },
    });
  } finally {
    s.close();
  }
});

test('issue_delete works without a gate', async () => {
  const u = await start();
  const id = await create(u);
  const r = await u.post(tool('issue_delete'), { id });
  expect([r.status, r.json().op.op]).toEqual([200, 'issue.delete']);
  expect((await u.get(`/api/b/acme/issues/${id}`)).status).toBe(404);
});

test('batch accepts issue.delete in the ui', async () => {
  const u = await start();
  const id = await create(u);
  const r = await u.post(tool('batch'), { ops: [{ op: 'issue.delete', id }] });
  expect(r.status).toBe(200);
  expect(r.json().commit).toBe(await head());
  expect((await u.get(`/api/b/acme/issues/${id}`)).status).toBe(404);
});

test('batch names backe ui for an unavailable op', async () => {
  setLocale('en');
  try {
    const u = await start();
    const before = await head();
    const r = await u.post(tool('batch'), {
      ops: [
        { op: 'issue.create', title: 'A' },
        { op: 'project.create', path: 'x' },
      ],
    });
    expect(r.status).toBe(400);
    expect(r.json().error).toEqual({
      code: 'validation',
      message: "line 2: 'project.create' is not available in backe ui",
      details: { line: 2 },
    });
    expect(await head()).toBe(before);
  } finally {
    setLocale('de');
  }
});

test('an admin tool runs over http', async () => {
  const u = await start();
  const r = await u.post(tool('project_create'), { path: 'web', title: 'Web' });
  expect(r.status).toBe(200);
  expect(r.json().commit).toBe(await head());
  const state = (await u.get('/api/b/acme/state')).json();
  expect(state.projects).toEqual(
    expect.arrayContaining([expect.objectContaining({ path: 'web', title: 'Web' })]),
  );
});

test('a tool result of undefined is null', async () => {
  const u = await start();
  vi.spyOn(catalog, 'invokeTool').mockResolvedValue(undefined);
  const r = await u.post(tool('issue_list'), {});
  expect(r.status).toBe(200);
  expect(r.text()).toBe('null');
});

test('an unknown tool is 404', async () => {
  const u = await start();
  const tools = vi.spyOn(UiTools.prototype, 'envFor');
  const r = await u.post(tool('nope'), { title: 'x' });
  expect([r.status, r.json().error.code]).toEqual([404, 'not_found']);
  expect(r.json().error.message).toContain('nope');
  // Ein unbekanntes Tool löst keinen Kontext auf.
  expect(tools).not.toHaveBeenCalled();
  // Ein Schlüssel des Objekt-Prototyps ist kein Tool: Der Katalog ist eine Map, kein Objekt-Lookup.
  expect((await u.post('/api/b/acme/tools/constructor', {})).status).toBe(404);
});

test('get on a tool path is 404', async () => {
  const u = await start();
  const r = await u.get(tool('issue_create'));
  expect([r.status, r.json().error.code]).toEqual([404, 'not_found']);
});

test('a schema violation is 400 with details', async () => {
  const u = await start();
  const id = await create(u);
  const r = await u.post(tool('issue_move'), { id });
  expect([r.status, r.json().error.code]).toEqual([400, 'usage']);
  expect(r.json().error.message).toContain('issue_move');
  expect(r.json().error.details.issues[0].path).toBe('to');
  const extra = await u.post(tool('issue_move'), { id, to: 'done', nope: 1 });
  expect(extra.status).toBe(400);
  expect(extra.json().error.details.issues[0].path).toBe('');
});

test('a body that is no json object is 400', async () => {
  const u = await start();
  const before = await head();
  const broken = await u.post(tool('issue_create'), '{"title":');
  expect([broken.status, broken.json().error.code]).toEqual([400, 'usage']);
  const list = await u.post(tool('issue_create'), [{ title: 'x' }]);
  expect([list.status, list.json().error.code]).toEqual([400, 'usage']);
  // Ein leerer Body ist `{}`; `issue_create` fehlt dann der Titel.
  const empty = await u.post(tool('issue_create'), '');
  expect([empty.status, empty.json().error.details.issues[0].path]).toEqual([400, 'title']);
  expect(await head()).toBe(before);
});

test('a simple cross-site post never writes', async () => {
  const u = await start();
  const before = await head();
  const body = '{"title":"CSRF"}';
  const cookie = u.cookie;
  const own = `http://127.0.0.1:${u.port}`;
  const foreign = await rawRequest(u.port, {
    method: 'POST',
    path: tool('issue_create'),
    headers: { cookie, origin: 'http://evil.example', 'content-type': 'text/plain' },
    body,
  });
  expect([foreign.status, foreign.json().error.code]).toEqual([403, 'forbidden']);
  const noOrigin = await rawRequest(u.port, {
    method: 'POST',
    path: tool('issue_create'),
    headers: { cookie, 'content-type': 'text/plain' },
    body,
  });
  expect([noOrigin.status, noOrigin.json().error.code]).toEqual([403, 'forbidden']);
  for (const type of [
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=x',
    undefined,
  ]) {
    const r = await rawRequest(u.port, {
      method: 'POST',
      path: tool('issue_create'),
      headers: { cookie, origin: own, ...(type === undefined ? {} : { 'content-type': type }) },
      body,
    });
    expect([r.status, r.json().error.code]).toEqual([403, 'forbidden']);
  }
  expect(await head()).toBe(before);
});

test('the content type ignores parameters and case', async () => {
  const u = await start();
  const r = await u.post(tool('issue_create'), '{"title":"Groß"}', {
    'content-type': 'Application/JSON; charset=utf-8',
  });
  expect(r.status).toBe(200);
  expect(r.json().commit).toBe(await head());
});

/** POST mit einem angekündigten, nie gesendeten Body über der Grenze. */
function hugePost(u: UiHarness, path: string, type: string) {
  return rawRequest(u.port, {
    method: 'POST',
    path,
    headers: {
      cookie: u.cookie,
      origin: `http://127.0.0.1:${u.port}`,
      'content-type': type,
      'content-length': String(TOOL_BODY_LIMIT + 1),
    },
  });
}

test('a body over the limit is 400 and closes the connection', async () => {
  const u = await start();
  // Der Server antwortet, bevor der Client den angekündigten Body geschickt hat.
  const r = await hugePost(u, tool('issue_create'), 'application/json');
  expect([r.status, r.json().error.code]).toEqual([400, 'validation']);
  expect(r.headers.connection).toBe('close');
});

test('a forbidden content type never reads the body or resolves a context', async () => {
  const u = await start();
  const tools = vi.spyOn(UiTools.prototype, 'envFor');
  const r = await u.post(tool('issue_create'), { title: 'x' }, { 'content-type': 'text/plain' });
  expect([r.status, r.json().error.code]).toEqual([403, 'forbidden']);
  // Gelesen hätte der Body über der Grenze ein 400 ergeben; die Verbindung endet ungelesen.
  const huge = await hugePost(u, tool('issue_create'), 'text/plain');
  expect([huge.status, huge.headers.connection]).toEqual([403, 'close']);
  expect(tools).not.toHaveBeenCalled();
});

test('an unknown tool is 404 before its body is read', async () => {
  const u = await start();
  const huge = await hugePost(u, tool('nope'), 'application/json');
  expect([huge.status, huge.json().error.code]).toEqual([404, 'not_found']);
});

test('a read-only identity cannot write', async () => {
  const u = await start({ flags: { as: 'reader' } });
  const before = await head();
  for (const name of ['issue_create', 'issue_list']) {
    const r = await u.post(tool(name), name === 'issue_create' ? { title: 'x' } : {});
    expect([r.status, r.json().error.code]).toEqual([400, 'usage']);
    expect(r.json().error.hint).toBeDefined();
  }
  expect((await u.get('/api/b/acme/state')).status).toBe(200);
  expect(await head()).toBe(before);
});

test('writes of one backlog run one after another', async () => {
  const u = await start();
  const before = await count();
  const results = await Promise.all(
    [1, 2, 3, 4, 5].map((i) => u.post(tool('issue_create'), { title: `Parallel ${i}` })),
  );
  expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
  expect(await count()).toBe(before + 5);
  const merges = (await git(['rev-list', '--merges', 'HEAD'], { cwd: b.root })).stdout.trim();
  expect(merges).toBe('');
  const last = (await git(['rev-list', '-5', 'HEAD'], { cwd: b.root })).stdout.trim().split('\n');
  expect(new Set(results.map((r) => r.json().commit as string))).toEqual(new Set(last));
});

test('a background sync follows a commit', async () => {
  const u = await start();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const actual = schedule.getMockImplementation();
  schedule.mockImplementationOnce(async (...args) => {
    await gate;
    return actual?.(...args) ?? false;
  });
  const r = await u.post(tool('issue_create'), { title: 'Mit Sync' });
  // Die Antwort ist da, obwohl der Start des Hintergrund-Syncs noch wartet.
  expect(r.status).toBe(200);
  expect(schedule).toHaveBeenLastCalledWith(expect.anything(), 'write', expect.anything());
  expect(spawned).toEqual([]);
  release();
  await u.close();
  expect(spawned).toHaveLength(1);
});

test('close waits for queued writes and their background sync', async () => {
  let entered = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const u = await start({
    tools: {
      ...syncDeps(),
      write: {
        hooks: {
          beforeLock: async () => {
            entered += 1;
            await gate;
          },
        },
      },
    },
  });
  const before = await count();
  const envFor = vi.spyOn(UiTools.prototype, 'envFor');
  const posts = [1, 2, 3].map((i) => u.post(tool('issue_create'), { title: `Ende ${i}` }));
  await vi.waitFor(() => {
    expect(envFor).toHaveBeenCalledTimes(3);
    expect(entered).toBe(1);
  }, WAIT);
  let closed = false;
  const closing = u.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  release();
  await closing;
  expect((await Promise.all(posts)).map((r) => r.status)).toEqual([200, 200, 200]);
  expect(await count()).toBe(before + 3);
  expect(spawned).toHaveLength(3);
});

test('errors map exit codes to status', async () => {
  const u = await start();
  const missing = await u.post(tool('issue_move'), { id: 'bk-zzzzzz', to: 'done' });
  expect([missing.status, missing.json().error.code]).toEqual([404, 'not_found']);
  const id = await create(u);
  const add = { id, name: 'notiz', text: 'eins' };
  expect((await u.post(tool('attachment_add'), add)).status).toBe(200);
  const again = await u.post(tool('attachment_add'), add);
  expect([again.status, again.json().error.code]).toEqual([409, 'conflict']);
});

test('a write to an unknown backlog is 404', async () => {
  const u = await start();
  const r = await u.post('/api/b/ghost/tools/issue_create', { title: 'x' });
  expect([r.status, r.json().error.code]).toEqual([404, 'not_found']);
});

const attachment = (id: string, name: string) => `/api/b/acme/issues/${id}/attachments/${name}`;

/** Die Upload-Verzeichnisse `backe-ui-*` im Sandbox-`TMPDIR`. */
async function uploadDirs(): Promise<string[]> {
  return (await readdir(sandbox))
    .filter((n) => n.startsWith('backe-ui-'))
    .map((n) => join(sandbox, n));
}

/** Alle Temp-Dateien in den Upload-Verzeichnissen. */
async function uploadFiles(): Promise<string[]> {
  const dirs = await uploadDirs();
  return (
    await Promise.all(dirs.map(async (d) => (await readdir(d)).map((n) => join(d, n))))
  ).flat();
}

/** Chunked PUT ohne `Content-Length` mit eigenem `Origin` und `application/octet-stream`. */
function chunkedPut(u: UiHarness, path: string, chunks: Uint8Array[], end = true) {
  return streamRequest(u.port, {
    method: 'PUT',
    path,
    headers: {
      cookie: u.cookie,
      origin: `http://127.0.0.1:${u.port}`,
      'content-type': 'application/octet-stream',
    },
    chunks,
    end,
  });
}

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0xff, 0x00, 0x0a, 0x0d,
]);

test('an upload becomes an attachment', async () => {
  const u = await start();
  const id = await create(u);
  const r = await u.put(attachment(id, 'bild.png'), PNG);
  expect(r.status).toBe(200);
  const json = r.json();
  expect(json.commit).toBe(await head());
  expect(json.op).toMatchObject({ op: 'attach.add', id, name: 'bild.png', file: 'bild.png' });
  // Dieselbe Form wie das Tool `attachment_add`.
  const viaTool = await u.post(tool('attachment_add'), { id, name: 'notiz.txt', text: 'x' });
  expect(Object.keys(json)).toEqual(Object.keys(viaTool.json()));
  expect(Object.keys(json.op)).toEqual(Object.keys(viaTool.json().op));
  const got = await u.get(attachment(id, 'bild.png'));
  expect(got.status).toBe(200);
  expect([...got.body]).toEqual([...PNG]);
  // Ohne Punkt im Namen bleibt der Dateiname der Name; die Temp-Datei hat keine Endung.
  const plain = await u.put(attachment(id, 'rohdaten'), PNG);
  expect([plain.status, plain.json().op.file]).toEqual([200, 'rohdaten']);
});

test('an upload over max_bytes is cut off while streaming', async () => {
  await setAttachmentsMaxBytes(b, 1024);
  const u = await start();
  const id = await create(u);
  const before = await count();
  const chunk = new Uint8Array(1024).fill(7);
  const r = await chunkedPut(u, attachment(id, 'gross.bin'), [chunk, chunk, chunk, chunk], false);
  expect([r.status, r.json().error.code]).toEqual([400, 'validation']);
  expect(r.headers.connection).toBe('close');
  const expected = attachmentTooLarge('gross.bin', 2048, { max_bytes: 1024, lfs: false });
  expect(r.json().error.message).toMatch(/^Anhang »gross\.bin« hat \d+ Bytes, erlaubt sind 1024$/);
  expect(r.json().error.hint).toBe(expected?.hint);
  expect(await count()).toBe(before);
  await vi.waitFor(async () => expect(await uploadFiles()).toEqual([]), WAIT);
});

test('a content-length over max_bytes is refused before reading', async () => {
  await setAttachmentsMaxBytes(b, 1024);
  const u = await start();
  const id = await create(u);
  const before = await count();
  // Angekündigt, nie gesendet: Die Antwort kommt, ohne dass der Server auf den Body wartet.
  const r = await rawRequest(u.port, {
    method: 'PUT',
    path: attachment(id, 'gross.bin'),
    headers: {
      cookie: u.cookie,
      origin: `http://127.0.0.1:${u.port}`,
      'content-type': 'application/octet-stream',
      'content-length': '4096',
    },
  });
  const expected = attachmentTooLarge('gross.bin', 4096, { max_bytes: 1024, lfs: false });
  expect(r.status).toBe(400);
  expect(r.json().error).toMatchObject({ code: 'validation', message: expected?.message });
  expect(r.headers.connection).toBe('close');
  expect(await count()).toBe(before);
  expect(await uploadFiles()).toEqual([]);
});

test('an upload with another content type writes nothing', async () => {
  const u = await start();
  const id = await create(u);
  const before = await count();
  const tools = vi.spyOn(UiTools.prototype, 'envFor');
  const r = await u.put(attachment(id, 'a.txt'), 'hallo', {
    'content-type': 'multipart/form-data; boundary=x',
  });
  expect([r.status, r.json().error.code]).toEqual([403, 'forbidden']);
  expect(tools).not.toHaveBeenCalled();
  expect(await count()).toBe(before);
  expect(await uploadDirs()).toEqual([]);
});

test('an invalid attachment name writes nothing', async () => {
  const u = await start();
  const id = await create(u);
  const before = await count();
  const tools = vi.spyOn(UiTools.prototype, 'envFor');
  for (const name of ['..%2Fx', 'a%20b', '.hidden', 'Gross.txt']) {
    const r = await u.put(attachment(id, name), 'hallo');
    expect([r.status, r.json().error.code]).toEqual([400, 'validation']);
    expect(r.json().error.message).toBe(
      `Ungültiger Dateiname für den Anhang: »${decodeURIComponent(name)}«`,
    );
    expect(r.json().error.hint).toContain('[a-z0-9][a-z0-9._-]{0,63}');
  }
  // Geprüft vor dem Kontext und vor dem ersten Byte: Es entsteht nicht einmal das Verzeichnis.
  expect(tools).not.toHaveBeenCalled();
  expect(await uploadDirs()).toEqual([]);
  expect(await count()).toBe(before);
});

test('the temp file is gone after success and failure', async () => {
  const u = await start();
  const id = await create(u);
  expect((await u.put(attachment(id, 'a.txt'), 'eins')).status).toBe(200);
  // Der Service scheitert: Den Namen gibt es schon.
  const again = await u.put(attachment(id, 'a.txt'), 'zwei');
  expect([again.status, again.json().error.code]).toEqual([409, 'conflict']);
  // Das Issue fehlt.
  const missing = await u.put(attachment('bk-zzzzzz', 'b.txt'), 'drei');
  expect([missing.status, missing.json().error.code]).toEqual([404, 'not_found']);
  const [dir] = await uploadDirs();
  expect(dir).toBeDefined();
  expect(await uploadFiles()).toEqual([]);
});

test('the temp file is gone after the client goes away', async () => {
  const u = await start();
  const id = await create(u);
  const before = await count();
  const r = httpRequest({
    host: '127.0.0.1',
    port: u.port,
    method: 'PUT',
    path: attachment(id, 'halb.bin'),
    headers: {
      host: `127.0.0.1:${u.port}`,
      cookie: u.cookie,
      origin: `http://127.0.0.1:${u.port}`,
      'content-type': 'application/octet-stream',
    },
    agent: false,
  });
  r.on('error', () => {});
  r.write(new Uint8Array(100));
  await vi.waitFor(async () => expect(await uploadFiles()).toHaveLength(1), WAIT);
  r.destroy();
  await vi.waitFor(async () => expect(await uploadFiles()).toEqual([]), WAIT);
  expect(await count()).toBe(before);
});

test('a reader cannot upload', async () => {
  const u = await start({ flags: { as: 'reader' } });
  const before = await head();
  const r = await u.put(attachment('bk-zzzzzz', 'a.txt'), 'x');
  expect([r.status, r.json().error.code]).toEqual([400, 'usage']);
  expect(await head()).toBe(before);
  expect(await uploadDirs()).toEqual([]);
});

test('uploads share the queue with tools', async () => {
  let entered = 0;
  let hold: Promise<void> | undefined;
  const u = await start({
    tools: {
      ...syncDeps(),
      write: {
        hooks: {
          beforeLock: async () => {
            entered += 1;
            await hold;
          },
        },
      },
    },
  });
  const id = await create(u);
  const before = await count();
  let release!: () => void;
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  entered = 0;
  const upload = u.put(attachment(id, 'a.txt'), 'hallo');
  const update = u.post(tool('issue_update'), { id, title: 'Parallel' });
  try {
    // Beide sind angekommen (die Temp-Datei des Uploads liegt bereit), aber nur einer steht im
    // Lock-Hook: Der andere wartet in derselben Warteschlange.
    await vi.waitFor(async () => {
      expect(entered).toBe(1);
      expect(await uploadFiles()).toHaveLength(1);
    }, WAIT);
    for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(entered).toBe(1);
  } finally {
    release();
  }
  const [r1, r2] = await Promise.all([upload, update]);
  expect([r1.status, r2.status]).toEqual([200, 200]);
  expect(entered).toBe(2);
  expect(await count()).toBe(before + 2);
  const merges = (await git(['rev-list', '--merges', 'HEAD'], { cwd: b.root })).stdout.trim();
  expect(merges).toBe('');
});

test('close waits for an upload that is still reading its body', async () => {
  const u = await start();
  const id = await create(u);
  const before = await count();
  const socket = connect(u.port, '127.0.0.1');
  const received: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => received.push(chunk));
  const ended = new Promise<void>((resolve) => socket.on('close', () => resolve()));
  const chunk = (bytes: string) => `${bytes.length.toString(16)}\r\n${bytes}\r\n`;
  socket.write(
    [
      `PUT ${attachment(id, 'spaet.txt')} HTTP/1.1`,
      `Host: 127.0.0.1:${u.port}`,
      `Cookie: ${u.cookie}`,
      `Origin: http://127.0.0.1:${u.port}`,
      'Content-Type: application/octet-stream',
      'Transfer-Encoding: chunked',
      '',
      chunk('erste '),
    ].join('\r\n'),
  );
  // Das Temp-Verzeichnis steht, sobald der Handler den Upload angenommen hat.
  await vi.waitFor(async () => expect(await uploadDirs()).toHaveLength(1), WAIT);
  let closed = false;
  const closing = u.close().then(() => {
    closed = true;
  });
  ui = undefined;
  await new Promise((resolve) => setImmediate(resolve));
  expect(closed).toBe(false);
  socket.write(`${chunk('Rest')}0\r\n\r\n`);
  await closing;
  await ended;
  const raw = Buffer.concat(received).toString('utf8');
  expect(raw).toMatch(/^HTTP\/1\.1 200 /);
  expect(await count()).toBe(before + 1);
  expect(await uploadDirs()).toEqual([]);
});

test('an oversize upload without a disagreeing size check still throws', () => {
  // `attachmentTooLarge` kennt keine Grenze (null), `receiveUpload` hat trotzdem abgebrochen.
  const err = tooLarge('x.bin', 10, null, false).error;
  expect(err.code).toBe('validation');
  expect(err.message).toBe('Anhang »x.bin« ist größer als die erlaubten konfigurierten Bytes');
});

test('close removes the upload temp dir', async () => {
  const u = await start();
  const id = await create(u);
  expect((await u.put(attachment(id, 'a.txt'), 'hallo')).status).toBe(200);
  const [dir] = await uploadDirs();
  expect(dir).toBeDefined();
  await u.close();
  ui = undefined;
  expect(await uploadDirs()).toEqual([]);
  await expect(stat(dir as string)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('a chunked json body over the limit is 400 and closes the connection', async () => {
  const u = await start();
  const before = await count();
  const mib = new Uint8Array(1024 * 1024).fill(0x20);
  const chunks = [
    ...Array.from({ length: TOOL_BODY_LIMIT / mib.length }, () => mib),
    new Uint8Array([0x20]),
  ];
  // Der Body bleibt offen: Der Server hat dann alles Gesendete gelesen, wenn er antwortet.
  const r = await streamRequest(u.port, {
    method: 'POST',
    path: tool('issue_create'),
    headers: {
      cookie: u.cookie,
      origin: `http://127.0.0.1:${u.port}`,
      'content-type': 'application/json',
    },
    chunks,
    end: false,
  });
  expect([r.status, r.json().error.code]).toEqual([400, 'validation']);
  expect(r.headers.connection).toBe('close');
  expect(await count()).toBe(before);
});

/** Eine Anfrage als rohe Bytes für eine eigene Keep-Alive-Verbindung. */
function rawPost(u: UiHarness, path: string, body: string): string {
  return [
    `POST ${path} HTTP/1.1`,
    `Host: 127.0.0.1:${u.port}`,
    `Cookie: ${u.cookie}`,
    `Origin: http://127.0.0.1:${u.port}`,
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(body)}`,
    '',
    body,
  ].join('\r\n');
}

test('a request on a kept-alive connection after close started neither writes nor hangs', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered = 0;
  const u = await start({
    tools: {
      ...syncDeps(),
      write: {
        hooks: {
          beforeLock: async () => {
            entered += 1;
            await gate;
          },
        },
      },
    },
  });
  const before = await count();
  const socket = connect(u.port, '127.0.0.1');
  const received: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => received.push(chunk));
  const ended = new Promise<void>((resolve) => socket.on('close', () => resolve()));
  socket.write(rawPost(u, tool('issue_create'), '{"title":"Vorher"}'));
  await vi.waitFor(() => expect(entered).toBe(1), WAIT);
  const writeHead = vi.spyOn(ServerResponse.prototype, 'writeHead');
  const closing = u.close();
  ui = undefined;
  // Dieselbe Verbindung, nach dem Beginn des Endes: Die Antwort steht fest, bevor der erste
  // Write fertig ist.
  socket.write(rawPost(u, tool('issue_create'), '{"title":"Danach"}'));
  try {
    await vi.waitFor(() => expect(writeHead).toHaveBeenCalledWith(503, expect.anything()), WAIT);
  } finally {
    release();
  }
  await closing;
  await ended;
  const raw = Buffer.concat(received).toString('utf8');
  expect([...raw.matchAll(/HTTP\/1\.1 (\d{3})/g)].map((s) => s[1])).toEqual(['200', '503']);
  expect(raw).toContain('{"error":{"code":"unavailable","message":"backe ui wird beendet"}}');
  expect(raw).toMatch(/Connection: close/i);
  expect(entered).toBe(1);
  expect(await count()).toBe(before + 1);
});

const DEV_ORIGIN = 'http://127.0.0.1:5173';

test('dev origin may write when configured', async () => {
  ui = await startUi({
    ...input,
    env: { ...input.env, BACKE_UI_DEV_ORIGIN: DEV_ORIGIN },
    start: 'acme',
    tools: syncDeps(),
  });
  const r = await ui.post(tool('issue_list'), {}, { origin: DEV_ORIGIN });
  expect(r.status).toBe(200);
});

test('dev origin is foreign without the env', async () => {
  const u = await start();
  const r = await u.post(tool('issue_list'), {}, { origin: DEV_ORIGIN });
  expect([r.status, r.json().error.code]).toEqual([403, 'forbidden']);
});

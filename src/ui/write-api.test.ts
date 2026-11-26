/**
 * Der Tool-Endpunkt von `backe ui` (ui.md §2.3.2) über echtes HTTP gegen einen Test-Backlog mit
 * Remote. Hintergrund-Syncs starten nie wirklich: `tools.sync.spawn` zeichnet nur auf.
 */
import { tempDir } from '../../test/helpers/backlog.ts';
import { revParse, type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import { fakeTimers } from '../../test/helpers/live.ts';
import { rawRequest, startUi, type UiHarness } from '../../test/helpers/ui.ts';
import { git } from '../git/exec.ts';
import { setLocale } from '../i18n/locale.ts';
import { scheduleSync } from '../services/background.ts';
import type { SpawnFn } from '../services/sync.ts';
import * as catalog from '../tools/catalog.ts';
import type { ToolDeps } from '../tools/run.ts';
import { TOOL_BODY_LIMIT } from './body.ts';
import type { StartInput } from './context.ts';
import { UiTools } from './tools.ts';

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

beforeEach(async () => {
  b = await testBacklog({ remote: true });
  input = { cwd: await tempDir(), env: b.env, flags: { as: 'spw' } };
  spawned = [];
});
afterEach(async () => {
  await ui?.close();
  ui = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
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
  // Ein MCP-Tool, das die UI nicht anbietet, ist ebenso unbekannt wie ein erfundenes.
  expect((await u.post('/api/b/acme/tools/constructor', {})).status).toBe(404);
});

test('get on a tool path is 404', async () => {
  const u = await start();
  const r = await u.get(tool('issue_create'));
  expect([r.status, r.json().error.code]).toEqual([404, 'not_found']);
});

test('an upload is not served yet', async () => {
  const u = await start();
  const id = await create(u);
  const r = await u.put(`/api/b/acme/issues/${id}/attachments/a.txt`, 'hallo');
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

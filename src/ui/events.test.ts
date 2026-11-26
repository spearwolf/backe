import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tempDir } from '../../test/helpers/backlog.ts';
import { writeOp } from '../../test/helpers/context.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import { fakeTimers } from '../../test/helpers/live.ts';
import { rawRequest, startUi, type UiHarness } from '../../test/helpers/ui.ts';
import { registerBacklog } from '../context/registry.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { serveEvents, sseFrame } from './events.ts';
import { LIVE_TIMING, LiveBacklog } from './live.ts';
import { CSP } from './security.ts';

const WAIT = { timeout: 10_000 };

let b: TestBacklog;
let ctx: ResolvedContext;
let ui: UiHarness;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
  fakeTimers();
  ui = await startUi({ cwd: await tempDir(), env: b.env, flags: { as: 'spw' }, start: 'acme' });
});
afterEach(async () => {
  await ui.close();
  vi.useRealTimers();
});

const create = (title: string) => writeOp(ctx, { op: 'issue.create', title, state: 'todo' });
const EVENTS = '/api/b/acme/events';

test('sseFrame writes id, event and one line of data', () => {
  expect(sseFrame({ event: 'hello', data: { rev: 2, head: 'abc' } }, '0123abcd:2')).toBe(
    'id: 0123abcd:2\nevent: hello\ndata: {"rev":2,"head":"abc"}\n\n',
  );
});

test('events stream hello first', async () => {
  const s = await ui.events(EVENTS);
  try {
    expect(s.status).toBe(200);
    expect(s.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(s.headers['cache-control']).toBe('no-store');
    expect(s.headers['content-security-policy']).toBe(CSP);
    await vi.waitFor(() => expect(s.events().map((f) => f.event)).toEqual(['hello', 'sync']), WAIT);
    const [hello] = s.events();
    expect(hello?.id).toMatch(/^[0-9a-f]{8}:0$/);
    expect(hello?.data).toEqual({ rev: 0, head: (await ui.get('/api/b/acme/state')).json().head });
  } finally {
    s.close();
  }
});

test('a write arrives as a patch event with id boot:rev', async () => {
  const s = await ui.events(EVENTS);
  try {
    await vi.waitFor(() => expect(s.events()).toHaveLength(2), WAIT);
    const boot = s.events()[0]?.id?.split(':')[0];
    const id = await create('Live');
    await vi.waitFor(() => expect(s.events().at(-1)?.event).toBe('patch'), WAIT);
    const patch = s.events().at(-1);
    expect(patch?.id).toBe(`${boot}:1`);
    expect(patch?.data).toMatchObject({ rev: 1, upsert: { issues: [{ id, title: 'Live' }] } });
    expect((await ui.get('/api/b/acme/state')).json().rev).toBe(1);
  } finally {
    s.close();
  }
});

test('reconnect with last-event-id replays missed patches, a foreign one gets reset', async () => {
  const first = await ui.events(EVENTS);
  await vi.waitFor(() => expect(first.events()).toHaveLength(2), WAIT);
  const boot = first.events()[0]?.id?.split(':')[0] as string;
  first.close();
  await create('Eins');
  await create('Zwei');
  await vi.waitFor(
    async () => expect((await ui.get('/api/b/acme/state')).json().rev).toBe(2),
    WAIT,
  );
  const again = await ui.events(EVENTS, { 'last-event-id': `${boot}:0` });
  const other = boot === 'ffffffff' ? '00000000' : 'ffffffff';
  const foreign = await ui.events(EVENTS, { 'last-event-id': `${other}:2` });
  try {
    await vi.waitFor(() => expect(again.events()).toHaveLength(4), WAIT);
    expect(again.events().map((f) => [f.event, f.id])).toEqual([
      ['hello', `${boot}:2`],
      ['patch', `${boot}:1`],
      ['patch', `${boot}:2`],
      ['sync', `${boot}:2`],
    ]);
    await vi.waitFor(() => expect(foreign.events()).toHaveLength(3), WAIT);
    expect(foreign.events().map((f) => f.event)).toEqual(['hello', 'reset', 'sync']);
  } finally {
    again.close();
    foreign.close();
  }
});

test('heartbeat every 15 s', async () => {
  const s = await ui.events(EVENTS);
  try {
    await vi.waitFor(() => expect(s.events()).toHaveLength(2), WAIT);
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.heartbeatMs);
    await vi.waitFor(() => expect(s.frames.at(-1)).toEqual({ comment: 'ping' }), WAIT);
  } finally {
    s.close();
  }
});

test('head gets only the headers and starts no watcher', async () => {
  const timers = vi.getTimerCount();
  const head = await rawRequest(ui.port, {
    method: 'HEAD',
    path: EVENTS,
    headers: { cookie: ui.cookie },
  });
  expect([head.status, head.headers['content-type'], head.body.length]).toEqual([
    200,
    'text/event-stream; charset=utf-8',
    0,
  ]);
  expect(vi.getTimerCount()).toBe(timers);
  const other = await rawRequest(ui.port, {
    method: 'HEAD',
    path: '/api/b/nope/events',
    headers: { cookie: ui.cookie },
  });
  expect(other.status).toBe(404);
});

test('a client gone before the watcher stands is no subscriber', async () => {
  const live = await LiveBacklog.start(ctx, { boot: '0123abcd', rev: 0 });
  let served!: () => void;
  const done = new Promise<void>((resolve) => {
    served = resolve;
  });
  let arrived!: () => void;
  const got = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  // Der Handler kommt erst nach dem Abbruch des Clients zu `serveEvents`, wie nach einem langen Start.
  const server = createServer((_req, res) => {
    res.once('close', () => {
      serveEvents(res, live);
      served();
    });
    arrived();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    const req = request({ host: '127.0.0.1', port, path: '/', agent: false });
    req.on('error', () => {});
    req.end();
    await got;
    req.destroy();
    await done;
    expect(live.subscribers()).toBe(0);
  } finally {
    await live.stop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('close ends open event streams', async () => {
  const s = await ui.events(EVENTS);
  await vi.waitFor(() => expect(s.events()).toHaveLength(2), WAIT);
  await ui.close();
  await s.ended;
});

test('events of a backlog without working copy are 404', async () => {
  await registerBacklog(b.homes, { name: 'other', remote: '/nowhere/remote.git' });
  const res = await ui.get('/api/b/other/events');
  expect([res.status, res.json().error.code]).toEqual([404, 'not_found']);
});

test('events need the session cookie', async () => {
  const res = await rawRequest(ui.port, { path: EVENTS });
  expect([res.status, res.json().error.code]).toEqual([401, 'unauthorized']);
});

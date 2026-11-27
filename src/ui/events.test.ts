import { EventEmitter } from 'node:events';
import { createServer, request, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tempDir } from '../../test/helpers/backlog.ts';
import { writeOp } from '../../test/helpers/context.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import { fakeTimers } from '../../test/helpers/live.ts';
import { rawRequest, type SseFrame, startUi, type UiHarness } from '../../test/helpers/ui.ts';
import { type FakeWatcher, fakeWatcher } from '../../test/helpers/watch.ts';
import { registerBacklog } from '../context/registry.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { serveEvents, sseFrame } from './events.ts';
import { LIVE_TIMING, LiveBacklog } from './live.ts';
import { CSP } from './security.ts';

let b: TestBacklog;
let ctx: ResolvedContext;
let ui: UiHarness;
/** Quelle der Datei-Ereignisse des Servers: Der Test meldet einen Write selbst per `flush`. */
let fw: FakeWatcher;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
  fw = fakeWatcher();
  fakeTimers();
  ui = await startUi({
    cwd: await tempDir(),
    env: b.env,
    flags: { as: 'spw' },
    start: 'acme',
    live: { watch: fw.watch },
  });
});
afterEach(async () => {
  await ui.close();
  vi.useRealTimers();
});

const create = (title: string) => writeOp(ctx, { op: 'issue.create', title, state: 'todo' });
const EVENTS = '/api/b/acme/events';

/** Mindestens `n` Ereignisse (ohne Kommentare) sind da. */
const events = (n: number) => (frames: SseFrame[]) =>
  frames.filter((f) => f.comment === undefined).length >= n;
/** Mindestens `n` Patches sind da. */
const patches = (n: number) => (frames: SseFrame[]) =>
  frames.filter((f) => f.event === 'patch').length >= n;

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
    await s.until(events(2));
    expect(s.events().map((f) => f.event)).toEqual(['hello', 'sync']);
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
    await s.until(events(2));
    const boot = s.events()[0]?.id?.split(':')[0];
    const id = await create('Live');
    fw.flush();
    await s.until(patches(1));
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
  // Ein zweiter Abonnent bleibt verbunden und zeigt, wann die Patches heraus sind.
  const observer = await ui.events(EVENTS);
  await first.until(events(2));
  const boot = first.events()[0]?.id?.split(':')[0] as string;
  first.close();
  await create('Eins');
  fw.flush();
  await observer.until(patches(1));
  await create('Zwei');
  fw.flush();
  await observer.until(patches(2));
  observer.close();
  expect((await ui.get('/api/b/acme/state')).json().rev).toBe(2);
  const again = await ui.events(EVENTS, { 'last-event-id': `${boot}:0` });
  const other = boot === 'ffffffff' ? '00000000' : 'ffffffff';
  const foreign = await ui.events(EVENTS, { 'last-event-id': `${other}:2` });
  try {
    await again.until(events(4));
    expect(again.events().map((f) => [f.event, f.id])).toEqual([
      ['hello', `${boot}:2`],
      ['patch', `${boot}:1`],
      ['patch', `${boot}:2`],
      ['sync', `${boot}:2`],
    ]);
    await foreign.until(events(3));
    expect(foreign.events().map((f) => f.event)).toEqual(['hello', 'reset', 'sync']);
  } finally {
    again.close();
    foreign.close();
  }
});

test('heartbeat every 15 s', async () => {
  const s = await ui.events(EVENTS);
  try {
    await s.until(events(2));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.heartbeatMs);
    await s.until((frames) => frames.length > 2);
    expect(s.frames.at(-1)).toEqual({ comment: 'ping' });
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
  const live = await LiveBacklog.start(ctx, {
    boot: '0123abcd',
    rev: 0,
    deps: { watch: fw.watch },
  });
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
  await s.until(events(2));
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

/** Antwort ohne Socket: `write` meldet einen vollen Puffer, solange `full` gilt. */
class SlowResponse extends EventEmitter {
  destroyed = false;
  full = false;
  frames: string[] = [];
  req = { socket: { destroyed: false }, headers: {}, method: 'GET' };
  writeHead() {
    return this;
  }
  write(text: string): boolean {
    this.frames.push(text);
    return !this.full;
  }
}

test('a client that does not read gets reset instead of a growing buffer', async () => {
  const live = await LiveBacklog.start(ctx, {
    boot: '0123abcd',
    rev: 0,
    deps: { watch: fw.watch },
  });
  const res = new SlowResponse();
  try {
    serveEvents(res as unknown as ServerResponse, live);
    const kinds = () => res.frames.map((f) => (f.startsWith(':') ? 'ping' : f.split('\n')[1]));
    expect(kinds()).toEqual(['event: hello', 'event: sync']);
    // Ein Heartbeat in den vollen Puffer staut; der nächste fällt weg und verlangt kein reset.
    res.full = true;
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.heartbeatMs * 2);
    expect(kinds()).toEqual(['event: hello', 'event: sync', 'ping']);
    res.full = false;
    res.emit('drain');
    expect(kinds()).toHaveLength(3);
    // Ein Patch staut, der nächste wird übersprungen; nach drain kommt reset mit dem neuesten Stand.
    res.full = true;
    await create('Eins');
    fw.flush();
    await live.idle();
    expect(live.rev).toBe(1);
    await create('Zwei');
    fw.flush();
    await live.idle();
    expect(live.rev).toBe(2);
    expect(kinds()).toEqual(['event: hello', 'event: sync', 'ping', 'event: patch']);
    res.full = false;
    res.emit('drain');
    expect(res.frames.at(-1)).toBe('id: 0123abcd:2\nevent: reset\ndata: {}\n\n');
    res.emit('close');
    expect(live.subscribers()).toBe(0);
  } finally {
    await live.stop();
  }
});

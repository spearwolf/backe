import { ClientRequest, createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { streamRequest } from './ui.ts';

const MB = 1024 * 1024;

type Seen = { request: IncomingMessage; response: ServerResponse };

/** Ein Server auf einem freien Port; `handle` bekommt jeden Request. */
async function serve(handle: (seen: Seen) => void) {
  const server = createServer((request, response) => {
    // Ein abgebrochener Upload beim Aufräumen ist kein Fehler des Tests.
    request.on('error', () => {});
    handle({ request, response });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Die Requests des Helfers und die höchste Zahl ihrer `drain`- und `close`-Listener. */
function watchRequests() {
  const requests: ClientRequest[] = [];
  const most = { drain: 0, close: 0 };
  const on = ClientRequest.prototype.on;
  const spy = vi.spyOn(ClientRequest.prototype, 'on').mockImplementation(function (
    this: ClientRequest,
    event,
    listener,
  ) {
    if (!requests.includes(this)) requests.push(this);
    const out = on.call(this, event, listener);
    most.drain = Math.max(most.drain, this.listenerCount('drain'));
    most.close = Math.max(most.close, this.listenerCount('close'));
    return out;
  });
  return { requests, most, restore: () => spy.mockRestore() };
}

function* chunks(n: number, size: number, pulled = { n: 0 }): Generator<Uint8Array> {
  for (let i = 0; i < n; i++) {
    pulled.n += 1;
    yield new Uint8Array(size);
  }
}

let cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanup.reverse()) await c();
  cleanup = [];
});

test('streaming under back-pressure keeps one wake listener and no leak warning', async () => {
  const s = await serve(({ request, response }) => {
    let got = 0;
    request.on('data', (c: Buffer) => {
      got += c.length;
    });
    request.on('end', () => response.end(String(got)));
  });
  cleanup.push(s.close);
  const watched = watchRequests();
  cleanup.push(watched.restore);
  const warnings: Error[] = [];
  const warn = (w: Error) => warnings.push(w);
  process.on('warning', warn);
  cleanup.push(() => {
    process.off('warning', warn);
  });

  const res = await streamRequest(s.port, {
    method: 'POST',
    path: '/',
    chunks: chunks(64, MB / 4),
  });

  expect(res.status).toBe(200);
  expect(res.text()).toBe(String(16 * MB));
  // Jeder Chunk ist größer als die Hochwassermarke: Gewartet wurde viele Male, gestapelt nie.
  expect(watched.most).toEqual({ drain: 1, close: 1 });
  // `MaxListenersExceededWarning` käme erst nach dem aktuellen Tick.
  await new Promise((resolve) => setImmediate(resolve));
  expect(warnings.filter((w) => w.name === 'MaxListenersExceededWarning')).toEqual([]);
});

test('an early answer wakes a writer that waits for drain', async () => {
  let seen: Seen | undefined;
  // Der Server liest den Body nie: Der Schreiber bleibt im Gegendruck hängen.
  const s = await serve((x) => {
    seen = x;
  });
  cleanup.push(s.close);
  const watched = watchRequests();
  cleanup.push(watched.restore);
  const pulled = { n: 0 };

  const answer = streamRequest(s.port, {
    method: 'POST',
    path: '/',
    chunks: chunks(256, MB, pulled),
  });
  // Hängt, sobald zwei Blicke denselben Stand sehen und ein `drain`-Listener wartet.
  let last = -1;
  await vi.waitFor(
    () => {
      const now = pulled.n;
      const still = now === last;
      last = now;
      expect(seen).toBeDefined();
      expect(still && watched.requests[0]?.listenerCount('drain') === 1).toBe(true);
    },
    { timeout: 10_000, interval: 50 },
  );

  // Kopf und erstes Stück der Antwort, die Verbindung bleibt offen: Nur die Antwort weckt ihn.
  seen?.response.writeHead(413);
  seen?.response.write('zu groß');
  await vi.waitFor(() => expect(watched.requests[0]?.listenerCount('drain')).toBe(0));
  const stopped = pulled.n;

  seen?.response.end();
  const res = await answer;
  expect(res.status).toBe(413);
  expect(res.text()).toBe('zu groß');
  expect(pulled.n).toBe(stopped);
});

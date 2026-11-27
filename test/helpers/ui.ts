import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from 'node:http';
import { cookieName } from '../../src/ui/security.ts';
import { createUiServer, type UiOptions } from '../../src/ui/server.ts';

export type Res = {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  text(): string;
  // biome-ignore lint/suspicious/noExplicitAny: Tests greifen ohne Narrowing in das JSON.
  json(): any;
};

/** `node:http`-Request; `Host` ist `127.0.0.1:<port>`, solange `headers.host` nichts anderes sagt. */
export function rawRequest(
  port: number,
  req: {
    method?: string;
    path: string;
    headers?: OutgoingHttpHeaders;
    body?: string | Uint8Array;
  },
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: req.method ?? 'GET',
        path: req.path,
        headers: { host: `127.0.0.1:${port}`, ...req.headers },
        // Eigene Verbindung je Request: kein Keep-Alive-Socket überlebt den Test.
        agent: false,
      },
      (res) => {
        collect(res).then(resolve, reject);
      },
    );
    r.on('error', reject);
    r.end(req.body);
  });
}

/** Liest eine Antwort bis zum Ende. */
function collect(res: IncomingMessage): Promise<Res> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('error', reject);
    res.on('end', () => {
      const body = Buffer.concat(chunks);
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body,
        text: () => body.toString('utf8'),
        json: () => JSON.parse(body.toString('utf8')),
      });
    });
  });
}

/**
 * Request mit chunked Body ohne `Content-Length`: schreibt `chunks` mit Gegendruck und hört auf,
 * sobald die Antwort da ist; `end: false` lässt den Body offen. Nach der Antwort ist die eigene
 * Verbindung zu; ein Schreibfehler danach (der Server hat zugemacht) zählt nicht.
 */
export function streamRequest(
  port: number,
  req: {
    method: string;
    path: string;
    headers?: OutgoingHttpHeaders;
    chunks: Iterable<Uint8Array>;
    end?: boolean;
  },
): Promise<Res> {
  return new Promise((resolve, reject) => {
    let answered = false;
    /** Weckt den Schreiber, der auf `drain` wartet; auch die Antwort tut das. */
    let wakeWriter: (() => void) | undefined;
    const r = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: req.method,
        path: req.path,
        headers: { host: `127.0.0.1:${port}`, ...req.headers },
        agent: false,
      },
      (res) => {
        answered = true;
        wakeWriter?.();
        collect(res).then((got) => {
          r.destroy();
          resolve(got);
        }, reject);
      },
    );
    r.on('error', (err) => {
      if (!answered) reject(err);
    });
    void (async () => {
      for (const chunk of req.chunks) {
        if (answered || r.destroyed) return;
        if (!r.write(chunk)) {
          // Nach dem ersten Ereignis beide Listener entfernen, sonst sammeln sie sich pro Gegendruck
          // an. Eine frühe Antwort weckt ebenfalls: Der Server liest den Rest dann womöglich nie.
          await new Promise<void>((done) => {
            const wake = () => {
              wakeWriter = undefined;
              r.off('drain', wake);
              r.off('close', wake);
              done();
            };
            wakeWriter = wake;
            r.on('drain', wake);
            r.on('close', wake);
          });
        }
      }
      if (req.end !== false && !answered && !r.destroyed) r.end();
    })();
  });
}

/** Ein Block des Event-Streams: Ereignis mit `id`/`event`/`data` oder ein Kommentar. */
export type SseFrame = { id?: string; event?: string; data?: unknown; comment?: string };

export type SseStream = {
  status: number;
  headers: IncomingHttpHeaders;
  frames: SseFrame[];
  /** Nur die Ereignisse, ohne Kommentare. */
  events(): SseFrame[];
  /** Erfüllt, sobald der Server den Stream beendet. */
  ended: Promise<void>;
  close(): void;
};

function parseFrame(block: string): SseFrame {
  const frame: SseFrame = {};
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) frame.comment = line.slice(1).trim();
    else if (line.startsWith('id: ')) frame.id = line.slice(4);
    else if (line.startsWith('event: ')) frame.event = line.slice(7);
    else if (line.startsWith('data: ')) frame.data = JSON.parse(line.slice(6));
  }
  return frame;
}

/** Öffnet einen Event-Stream und sammelt seine Blöcke, bis `close` oder das Ende des Servers. */
export function openEvents(
  port: number,
  path: string,
  headers: OutgoingHttpHeaders = {},
): Promise<SseStream> {
  return new Promise((resolve, reject) => {
    const r = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: { host: `127.0.0.1:${port}`, ...headers },
        agent: false,
      },
      (res) => {
        const frames: SseFrame[] = [];
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let at = buffer.indexOf('\n\n');
          while (at >= 0) {
            frames.push(parseFrame(buffer.slice(0, at)));
            buffer = buffer.slice(at + 2);
            at = buffer.indexOf('\n\n');
          }
        });
        const ended = new Promise<void>((done) => {
          res.on('close', () => done());
          res.on('error', () => done());
        });
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          frames,
          events: () => frames.filter((f) => f.comment === undefined),
          ended,
          close: () => r.destroy(),
        });
      },
    );
    r.on('error', reject);
    r.end();
  });
}

export type UiHarness = {
  port: number;
  token: string;
  /** `backe_ui_<port>=<token>`, fertig für den `Cookie`-Header. */
  cookie: string;
  get(path: string, headers?: OutgoingHttpHeaders): Promise<Res>;
  /**
   * POST mit eigenem `Origin` und `Content-Type: application/json`; ein String geht roh hinaus,
   * alles andere als JSON. `headers` überschreibt die Defaults.
   */
  post(path: string, body: unknown, headers?: OutgoingHttpHeaders): Promise<Res>;
  /** PUT mit eigenem `Origin` und `Content-Type: application/octet-stream`. */
  put(path: string, bytes: string | Uint8Array, headers?: OutgoingHttpHeaders): Promise<Res>;
  events(path: string, headers?: OutgoingHttpHeaders): Promise<SseStream>;
  close(): Promise<void>;
};

/** Startet `createUiServer` auf Port 0, tauscht das Token und hält das Cookie; `close` nach jedem Test. */
export async function startUi(opts: Omit<UiOptions, 'port'>): Promise<UiHarness> {
  const server = createUiServer({ ...opts, port: 0 });
  const { port, url } = await server.listen();
  const token = new URL(url).searchParams.get('token') ?? '';
  const session = await rawRequest(port, { path: `/?token=${token}` });
  const setCookie = session.headers['set-cookie']?.[0];
  if (session.status !== 303 || !setCookie?.startsWith(`${cookieName(port)}=`)) {
    await server.close();
    throw new Error(`token exchange failed with status ${session.status}`);
  }
  const cookie = setCookie.split(';')[0] ?? '';
  const origin = `http://127.0.0.1:${port}`;
  return {
    port,
    token,
    cookie,
    get: (path, headers = {}) => rawRequest(port, { path, headers: { cookie, ...headers } }),
    post: (path, body, headers = {}) =>
      rawRequest(port, {
        method: 'POST',
        path,
        headers: { cookie, origin, 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    put: (path, bytes, headers = {}) =>
      rawRequest(port, {
        method: 'PUT',
        path,
        headers: { cookie, origin, 'content-type': 'application/octet-stream', ...headers },
        body: bytes,
      }),
    events: (path, headers = {}) => openEvents(port, path, { cookie, ...headers }),
    close: () => server.close(),
  };
}

import {
  request as httpRequest,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
} from 'node:http';
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
      },
    );
    r.on('error', reject);
    r.end(req.body);
  });
}

export type UiHarness = {
  port: number;
  token: string;
  /** `backe_ui=<token>`, fertig für den `Cookie`-Header. */
  cookie: string;
  get(path: string, headers?: OutgoingHttpHeaders): Promise<Res>;
  close(): Promise<void>;
};

/** Startet `createUiServer` auf Port 0, tauscht das Token und hält das Cookie; `close` nach jedem Test. */
export async function startUi(opts: Omit<UiOptions, 'port'>): Promise<UiHarness> {
  const server = createUiServer({ ...opts, port: 0 });
  const { port, url } = await server.listen();
  const token = new URL(url).searchParams.get('token') ?? '';
  const session = await rawRequest(port, { path: `/?token=${token}` });
  const setCookie = session.headers['set-cookie']?.[0];
  if (session.status !== 303 || setCookie === undefined) {
    await server.close();
    throw new Error(`token exchange failed with status ${session.status}`);
  }
  const cookie = setCookie.split(';')[0] ?? '';
  return {
    port,
    token,
    cookie,
    get: (path, headers = {}) => rawRequest(port, { path, headers: { cookie, ...headers } }),
    close: () => server.close(),
  };
}

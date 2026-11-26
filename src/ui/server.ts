/**
 * HTTP-Server von `backe ui` (ui.md §2.1, §2.15) auf `node:http`: bindet nur `127.0.0.1`, prüft
 * jede Anfrage mit `checkRequest` und setzt die Sicherheits-Header vor dem Dispatch.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { Env } from '../core/env.ts';
import { BackeError } from '../core/errors.ts';
import type { ToolDeps } from '../tools/run.ts';
import { deniedJson, sendError, sendJson } from './http.ts';
import { type LiveDeps, LiveHub } from './live.ts';
import { forbiddenPage, noSessionPage } from './pages.ts';
import { watchPhase } from './phase.ts';
import { handleRead } from './read-api.ts';
import { readRoute, writeRoute } from './routes.ts';
import { appHeaders, checkRequest, type Gate, newToken, ownOrigins } from './security.ts';
import { m } from './server.messages.ts';
import { serveStatic } from './static.ts';
import { UiTools } from './tools.ts';
import { uploadDir } from './upload.ts';
import { handleWrite } from './write-api.ts';

export type UiOptions = {
  cwd: string;
  env: Env;
  flags: { backlog?: string; as?: string };
  /** Start-Backlog aus `resolveStart` (Task 4); `undefined` = keiner. */
  start: string | undefined;
  port: number;
  /** Default `fileURLToPath(new URL('./ui/', import.meta.url))`, im Bundle neben `dist/cli.js`. */
  staticDir?: string;
  /** Default `newToken()`; Tests setzen es fest. */
  token?: string;
  /** Watcher und periodischer Sync der Live-Updates; Tests ersetzen `fs.watch` und den Spawn. */
  live?: LiveDeps;
  /** Test-Hooks der Services hinter den Tools, etwa der Spawn des Hintergrund-Syncs. */
  tools?: ToolDeps;
};

export type UiServer = {
  /** Bindet `127.0.0.1`; `EADDRINUSE` → `BackeError('sync', …)`, Hint `backe ui --port <n>`. */
  listen(): Promise<{ port: number; url: string }>;
  /**
   * Nimmt nichts Neues an, wartet die Arbeitsphase laufender Handler ab (`phase.ts`), dann die
   * Write-Warteschlangen samt ihren Hintergrund-Starts und laufende Sync-Tools (ui.md §2.1,
   * »Lebensdauer«), entfernt das Upload-Verzeichnis, beendet die Watcher der Live-Updates und
   * schließt zuletzt alle Verbindungen; das beendet auch Antworten, die noch Bytes streamen, und
   * offene Event-Streams. Idempotent.
   */
  close(): Promise<void>;
};

const HOST = '127.0.0.1';
const PORT_HINT = 'backe ui --port <n>';
const HTML_TYPE = 'text/html; charset=utf-8';

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'Content-Type': HTML_TYPE,
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
  });
  res.end(html);
}

/** Statuszeilen für Parse-Fehler, die Node selbst unterscheidet; alles andere ist 400. */
const CLIENT_ERROR_STATUS: Readonly<Record<string, string>> = {
  HPE_HEADER_OVERFLOW: '431 Request Header Fields Too Large',
  HPE_CHUNK_EXTENSIONS_OVERFLOW: '413 Payload Too Large',
  ERR_HTTP_REQUEST_TIMEOUT: '408 Request Timeout',
};

/**
 * Antwort auf eine Anfrage, die Node schon beim Parsen verwirft (`clientError`), mit denselben
 * Sicherheits-Headern wie jede andere Antwort; danach ist die Verbindung zu. Geantwortet wird nur,
 * wenn der Socket noch beschreibbar ist und keine Antwort auf ihm schon Bytes geschickt hat (sonst
 * stünde die Statuszeile mitten in deren Body); bei `ECONNRESET` ist der Client weg. Welche Antwort
 * gerade auf dem Socket läuft, steht in `responses` (der Server trägt sie dort ein und ab), nicht
 * in Nodes undokumentiertem `socket._httpMessage`.
 */
export function answerClientError(
  err: NodeJS.ErrnoException,
  socket: Duplex,
  responses: ReadonlyMap<Duplex, ServerResponse> | WeakMap<Duplex, ServerResponse>,
): void {
  const inFlight = responses.get(socket);
  if (err.code !== 'ECONNRESET' && socket.writable && inFlight?.headersSent !== true) {
    const status = CLIENT_ERROR_STATUS[String(err.code)] ?? '400 Bad Request';
    const headers = Object.entries(appHeaders())
      .filter(([, value]) => value !== undefined)
      .map(([name, value]) => `${name}: ${String(value)}\r\n`)
      .join('');
    socket.write(`HTTP/1.1 ${status}\r\n${headers}Content-Length: 0\r\nConnection: close\r\n\r\n`);
  }
  socket.destroy();
}

export function createUiServer(opts: UiOptions): UiServer {
  const token = opts.token ?? newToken();
  /** Steht ab `listen`, vorher erreicht keine Anfrage den Handler. */
  let gate: Gate = { port: opts.port, token, origins: ownOrigins(opts.port) };
  const staticDir = opts.staticDir ?? fileURLToPath(new URL('./ui/', import.meta.url));
  const input = { cwd: opts.cwd, env: opts.env, flags: opts.flags };
  /** Arbeitsphasen laufender Handler; eine endet mit dem Handler oder mit `streaming(res)`. */
  const working = new Set<Promise<void>>();
  const hub = new LiveHub(opts.live === undefined ? {} : { deps: opts.live });
  const tools = new UiTools(input, opts.start, opts.tools);
  const uploads = uploadDir();
  let closing: Promise<void> | undefined;

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [name, value] of Object.entries(appHeaders())) {
      if (value !== undefined) res.setHeader(name, value);
    }
    const url = URL.parse(req.url ?? '/', `http://${HOST}`);
    if (url === null) {
      sendError(res, new BackeError('usage', m.badRequestUrl));
      return;
    }
    const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
    const verdict = checkRequest({ method: req.method ?? 'GET', url, headers: req.headers }, gate);
    if (verdict.kind === 'session') {
      res.writeHead(303, { Location: verdict.location, 'Set-Cookie': [verdict.cookie] });
      res.end();
    } else if (verdict.kind === 'deny') {
      if (api) {
        sendJson(res, verdict.status, deniedJson(verdict.code, verdict.message, verdict.hint));
      } else {
        const html = verdict.status === 401 ? noSessionPage() : forbiddenPage(verdict.message);
        sendHtml(res, verdict.status, html);
      }
    } else if (api) {
      const method = req.method ?? 'GET';
      const read = readRoute(method, url);
      const write = read === undefined ? writeRoute(method, url) : undefined;
      if (read !== undefined) {
        await handleRead(read, { input, start: opts.start, hub }, res);
      } else if (write !== undefined) {
        await handleWrite(write, req, res, { tools, uploads });
      } else {
        sendError(res, new BackeError('not_found', m.noEndpoint(url.pathname)));
      }
    } else {
      await serveStatic(req, url, res, staticDir);
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await dispatch(req, res);
    } catch (err) {
      if (res.headersSent) res.destroy();
      else sendError(res, err);
    }
  }

  /** Die Antwort, die gerade auf einem Socket läuft; fällt mit `finish`/`close` der Antwort weg. */
  const responses = new WeakMap<Socket, ServerResponse>();

  const server = createServer((req, res) => {
    const { socket } = req;
    responses.set(socket, res);
    const forget = () => {
      if (responses.get(socket) === res) responses.delete(socket);
    };
    res.once('finish', forget);
    res.once('close', forget);
    let done!: () => void;
    const work = new Promise<void>((resolve) => {
      done = resolve;
    });
    working.add(work);
    void work.then(() => working.delete(work));
    watchPhase(res, done);
    void handle(req, res).finally(done);
  });
  server.on('clientError', (err, socket) => answerClientError(err, socket, responses));

  return {
    listen() {
      return new Promise((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          reject(
            err.code === 'EADDRINUSE'
              ? new BackeError('sync', m.portInUse(opts.port), { hint: PORT_HINT })
              : err,
          );
        };
        server.once('error', onError);
        server.listen(opts.port, HOST, () => {
          server.off('error', onError);
          const { port } = server.address() as AddressInfo;
          gate = { port, token, origins: ownOrigins(port) };
          resolve({ port, url: `http://${HOST}:${port}/?token=${token}` });
        });
      });
    },
    close() {
      closing ??= (async () => {
        const closed = new Promise<void>((resolve) => server.close(() => resolve()));
        // Ein Handler kann über eine noch offene Keep-Alive-Verbindung weitere nach sich ziehen.
        // Wer streamt, zählt nicht mehr: Ein Client, der nicht weiterliest, hielte sonst das Ende auf.
        // Während die Warteschlangen leerlaufen, kann über eine solche Verbindung noch ein Write
        // ankommen; erst wenn danach kein Handler mehr arbeitet, ist alles abgewartet. Ein Upload,
        // der noch Bytes liest, arbeitet.
        do {
          while (working.size > 0) await Promise.all(working);
          await tools.settled();
        } while (working.size > 0);
        await uploads.remove();
        await hub.close();
        server.closeAllConnections();
        await closed;
      })();
      return closing;
    },
  };
}

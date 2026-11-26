/**
 * HTTP-Server von `backe ui` (ui.md §2.1, §2.15) auf `node:http`: bindet nur `127.0.0.1`, prüft
 * jede Anfrage mit `checkRequest` und setzt die Sicherheits-Header vor dem Dispatch.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { Env } from '../core/env.ts';
import { BackeError } from '../core/errors.ts';
import { sendError, sendJson } from './http.ts';
import { forbiddenPage, noSessionPage } from './pages.ts';
import { handleRead } from './read-api.ts';
import { readRoute } from './routes.ts';
import { appHeaders, checkRequest, type Gate, newToken, ownOrigins } from './security.ts';
import { m } from './server.messages.ts';
import { serveStatic } from './static.ts';

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
};

export type UiServer = {
  /** Bindet `127.0.0.1`; `EADDRINUSE` → `BackeError('sync', …)`, Hint `backe ui --port <n>`. */
  listen(): Promise<{ port: number; url: string }>;
  /** Nimmt nichts Neues an, wartet laufende Handler ab, schließt dann alle Verbindungen. Idempotent. */
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

export function createUiServer(opts: UiOptions): UiServer {
  const token = opts.token ?? newToken();
  /** Steht ab `listen`, vorher erreicht keine Anfrage den Handler. */
  let gate: Gate = { port: opts.port, token, origins: ownOrigins(opts.port) };
  const staticDir = opts.staticDir ?? fileURLToPath(new URL('./ui/', import.meta.url));
  const input = { cwd: opts.cwd, env: opts.env, flags: opts.flags };
  const running = new Set<Promise<void>>();
  let closing: Promise<void> | undefined;

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [name, value] of Object.entries(appHeaders())) {
      if (value !== undefined) res.setHeader(name, value);
    }
    const url = new URL(req.url ?? '/', `http://${HOST}`);
    const api = url.pathname === '/api' || url.pathname.startsWith('/api/');
    const verdict = checkRequest({ method: req.method ?? 'GET', url, headers: req.headers }, gate);
    if (verdict.kind === 'session') {
      res.writeHead(303, { Location: verdict.location, 'Set-Cookie': [verdict.cookie] });
      res.end();
    } else if (verdict.kind === 'deny') {
      if (api) {
        const { code, message, hint } = verdict;
        sendJson(res, verdict.status, { error: { code, message, hint } });
      } else {
        const html = verdict.status === 401 ? noSessionPage() : forbiddenPage(verdict.message);
        sendHtml(res, verdict.status, html);
      }
    } else if (api) {
      const route = readRoute(req.method ?? 'GET', url);
      if (route === undefined)
        sendError(res, new BackeError('not_found', m.noEndpoint(url.pathname)));
      else await handleRead(route, { input, start: opts.start }, res);
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

  const server = createServer((req, res) => {
    const p = handle(req, res);
    running.add(p);
    void p.finally(() => running.delete(p));
  });

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
        while (running.size > 0) await Promise.all(running);
        server.closeAllConnections();
        await closed;
      })();
      return closing;
    },
  };
}

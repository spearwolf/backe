/**
 * Statische Auslieferung des gebauten Frontends (`dist/ui/`) mit SPA-Fallback. Pfadsicherheit ist
 * hier sicherheitsrelevant: jedes Segment wird einzeln dekodiert, und der `realpath` des Ziels muss
 * unter dem `realpath` des Wurzelverzeichnisses liegen (fängt Symlinks, die hinausführen).
 */
import { realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, sep } from 'node:path';
import { placeholderPage } from './pages.ts';
import { m } from './static.messages.ts';
import { sendFile } from './stream-file.ts';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const IMMUTABLE = 'public, max-age=31536000, immutable';
const TEXT_TYPE = 'text/plain; charset=utf-8';

function notFound(res: ServerResponse): void {
  const text = m.notFound;
  res.writeHead(404, {
    'Content-Type': TEXT_TYPE,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

/** Dekodierte Segmente des Pfads; `undefined` bei ungültiger Kodierung, NUL, `..` oder Trenner im Segment. */
function segmentsOf(pathname: string): string[] | undefined {
  const out: string[] = [];
  for (const raw of pathname.split('/')) {
    let seg: string;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (seg.includes('\0') || seg.includes('/') || seg.includes('\\') || seg === '..') {
      return undefined;
    }
    if (seg !== '' && seg !== '.') out.push(seg);
  }
  return out;
}

/** `realpath` oder `undefined`, wenn es das Ziel nicht gibt. */
async function resolve(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

type Found = string | 'outside' | undefined;

/**
 * `realpath` einer regulären Datei unter `root` (bereits `realpath`); `'outside'`, wenn das Ziel
 * die Wurzel verlässt.
 */
async function locate(root: string, target: string): Promise<Found> {
  const real = await resolve(target);
  if (real === undefined) return undefined;
  if (real !== root && !real.startsWith(root.endsWith(sep) ? root : root + sep)) return 'outside';
  const info = await stat(real);
  return info.isFile() ? real : undefined;
}

/**
 * Schickt `file` über `sendFile`; `false`, wenn die Datei seit `locate` verschwunden ist. Dann
 * ist nichts gesendet, und der Aufrufer behandelt sie wie eine fehlende Datei.
 */
function sendStatic(
  req: IncomingMessage,
  res: ServerResponse,
  file: string,
  cache: string,
): Promise<boolean> {
  return sendFile(res, file, {
    head: req.method === 'HEAD',
    headers: () => ({
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': cache,
    }),
  });
}

function sendPlaceholder(req: IncomingMessage, res: ServerResponse): void {
  const html = placeholderPage();
  res.writeHead(200, {
    'Content-Type': TYPES['.html'] as string,
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control': 'no-store',
  });
  res.end(req.method === 'HEAD' ? undefined : html);
}

/** Liefert `url.pathname` aus `dir`; App-Routen (letztes Segment ohne Punkt) fallen auf `index.html` zurück. */
export async function serveStatic(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  dir: string,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
  const segments = segmentsOf(url.pathname);
  if (segments === undefined) return notFound(res);

  const root = await resolve(dir);
  const found = root === undefined ? undefined : await locate(root, join(root, ...segments));
  if (found === 'outside') return notFound(res);
  if (found !== undefined) {
    const immutable = segments[0] === 'assets' && segments.length > 1;
    if (await sendStatic(req, res, found, immutable ? IMMUTABLE : 'no-cache')) return;
  }

  const last = segments[segments.length - 1] ?? '';
  if (last.includes('.')) return notFound(res);
  const index = root === undefined ? undefined : await locate(root, join(root, 'index.html'));
  if (index !== undefined && index !== 'outside') {
    if (await sendStatic(req, res, index, 'no-cache')) return;
  }
  sendPlaceholder(req, res);
}

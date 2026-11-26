/**
 * Auslieferung von Anhängen (ui.md §2.9.4, §2.15). Anhänge sind fremde Bytes: Sie laufen nie als
 * aktiver Inhalt im Ursprung der App, sondern mit `sandbox`-CSP, `nosniff` und, wo ein Browser
 * sie ausführen könnte (HTML), als Download.
 */
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ATTACHMENT_TEXT_LIMIT } from '../tools/read.ts';

export type Delivery = { type: string; disposition: 'inline' | 'attachment' };

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

const HTML_EXTENSIONS: ReadonlySet<string> = new Set(['html', 'htm', 'xhtml', 'xht']);

const DOWNLOAD: Delivery = { type: 'application/octet-stream', disposition: 'attachment' };

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Typ und Disposition nach Endung, bei unbekannter Endung nach Inhalt. `bytes` ist der ganze
 * Inhalt, wenn die Datei höchstens `ATTACHMENT_TEXT_LIMIT` Bytes hat, sonst `undefined`.
 */
export function attachmentDelivery(name: string, bytes: Uint8Array | undefined): Delivery {
  const ext = extname(name).slice(1).toLowerCase();
  if (HTML_EXTENSIONS.has(ext)) return DOWNLOAD;
  const image = IMAGE_TYPES[ext];
  if (image !== undefined) return { type: image, disposition: 'inline' };
  if (bytes !== undefined && isUtf8(bytes)) {
    return { type: 'text/plain; charset=utf-8', disposition: 'inline' };
  }
  return DOWNLOAD;
}

/** `inline|attachment; filename*=UTF-8''<encodeURIComponent(name)>` */
export function contentDisposition(d: Delivery['disposition'], name: string): string {
  return `${d}; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Schickt einen Anhang. Kleine Dateien (bis `ATTACHMENT_TEXT_LIMIT`) werden ganz gelesen, damit
 * die Inhaltsprüfung und die ausgelieferten Bytes dieselben sind; größere gehen als Stream. `path`
 * stammt aus dem Anhangsverzeichnis des Issues, nie aus der URL. `head`: nur die Header.
 */
export async function sendAttachment(
  res: ServerResponse,
  a: { name: string; path: string; size: number },
  head: boolean,
): Promise<void> {
  const small = a.size <= ATTACHMENT_TEXT_LIMIT;
  const bytes = small ? await readFile(a.path) : undefined;
  const delivery = attachmentDelivery(a.name, bytes);
  res.writeHead(200, {
    'Content-Type': delivery.type,
    'Content-Disposition': contentDisposition(delivery.disposition, a.name),
    'Content-Length': bytes?.length ?? a.size,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  if (head) {
    res.end();
  } else if (bytes !== undefined) {
    res.end(bytes);
  } else {
    await pipeline(createReadStream(a.path), res).catch(() => res.destroy());
  }
}

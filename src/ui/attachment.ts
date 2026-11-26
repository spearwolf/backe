/**
 * Auslieferung von Anhängen (ui.md §2.9.4, §2.15). Anhänge sind fremde Bytes: Sie laufen nie als
 * aktiver Inhalt im Ursprung der App, sondern mit `sandbox`-CSP, `nosniff` und, wo ein Browser
 * sie ausführen könnte (HTML), als Download.
 */
import type { ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { m } from '../services/attachments.messages.ts';
import { ATTACHMENT_TEXT_LIMIT } from '../tools/read.ts';
import { sendFile } from './stream-file.ts';

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
  // RFC 8187: `'()*` sind keine attr-char und müssen zusätzlich kodiert werden.
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${d}; filename*=UTF-8''${encoded}`;
}

/**
 * Schickt einen Anhang über `sendFile`: Länge und Inhalt stammen vom `fstat` des einmal geöffneten
 * Handles. Kleine Dateien (bis `ATTACHMENT_TEXT_LIMIT`) werden ganz gelesen, damit die
 * Inhaltsprüfung und die ausgelieferten Bytes dieselben sind; größere gehen als Stream. `path`
 * stammt aus dem Anhangsverzeichnis des Issues, nie aus der URL. Ist die Datei inzwischen weg,
 * ist das `not_found` wie in `getAttachment`. `head`: nur die Header.
 */
export async function sendAttachment(
  res: ServerResponse,
  a: { name: string; path: string },
  head: boolean,
): Promise<void> {
  const sent = await sendFile(res, a.path, {
    head,
    readLimit: ATTACHMENT_TEXT_LIMIT,
    headers: ({ bytes }) => {
      const delivery = attachmentDelivery(a.name, bytes);
      return {
        'Content-Type': delivery.type,
        'Content-Disposition': contentDisposition(delivery.disposition, a.name),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': 'sandbox',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
      };
    },
  });
  if (!sent) throw new BackeError('not_found', m.pathMissing(a.path));
}

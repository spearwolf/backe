/**
 * Bodys schreibender Anfragen von `backe ui` (ui.md §2.3.2, §2.15): Medientyp und JSON mit
 * Obergrenze. Über der Grenze wird nicht weitergelesen; den Rest verwirft das Ende der Verbindung.
 */
import type { IncomingMessage } from 'node:http';
import { BackeError } from '../core/errors.ts';
import { m } from './write-api.messages.ts';

/** Obergrenze eines Tool-Bodys: 16 MiB. */
export const TOOL_BODY_LIMIT = 16_777_216;

/** Medientyp eines `Content-Type`-Headers, kleingeschrieben und ohne Parameter; leer → `undefined`. */
export function mediaType(header: string | undefined): string | undefined {
  const type = header?.split(';')[0]?.trim().toLowerCase();
  return type === undefined || type === '' ? undefined : type;
}

function parseObject(bytes: Buffer): Record<string, unknown> {
  if (bytes.length === 0) return {};
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new BackeError('usage', m.bodyNotJson);
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BackeError('usage', m.bodyNotObject);
  }
  return value as Record<string, unknown>;
}

/**
 * Liest den Body als JSON-Objekt; leer → `{}`. Mehr als `limit` Bytes — angekündigt per
 * `Content-Length` oder beim Lesen gezählt — ist `validation`: Der Stream wird dann angehalten
 * und nicht weiter gelesen. Kein JSON oder kein Objekt → `usage`. Endet der Stream ohne `end`
 * (Client weg) oder ist er schon verbraucht, scheitert das Lesen, statt ewig zu warten.
 */
export function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const declared = Number(req.headers['content-length']);
  if (declared > limit) return Promise.reject(new BackeError('validation', m.bodyTooLarge(limit)));
  // Ein schon beendeter oder zerstörter Stream meldet weder `end` noch `close` noch einmal.
  if (req.readableEnded || req.destroyed) {
    return Promise.reject(new BackeError('usage', m.bodyEndedEarly));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const stop = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
    };
    function onData(chunk: Buffer): void {
      size += chunk.length;
      if (size > limit) {
        stop();
        req.pause();
        reject(new BackeError('validation', m.bodyTooLarge(limit)));
        return;
      }
      chunks.push(chunk);
    }
    function onEnd(): void {
      stop();
      try {
        resolve(parseObject(Buffer.concat(chunks)));
      } catch (err) {
        reject(err);
      }
    }
    function onError(err: Error): void {
      stop();
      reject(err);
    }
    function onClose(): void {
      stop();
      reject(new BackeError('usage', m.bodyEndedEarly));
    }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

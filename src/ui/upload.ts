/**
 * Uploads von `backe ui` (ui.md §2.3.2 »Upload«, §2.15 »Uploads«): Die Bytes landen in einer
 * Temp-Datei im eigenen Temp-Verzeichnis des Servers, nie an einem Pfad aus der Anfrage. Name und
 * Ort der Datei bestimmt allein der Server.
 */
import { randomUUID } from 'node:crypto';
import { type FileHandle, mkdtemp, open, rm } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { m } from './write-api.messages.ts';

/**
 * Das Temp-Verzeichnis eines Serverprozesses: `file()` legt es beim ersten Aufruf an
 * (`mkdtemp`, Modus 0700) und gibt je Aufruf einen neuen Pfad `upload-<uuid>` darin zurück, ohne
 * die Datei anzulegen; `remove()` entfernt das Verzeichnis samt Inhalt.
 */
export type UploadDir = { file(): Promise<string>; remove(): Promise<void> };

export function uploadDir(): UploadDir {
  let dir: Promise<string> | undefined;
  return {
    async file() {
      dir ??= mkdtemp(join(tmpdir(), 'backe-ui-')).catch((err: unknown) => {
        // Ein gescheitertes Anlegen bleibt nicht hängen; der nächste Upload versucht es neu.
        dir = undefined;
        throw err;
      });
      return join(await dir, `upload-${randomUUID()}`);
    },
    async remove() {
      const made = dir;
      dir = undefined;
      const path = await made?.catch(() => undefined);
      if (path !== undefined) await rm(path, { recursive: true, force: true });
    },
  };
}

/**
 * Liest den Body nach `handle`, Chunk für Chunk mit Gegendruck: Während ein Chunk geschrieben
 * wird, ruht der Stream. Ab dem ersten Byte über `max` wird nicht weitergeschrieben und nicht
 * weitergelesen; das Ergebnis ist dann `{tooLarge}` mit den bis dahin gezählten Bytes.
 */
function pump(
  req: IncomingMessage,
  handle: FileHandle,
  max: number | null,
): Promise<{ size: number } | { tooLarge: number }> {
  // Während `open` lief, kann der Client gegangen sein; `close` und `error` sind dann vorbei.
  if (req.destroyed) {
    return Promise.reject(req.errored ?? new BackeError('usage', m.bodyEndedEarly));
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    /** Der laufende Schreibvorgang; `end` wartet auf ihn. */
    let writing: Promise<unknown> = Promise.resolve();
    let settled = false;
    const stop = () => {
      settled = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      stop();
      reject(err);
    };
    function onData(chunk: Buffer): void {
      size += chunk.length;
      req.pause();
      if (max !== null && size > max) {
        stop();
        resolve({ tooLarge: size });
        return;
      }
      writing = handle.write(chunk).then(() => {
        if (!settled) req.resume();
      });
      writing.catch(fail);
    }
    function onEnd(): void {
      // `end` kann kommen, während der letzte Chunk noch geschrieben wird.
      stop();
      writing.then(() => resolve({ size }), reject);
    }
    function onError(err: Error): void {
      fail(err);
    }
    function onClose(): void {
      fail(new BackeError('usage', m.bodyEndedEarly));
    }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
  });
}

/**
 * Schreibt den Body nach `path`; bricht ab, sobald mehr als `max` Bytes kamen (max null = ohne
 * Grenze). Die Datei wird exklusiv neu angelegt (`wx`, Modus 0600): Ein vorhandener Pfad, auch ein
 * Symlink, wird nie beschrieben. Endet der Stream ohne `end` (Client weg) oder ist er schon
 * verbraucht, scheitert das Lesen, statt ewig zu warten. Die Datei entfernt der Aufrufer, in jedem
 * Fall, auch nach einem Fehler.
 */
export async function receiveUpload(
  req: IncomingMessage,
  path: string,
  max: number | null,
): Promise<{ size: number } | { tooLarge: number }> {
  // Ein schon beendeter oder zerstörter Stream meldet weder `end` noch `close` noch einmal.
  if (req.readableEnded || req.destroyed) throw new BackeError('usage', m.bodyEndedEarly);
  const handle = await open(path, 'wx', 0o600);
  try {
    return await pump(req, handle, max);
  } finally {
    // Wartet auch einen noch laufenden Schreibvorgang ab (`FileHandle.close`).
    await handle.close();
  }
}

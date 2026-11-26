/**
 * Schickt eine Datei als Antwort, gemeinsam für statische Dateien und Anhänge. Die Datei wird
 * genau einmal geöffnet; `Content-Length` und Inhalt stammen beide vom `fstat` dieses Handles. Eine
 * Datei, die währenddessen wächst, liefert nicht mehr Bytes als versprochen; eine, die schrumpft,
 * bricht die Antwort ab, statt den Client auf fehlende Bytes warten zu lassen.
 */
import { type FileHandle, open } from 'node:fs/promises';
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { streaming } from './phase.ts';

export type FileBody = {
  /** Größe aus dem `fstat` des geöffneten Handles. */
  size: number;
  /** Ganzer Inhalt, wenn die Datei höchstens `readLimit` Bytes hat, sonst `undefined`. */
  bytes: Uint8Array | undefined;
};

export type SendFileOptions = {
  /** HEAD: nur die Header. */
  head: boolean;
  /**
   * Bis zu dieser Größe wird die Datei ganz gelesen und als `bytes` an `headers` gereicht, etwa
   * für eine Inhaltsprüfung; die ausgelieferten Bytes sind dann genau die geprüften. Default 0.
   */
  readLimit?: number;
  /** Header der 200-Antwort außer `Content-Length`, das setzt `sendFile`. */
  headers(body: FileBody): OutgoingHttpHeaders;
};

/** Fehlercodes von `open` und `stat`, die heißen: Unter diesem Pfad gibt es (jetzt) keine Datei. */
const MISSING: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

export function isMissing(err: unknown): boolean {
  return MISSING.has((err as NodeJS.ErrnoException | undefined)?.code ?? '');
}

/** Liest höchstens `size` Bytes ab Offset 0; weniger, wenn die Datei inzwischen kürzer ist. */
async function readAll(fh: FileHandle, size: number): Promise<Uint8Array> {
  const buf = Buffer.alloc(size);
  let got = 0;
  while (got < size) {
    const { bytesRead } = await fh.read(buf, got, size - got, got);
    if (bytesRead === 0) break;
    got += bytesRead;
  }
  return buf.subarray(0, got);
}

/** Reicht Chunks durch und scheitert im `flush`, wenn weniger als `size` Bytes kamen. */
function lengthGuard(size: number): Transform {
  let sent = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      sent += chunk.length;
      cb(null, chunk);
    },
    // Der Fehler kommt vor `res.end()`, solange der Socket noch hängt.
    flush(cb) {
      cb(sent < size ? new Error('file shrank while streaming') : null);
    },
  });
}

/**
 * Antwortet mit 200 und dem Inhalt von `path`. `false`, wenn es dort keine reguläre Datei gibt
 * (fehlt beim Öffnen, ist ein Verzeichnis); dann ist nichts gesendet. Andere Fehler beim Öffnen
 * oder Lesen fliegen, solange noch nichts gesendet ist. Das Handle schließt auf jedem Weg hier,
 * nicht im Stream: Ist der Client schon getrennt, scheitert `pipeline`, ohne die Quelle zu
 * zerstören, und ein `autoClose` griffe nie.
 */
export async function sendFile(
  res: ServerResponse,
  path: string,
  opts: SendFileOptions,
): Promise<boolean> {
  let fh: FileHandle;
  try {
    fh = await open(path, 'r');
  } catch (err) {
    if (isMissing(err)) return false;
    throw err;
  }
  try {
    const info = await fh.stat();
    if (!info.isFile()) return false;
    const size = info.size;
    const bytes = size <= (opts.readLimit ?? 0) ? await readAll(fh, size) : undefined;
    res.writeHead(200, {
      ...opts.headers({ size, bytes }),
      'Content-Length': bytes?.length ?? size,
    });
    if (opts.head) {
      res.end();
    } else if (bytes !== undefined) {
      res.end(bytes);
    } else {
      const stream = fh.createReadStream({ start: 0, end: size - 1, autoClose: false });
      streaming(res);
      // Ein Abbruch beendet die Verbindung, damit der Client nicht auf versprochene Bytes wartet.
      await pipeline(stream, lengthGuard(size), res).catch(() => {
        stream.destroy();
        res.destroy();
      });
    }
    return true;
  } finally {
    // Wartet laufende Lesezugriffe des Streams ab, bevor der Deskriptor geht.
    await fh.close();
  }
}

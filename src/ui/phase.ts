/**
 * Arbeitsphase einer Antwort, für das Herunterfahren von `backe ui` (ui.md §2.1, »Lebensdauer«).
 * `close()` wartet auf jeden Handler, solange er arbeitet: Kontext auflösen, Dienste lesen, die
 * Antwort vorbereiten. Ab `streaming(res)` fließen nur noch Bytes, und die Antwort hält das Ende
 * nicht mehr auf; `close()` schließt danach ihre Verbindung. Jede strömende oder langlebige
 * Antwort meldet sich so, ein Dateistrom ebenso wie ein Event-Stream.
 */
import type { ServerResponse } from 'node:http';

const watchers = new WeakMap<ServerResponse, () => void>();

/** `onStreaming` wird höchstens einmal gerufen, beim ersten `streaming(res)`. */
export function watchPhase(res: ServerResponse, onStreaming: () => void): void {
  watchers.set(res, onStreaming);
}

/** Die Arbeit an `res` ist getan; was folgt, sind Bytes, die das Ende nicht abwarten muss. */
export function streaming(res: ServerResponse): void {
  const done = watchers.get(res);
  watchers.delete(res);
  done?.();
}

/**
 * Batch (backe.md §2.16.6): mehrere Operationen nacheinander auf einem Draft. Jede sieht den
 * Stand ihrer Vorgänger, geschrieben wird erst, wenn alle durch sind; scheitert eine, scheitert
 * der ganze Batch (auch beim Replay, backe.md §2.16.4).
 */

import { BackeError } from '../core/errors.ts';
import type { FileChange } from '../store/files.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { type ApplyContext, applyStep } from './apply.ts';
import { m } from './batch.messages.ts';
import { Draft } from './draft.ts';
import { violation } from './invariants.ts';
import type { Notice } from './notice.ts';
import { decodeOp, type Operation, substituteIds } from './operation.ts';

export const MAX_BATCH = 1000;

export type BatchResult = {
  snapshot: BacklogSnapshot;
  changes: FileChange[];
  /** Die wirksamen Operationen mit echten IDs und ohne `ref`, in Reihenfolge. */
  recorded: Operation[];
  /** Platzhalter zu vergebener Issue-ID, in der Reihenfolge ihrer Vergabe. */
  refs: Record<string, string>;
  notices: Notice[];
};

/** Wirft `err` mit `Zeile <line>: ` vor der Message neu; Code und Hinweis bleiben. */
function onLine(line: number, err: unknown): never {
  if (!(err instanceof BackeError)) throw err;
  const details = { ...(err.details as object | undefined), line };
  throw new BackeError(err.code, m.lineError(line, err.message), {
    details,
    ...(err.hint === undefined ? {} : { hint: err.hint }),
  });
}

/**
 * Eine Operation je Zeile. Erlaubt sind ein abschließender Newline und leere Zeilen am Ende; eine
 * leere Zeile vor einer weiteren Operation ist ein Fehler. Zeilenfehler nennen die Zeile.
 * `reject` liefert für eine gültige, aber hier verbotene Operation den Grund (`validation`); er
 * läuft je Zeile direkt nach dem Dekodieren, damit der erste Fehler auch der in der ersten Zeile ist.
 */
export function parseBatchInput(
  text: string,
  reject?: (op: Operation) => string | undefined,
): Operation[] {
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  while (lines.at(-1) === '') lines.pop();
  return lines.map((line, i) => {
    try {
      if (line === '') throw violation('schema', m.emptyLine);
      const op = decodeOp(line);
      const reason = reject?.(op);
      if (reason !== undefined) throw new BackeError('validation', reason);
      return op;
    } catch (err) {
      return onLine(i + 1, err);
    }
  });
}

/**
 * Wendet `ops` der Reihe nach auf `s` an. Vor jeder Operation werden die bisher vergebenen
 * Platzhalter eingesetzt; `ref` einer `issue.create` hält danach die vergebene ID. Eine Operation
 * ohne Wirkung wird nicht aufgezeichnet; als Wirkung zählt jede Änderung am Draft, auch eine, die
 * später im selben Batch wieder zurückgenommen wird.
 */
export function applyBatch(
  s: BacklogSnapshot,
  ops: readonly Operation[],
  ctx: ApplyContext,
): BatchResult {
  if (ops.length === 0) throw new BackeError('validation', m.emptyBatch);
  if (ops.length > MAX_BATCH) {
    throw new BackeError('validation', m.batchTooLarge(MAX_BATCH), {
      hint: m.batchTooLargeHint(ops.length),
    });
  }
  const d = new Draft(s, ctx);
  const refs = new Map<string, string>();
  const recorded: Operation[] = [];
  ops.forEach((raw, i) => {
    try {
      if (raw.op === 'issue.create' && raw.ref !== undefined && refs.has(raw.ref)) {
        throw violation('schema', m.placeholderTaken(raw.ref));
      }
      const before = d.revision;
      const done = applyStep(d, substituteIds(raw, refs));
      if (done.op === 'issue.create') {
        const { ref: _, ...plain } = done;
        if (raw.op === 'issue.create' && raw.ref !== undefined && plain.id !== undefined) {
          refs.set(raw.ref, plain.id);
        }
        if (d.revision !== before) recorded.push(plain);
      } else if (d.revision !== before) {
        recorded.push(done);
      }
    } catch (err) {
      onLine(i + 1, err);
    }
  });
  const { snapshot, changes, notices } = d.finish();
  return { snapshot, changes, recorded, refs: Object.fromEntries(refs), notices };
}

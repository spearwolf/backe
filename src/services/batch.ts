/**
 * `backe batch` (backe.md §2.16.6): Operationen als JSONL, eine pro Zeile, in einem Commit. Den Text
 * liest die CLI; Platzhalter (`ref`) und Zeilennummern in Fehlern kommen aus der Ops-Schicht.
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { parseBatchInput } from '../ops/batch.ts';
import type { Notice } from '../ops/notice.ts';
import type { Operation } from '../ops/operation.ts';
import { executeWrite, type WriteDeps } from './write.ts';

export type BatchOutcome = {
  commit: string | undefined;
  /** Platzhalter zu vergebener Issue-ID, in Vergabe-Reihenfolge. */
  refs: Record<string, string>;
  /** Die aufgezeichneten (wirksamen) Operationen. */
  ops: Operation[];
  notices: Notice[];
  /** Verify-Gründe, wenn dieser Batch die Arbeitskopie im Modus `warn` geklont hat. */
  warnings: string[];
};

const FORBIDDEN: Partial<Record<Operation['op'], (op: Operation) => string | undefined>> = {
  'attach.add': (op) =>
    'file' in op && op.file !== undefined ? 'Datei-Anhänge gehen nicht per Batch' : undefined,
  'issue.claim': () => 'issue.claim gibt es nicht im Batch',
};

export async function runBatch(
  ctx: ResolvedContext,
  text: string,
  deps?: WriteDeps,
): Promise<BatchOutcome> {
  const ops = parseBatchInput(text.startsWith('﻿') ? text.slice(1) : text, (op) =>
    FORBIDDEN[op.op]?.(op),
  );
  const r = await executeWrite(ctx, { kind: 'batch', ops }, deps);
  return {
    commit: r.commit,
    refs: r.refs,
    ops: r.recorded,
    notices: r.notices,
    warnings: r.verifyNotices,
  };
}

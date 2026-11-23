/**
 * `backe sync resolve` (backe.md §2.16.4): ein Eintrag der Konfliktablage wird verworfen oder
 * »trotzdem angewendet« — mit Vorbedingungen auf dem aktuellen Stand, als ein Write mit voller
 * Prüfung. Erst ein gelungener Write löscht den Eintrag.
 */
import { type ResolvedContext, requireWriter } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { Comment } from '../core/schemas.ts';
import { readBlobs } from '../git/history.ts';
import type { Operation } from '../ops/operation.ts';
import { rebaseOp, rewriteCollisions } from '../ops/replay.ts';
import { listComments, type StoredEntity } from '../store/snapshot.ts';
import { m } from './resolve.messages.ts';
import { type ConflictEntry, listConflicts, removeConflict } from './sync-state.ts';
import { executeWrite, type WriteDeps } from './write.ts';

type AttachAdd = Extract<Operation, { op: 'attach.add' }>;

const needsContent = (op: Operation): op is AttachAdd =>
  op.op === 'attach.add' && op.file !== undefined && op.content === undefined;

/**
 * Die Operationen aller Einheiten in Reihenfolge, `attach.add` mit dem Inhalt aus `sources` (der
 * Blob im Ursprungs-Commit). Lässt sich ein Blob nicht mehr lesen — der Ursprungs-Commit ist
 * etwa aufgeräumt —, ist der Inhalt verloren (`validation`); der Eintrag lässt sich verwerfen.
 */
async function entryOps(wc: string, entry: ConflictEntry): Promise<Operation[]> {
  const specs = entry.units.flatMap((u) =>
    u.ops.flatMap((op, i) => (needsContent(op) ? [u.sources?.[i] ?? ''] : [])),
  );
  const blobs = await readBlobs(
    wc,
    specs.filter((s) => s !== ''),
  );
  return entry.units.flatMap((u) =>
    u.ops.map((op, i) => {
      if (!needsContent(op)) return op;
      const spec = u.sources?.[i] ?? '';
      const blob = blobs.get(spec);
      if (blob == null) {
        throw new BackeError('validation', m.attachmentContentGone(op.file, op.id), {
          hint: `backe sync resolve ${entry.id} --drop`,
          details: { source: spec },
        });
      }
      return { ...op, content: new Uint8Array(blob) };
    }),
  );
}

/** Kommentare der Issues, deren `comment.edit` eine Vorbedingung auf dem aktuellen Stand braucht. */
async function editedComments(
  wc: string,
  ops: readonly Operation[],
): Promise<Map<string, StoredEntity<Comment>[]>> {
  const out = new Map<string, StoredEntity<Comment>[]>();
  for (const op of ops) {
    if (op.op === 'comment.edit' && !out.has(op.id)) out.set(op.id, await listComments(wc, op.id));
  }
  return out;
}

/**
 * `sync resolve <id> --drop` löscht den Eintrag; `--apply` setzt die Vorbedingungen aller
 * Operationen auf den aktuellen Stand (`rebaseOp`), gibt inzwischen vergebenen IDs neuer Issues
 * eine frische und schreibt alles als **einen** Write (eine Operation als `op`, mehrere als
 * Batch) mit voller Prüfung der Invarianten. Erfolg löscht den Eintrag, ein Fehler lässt ihn
 * stehen. Eine unbekannte ID ist `not_found`.
 */
export async function resolveConflict(
  ctx: ResolvedContext,
  id: string,
  action: 'drop' | 'apply',
  deps: WriteDeps = {},
): Promise<{ commit: string | undefined; ops: Operation[] }> {
  const { workingCopy: wc } = requireWriter(ctx);
  const entry = (await listConflicts(wc)).find((e) => e.id === id);
  if (entry === undefined) throw new BackeError('not_found', m.conflictNotFound(id));
  if (action === 'drop') {
    await removeConflict(wc, id);
    return { commit: undefined, ops: entry.units.flatMap((u) => u.ops) };
  }
  const ops = await entryOps(wc, entry);
  let derived: Operation[] = [];
  const r = await executeWrite(
    ctx,
    {
      kind: 'derive',
      // Unter dem Write-Lock: Kommentare nach dem Umschreiben der IDs, im Stand dieses Writes.
      derive: async (s) => {
        const named = rewriteCollisions(s, ops, new Map(), deps).ops;
        const comments = await editedComments(wc, named);
        derived = named.map((op) => rebaseOp(s, op, comments));
        return derived;
      },
    },
    deps,
  );
  await removeConflict(wc, id);
  // Ohne Wirkung zeichnet der Write nichts auf; gemeldet werden dann die abgeleiteten Operationen.
  const recorded = r.recorded.length > 0 ? r.recorded : derived;
  return { commit: r.commit, ops: recorded.map(withoutContent) };
}

/** Eine Operation für die Ausgabe: ohne den Inhalt eines Anhangs. */
function withoutContent(op: Operation): Operation {
  if (op.op !== 'attach.add') return op;
  const { content: _, ...rest } = op;
  return rest;
}

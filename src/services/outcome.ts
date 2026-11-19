/** Ergebnis eines Schreibbefehls für die Ausgabe: Commit, aufgezeichnete Operation, betroffenes Issue. */
import type { ResolvedContext } from '../context/resolve.ts';
import type { Notice } from '../ops/notice.ts';
import type { Operation } from '../ops/operation.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { executeWrite, type WriteDeps } from './write.ts';

export type WriteOutcome = {
  commit: string | undefined;
  op: Operation;
  /** Statt `op`, wenn `derive` mehrere Operationen geliefert hat. */
  ops?: Operation[];
  id?: string;
  notices: Notice[];
  warnings: string[];
};

/** Ergebnis von `writeOp`, wenn `derive` eine Liste liefert: `ops` statt `op`. */
export type WriteOpsOutcome = Omit<WriteOutcome, 'op' | 'ops'> & { ops: Operation[] };

/** Die gemeinsame Issue-ID aller Operationen, wenn es genau eine ist. */
function singleId(ops: readonly Operation[]): string | undefined {
  const ids = new Set(ops.map((op) => ('id' in op && typeof op.id === 'string' ? op.id : '')));
  const [id] = ids;
  return ids.size === 1 && id !== '' ? id : undefined;
}

/**
 * Leitet die Operation(en) unter dem Write-Lock ab und schreibt sie. `id` ist gesetzt, wenn die
 * Operationen genau ein Issue betreffen; `warnings` sind die Verify-Hinweise eines frischen Klons.
 * Liefert `derive` eine Liste, meldet das Ergebnis `ops` statt `op`.
 */
export async function writeOp(
  ctx: ResolvedContext,
  derive: (s: BacklogSnapshot, actor: string) => Operation,
  deps?: WriteDeps,
): Promise<WriteOutcome>;
export async function writeOp(
  ctx: ResolvedContext,
  derive: (s: BacklogSnapshot, actor: string) => readonly Operation[],
  deps?: WriteDeps,
): Promise<WriteOpsOutcome>;
export async function writeOp(
  ctx: ResolvedContext,
  derive: (s: BacklogSnapshot, actor: string) => Operation | readonly Operation[],
  deps?: WriteDeps,
): Promise<WriteOutcome | WriteOpsOutcome> {
  let derived: Operation | readonly Operation[] | undefined;
  const r = await executeWrite(
    ctx,
    {
      kind: 'derive',
      derive: (s, actor) => {
        derived = derive(s, actor);
        return derived;
      },
    },
    deps,
  );
  const base = { commit: r.commit, notices: r.notices, warnings: r.verifyNotices };
  if (Array.isArray(derived)) {
    // Wirkungslose Operationen werden nicht aufgezeichnet; ohne Wirkung gilt die abgeleitete Liste.
    const ops: Operation[] = r.recorded.length > 0 ? r.recorded : [...(derived as Operation[])];
    const id = singleId(ops);
    return { ...base, ops, ...(id === undefined ? {} : { id }) };
  }
  // Eine wirkungslose Operation wird nicht aufgezeichnet; gemeldet wird dann die abgeleitete.
  const op = (r.recorded[0] ?? derived) as Operation;
  const id = 'id' in op && typeof op.id === 'string' ? op.id : undefined;
  return { ...base, op, ...(id === undefined ? {} : { id }) };
}

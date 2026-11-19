/** Ergebnis eines Schreibbefehls für die Ausgabe: Commit, aufgezeichnete Operation, betroffenes Issue. */
import type { ResolvedContext } from '../context/resolve.ts';
import type { Notice } from '../ops/notice.ts';
import type { Operation } from '../ops/operation.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { executeWrite, type WriteDeps } from './write.ts';

export type WriteOutcome = {
  commit: string | undefined;
  op: Operation;
  id?: string;
  notices: Notice[];
  warnings: string[];
};

/**
 * Leitet die Operation unter dem Write-Lock ab und schreibt sie. `id` ist gesetzt, wenn die
 * Operation genau ein Issue betrifft; `warnings` sind die Verify-Hinweise eines frischen Klons.
 */
export async function writeOp(
  ctx: ResolvedContext,
  derive: (s: BacklogSnapshot, actor: string) => Operation,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  let derived: Operation | undefined;
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
  // Eine wirkungslose Operation wird nicht aufgezeichnet; gemeldet wird dann die abgeleitete.
  const op = (r.recorded[0] ?? derived) as Operation;
  const id = 'id' in op && typeof op.id === 'string' ? op.id : undefined;
  return {
    commit: r.commit,
    op,
    ...(id === undefined ? {} : { id }),
    notices: r.notices,
    warnings: r.verifyNotices,
  };
}

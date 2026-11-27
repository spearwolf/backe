/** Züge vom Board hinaus: über dieselbe Warteschlange wie das Umsortieren im Tab Backlog. */
import { withoutBatchLine } from '../../app/batch-line.ts';
import { type BoardPlan, boardCall, boardOverlay } from '../../app/board-move.ts';
import type { StateExtra } from '../../app/state-actions.ts';
import { ApiError } from '../../data/api-client.ts';
import type { Store } from '../../data/store.ts';
import type { Writes } from '../../data/writes.ts';
import { rank } from '../rank-write.ts';
import { serialWrite, serverSnapshot } from '../serial-write.ts';

/**
 * Schickt einen Plan: `rank` über `rank()`, `change` über `serialWrite`. `undefined`, wenn das
 * Issue weg ist (ein Patch hat es während des Ziehens gelöscht); dann geht nichts hinaus. Bei
 * `change` lehnt das Promise mit `ApiError` ab: Ob die Ablehnung in `writes.report` landet oder
 * einen Dialog öffnet (offene Sub-Issues, `force`), entscheidet der Aufrufer. Bei `rank` nie; das
 * Umsortieren meldet seine Fehler selbst, das Promise erfüllt sich sofort mit `undefined`. Die
 * Ablehnung eines `batch` kommt ohne das Zeilenpräfix von BK (`withoutBatchLine`): Den Batch hat
 * das Board geschrieben, nicht der Nutzer.
 */
export function sendBoardMove(
  store: Store,
  writes: Writes,
  id: string,
  plan: BoardPlan,
  extra?: StateExtra,
): Promise<unknown> | undefined {
  const known = store.issues.server(id);
  if (known === undefined) return undefined;
  if (plan.kind === 'rank') {
    rank(store, writes, id, plan.pos);
    return Promise.resolve(undefined);
  }
  const snapshot = store.toSnapshot();
  const optimistic = snapshot === undefined ? undefined : boardOverlay(snapshot, id, plan, extra);
  const sent = serialWrite(writes, {
    ...(optimistic === undefined ? {} : { optimistic }),
    plan: (replan) => {
      // Beim Senden gilt der Serverstand von dann, nie die Vorschau. Ist das Issue inzwischen
      // verschwunden, geht der Zug mit dem Stand von vorher hinaus und der Server meldet
      // `not_found`, wie bei jedem Write auf ein gelöschtes Issue.
      const server = store.issues.server(id) ?? known;
      const call = boardCall(server, plan, extra);
      // Wie `rankCall`: Ohne Snapshot bleibt die erste Vorschau stehen; lehnt BK die neue
      // Rechnung ab, fällt sie weg (eine leere Überlagerung).
      const s = replan ? serverSnapshot(store) : undefined;
      if (s === undefined) return { call };
      return { call, optimistic: boardOverlay(s, id, plan, extra) ?? new Map() };
    },
  });
  return sent.catch((cause: unknown) => {
    throw cause instanceof ApiError ? withoutBatchLine(cause) : cause;
  });
}

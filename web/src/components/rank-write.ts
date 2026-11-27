/** Umsortieren als Write ohne eigene Fehlerfläche: Kontextmenü, Ziehen und Tastatur im Tab Backlog. */
import { preview, rankOverlay } from '../app/optimistic.ts';
import { type RankMove, rankBatchOps, rankSteps } from '../app/rank-plan.ts';
import type { Store } from '../data/store.ts';
import type { PlannedCall, ToolCall, Writes } from '../data/writes.ts';
import { serialWrite, serverSnapshot } from './serial-write.ts';

export type { RankMove };

/**
 * Der Aufruf für `id` nach `pos`, gerechnet gegen den Serverstand: `issue_rank`, oder ein `batch`,
 * wenn Issues ohne Rang im Weg liegen (`rankSteps`). `from` ist so immer der Rang, den der Server
 * gerade hat. Mit `replan` kommt die Vorschau dazu, die zu genau diesem Aufruf gehört.
 */
function rankCall(store: Store, id: string, pos: RankMove, replan: boolean): PlannedCall {
  const s = serverSnapshot(store);
  const steps = s === undefined ? { pos, unranked: [] } : rankSteps(s, id, pos);
  const call: ToolCall =
    steps.unranked.length === 0
      ? { name: 'issue_rank', args: { id, ...steps.pos } }
      : { name: 'batch', args: { ops: rankBatchOps(id, store.issues.server(id)?.rank, steps) } };
  if (!replan || s === undefined) return { call };
  return {
    call,
    optimistic: preview(() => rankOverlay(s, id, steps.pos, steps.unranked)) ?? new Map(),
  };
}

/**
 * Sofort umsortiert über `rankOverlay`, Fehler landen in `writes.report` (die Überlagerung fällt
 * dann weg, die alte Reihenfolge steht wieder). Rank-Writes gehen über `serialWrite` nacheinander
 * hinaus, in derselben Schlange wie die Züge auf dem Board; ein wartender Zug rechnet Aufruf und
 * Vorschau beim Senden gegen den Serverstand neu. Ergibt, ob die erste Vorschau die Liste
 * umsortiert: Nur dann folgt ihr ein Render, an dem der Fokus der Zeile nachgehen kann.
 */
export function rank(store: Store, writes: Writes, id: string, pos: RankMove): boolean {
  const snapshot = store.toSnapshot();
  const steps = snapshot === undefined ? { pos, unranked: [] } : rankSteps(snapshot, id, pos);
  const optimistic =
    snapshot === undefined
      ? undefined
      : preview(() => rankOverlay(snapshot, id, steps.pos, steps.unranked));

  serialWrite(writes, {
    ...(optimistic === undefined ? {} : { optimistic }),
    plan: (replan) => rankCall(store, id, pos, replan),
  }).catch(writes.report);
  return optimistic !== undefined && optimistic.size > 0;
}

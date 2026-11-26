/** Umsortieren als Write ohne eigene Fehlerfläche: Kontextmenü, Ziehen und Tastatur im Tab Backlog. */
import { preview, rankOverlay } from '../app/optimistic.ts';
import { type RankMove, rankBatchOps, rankSteps } from '../app/rank-plan.ts';
import type { Store } from '../data/store.ts';
import type { Writes } from '../data/writes.ts';

export type { RankMove };

/**
 * Sofort umsortiert über `rankOverlay`, Fehler landen in `writes.report` (die Überlagerung fällt
 * dann weg, die alte Reihenfolge steht wieder). Liegen Issues ohne Rang im Weg (`rankSteps`), geht
 * statt `issue_rank` ein `batch`. Ergibt, ob eine Vorschau die Liste umsortiert: Nur dann folgt ihr
 * ein Render, an dem der Fokus der Zeile nachgehen kann.
 */
export function rank(store: Store, writes: Writes, id: string, pos: RankMove): boolean {
  const snapshot = store.toSnapshot();
  const steps = snapshot === undefined ? { pos, unranked: [] } : rankSteps(snapshot, id, pos);
  const optimistic =
    snapshot === undefined
      ? undefined
      : preview(() => rankOverlay(snapshot, id, steps.pos, steps.unranked));
  const opts = optimistic === undefined ? {} : { optimistic };
  const write =
    steps.unranked.length === 0
      ? writes.run('issue_rank', { id, ...steps.pos }, opts)
      : writes.run('batch', { ops: rankBatchOps(id, store.issues.server(id)?.rank, steps) }, opts);
  write.catch(writes.report);
  return optimistic !== undefined && optimistic.size > 0;
}

/** Umsortieren als Write ohne eigene Fehlerfläche: Kontextmenü, Ziehen und Tastatur im Tab Backlog. */
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';
import { preview, rankOverlay } from '../app/optimistic.ts';
import { type RankMove, rankBatchOps, rankSteps } from '../app/rank-plan.ts';
import type { Store } from '../data/store.ts';
import type { ToolCall, Writes } from '../data/writes.ts';

export type { RankMove };

/** Je `Writes` (also je Sitzung): wie viele Rank-Writes noch laufen und wann der letzte endet. */
const queues = new WeakMap<Writes, { open: number; tail: Promise<void> }>();

/** Der Snapshot mit den Werten des Servers, ohne Überlagerungen. */
function serverSnapshot(store: Store): BacklogSnapshot | undefined {
  const s = store.toSnapshot();
  if (s === undefined) return undefined;
  const issues: BacklogSnapshot['issues'] = new Map();
  for (const [key, entry] of s.issues) {
    const data = store.issues.server(key);
    if (data !== undefined) issues.set(key, { ...entry, data });
  }
  return { ...s, issues };
}

/**
 * Der Aufruf für `id` nach `pos`, gerechnet gegen den Serverstand: `issue_rank`, oder ein `batch`,
 * wenn Issues ohne Rang im Weg liegen (`rankSteps`). `from` ist so immer der Rang, den der Server
 * gerade hat.
 */
function rankCall(store: Store, id: string, pos: RankMove): ToolCall {
  const s = serverSnapshot(store);
  const steps = s === undefined ? { pos, unranked: [] } : rankSteps(s, id, pos);
  if (steps.unranked.length === 0) return { name: 'issue_rank', args: { id, ...steps.pos } };
  return {
    name: 'batch',
    args: { ops: rankBatchOps(id, store.issues.server(id)?.rank, steps) },
  };
}

/**
 * Sofort umsortiert über `rankOverlay`, Fehler landen in `writes.report` (die Überlagerung fällt
 * dann weg, die alte Reihenfolge steht wieder). Rank-Writes einer Sitzung gehen nacheinander
 * hinaus: Ein Zug wartet, bis der vorige beendet ist (sein Patch ist da, oder er scheiterte), und
 * rechnet erst dann gegen den Serverstand. Sonst trüge ein schneller zweiter Zug das `from` von
 * vor dem ersten, und der Server lehnte ihn ab. Die Vorschau steht trotzdem sofort. Ergibt, ob sie
 * die Liste umsortiert: Nur dann folgt ihr ein Render, an dem der Fokus der Zeile nachgehen kann.
 */
export function rank(store: Store, writes: Writes, id: string, pos: RankMove): boolean {
  const snapshot = store.toSnapshot();
  const steps = snapshot === undefined ? { pos, unranked: [] } : rankSteps(snapshot, id, pos);
  const optimistic =
    snapshot === undefined
      ? undefined
      : preview(() => rankOverlay(snapshot, id, steps.pos, steps.unranked));

  const queue = queues.get(writes) ?? { open: 0, tail: Promise.resolve() };
  queues.set(writes, queue);
  const after = queue.open > 0 ? queue.tail : undefined;
  let done!: () => void;
  queue.tail = new Promise<void>((resolve) => {
    done = resolve;
  });
  queue.open += 1;
  const onSettle = () => {
    queue.open -= 1;
    done();
  };
  writes
    .runCall(() => rankCall(store, id, pos), {
      ...(optimistic === undefined ? {} : { optimistic }),
      ...(after === undefined ? {} : { after }),
      onSettle,
    })
    .catch(writes.report);
  return optimistic !== undefined && optimistic.size > 0;
}

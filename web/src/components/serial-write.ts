/**
 * Die serielle Warteschlange je Sitzung, für Umsortieren im Tab Backlog und Züge auf dem Board:
 * Ein Zug wartet, bis der vorige beendet ist (sein Patch ist da, oder er scheiterte), und rechnet
 * erst dann gegen den Serverstand. Sonst trüge ein schneller zweiter Zug das `from` von vor dem
 * ersten, und der Server lehnte ihn ab. Rang und Zustand teilen sich die Schlange, weil ein
 * Board-Zug und ein Umsortieren dasselbe Issue treffen können.
 */
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';
import type { IssueJson } from '@backe/ui/api.ts';
import type { Store } from '../data/store.ts';
import type { PlannedCall, Writes } from '../data/writes.ts';

/** Je `Writes` (also je Sitzung): wie viele Züge noch laufen und wann der letzte endet. */
const queues = new WeakMap<Writes, { open: number; tail: Promise<void> }>();

/** Der Snapshot mit den Werten des Servers, ohne Überlagerungen. */
export function serverSnapshot(store: Store): BacklogSnapshot | undefined {
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
 * Wartet auf den vorigen Zug derselben Sitzung; `plan(replan)` rechnet beim Senden, mit `replan`
 * samt neuer Vorschau. Die Vorschau `optimistic` steht trotzdem sofort; ein wartender Zug rechnet
 * sie beim Senden neu, sodass sie zeigt, was hinausgeht (auch wenn der vorige scheiterte). Ohne
 * offenen Vorgänger wird sofort gerechnet und gesendet, ohne Neuplanung.
 */
export function serialWrite(
  writes: Writes,
  opts: {
    optimistic?: ReadonlyMap<string, Partial<IssueJson>>;
    plan: (replan: boolean) => PlannedCall;
  },
): Promise<unknown> {
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
  return writes.runCall(() => opts.plan(after !== undefined), {
    ...(opts.optimistic === undefined ? {} : { optimistic: opts.optimistic }),
    ...(after === undefined ? {} : { after }),
    onSettle,
  });
}

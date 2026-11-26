/** `issue_rank` als Write ohne eigene Fehlerfläche: Kontextmenü, Ziehen und Tastatur im Tab Backlog. */
import { preview, rankOverlay } from '../app/optimistic.ts';
import type { Store } from '../data/store.ts';
import type { Writes } from '../data/writes.ts';

export type RankMove = { top: true } | { bottom: true } | { before: string } | { after: string };

/**
 * Sofort umsortiert über `rankOverlay`, Fehler landen in `writes.report` (die Überlagerung fällt
 * dann weg, die alte Reihenfolge steht wieder). Ergibt, ob eine Vorschau die Liste umsortiert: Nur
 * dann folgt ihr ein Render, an dem der Fokus der Zeile nachgehen kann.
 */
export function rank(store: Store, writes: Writes, id: string, pos: RankMove): boolean {
  const snapshot = store.toSnapshot();
  const optimistic =
    snapshot === undefined ? undefined : preview(() => rankOverlay(snapshot, id, pos));
  writes
    .run('issue_rank', { id, ...pos }, optimistic === undefined ? {} : { optimistic })
    .catch(writes.report);
  return optimistic !== undefined && optimistic.size > 0;
}

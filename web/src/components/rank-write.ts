/** `issue_rank` als Write ohne eigene Fehlerfläche: Kontextmenü, Ziehen und Tastatur im Tab Backlog. */
import { BackeError } from '@backe/core/errors.ts';
import { rankOverlay } from '../app/optimistic.ts';
import type { Store } from '../data/store.ts';
import type { Writes } from '../data/writes.ts';

export type RankMove = { top: true } | { bottom: true } | { before: string } | { after: string };

/**
 * Sofort umsortiert über `rankOverlay`; Fehler landen in `writes.report`. Lehnt die Rechnung die
 * Position ab (`BackeError`, etwa ein Anker, den der Store nicht mehr kennt), läuft der Write ohne
 * Vorschau und der Server entscheidet allein. Jeder andere Wurf ist ein Fehler im Client.
 */
export function rank(store: Store, writes: Writes, id: string, pos: RankMove): void {
  const snapshot = store.toSnapshot();
  let optimistic: ReturnType<typeof rankOverlay> | undefined;
  try {
    optimistic = snapshot === undefined ? undefined : rankOverlay(snapshot, id, pos);
  } catch (cause) {
    if (!(cause instanceof BackeError)) throw cause;
  }
  writes
    .run('issue_rank', { id, ...pos }, optimistic === undefined ? {} : { optimistic })
    .catch(writes.report);
}

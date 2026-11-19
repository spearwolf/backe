/**
 * `rank`-Arithmetik (backe.md §2.22): ein Issue an eine Stelle der Rangfolge setzen und dabei nur
 * so viele Nachbarn neu nummerieren, wie nötig sind.
 */
import { BackeError } from '../core/errors.ts';
import type { Issue } from '../core/schemas.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { compareIssues } from './order.ts';

export const RANK_STEP = 1000;

export type RankPosition =
  | { top: true }
  | { bottom: true }
  | { before: string }
  | { after: string }
  | { value: number };

type Slot = { id: string; rank: number };

/** Anker auflösen: er muss existieren, ein anderes Issue sein und einen `rank` tragen. */
function anchorIndex(s: BacklogSnapshot, id: string, anchor: string, list: Slot[]): number {
  if (anchor === id) {
    throw new BackeError('validation', `Anker ${anchor} ist das Issue selbst`);
  }
  if (!s.issues.has(anchor)) {
    const broken = s.problems.find((p) => p.kind === 'issue' && p.key === anchor);
    if (broken !== undefined) {
      throw new BackeError('validation', `Anker ${anchor} ist nicht lesbar: ${broken.message}`);
    }
    throw new BackeError('not_found', `Issue ${anchor} nicht gefunden`);
  }
  const index = list.findIndex((slot) => slot.id === anchor);
  if (index < 0) {
    throw new BackeError('validation', `Anker ${anchor} hat keinen rank`, {
      hint: `backe issue rank ${anchor} --bottom`,
    });
  }
  return index;
}

/** Zielindex der Einfügestelle in der Liste ohne `id`. */
function targetIndex(s: BacklogSnapshot, id: string, pos: RankPosition, list: Slot[]): number {
  if ('top' in pos) return 0;
  if ('bottom' in pos) return list.length;
  if ('before' in pos) return anchorIndex(s, id, pos.before, list);
  if ('after' in pos) return anchorIndex(s, id, pos.after, list) + 1;
  throw new BackeError('unexpected', 'Unbekannte Rang-Position');
}

/**
 * Neue Ranks aller Issues, deren Rank sich ändert (inklusive `id`); leer, wenn sich nichts ändert.
 * `value` setzt direkt und fasst keine Nachbarn an. Alle anderen Positionen suchen ein Fenster um
 * die Einfügestelle, das zwischen seinen beiden Nachbarn genug ganze Zahlen frei hat, und
 * verteilt die Fensterelemente gleichmäßig darin.
 */
export function rankPlacement(
  s: BacklogSnapshot,
  id: string,
  pos: RankPosition,
): Map<string, number> {
  const self = s.issues.get(id)?.data;
  if (!self) throw new BackeError('not_found', `Issue ${id} nicht gefunden`);

  if ('value' in pos) {
    if (!Number.isInteger(pos.value)) {
      throw new BackeError('validation', `rank muss eine Ganzzahl sein, nicht ${pos.value}`);
    }
    return self.rank === pos.value ? new Map() : new Map([[id, pos.value]]);
  }

  const ordered: Issue[] = [...s.issues.values()]
    .map((e) => e.data)
    .filter((i) => i.id !== id && i.rank !== undefined)
    .sort(compareIssues);
  const list: Slot[] = ordered.map((i) => ({ id: i.id, rank: i.rank as number }));
  const k = targetIndex(s, id, pos, list);

  const m: Slot[] = [...list.slice(0, k), { id, rank: 0 }, ...list.slice(k)];
  let a = k;
  let b = k;
  for (;;) {
    const lo = a > 0 ? (m[a - 1] as Slot).rank : Number.NEGATIVE_INFINITY;
    const hi = b < m.length - 1 ? (m[b + 1] as Slot).rank : Number.POSITIVE_INFINITY;
    const n = b - a + 1;
    const set = (value: (i: number) => number) => {
      for (let i = 0; i < n; i++) (m[a + i] as Slot).rank = value(i);
    };
    if (lo === Number.NEGATIVE_INFINITY && hi === Number.POSITIVE_INFINITY) {
      set((i) => RANK_STEP * (i + 1));
    } else if (lo === Number.NEGATIVE_INFINITY) {
      set((i) => hi - RANK_STEP * (n - i));
    } else if (hi === Number.POSITIVE_INFINITY) {
      set((i) => lo + RANK_STEP * (i + 1));
    } else if (hi - lo - 1 >= n) {
      const step = Math.floor((hi - lo) / (n + 1));
      set((i) => lo + step * (i + 1));
    } else {
      a = Math.max(a - 1, 0);
      b = Math.min(b + 1, m.length - 1);
      continue;
    }
    break;
  }

  const result = new Map<string, number>();
  for (const slot of m) {
    if (s.issues.get(slot.id)?.data.rank !== slot.rank) result.set(slot.id, slot.rank);
  }
  return result;
}

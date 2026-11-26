/**
 * Umsortieren im Tab Backlog (ui.md §2.7): wohin `issue_rank` eine Zeile beim Ablegen oder per
 * `Alt+↑`/`Alt+↓` setzt. Rein; Ereignisse und Writes liegen in `IssueList`.
 *
 * Der Rang ist global, der Baum ordnet aber je Ebene: Wurzeln nach Rang, darunter die Kinder nach
 * Rang (`treeOrder` in `src/ops/issue-query.ts`). Ein Anker außerhalb der eigenen Geschwister
 * ändert darum oft nichts Sichtbares. Bewegt wird deshalb nur unter Geschwistern: gleiche Tiefe,
 * gleicher angezeigter Parent. In der flachen Ansicht (alle Tiefe 0) ist jede Zeile Geschwister.
 */
import type { ListRow } from '../app/backlog-list.ts';

/** Typ der Drag-Daten: die ID des gezogenen Issues. Fremde Drags (Text, Dateien) bleiben außen vor. */
export const DRAG_TYPE = 'application/x-backe-issue';

export type DropPosition = { before: string } | { after: string };
export type DropMarker = { id: string; side: 'before' | 'after' };

/** Ausblendende Zeilen zählen nicht: Ihr Issue ist schon weg und taugt nicht als Anker. */
const present = (rows: readonly ListRow[]) => rows.filter((r) => r.live !== 'leaving');

/** Das nächste Geschwister in Richtung `step`, über Teilbäume hinweg; am Rand der Gruppe -1. */
function sibling(rows: readonly ListRow[], i: number, step: 1 | -1): number {
  const depth = (rows[i] as ListRow).depth;
  for (let j = i + step; j >= 0 && j < rows.length; j += step) {
    const d = (rows[j] as ListRow).depth;
    if (d === depth) return j;
    if (d < depth) return -1;
  }
  return -1;
}

/** Index des angezeigten Parents; -1 für Wurzeln. */
function parentIndex(rows: readonly ListRow[], i: number): number {
  const depth = (rows[i] as ListRow).depth;
  for (let j = i - 1; j >= 0; j--) if ((rows[j] as ListRow).depth < depth) return j;
  return -1;
}

/** Letzte Zeile des Teilbaums unter `i` (oder `i` selbst). */
function subtreeEnd(rows: readonly ListRow[], i: number): number {
  const depth = (rows[i] as ListRow).depth;
  let j = i;
  while (j + 1 < rows.length && (rows[j + 1] as ListRow).depth > depth) j++;
  return j;
}

/** Rank-Position für das Ablegen von `id` auf `target`; obere Hälfte → before, untere → after; auf sich selbst → undefined. */
export function dropPosition(
  id: string,
  target: string,
  offsetY: number,
  height: number,
): DropPosition | undefined {
  if (id === target) return undefined;
  return offsetY < height / 2 ? { before: target } : { after: target };
}

/**
 * Ablegen von `id` auf `target` in der angezeigten Liste: Position für `issue_rank` und die Stelle
 * der Markierung. Undefined, wenn das Ziel kein Geschwister ist oder die Reihenfolge bliebe. Hinter
 * einer Zeile mit Teilbaum landet das Issue hinter dem ganzen Teilbaum; dort steht die Markierung.
 * `{ after: target }` reicht dafür: `rankPlacement` setzt das Issue global direkt hinter `target`,
 * und die Geschwister sind eine Teilfolge der globalen Ordnung. Unter ihnen folgt es also auf
 * `target`, gleich ob global Kinder oder ausgefilterte Issues dazwischen liegen. Eine Zeile im
 * Teilbaum eines Geschwisters meint dieses Geschwister, abgelegt dahinter: Zwischen dessen Kinder
 * kann `id` nicht, und so hat jede Zeile unter dem Zeiger ein Ziel.
 */
export function dropTarget(
  rows: readonly ListRow[],
  id: string,
  target: string,
  offsetY: number,
  height: number,
): { pos: DropPosition; marker: DropMarker } | undefined {
  const pos = dropPosition(id, target, offsetY, height);
  if (pos === undefined) return undefined;
  const list = present(rows);
  const i = list.findIndex((r) => r.issue.id === id);
  let t = list.findIndex((r) => r.issue.id === target);
  if (i < 0 || t < 0) return undefined;
  const depth = (list[i] as ListRow).depth;
  if ((list[t] as ListRow).depth > depth) {
    while (t >= 0 && (list[t] as ListRow).depth > depth) t = parentIndex(list, t);
    if (t < 0 || t === i) return undefined;
    return after(list, i, t);
  }
  if ((list[t] as ListRow).depth !== depth) return undefined;
  if (parentIndex(list, i) !== parentIndex(list, t)) return undefined;
  if ('before' in pos) {
    if (sibling(list, i, 1) === t) return undefined;
    return { pos, marker: { id: target, side: 'before' } };
  }
  return after(list, i, t);
}

/** Hinter das Geschwister `t` samt Teilbaum; undefined, wenn `i` schon direkt dahinter steht. */
function after(
  list: readonly ListRow[],
  i: number,
  t: number,
): { pos: DropPosition; marker: DropMarker } | undefined {
  if (parentIndex(list, i) !== parentIndex(list, t)) return undefined;
  if (sibling(list, i, -1) === t) return undefined;
  const end = list[subtreeEnd(list, t)] as ListRow;
  return {
    pos: { after: (list[t] as ListRow).issue.id },
    marker: { id: end.issue.id, side: 'after' },
  };
}

/** Alt+↑/↓: vor das vorige bzw. hinter das nächste Geschwister; am Rand der Gruppe undefined. */
export function keyboardPosition(
  rows: readonly ListRow[],
  id: string,
  key: 'ArrowUp' | 'ArrowDown',
): DropPosition | undefined {
  const list = present(rows);
  const i = list.findIndex((r) => r.issue.id === id);
  if (i < 0) return undefined;
  const j = sibling(list, i, key === 'ArrowUp' ? -1 : 1);
  if (j < 0) return undefined;
  const anchor = (list[j] as ListRow).issue.id;
  return key === 'ArrowUp' ? { before: anchor } : { after: anchor };
}

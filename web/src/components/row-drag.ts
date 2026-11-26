/**
 * Umsortieren im Tab Backlog (ui.md §2.7): wohin `issue_rank` eine Zeile beim Ablegen oder per
 * `Alt+↑`/`Alt+↓` setzt. Rein; Ereignisse und Writes liegen in `IssueList`.
 */
import type { ListRow } from '../app/backlog-list.ts';

/** Typ der Drag-Daten: die ID des gezogenen Issues. Fremde Drags (Text, Dateien) bleiben außen vor. */
export const DRAG_TYPE = 'application/x-backe-issue';

export type DropPosition = { before: string } | { after: string };

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
 * Alt+↑/↓: vor die vorige bzw. hinter die nächste Zeile der Liste; am Rand undefined. Ausblendende
 * Zeilen zählen nicht: Ihr Issue ist schon weg und taugt nicht als Anker.
 */
export function keyboardPosition(
  rows: readonly ListRow[],
  id: string,
  key: 'ArrowUp' | 'ArrowDown',
): DropPosition | undefined {
  const ids = rows.filter((r) => r.live !== 'leaving').map((r) => r.issue.id);
  const i = ids.indexOf(id);
  if (i < 0) return undefined;
  if (key === 'ArrowUp') {
    const prev = ids[i - 1];
    return prev === undefined ? undefined : { before: prev };
  }
  const next = ids[i + 1];
  return next === undefined ? undefined : { after: next };
}

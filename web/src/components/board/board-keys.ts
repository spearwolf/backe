/** Die Tastatur als Alternative zum Ziehen (ui.md §2.13), rein: aus Taste und Karte ein Ablegen. */
import type { State } from '@backe/core/state.ts';
import type { BoardLane } from '../../app/board-model.ts';
import type { BoardDrop } from '../../app/board-move.ts';
import { type CardData, cardsIn } from './board-dnd.ts';

export type BoardKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
export const BOARD_KEYS: readonly BoardKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

/**
 * Alt+↑/↓: Rang in der Zelle; Alt+←/→: Nachbarspalte derselben Bahn. Die Bahn wechselt die
 * Tastatur nicht — dafür gibt es das Kartenmenü. Am Rand und für eine Karte, die das Modell nicht
 * (mehr) in dieser Zelle kennt, `undefined`.
 */
export function keyDrop(
  lanes: readonly BoardLane[],
  card: CardData,
  key: BoardKey,
  columns: readonly State[],
): BoardDrop | undefined {
  const cards = cardsIn(lanes, card.lane, card.column);
  const at = cards.indexOf(card.id);
  if (at < 0) return undefined;
  const from = { lane: card.lane, column: card.column };
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const anchor =
      key === 'ArrowUp'
        ? at > 0
          ? { before: cards[at - 1] as string }
          : undefined
        : at < cards.length - 1
          ? { after: cards[at + 1] as string }
          : undefined;
    return anchor === undefined ? undefined : { id: card.id, from, to: from, anchor };
  }
  const column = columns.indexOf(card.column);
  const next = column < 0 ? undefined : columns[column + (key === 'ArrowLeft' ? -1 : 1)];
  if (next === undefined) return undefined;
  return { id: card.id, from, to: { lane: card.lane, column: next } };
}

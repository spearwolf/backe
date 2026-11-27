/**
 * Ziehen auf dem Board (ui.md §2.8), rein: welches Ziel unter dem Zeiger gilt und welches Ablegen
 * aus einem Ereignis von dnd-kit folgt. Der Rest (Plan, Write, Fehler) liegt in `use-board-move`.
 */
import type { State } from '@backe/core/state.ts';
import {
  type Active,
  type CollisionDetection,
  type Over,
  pointerWithin,
  rectIntersection,
} from '@dnd-kit/core';
import type { BoardLane } from '../../app/board-model.ts';
import { anchorIn, type BoardDrop } from '../../app/board-move.ts';

/** Daten der gezogenen Karte; `lane`/`column` sind die Zelle, in der sie steht. */
export type CardData = { type: 'card'; id: string; lane: string; column: State };
/**
 * Daten einer Zelle, des einzigen Ziels beim Ziehen. `list` ist ihr `<ul>`: Die Einfügestelle in
 * derselben Zelle kommt aus den Rechtecken seiner Karten zur Zeit des Ereignisses.
 */
export type CellData = {
  type: 'cell';
  lane: string;
  column: State;
  list?: { readonly current: HTMLUListElement | null };
};

const dataOf = (value: unknown): CardData | CellData | undefined => {
  const type = (value as { type?: unknown } | null | undefined)?.type;
  return type === 'card' || type === 'cell' ? (value as CardData | CellData) : undefined;
};

/**
 * Die Zelle unter dem Zeiger; liegt er über keiner (zwischen den Spalten, über dem Kopf), die mit
 * der größten Überdeckung der gezogenen Kopie, damit ein Ablegen knapp daneben nicht ins Leere geht.
 * Zellen überlappen sich nicht, unter dem Zeiger liegt also höchstens eine.
 */
export const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/**
 * Die Einfügestelle: Index der ersten Karte, deren Mitte unterhalb von `y` liegt; `count`, wenn
 * keine. Die Karten stehen untereinander, ihre Mitten steigen also; die binäre Suche misst über
 * `rectAt` nur O(log count) Karten — beim Ziehen über einer Zelle mit Tausenden zählt das.
 */
export function slotAt(
  y: number,
  count: number,
  rectAt: (i: number) => { top: number; height: number },
): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const r = rectAt(mid);
    if (r.top + r.height / 2 > y) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** IDs der Karten einer Zelle in ihrer Reihenfolge; leer, wenn das Modell die Zelle nicht kennt. */
export const cardsIn = (lanes: readonly BoardLane[], lane: string, column: State): string[] =>
  lanes
    .find((l) => l.key === lane)
    ?.cells.find((c) => c.column === column)
    ?.cards.map((c) => c.issue.id) ?? [];

/**
 * Das Ablegen der Karte `active` in der Zelle `over`; `undefined` ohne Änderung. In derselben Zelle
 * landet die Karte vor der mit der ID `slotId`, ohne sie am Ende. Kennt das Modell `slotId` nicht
 * (ein Patch nahm die Karte heraus, das DOM zeigt sie noch), gibt es keinen Anker und keinen Zug.
 * In einer anderen Zelle ändert sich kein Rang (ui.md §2.8).
 */
export function dropOf(
  active: CardData,
  over: CellData,
  slotId: string | undefined,
  lanes: readonly BoardLane[],
): BoardDrop | undefined {
  const from = { lane: active.lane, column: active.column };
  const to = { lane: over.lane, column: over.column };
  if (from.lane !== to.lane || from.column !== to.column) return { id: active.id, from, to };
  const cards = cardsIn(lanes, from.lane, from.column);
  const anchor = anchorIn(
    cards,
    active.id,
    slotId === undefined ? 'end' : { card: slotId, side: 'before' },
  );
  return anchor === undefined ? undefined : { id: active.id, from, to, anchor };
}

/**
 * Das Ablegen aus einem Ereignis von dnd-kit (`onDragEnd`, für die Markierung auch `onDragOver` und
 * `onDragMove`). In derselben Zelle zählt die Mitte der Kopie unter dem Zeiger (`translated`, vor
 * dem ersten Messen die Ausgangslage) gegen die Karten der Zelle, wie sie jetzt stehen — auch, wenn
 * das Board seit dem Start gescrollt hat. Ohne Liste oder Kopie bleibt das Ende.
 */
export function dropFrom(
  event: { active: Pick<Active, 'data' | 'rect'>; over: Pick<Over, 'data'> | null },
  lanes: readonly BoardLane[],
): BoardDrop | undefined {
  const dragged = dataOf(event.active.data.current);
  const target = dataOf(event.over?.data.current);
  if (dragged?.type !== 'card' || target?.type !== 'cell') return undefined;
  if (dragged.lane !== target.lane || dragged.column !== target.column) {
    return dropOf(dragged, target, undefined, lanes);
  }
  const box = event.active.rect.current.translated ?? event.active.rect.current.initial;
  const list = target.list?.current;
  if (box === null || list === null || list === undefined) {
    return dropOf(dragged, target, undefined, lanes);
  }
  const cards = list.children;
  const slot = slotAt(box.top + box.height / 2, cards.length, (i) =>
    (cards[i] as Element).getBoundingClientRect(),
  );
  const slotId = (cards[slot] as HTMLElement | undefined)?.dataset.card;
  return dropOf(dragged, target, slotId, lanes);
}

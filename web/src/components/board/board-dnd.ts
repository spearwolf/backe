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

/** Daten an Karte (gezogen und Ziel) und Zelle; `lane`/`column` sind die Zelle, in der sie steht. */
export type CardData = { type: 'card'; id: string; lane: string; column: State };
export type CellData = { type: 'cell'; lane: string; column: State };

const dataOf = (value: unknown): CardData | CellData | undefined => {
  const type = (value as { type?: unknown } | null | undefined)?.type;
  return type === 'card' || type === 'cell' ? (value as CardData | CellData) : undefined;
};

/**
 * Karten vor Zellen unter dem Zeiger; sonst `rectIntersection`. Die Zelle umschließt ihre Karten,
 * und `pointerWithin` sortiert nach dem Abstand zu den Ecken — da gewönne mal die eine, mal die
 * andere. Liegt der Zeiger über nichts (zwischen den Spalten, über dem Kopf), hilft die
 * Überdeckung der gezogenen Kopie, damit ein Ablegen knapp daneben nicht ins Leere geht.
 */
export const boardCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length === 0) return rectIntersection(args);
  const typeOf = (id: unknown) =>
    dataOf(args.droppableContainers.find((c) => c.id === id)?.data.current)?.type;
  const cards = hits.filter((hit) => typeOf(hit.id) === 'card');
  return cards.length > 0 ? cards : hits;
};

/** Ober- oder Unterhälfte der Zielkarte nach der Mitte der gezogenen. */
export function sideOf(
  activeCenterY: number,
  overTop: number,
  overHeight: number,
): 'before' | 'after' {
  return activeCenterY < overTop + overHeight / 2 ? 'before' : 'after';
}

/** IDs der Karten einer Zelle in ihrer Reihenfolge; leer, wenn das Modell die Zelle nicht kennt. */
export const cardsIn = (lanes: readonly BoardLane[], lane: string, column: State): string[] =>
  lanes
    .find((l) => l.key === lane)
    ?.cells.find((c) => c.column === column)
    ?.cards.map((c) => c.issue.id) ?? [];

/**
 * Das Ablegen aus `active`/`over` samt Seite; `undefined` ohne Ziel oder ohne Änderung. In derselben
 * Zelle zählt die Karte unter dem Zeiger (vor/hinter sie) oder die Zelle (ans Ende); in einer
 * anderen Zelle ändert sich kein Rang, auch nicht über einer Karte darin.
 */
export function dropOf(
  active: CardData,
  over: CardData | CellData,
  side: 'before' | 'after',
  lanes: readonly BoardLane[],
): BoardDrop | undefined {
  const from = { lane: active.lane, column: active.column };
  const to = { lane: over.lane, column: over.column };
  if (from.lane !== to.lane || from.column !== to.column) return { id: active.id, from, to };
  const cards = cardsIn(lanes, from.lane, from.column);
  const anchor = anchorIn(cards, active.id, over.type === 'card' ? { card: over.id, side } : 'end');
  return anchor === undefined ? undefined : { id: active.id, from, to, anchor };
}

/**
 * Das Ablegen aus einem Ereignis von dnd-kit (`onDragEnd`, für die Markierung auch `onDragOver`).
 * Die Seite kommt aus der Mitte der Kopie unter dem Zeiger (`translated`), vor dem ersten Messen
 * aus der Ausgangslage.
 */
export function dropFrom(
  event: { active: Pick<Active, 'data' | 'rect'>; over: Pick<Over, 'data' | 'rect'> | null },
  lanes: readonly BoardLane[],
): BoardDrop | undefined {
  const { active, over } = event;
  const dragged = dataOf(active.data.current);
  const target = dataOf(over?.data.current);
  if (over === null || dragged?.type !== 'card' || target === undefined) return undefined;
  const box = active.rect.current.translated ?? active.rect.current.initial;
  const side =
    box === null ? 'after' : sideOf(box.top + box.height / 2, over.rect.top, over.rect.height);
  return dropOf(dragged, target, side, lanes);
}

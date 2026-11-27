import type { State } from '@backe/core/state.ts';
import type { ClientRect, DroppableContainer } from '@dnd-kit/core';
import type { BoardLane } from '../../app/board-model.ts';
import { newCard } from '../../app/board-model.ts';
import { testIssue, tid } from '../../test/state.ts';
import {
  boardCollision,
  type CardData,
  type CellData,
  dropFrom,
  dropOf,
  ownListeners,
  sideOf,
} from './board-dnd.ts';

const rect = (top: number, height: number, left = 0, width = 100): ClientRect => ({
  top,
  left,
  width,
  height,
  bottom: top + height,
  right: left + width,
});

const container = (id: string, data: CardData | CellData): DroppableContainer => ({
  id,
  key: id,
  data: { current: data },
  disabled: false,
  node: { current: null },
  rect: { current: null },
});

/** Bahn `s1` mit 1, 2, 3 in `todo` und 4 in `in_progress`, Bahn `s2` leer. */
const lanes: BoardLane[] = [
  {
    key: 's1',
    label: 'Sprint 1',
    closed: false,
    count: 4,
    cells: [
      { column: 'todo', cards: [1, 2, 3].map((n) => newCard(testIssue(n), false)) },
      { column: 'in_progress', cards: [newCard(testIssue(4, { state: 'in_progress' }), false)] },
    ],
  },
  {
    key: 's2',
    label: 'Sprint 2',
    closed: false,
    count: 0,
    cells: [
      { column: 'todo', cards: [] },
      { column: 'in_progress', cards: [] },
    ],
  },
];

const card = (n: number, lane = 's1', column: State = 'todo'): CardData => ({
  type: 'card',
  id: tid(n),
  lane,
  column,
});
const cell = (lane: string, column: State): CellData => ({ type: 'cell', lane, column });

test('cards win over cells under the pointer', () => {
  const cellBox = container('cell:s1:todo', cell('s1', 'todo'));
  const cardBox = container(`card:s1:${tid(2)}`, card(2));
  const droppableRects = new Map([
    [cellBox.id, rect(0, 400)],
    [cardBox.id, rect(100, 40)],
  ]);
  const args = {
    active: { id: `drag:s1:${tid(1)}`, data: { current: card(1) }, rect: { current: {} } },
    collisionRect: rect(110, 40),
    droppableRects,
    droppableContainers: [cellBox, cardBox],
  } as unknown as Parameters<typeof boardCollision>[0];
  // Der Zeiger über der Karte: nur sie, obwohl die Zelle sie umschließt.
  expect(
    boardCollision({ ...args, pointerCoordinates: { x: 50, y: 120 } }).map((c) => c.id),
  ).toEqual([cardBox.id]);
  // Zwischen den Karten bleibt die Zelle.
  expect(
    boardCollision({ ...args, pointerCoordinates: { x: 50, y: 300 } }).map((c) => c.id),
  ).toEqual([cellBox.id]);
  // Ohne Zeiger (oder außerhalb von allem) entscheidet die Überdeckung der gezogenen Fläche.
  expect(boardCollision({ ...args, pointerCoordinates: null }).map((c) => c.id)).toContain(
    cardBox.id,
  );
  expect(
    boardCollision({ ...args, pointerCoordinates: { x: 500, y: 500 } }).length,
  ).toBeGreaterThan(0);
});

test('side by the centre', () => {
  expect(sideOf(10, 0, 40)).toBe('before');
  expect(sideOf(30, 0, 40)).toBe('after');
  expect(sideOf(119, 100, 40)).toBe('before');
  expect(sideOf(120, 100, 40)).toBe('after');
});

test('drop on a card of the same cell anchors, on another cell changes it', () => {
  // Hinter die 2: Die 1 rückt zwischen 2 und 3.
  expect(dropOf(card(1), card(2), 'after', lanes)).toEqual({
    id: tid(1),
    from: { lane: 's1', column: 'todo' },
    to: { lane: 's1', column: 'todo' },
    anchor: { after: tid(2) },
  });
  expect(dropOf(card(3), card(1), 'before', lanes)?.anchor).toEqual({ before: tid(1) });
  // Auf die Zelle selbst: ans Ende.
  expect(dropOf(card(1), cell('s1', 'todo'), 'after', lanes)?.anchor).toEqual({ after: tid(3) });
  // Eine andere Zelle: Spalte, Bahn oder beides; die Karte darin setzt keinen Rang.
  expect(dropOf(card(1), card(4, 's1', 'in_progress'), 'before', lanes)).toEqual({
    id: tid(1),
    from: { lane: 's1', column: 'todo' },
    to: { lane: 's1', column: 'in_progress' },
  });
  expect(dropOf(card(1), cell('s2', 'in_progress'), 'after', lanes)).toEqual({
    id: tid(1),
    from: { lane: 's1', column: 'todo' },
    to: { lane: 's2', column: 'in_progress' },
  });
});

test('dropping a card on itself is no move', () => {
  expect(dropOf(card(2), card(2), 'before', lanes)).toBeUndefined();
  // Vor die nächste oder hinter die vorige Karte: derselbe Platz.
  expect(dropOf(card(2), card(3), 'before', lanes)).toBeUndefined();
  expect(dropOf(card(2), card(1), 'after', lanes)).toBeUndefined();
  // Die letzte Karte auf ihre eigene Zelle.
  expect(dropOf(card(3), cell('s1', 'todo'), 'after', lanes)).toBeUndefined();
});

test('the drop from the drag event takes the side from the dragged centre', () => {
  const active = (top: number | undefined) => ({
    data: { current: card(1) },
    rect: {
      current: { initial: rect(0, 40), translated: top === undefined ? null : rect(top, 40) },
    },
  });
  const over = { data: { current: card(3) }, rect: rect(100, 40) };
  // Mitte bei 110 (obere Hälfte von 100–140) → vor die 3; bei 130 → dahinter.
  expect(dropFrom({ active: active(90), over }, lanes)?.anchor).toEqual({ before: tid(3) });
  expect(dropFrom({ active: active(110), over }, lanes)?.anchor).toEqual({ after: tid(3) });
  // Ohne Ziel oder ohne Kartendaten kein Zug.
  expect(dropFrom({ active: active(110), over: null }, lanes)).toBeUndefined();
  expect(
    dropFrom({ active: { ...active(110), data: { current: undefined } }, over }, lanes),
  ).toBeUndefined();
  expect(
    dropFrom({ active: active(110), over: { ...over, data: { current: { other: 1 } } } }, lanes),
  ).toBeUndefined();
});

test('drag listeners ignore events from portals', () => {
  const seen: unknown[] = [];
  const own = ownListeners({ onPointerDown: (e: { target: unknown }) => seen.push(e.target) });
  const inside = {};
  const node = { contains: (n: unknown) => n === inside };
  own.onPointerDown?.({ currentTarget: node, target: inside });
  // Im React-Baum unter der Karte, im DOM aber woanders (Portal): kein Ziehen.
  own.onPointerDown?.({ currentTarget: node, target: {} });
  expect(seen).toEqual([inside]);
  expect(ownListeners(undefined)).toEqual({});
});

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
  slotAt,
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

test('only cells are targets: under the pointer, else the overlap', () => {
  const todo = container('cell:s1:todo', cell('s1', 'todo'));
  const doing = container('cell:s1:in_progress', cell('s1', 'in_progress'));
  const droppableRects = new Map([
    [todo.id, rect(0, 400, 0, 100)],
    [doing.id, rect(0, 400, 120, 100)],
  ]);
  const args = {
    active: { id: 'board-card', data: { current: card(1) }, rect: { current: {} } },
    collisionRect: rect(10, 40, 90, 100),
    droppableRects,
    droppableContainers: [todo, doing],
  } as unknown as Parameters<typeof boardCollision>[0];
  expect(
    boardCollision({ ...args, pointerCoordinates: { x: 150, y: 20 } }).map((c) => c.id),
  ).toEqual([doing.id]);
  // Zwischen den Spalten entscheidet die Überdeckung der gezogenen Kopie: mehr in `in_progress`.
  expect(boardCollision({ ...args, pointerCoordinates: { x: 110, y: 20 } })[0]?.id).toBe(doing.id);
  expect(boardCollision({ ...args, pointerCoordinates: null })[0]?.id).toBe(doing.id);
});

test('slotAt finds the first card below the centre', () => {
  const rects = [
    { top: 0, height: 40 },
    { top: 50, height: 40 },
    { top: 100, height: 40 },
  ];
  const at = (i: number) => rects[i] as { top: number; height: number };
  expect(slotAt(10, 3, at)).toBe(0);
  expect(slotAt(30, 3, at)).toBe(1);
  expect(slotAt(95, 3, at)).toBe(2);
  expect(slotAt(500, 3, at)).toBe(3);
  expect(slotAt(10, 0, at)).toBe(0);
  // Binäre Suche: Bei 1 000 Karten misst sie höchstens 11.
  for (const y of [-5, 0, 7_777, 25_000, 49_995, 99_999]) {
    const measured: number[] = [];
    const slot = slotAt(y, 1_000, (i) => {
      measured.push(i);
      return { top: i * 50, height: 40 };
    });
    expect(slot).toBe(Math.min(1_000, Math.max(0, Math.floor((y - 20) / 50) + 1)));
    expect(measured.length).toBeLessThanOrEqual(11);
  }
});

/** Eine Kartenliste wie im DOM: `li[data-card]` mit Rechtecken, die `layout` gerade liefert. */
function listOf(ids: string[], layout: { tops: number[] }) {
  const children = ids.map((id, i) => ({
    dataset: { card: id },
    getBoundingClientRect: () => ({ top: layout.tops[i] ?? 0, height: 40 }),
  }));
  return { current: { children } as unknown as HTMLUListElement };
}

/** Das Ereignis von dnd-kit: Kopie mit Oberkante `top` (Höhe 40) über der Zelle `over`. */
const dragEvent = (dragged: CardData, top: number | null, over: CellData | null) => ({
  active: {
    data: { current: dragged },
    rect: { current: { initial: rect(0, 40), translated: top === null ? null : rect(top, 40) } },
  },
  over: over === null ? null : { data: { current: over } },
});

test('a drop in the same cell anchors before the slot, in another cell changes it', () => {
  // 1 bei 0, 2 bei 50, 3 bei 100; Mitten 20, 70, 120.
  const list = listOf([tid(1), tid(2), tid(3)], { tops: [0, 50, 100] });
  const todo: CellData = { ...cell('s1', 'todo'), list };
  // Kopie der 1 mit Mitte 100: vor die 3, also zwischen 2 und 3.
  expect(dropFrom(dragEvent(card(1), 80, todo), lanes)).toEqual({
    id: tid(1),
    from: { lane: 's1', column: 'todo' },
    to: { lane: 's1', column: 'todo' },
    anchor: { before: tid(3) },
  });
  // Kopie der 3 mit Mitte 10: vor die 1.
  expect(dropFrom(dragEvent(card(3), -10, todo), lanes)?.anchor).toEqual({ before: tid(1) });
  // Kopie der 1 unter der letzten Karte: ans Ende.
  expect(dropFrom(dragEvent(card(1), 200, todo), lanes)?.anchor).toEqual({ after: tid(3) });
  // Eine andere Zelle: Spalte, Bahn oder beides, ohne Rang.
  expect(dropFrom(dragEvent(card(1), 0, cell('s1', 'in_progress')), lanes)).toEqual({
    id: tid(1),
    from: { lane: 's1', column: 'todo' },
    to: { lane: 's1', column: 'in_progress' },
  });
  expect(dropOf(card(1), cell('s2', 'in_progress'), undefined, lanes)).toEqual({
    id: tid(1),
    from: { lane: 's1', column: 'todo' },
    to: { lane: 's2', column: 'in_progress' },
  });
  // Eine leere Zelle der eigenen Spalte in einer anderen Bahn: ohne Fehler, ohne Rang.
  const empty: CellData = { ...cell('s2', 'todo'), list: listOf([], { tops: [] }) };
  expect(dropFrom(dragEvent(card(1), 0, empty), lanes)?.anchor).toBeUndefined();
});

test('the slot comes from the card rects at the time of the event', () => {
  const layout = { tops: [0, 50, 100] };
  const todo: CellData = { ...cell('s1', 'todo'), list: listOf([tid(1), tid(2), tid(3)], layout) };
  // Mitte der Kopie bei 95: vor die 3.
  expect(dropFrom(dragEvent(card(1), 75, todo), lanes)?.anchor).toEqual({ before: tid(3) });
  // Das Board scrollt um 60 px nach oben: Dieselbe Stelle am Schirm liegt jetzt hinter der 3.
  layout.tops = [-60, -10, 40];
  expect(dropFrom(dragEvent(card(1), 75, todo), lanes)?.anchor).toEqual({ after: tid(3) });
});

test('dropping a card on its own slot is no move', () => {
  expect(dropOf(card(2), cell('s1', 'todo'), tid(2), lanes)).toBeUndefined();
  // Vor die nächste Karte: derselbe Platz.
  expect(dropOf(card(2), cell('s1', 'todo'), tid(3), lanes)).toBeUndefined();
  // Die letzte Karte ans Ende ihrer eigenen Zelle.
  expect(dropOf(card(3), cell('s1', 'todo'), undefined, lanes)).toBeUndefined();
  // Über die Rechtecke: Mitte der Kopie der 2 knapp unter ihrer eigenen Mitte → vor die 3.
  const todo: CellData = {
    ...cell('s1', 'todo'),
    list: listOf([tid(1), tid(2), tid(3)], { tops: [0, 50, 100] }),
  };
  expect(dropFrom(dragEvent(card(2), 55, todo), lanes)).toBeUndefined();
  expect(dropFrom(dragEvent(card(2), 45, todo), lanes)).toBeUndefined();
});

test('a card the model no longer knows anchors nothing', () => {
  // Ein Patch nahm die 2 aus dem Modell, das DOM zeigt sie noch.
  const todo: CellData = {
    ...cell('s1', 'todo'),
    list: listOf([tid(1), tid(9), tid(3)], { tops: [0, 50, 100] }),
  };
  expect(dropOf(card(1), cell('s1', 'todo'), tid(9), lanes)).toBeUndefined();
  expect(() => dropFrom(dragEvent(card(3), 25, todo), lanes)).not.toThrow();
  expect(dropFrom(dragEvent(card(3), 25, todo), lanes)).toBeUndefined();
  // Kennt das Modell die Zelle nicht mehr, gibt es keinen Anker.
  expect(dropOf(card(1, 'gone'), cell('gone', 'todo'), undefined, lanes)).toBeUndefined();
});

test('without a target, cell data or geometry there is no ranked drop', () => {
  expect(dropFrom(dragEvent(card(1), 0, null), lanes)).toBeUndefined();
  expect(
    dropFrom(
      { ...dragEvent(card(1), 0, cell('s1', 'in_progress')), over: { data: { current: card(4) } } },
      lanes,
    ),
  ).toBeUndefined();
  expect(
    dropFrom(
      {
        ...dragEvent(card(1), 0, cell('s1', 'in_progress')),
        active: { ...dragEvent(card(1), 0, null).active, data: { current: undefined } },
      },
      lanes,
    ),
  ).toBeUndefined();
  // Ohne Liste der Zelle (oder ohne Kopie) bleibt nur das Ende.
  expect(dropFrom(dragEvent(card(1), 100, cell('s1', 'todo')), lanes)?.anchor).toEqual({
    after: tid(3),
  });
  expect(
    dropFrom(dragEvent(card(1), null, { ...cell('s1', 'todo'), list: { current: null } }), lanes)
      ?.anchor,
  ).toEqual({ after: tid(3) });
});

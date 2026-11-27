import type { State } from '@backe/core/state.ts';
import { type BoardLane, newCard } from '../../app/board-model.ts';
import { testIssue, tid } from '../../test/state.ts';
import type { CardData } from './board-dnd.ts';
import { keyDrop } from './board-keys.ts';

const OPEN: State[] = ['todo', 'in_progress', 'review', 'done'];
const WITH_BACKLOG: State[] = ['backlog', ...OPEN];

/** 1, 2, 3 in `todo`, 4 in `review`, 5 in `done`, 6 in `backlog`. */
const CARDS: Partial<Record<State, number[]>> = {
  backlog: [6],
  todo: [1, 2, 3],
  review: [4],
  done: [5],
};
const lane = (columns: readonly State[]): BoardLane => ({
  key: 's1',
  label: 'Sprint 1',
  closed: false,
  count: 6,
  cells: columns.map((column) => ({
    column,
    cards: (CARDS[column] ?? []).map((n) => newCard(testIssue(n, { state: column }), false)),
  })),
});

const card = (n: number, column: State = 'todo'): CardData => ({
  type: 'card',
  id: tid(n),
  lane: 's1',
  column,
});

test('alt up and down rank within the cell, at the edge nothing', () => {
  const lanes = [lane(OPEN)];
  expect(keyDrop(lanes, card(2), 'ArrowUp', OPEN)).toEqual({
    id: tid(2),
    from: { lane: 's1', column: 'todo' },
    to: { lane: 's1', column: 'todo' },
    anchor: { before: tid(1) },
  });
  expect(keyDrop(lanes, card(2), 'ArrowDown', OPEN)?.anchor).toEqual({ after: tid(3) });
  expect(keyDrop(lanes, card(1), 'ArrowUp', OPEN)).toBeUndefined();
  expect(keyDrop(lanes, card(3), 'ArrowDown', OPEN)).toBeUndefined();
  // Eine Karte, die das Modell nicht (mehr) in der Zelle kennt, bewegt sich nicht.
  expect(keyDrop(lanes, card(9), 'ArrowUp', OPEN)).toBeUndefined();
});

test('alt left and right move to the neighbouring column of the lane', () => {
  const lanes = [lane(OPEN)];
  expect(keyDrop(lanes, card(1), 'ArrowRight', OPEN)).toEqual({
    id: tid(1),
    from: { lane: 's1', column: 'todo' },
    to: { lane: 's1', column: 'in_progress' },
  });
  expect(keyDrop(lanes, card(4, 'review'), 'ArrowLeft', OPEN)?.to).toEqual({
    lane: 's1',
    column: 'in_progress',
  });
  // Ohne `backlog` in den Spalten ist eine Karte dort nicht zu bewegen.
  expect(keyDrop([lane(WITH_BACKLOG)], card(6, 'backlog'), 'ArrowRight', OPEN)).toBeUndefined();
  // Am Rand: links von `todo` ohne Spalte `backlog`, rechts von `done`.
  expect(keyDrop(lanes, card(1), 'ArrowLeft', OPEN)).toBeUndefined();
  expect(keyDrop(lanes, card(5, 'done'), 'ArrowRight', OPEN)).toBeUndefined();
  // Mit eingeblendeter Spalte `backlog` geht es dorthin, links davon ist Schluss.
  const shown = [lane(WITH_BACKLOG)];
  expect(keyDrop(shown, card(1), 'ArrowLeft', WITH_BACKLOG)?.to).toEqual({
    lane: 's1',
    column: 'backlog',
  });
  expect(keyDrop(shown, card(6, 'backlog'), 'ArrowLeft', WITH_BACKLOG)).toBeUndefined();
});

import type { ListRow } from '../app/backlog-list.ts';
import { testIssue, tid } from '../test/state.ts';
import { dropPosition, dropTarget, keyboardPosition } from './row-drag.ts';

const row = (n: number, extra: Partial<ListRow> = {}): ListRow => ({
  issue: testIssue(n),
  depth: 0,
  openDeps: false,
  ...extra,
});

/**
 * Baum: 1 mit den Kindern 2 (darunter 3) und 4, dann die Wurzeln 5 und 6.
 *   1
 *     2
 *       3
 *     4
 *   5
 *   6
 */
const tree = [
  row(1),
  row(2, { depth: 1 }),
  row(3, { depth: 2 }),
  row(4, { depth: 1 }),
  row(5),
  row(6),
];

test('drop position by half', () => {
  expect(dropPosition(tid(1), tid(2), 5, 36)).toEqual({ before: tid(2) });
  expect(dropPosition(tid(1), tid(2), 17, 36)).toEqual({ before: tid(2) });
  expect(dropPosition(tid(1), tid(2), 18, 36)).toEqual({ after: tid(2) });
  expect(dropPosition(tid(1), tid(2), 35, 36)).toEqual({ after: tid(2) });
  expect(dropPosition(tid(1), tid(1), 5, 36)).toBeUndefined();
});

test('keyboard position moves one row', () => {
  const rows = [row(1), row(2), row(3)];
  expect(keyboardPosition(rows, tid(1), 'ArrowUp')).toBeUndefined();
  expect(keyboardPosition(rows, tid(2), 'ArrowUp')).toEqual({ before: tid(1) });
  expect(keyboardPosition(rows, tid(2), 'ArrowDown')).toEqual({ after: tid(3) });
  expect(keyboardPosition(rows, tid(3), 'ArrowDown')).toBeUndefined();
  expect(keyboardPosition(rows, tid(9), 'ArrowDown')).toBeUndefined();
});

test('keyboard position skips rows that are fading out', () => {
  const rows = [row(1), row(2, { live: 'leaving' }), row(3)];
  expect(keyboardPosition(rows, tid(3), 'ArrowUp')).toEqual({ before: tid(1) });
  expect(keyboardPosition(rows, tid(1), 'ArrowDown')).toEqual({ after: tid(3) });
});

test('in a tree the keyboard moves among siblings and skips subtrees', () => {
  // Eine Wurzel springt über den ganzen Teilbaum der vorigen Wurzel.
  expect(keyboardPosition(tree, tid(5), 'ArrowUp')).toEqual({ before: tid(1) });
  expect(keyboardPosition(tree, tid(1), 'ArrowDown')).toEqual({ after: tid(5) });
  // Kinder bleiben in ihrer Gruppe; am Rand der Gruppe geht es nicht weiter.
  expect(keyboardPosition(tree, tid(4), 'ArrowUp')).toEqual({ before: tid(2) });
  expect(keyboardPosition(tree, tid(2), 'ArrowDown')).toEqual({ after: tid(4) });
  expect(keyboardPosition(tree, tid(2), 'ArrowUp')).toBeUndefined();
  expect(keyboardPosition(tree, tid(4), 'ArrowDown')).toBeUndefined();
  expect(keyboardPosition(tree, tid(3), 'ArrowUp')).toBeUndefined();
});

test('a drop target must be a sibling', () => {
  // Kind auf Wurzel und Kind auf ein fremdes Kind: keine Markierung, kein Write.
  expect(dropTarget(tree, tid(4), tid(5), 5, 36)).toBeUndefined();
  expect(dropTarget(tree, tid(3), tid(4), 5, 36)).toBeUndefined();
  expect(dropTarget(tree, tid(4), tid(2), 5, 36)).toEqual({
    pos: { before: tid(2) },
    marker: { id: tid(2), side: 'before' },
  });
});

test('dropping after a row with a subtree marks the end of the subtree', () => {
  expect(dropTarget(tree, tid(6), tid(1), 30, 36)).toEqual({
    pos: { after: tid(1) },
    marker: { id: tid(4), side: 'after' },
  });
});

test('a drop on a child row means its sibling ancestor, after its subtree', () => {
  // Wurzel 6 über Kind 2 oder Enkel 3: gemeint ist die Wurzel 1, abgelegt hinter ihrem Teilbaum.
  for (const target of [tid(2), tid(3)]) {
    for (const offset of [5, 30]) {
      expect(dropTarget(tree, tid(6), target, offset, 36)).toEqual({
        pos: { after: tid(1) },
        marker: { id: tid(4), side: 'after' },
      });
    }
  }
  // 5 steht schon hinter 1, 4 schon hinter 2: Die Reihenfolge bliebe.
  expect(dropTarget(tree, tid(5), tid(3), 5, 36)).toBeUndefined();
  expect(dropTarget(tree, tid(4), tid(3), 5, 36)).toBeUndefined();
  // Über den eigenen Kindern gibt es kein Ziel.
  expect(dropTarget(tree, tid(1), tid(3), 30, 36)).toBeUndefined();
  expect(dropTarget(tree, tid(2), tid(3), 30, 36)).toBeUndefined();
});

test('a drop that keeps the order is no move', () => {
  const flat = [row(1), row(2), row(3)];
  expect(dropTarget(flat, tid(2), tid(1), 30, 36)).toBeUndefined();
  expect(dropTarget(flat, tid(2), tid(3), 5, 36)).toBeUndefined();
  expect(dropTarget(flat, tid(2), tid(2), 5, 36)).toBeUndefined();
  expect(dropTarget(flat, tid(9), tid(1), 5, 36)).toBeUndefined();
  expect(dropTarget(flat, tid(2), tid(1), 5, 36)?.pos).toEqual({ before: tid(1) });
  // Im Baum gilt dasselbe über den Teilbaum hinweg: 5 steht schon hinter 1.
  expect(dropTarget(tree, tid(5), tid(1), 30, 36)).toBeUndefined();
});

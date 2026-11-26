import type { ListRow } from '../app/backlog-list.ts';
import { testIssue, tid } from '../test/state.ts';
import { dropPosition, keyboardPosition } from './row-drag.ts';

const row = (n: number, extra: Partial<ListRow> = {}): ListRow => ({
  issue: testIssue(n),
  depth: 0,
  openDeps: false,
  ...extra,
});

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

import { VirtualCells } from './board-virtual.tsx';

test('relayout asks every cell to measure again, until it leaves', () => {
  const cells = new VirtualCells();
  const a = vi.fn();
  const b = vi.fn();
  const offA = cells.onRelayout(a);
  cells.onRelayout(b);
  cells.relayout();
  offA();
  cells.relayout();
  expect(a).toHaveBeenCalledTimes(1);
  expect(b).toHaveBeenCalledTimes(2);
});

test('reveal asks only the cells of the lane and stops at the first that holds the card', () => {
  const cells = new VirtualCells();
  const shown = () => {};
  const other = vi.fn(() => true);
  const empty = vi.fn(() => false);
  const holder = vi.fn((id: string) => id === 'bk-1');
  cells.add('s2\ntodo', 's2', other);
  cells.add('s1\ntodo', 's1', empty);
  const off = cells.add('s1\nreview', 's1', holder);
  expect(cells.reveal('s1', 'bk-1', shown)).toBe(true);
  expect(other).not.toHaveBeenCalled();
  expect(empty).toHaveBeenCalledWith('bk-1', shown);
  expect(cells.reveal('s1', 'bk-9', shown)).toBe(false);
  off();
  expect(cells.reveal('s1', 'bk-1', shown)).toBe(false);
});

test('a cell that registers again under its key replaces the old entry, and the old one cannot remove it', () => {
  const cells = new VirtualCells();
  const first = vi.fn(() => true);
  const second = vi.fn(() => true);
  const offFirst = cells.add('s1\ntodo', 's1', first);
  cells.add('s1\ntodo', 's1', second);
  offFirst();
  expect(cells.reveal('s1', 'bk-1', () => {})).toBe(true);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledOnce();
});

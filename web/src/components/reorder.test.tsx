import { act, createEvent, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../data/api-client.ts';
import {
  answerNever,
  call,
  linkOf,
  registerBacklogViewHarness,
  rowIds,
  rowOf,
  scroller,
  view,
} from '../test/backlog-view.tsx';
import { testIssue, tid } from '../test/state.ts';
import { m } from '../views/backlog.messages.ts';
import { DRAG_TYPE } from './row-drag.ts';
import { m as w } from './write/write.messages.ts';

registerBacklogViewHarness();

const three = () => view([1, 2, 3].map((n) => testIssue(n)));
/** 1 mit dem Kind 2, dann die Wurzeln 3 und 4 (Baum ist die Voreinstellung). */
const tree = () =>
  view([testIssue(1), testIssue(2, { parent: tid(1) }), testIssue(3), testIssue(4)]);

/** jsdom kennt weder `DataTransfer` noch `DragEvent`: ein Ersatz mit `types`, `setData`, `getData`. */
function dataTransfer() {
  const data = new Map<string, string>();
  return {
    get types() {
      return [...data.keys()];
    },
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    dropEffect: 'none',
    effectAllowed: 'all',
  };
}
type Drag = 'dragStart' | 'dragOver' | 'drop' | 'dragEnd';
function drag(type: Drag, el: HTMLElement, dt: object, clientY = 0) {
  const event = createEvent[type](el, { dataTransfer: dt });
  Object.defineProperty(event, 'clientY', { value: clientY });
  fireEvent(el, event);
}
/** Zieht `id` auf `target`: `clientY` 5 ist die obere, 30 die untere Hälfte der Zeile. */
function dragOnto(id: string, target: string, clientY: number) {
  const dt = dataTransfer();
  drag('dragStart', rowOf(id), dt);
  drag('dragOver', rowOf(target), dt, clientY);
  const marked = rowIds().map((r) => [r, rowOf(r as string).dataset.drop]);
  drag('drop', rowOf(target), dt, clientY);
  drag('dragEnd', rowOf(id), dt);
  return marked.filter(([, side]) => side !== undefined);
}
const alt = (key: 'ArrowUp' | 'ArrowDown') => userEvent.keyboard(`{Alt>}{${key}}{/Alt}`);

test('dragging a row reranks it optimistically', () => {
  answerNever();
  three();
  const dt = dataTransfer();
  drag('dragStart', rowOf(tid(3)), dt);
  expect(dt.getData(DRAG_TYPE)).toBe(tid(3));
  drag('dragOver', rowOf(tid(3)), dt, 5);
  expect(rowOf(tid(3)).dataset.drop).toBeUndefined();
  drag('dragOver', rowOf(tid(1)), dt, 30);
  expect(rowOf(tid(1)).dataset.drop).toBe('after');
  drag('dragOver', rowOf(tid(1)), dt, 5);
  expect(rowOf(tid(1)).dataset.drop).toBe('before');
  drag('drop', rowOf(tid(1)), dt, 5);
  expect(rowIds()).toEqual([tid(3), tid(1), tid(2)]);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(3), before: tid(1) });
  drag('dragEnd', rowOf(tid(3)), dt);
  expect(rowOf(tid(1)).dataset.drop).toBeUndefined();
});

test('a drop on itself, a neighbour or of a foreign type does nothing', () => {
  three();
  expect(dragOnto(tid(2), tid(2), 5)).toEqual([]);
  // Hinter die vorige oder vor die nächste Zeile: Die Reihenfolge bliebe.
  expect(dragOnto(tid(2), tid(1), 30)).toEqual([]);
  expect(dragOnto(tid(2), tid(3), 5)).toEqual([]);
  const foreign = dataTransfer();
  foreign.setData('text/plain', 'x');
  drag('dragOver', rowOf(tid(1)), foreign, 5);
  expect(rowOf(tid(1)).dataset.drop).toBeUndefined();
  drag('drop', rowOf(tid(1)), foreign, 5);
  expect(call).not.toHaveBeenCalled();
});

test('a rejected drag restores the order and shows in the failures', async () => {
  let reject!: (e: unknown) => void;
  call.mockImplementation(() => new Promise((_, rej) => (reject = rej)));
  three();
  dragOnto(tid(3), tid(1), 5);
  expect(rowIds()).toEqual([tid(3), tid(1), tid(2)]);
  await act(async () => reject(new ApiError(400, 'validation', 'Kein Rang', 'backe issue rank')));
  expect(rowIds()).toEqual([tid(1), tid(2), tid(3)]);
  const failures = screen.getByRole('region', { name: w.failures });
  expect(within(failures).getByText('Kein Rang')).toBeTruthy();
  expect(within(failures).getByText('backe issue rank')).toBeTruthy();
});

describe('in the tree', () => {
  test('a drop outside the sibling group marks nothing and writes nothing', () => {
    tree();
    expect(rowIds()).toEqual([tid(1), tid(2), tid(3), tid(4)]);
    // Wurzel auf ein Kind und Kind auf eine Wurzel.
    expect(dragOnto(tid(4), tid(2), 5)).toEqual([]);
    expect(dragOnto(tid(2), tid(3), 30)).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });

  test('a drop after a parent marks and lands behind its subtree', () => {
    answerNever();
    tree();
    expect(dragOnto(tid(4), tid(1), 30)).toEqual([[tid(2), 'after']]);
    expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(4), after: tid(1) });
    expect(rowIds()).toEqual([tid(1), tid(2), tid(4), tid(3)]);
  });

  test('alt+arrow passes a whole subtree and stops at the group edge', async () => {
    answerNever();
    tree();
    linkOf(tid(3)).focus();
    await alt('ArrowUp');
    expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(3), before: tid(1) });
    expect(rowIds()).toEqual([tid(3), tid(1), tid(2), tid(4)]);
    expect(document.activeElement).toBe(linkOf(tid(3)));
    call.mockClear();
    linkOf(tid(2)).focus();
    await alt('ArrowUp');
    await alt('ArrowDown');
    expect(call).not.toHaveBeenCalled();
  });
});

test('alt+arrow reranks with the keyboard', async () => {
  answerNever();
  three();
  linkOf(tid(2)).focus();
  await alt('ArrowUp');
  expect(rowIds()).toEqual([tid(2), tid(1), tid(3)]);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(2), before: tid(1) });
  expect(document.activeElement).toBe(linkOf(tid(2)));
  call.mockClear();
  await alt('ArrowUp');
  expect(call).not.toHaveBeenCalled();
  await alt('ArrowDown');
  expect(rowIds()).toEqual([tid(1), tid(2), tid(3)]);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(2), after: tid(1) });
  expect(document.activeElement).toBe(linkOf(tid(2)));
  expect(linkOf(tid(2)).getAttribute('aria-keyshortcuts')).toBe('Alt+ArrowUp Alt+ArrowDown');
});

test('alt+arrow scrolls the moved row into view', async () => {
  answerNever();
  view(Array.from({ length: 40 }, (_, i) => testIssue(i + 1)));
  // 600 px Fläche, 36 px je Zeile: Zeile 17 (Index 16) ragt unten hinaus, Index 17 noch weiter.
  linkOf(tid(17)).focus();
  await alt('ArrowDown');
  expect(rowIds().indexOf(tid(17))).toBe(17);
  expect(scroller().scrollTop).toBeGreaterThan(0);
  expect(document.activeElement).toBe(linkOf(tid(17)));
});

/** 1 mit Rang, dann 2 bis 4 ohne: so liegen frisch angelegte Issues im Backlog. */
const unranked = () =>
  view([
    testIssue(1),
    testIssue(2, { rank: undefined }),
    testIssue(3, { rank: undefined }),
    testIssue(4, { rank: undefined }),
  ]);

test('alt+arrow past an unranked anchor ranks the issues up to it in one batch', async () => {
  answerNever();
  const { store } = unranked();
  linkOf(tid(1)).focus();
  await alt('ArrowDown');
  expect(call).toHaveBeenCalledExactlyOnceWith('batch', {
    ops: [
      { op: 'issue.rank', id: tid(2), from: null, bottom: true },
      { op: 'issue.rank', id: tid(1), from: 1000, after: tid(2) },
    ],
  });
  expect(rowIds()).toEqual([tid(2), tid(1), tid(3), tid(4)]);
  expect(document.activeElement).toBe(linkOf(tid(1)));
  call.mockClear();
  // Noch überlagert: `from` ist trotzdem der Rang des Servers, nicht der angezeigte.
  expect(store.issues.get(tid(1)).value?.rank).not.toBe(1000);
  await alt('ArrowDown');
  expect(call).toHaveBeenCalledExactlyOnceWith('batch', {
    ops: [
      { op: 'issue.rank', id: tid(3), from: null, bottom: true },
      { op: 'issue.rank', id: tid(1), from: 1000, after: tid(3) },
    ],
  });
});

test('a drop on an unranked row sends the same batch', () => {
  answerNever();
  unranked();
  expect(dragOnto(tid(4), tid(3), 5)).toEqual([[tid(3), 'before']]);
  expect(call).toHaveBeenCalledExactlyOnceWith('batch', {
    ops: [
      { op: 'issue.rank', id: tid(2), from: null, bottom: true },
      { op: 'issue.rank', id: tid(3), from: null, bottom: true },
      { op: 'issue.rank', id: tid(4), from: null, before: tid(3) },
    ],
  });
  expect(rowIds()).toEqual([tid(1), tid(2), tid(4), tid(3)]);
});

test('a batch the server refuses shows its message verbatim', async () => {
  let reject!: (e: unknown) => void;
  call.mockImplementation(() => new Promise((_, rej) => (reject = rej)));
  unranked();
  linkOf(tid(1)).focus();
  await alt('ArrowDown');
  await act(async () => reject(new ApiError(400, 'usage', 'Zu viele Operationen', 'kleiner')));
  expect(rowIds()).toEqual([tid(1), tid(2), tid(3), tid(4)]);
  const failures = screen.getByRole('region', { name: w.failures });
  expect(within(failures).getByText('Zu viele Operationen')).toBeTruthy();
});

test('no drag when sorted by created', async () => {
  three();
  expect(rowOf(tid(1)).getAttribute('draggable')).toBe('true');
  await userEvent.click(screen.getByRole('button', { name: m.sortCreated }));
  expect(rowOf(tid(1)).hasAttribute('draggable')).toBe(false);
  expect(linkOf(tid(1)).hasAttribute('aria-keyshortcuts')).toBe(false);
  linkOf(tid(2)).focus();
  await alt('ArrowUp');
  expect(call).not.toHaveBeenCalled();
});

test('no drag without write access', () => {
  view([testIssue(1)], { canWrite: false });
  expect(rowOf(tid(1)).hasAttribute('draggable')).toBe(false);
});

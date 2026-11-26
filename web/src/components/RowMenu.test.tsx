import { act, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
import { testIssue, testPatch, tid } from '../test/state.ts';
import { m } from '../views/backlog.messages.ts';
import { m as im } from '../views/issue.messages.ts';
import { m as w } from './write/write.messages.ts';

registerBacklogViewHarness();

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Rechtsklick auf die Zeile, dann im Untermenü `sub` den Eintrag `item` (oder `role`). */
async function pick(id: string, sub: string, item: string, role = 'menuitem') {
  fireEvent.contextMenu(linkOf(id));
  await userEvent.click(screen.getByRole('menuitem', { name: sub }));
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2));
  const menu = screen.getAllByRole('menu')[1] as HTMLElement;
  await userEvent.click(within(menu).getByRole(role, { name: item }));
}

test('the context menu moves an issue optimistically', async () => {
  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  view([testIssue(1), testIssue(2)]);
  await pick(tid(1), m.menuState, 'in_progress');
  const row = within(rowOf(tid(1)));
  expect(row.getByText('in_progress')).toBeTruthy();
  expect(row.getByText(w.pending)).toBeTruthy();
  expect(within(rowOf(tid(2))).queryByText(w.pending)).toBeNull();
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', { id: tid(1), to: 'in_progress' });
  await act(async () => answer.resolve({ commit: null }));
  expect(within(rowOf(tid(1))).queryByText(w.pending)).toBeNull();
});

test('blocked from the menu opens the state dialog', async () => {
  view([testIssue(1), testIssue(2)]);
  await pick(tid(1), m.menuState, 'blocked');
  expect(screen.getByRole('dialog', { name: im.stateDialogTitle('blocked') })).toBeTruthy();
  expect(call).not.toHaveBeenCalled();
});

test('rank top and bottom from the menu', async () => {
  answerNever();
  view([testIssue(1), testIssue(2), testIssue(3)]);
  await pick(tid(3), m.menuRank, m.rankTop);
  expect(rowIds()).toEqual([tid(3), tid(1), tid(2)]);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(3), top: true });
  call.mockClear();
  await pick(tid(3), m.menuRank, m.rankBottom);
  expect(rowIds()).toEqual([tid(1), tid(2), tid(3)]);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(3), bottom: true });
});

test('bottom from the menu lands in the last row, past unranked issues', async () => {
  answerNever();
  view([testIssue(1), testIssue(2), testIssue(3, { rank: undefined })]);
  await pick(tid(1), m.menuRank, m.rankBottom);
  expect(call).toHaveBeenCalledExactlyOnceWith('batch', {
    ops: [
      { op: 'issue.rank', id: tid(3), from: null, bottom: true },
      { op: 'issue.rank', id: tid(1), from: 1000, after: tid(3) },
    ],
  });
  expect(rowIds()).toEqual([tid(2), tid(3), tid(1)]);
});

test('a rejected rank restores the order and shows in the failures', async () => {
  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  view([testIssue(1), testIssue(2), testIssue(3)]);
  await pick(tid(3), m.menuRank, m.rankTop);
  expect(rowIds()).toEqual([tid(3), tid(1), tid(2)]);
  await act(async () => answer.reject(new ApiError(409, 'conflict', 'Rang belegt', 'backe sync')));
  expect(rowIds()).toEqual([tid(1), tid(2), tid(3)]);
  const failures = screen.getByRole('region', { name: w.failures });
  expect(within(failures).getByText('Rang belegt')).toBeTruthy();
});

test('to the top follows the row out of the rendered range', async () => {
  answerNever();
  view(Array.from({ length: 80 }, (_, i) => testIssue(i + 1)));
  // Zeilen ab etwa 40 sichtbar; Zeile 0 liegt außerhalb des gerenderten Bereichs.
  act(() => scroller().scrollTo({ top: 1800 }));
  expect(rowOf(tid(1))).toBeUndefined();
  await pick(tid(60), m.menuRank, m.rankTop);
  expect(rowIds()[0]).toBe(tid(60));
  expect(scroller().scrollTop).toBe(0);
  await waitFor(() => expect(document.activeElement).toBe(linkOf(tid(60))));
});

test('assignee from the menu', async () => {
  answerNever();
  view([testIssue(1, { assignee: 'ada' })], {
    over: { users: [{ handle: 'ada', name: 'Ada', kind: 'human', admin: false }] },
  });
  await pick(tid(1), m.menuAssignee, im.assigneeMe('spw'), 'menuitemradio');
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_update', { id: tid(1), assignee: 'spw' });
  expect(within(rowOf(tid(1))).getByText('spw')).toBeTruthy();
  call.mockClear();
  await pick(tid(1), m.menuAssignee, im.assigneeNone, 'menuitemradio');
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_update', { id: tid(1), assignee: null });
});

test('delete from the menu opens the dialog', async () => {
  view([testIssue(1)]);
  fireEvent.contextMenu(linkOf(tid(1)));
  await userEvent.click(screen.getByRole('menuitem', { name: m.deleteIssue }));
  const dialog = screen.getByRole('dialog', { name: im.deleteTitle(tid(1)) });
  await userEvent.click(within(dialog).getByRole('button', { name: im.deleteAction }));
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_delete', { id: tid(1) });
});

test('after a delete from the menu the focus goes to the neighbour row', async () => {
  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  const { store } = view([testIssue(1), testIssue(2), testIssue(3)]);
  linkOf(tid(2)).focus();
  fireEvent.contextMenu(linkOf(tid(2)));
  await userEvent.click(screen.getByRole('menuitem', { name: m.deleteIssue }));
  const dialog = screen.getByRole('dialog', { name: im.deleteTitle(tid(2)) });
  await userEvent.click(within(dialog).getByRole('button', { name: im.deleteAction }));
  // Der Patch kommt vor der Antwort: Die Zeile blendet aus, während der Dialog noch offen ist.
  act(() => {
    store.applyPatch(testPatch(2, { remove: { issues: [tid(2)] } }));
  });
  await act(async () => answer.resolve({ commit: 'h2' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(linkOf(tid(3)));
});

test('a focused row that disappears hands the focus to the next, else the previous', () => {
  const { store } = view([testIssue(1), testIssue(2), testIssue(3)]);
  linkOf(tid(2)).focus();
  act(() => {
    store.applyPatch(testPatch(2, { remove: { issues: [tid(2)] } }));
  });
  expect(document.activeElement).toBe(linkOf(tid(3)));
  act(() => {
    store.applyPatch(testPatch(3, { remove: { issues: [tid(3)] } }));
  });
  expect(document.activeElement).toBe(linkOf(tid(1)));
});

test('a row the user left does not pull the focus back when it disappears', () => {
  const { store } = view([testIssue(1), testIssue(2), testIssue(3)]);
  linkOf(tid(2)).focus();
  linkOf(tid(2)).blur();
  act(() => {
    store.applyPatch(testPatch(2, { remove: { issues: [tid(2)] } }));
  });
  expect(document.activeElement).toBe(document.body);
});

test('a rejected menu action shows in the failures', async () => {
  call.mockRejectedValue(new ApiError(400, 'invariant', 'Kein Wechsel', 'backe issue show'));
  view([testIssue(1)]);
  await pick(tid(1), m.menuState, 'in_progress');
  const failures = await screen.findByRole('region', { name: w.failures });
  expect(within(failures).getByText('Kein Wechsel')).toBeTruthy();
  expect(within(failures).getByText('backe issue show')).toBeTruthy();
  expect(within(rowOf(tid(1))).getByText('todo')).toBeTruthy();
  expect(within(rowOf(tid(1))).queryByText(w.pending)).toBeNull();
});

test('without write access a row has no context menu', () => {
  view([testIssue(1)], { canWrite: false });
  fireEvent.contextMenu(linkOf(tid(1)));
  expect(screen.queryByRole('menu')).toBeNull();
  const keyed = createEvent.keyDown(linkOf(tid(1)), { key: 'F10', shiftKey: true });
  fireEvent(linkOf(tid(1)), keyed);
  expect(keyed.defaultPrevented).toBe(false);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(linkOf(tid(1)).hasAttribute('aria-keyshortcuts')).toBe(false);
});

test.each([
  ['Shift+F10', { key: 'F10', shiftKey: true }],
  ['the context menu key', { key: 'ContextMenu' }],
])('%s opens exactly one menu at the focused row', async (_name, key) => {
  view([testIssue(1), testIssue(2)]);
  linkOf(tid(2)).focus();
  const keyed = createEvent.keyDown(linkOf(tid(2)), key);
  fireEvent(linkOf(tid(2)), keyed);
  // Ohne `preventDefault` öffnete der Browser sein eigenes Menü darüber.
  expect(keyed.defaultPrevented).toBe(true);
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1));
  expect(screen.getByRole('menuitem', { name: m.menuState })).toBeTruthy();
  // Ein Druck auf F10 allein oder mit Strg ist kein Menüwunsch.
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  for (const other of [{ key: 'F10' }, { key: 'F10', shiftKey: true, ctrlKey: true }]) {
    const plain = createEvent.keyDown(linkOf(tid(2)), other);
    fireEvent(linkOf(tid(2)), plain);
    expect(plain.defaultPrevented).toBe(false);
  }
  expect(screen.queryByRole('menu')).toBeNull();
});

test('the keyboard opens the menu when sorted by created too', async () => {
  view([testIssue(1), testIssue(2)]);
  await userEvent.click(screen.getByRole('button', { name: m.sortCreated }));
  expect(linkOf(tid(1)).getAttribute('aria-keyshortcuts')).toBe('Shift+F10');
  linkOf(tid(1)).focus();
  await userEvent.keyboard('{Shift>}{F10}{/Shift}');
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1));
});

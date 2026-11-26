import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
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
  await pick(tid(1), m.menuAssignee, 'me (spw)', 'menuitemradio');
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_update', { id: tid(1), assignee: 'spw' });
  expect(within(rowOf(tid(1))).getByText('spw')).toBeTruthy();
  call.mockClear();
  await pick(tid(1), m.menuAssignee, 'none', 'menuitemradio');
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
});

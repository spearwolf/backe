import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../data/api-client.ts';
import {
  call,
  deferred,
  expectOneCall,
  flush,
  ID,
  registerIssueViewHarness,
  view,
} from '../../../test/issue-view.tsx';
import { testIssue, tid } from '../../../test/state.ts';
import { m } from '../../../views/issue.messages.ts';
import { m as w } from '../../write/write.messages.ts';

vi.mock('../../../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

registerIssueViewHarness();

const stateField = () => screen.getByText(m.fieldState).parentElement as HTMLElement;
const trigger = () => screen.getByRole('button', { name: m.changeState });

async function openStateMenu() {
  await userEvent.click(trigger());
}

/** Öffnet »Mit Begründung …« und wählt dort `to`. */
async function withReason(to: string) {
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: m.withReason }));
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2));
  const sub = screen.getAllByRole('menu')[1] as HTMLElement;
  await userEvent.click(within(sub).getByRole('menuitem', { name: to }));
}

const openChildren = () =>
  new ApiError(400, 'invariant', 'Offene Sub-Issues', 'mit --force abschließen', {
    reason: 'open_children',
    ids: [tid(2)],
  });

test('a state change is optimistic and posts issue_move', async () => {
  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  view([testIssue(1)]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'in_progress' }));
  expect(within(stateField()).getByText('in_progress')).toBeTruthy();
  expect(within(stateField()).getByText(w.pending)).toBeTruthy();
  expectOneCall('issue_move', { id: ID, to: 'in_progress' });
  await act(async () => answer.resolve({ commit: null, id: ID }));
  expect(within(stateField()).queryByText(w.pending)).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger()));
});

test('blocked asks for blocked_by and reason', async () => {
  view([testIssue(1), testIssue(2)]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: /blocked/ }));
  const dialog = screen.getByRole('dialog');
  const confirm = within(dialog).getByRole('button', { name: m.confirmState });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(within(dialog).getByRole('combobox', { name: m.blockedBy }), tid(2));
  await userEvent.type(within(dialog).getByRole('textbox', { name: m.reason }), 'wartet');
  await userEvent.click(confirm);
  expectOneCall('issue_move', { id: ID, to: 'blocked', reason: 'wartet', blocked_by: [tid(2)] });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('escape closes the state dialog without a write and returns focus to the menu', async () => {
  view([testIssue(1), testIssue(2)]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: /blocked/ }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(call).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement).toBe(trigger()));
});

test('a resume uses issue_resume, a settled issue issue_reopen', async () => {
  view([
    testIssue(1, { state: 'blocked', paused_from: 'in_progress', blocked_by: [tid(2)] }),
    testIssue(2),
  ]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'in_progress' }));
  expectOneCall('issue_resume', { id: ID });
});

test('a settled issue reopens with a reason', async () => {
  view([testIssue(1, { state: 'done' })]);
  await flush();
  await withReason('todo');
  const dialog = screen.getByRole('dialog');
  await userEvent.type(within(dialog).getByRole('textbox', { name: m.reason }), 'nochmal');
  await userEvent.click(within(dialog).getByRole('button', { name: m.confirmState }));
  expectOneCall('issue_reopen', { id: ID, to: 'todo', reason: 'nochmal' });
});

test('a rejected move rolls back and shows the hint', async () => {
  call.mockRejectedValue(
    new ApiError(400, 'invariant', 'Nicht erlaubt', 'backe issue move --force'),
  );
  view([testIssue(1)]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'review' }));
  await flush();
  expectOneCall('issue_move', { id: ID, to: 'review' });
  expect(within(stateField()).getByText('todo')).toBeTruthy();
  expect(within(stateField()).getByText('Nicht erlaubt')).toBeTruthy();
  expect(within(stateField()).getByText('backe issue move --force')).toBeTruthy();
});

test('done with open sub-issues offers force and closes after it', async () => {
  call.mockRejectedValueOnce(openChildren());
  view([testIssue(1, { state: 'review' }), testIssue(2, { title: 'Kind', parent: ID })]);
  await flush();
  await openStateMenu();
  await userEvent.click(screen.getByRole('menuitem', { name: 'done' }));
  const dialog = await screen.findByRole('dialog');
  expectOneCall('issue_move', { id: ID, to: 'done' });
  expect(within(dialog).getByRole('link', { name: /Kind/ })).toBeTruthy();
  expect(within(stateField()).getByText('review')).toBeTruthy();

  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  await userEvent.click(within(dialog).getByRole('button', { name: m.forceDone }));
  expectOneCall('issue_move', { id: ID, to: 'done', force: true });
  // Während des Laufs bleiben Liste und Knopf stehen.
  expect(within(dialog).getByRole('link', { name: /Kind/ })).toBeTruthy();
  expect(within(dialog).getByRole('button', { name: m.forceDone })).toBeTruthy();
  await act(async () => answer.resolve({ commit: null, id: ID }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('done in the dialog learns about open sub-issues and forces', async () => {
  call.mockRejectedValueOnce(openChildren());
  view([testIssue(1, { state: 'review' }), testIssue(2, { title: 'Kind', parent: ID })]);
  await flush();
  await withReason('done');
  const dialog = screen.getByRole('dialog');
  await userEvent.type(within(dialog).getByRole('textbox', { name: m.reason }), 'fertig');
  await userEvent.click(within(dialog).getByRole('button', { name: m.confirmState }));
  expectOneCall('issue_move', { id: ID, to: 'done', reason: 'fertig' });
  expect(await within(dialog).findByRole('link', { name: /Kind/ })).toBeTruthy();
  expect(within(dialog).getByText('mit --force abschließen')).toBeTruthy();
  await userEvent.click(within(dialog).getByRole('button', { name: m.forceDone }));
  expectOneCall('issue_move', { id: ID, to: 'done', reason: 'fertig', force: true });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

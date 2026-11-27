import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../../data/api-client.ts';
import {
  button,
  call,
  deferred,
  expectOneCall,
  flush,
  ID,
  registerIssueViewHarness,
  served,
  testComment,
  view,
} from '../../../test/issue-view.tsx';
import { testIssue, testPatch, tid } from '../../../test/state.ts';
import { m } from '../../../views/issue.messages.ts';
import { m as w } from '../../write/write.messages.ts';

vi.mock('../../../markdown/index.tsx', () => ({
  Markdown: ({ source }: { source: string }) => <div data-testid="markdown">{source}</div>,
}));

registerIssueViewHarness();

test('without write access there is no composer, upload or action', async () => {
  served.body = 'Text';
  served.comments = [testComment(1)];
  served.attachments = [{ name: 'dump.bin', file: 'dump.bin', size: 3 }];
  view([testIssue(1, { attachments: [{ name: 'dump.bin', file: 'dump.bin' }] })], {}, false);
  await flush();
  expect(screen.queryByRole('textbox', { name: m.newComment })).toBeNull();
  expect(screen.queryByRole('button', { name: new RegExp(m.edit, 'i') })).toBeNull();
  expect(screen.queryByRole('button', { name: m.upload })).toBeNull();
  expect(screen.queryByLabelText(m.uploadFiles)).toBeNull();
  expect(screen.queryByRole('button', { name: m.remove('dump.bin') })).toBeNull();
  expect(screen.queryByRole('button', { name: m.claim })).toBeNull();
  expect(screen.queryByRole('button', { name: m.deleteNamed(ID) })).toBeNull();
  fireEvent.dragOver(screen.getByRole('heading', { level: 1 }), {
    dataTransfer: { types: ['Files'], files: [] },
  });
  expect(screen.queryByText(m.dropFiles)).toBeNull();

  // Auch ein erledigtes Issue bietet ohne Schreibrecht kein »Wiedereröffnen« an.
  cleanup();
  view([testIssue(1, { state: 'done' })], {}, false);
  await flush();
  expect(screen.getByText(m.fieldState)).toBeTruthy();
  expect(screen.queryByRole('button', { name: m.reopen })).toBeNull();
  expect(screen.queryByRole('button', { name: m.deleteNamed(ID) })).toBeNull();
});

test('claim shows progress and the conflict hint', async () => {
  const answer = deferred<unknown>();
  call.mockImplementation(() => answer.promise);
  view([testIssue(1, { state: 'in_progress', assignee: 'ada' })]);
  await flush();
  const claim = button(m.claim);
  await userEvent.click(claim);
  expectOneCall('issue_claim', { id: ID });
  expect(claim.disabled).toBe(true);
  expect(screen.getByText(m.claiming).closest('[role="status"]')).not.toBeNull();
  await act(async () =>
    answer.reject(new ApiError(409, 'conflict', 'Schon vergeben', 'backe issue claim --force')),
  );
  expect(claim.disabled).toBe(false);
  expect(screen.queryByText(m.claiming)).toBeNull();
  expect(screen.getByText('Schon vergeben')).toBeTruthy();
  expect(screen.getByText('backe issue claim --force')).toBeTruthy();
});

test('claim is offered only where it can change the assignee', async () => {
  const offered = async (issue: ReturnType<typeof testIssue>) => {
    cleanup();
    view([issue]);
    await flush();
    return screen.queryByRole('button', { name: m.claim }) !== null;
  };
  expect(await offered(testIssue(1, { state: 'backlog' }))).toBe(true);
  expect(await offered(testIssue(1, { state: 'todo', assignee: 'spw' }))).toBe(true);
  expect(await offered(testIssue(1, { state: 'in_progress', assignee: 'spw' }))).toBe(false);
  expect(await offered(testIssue(1, { state: 'review' }))).toBe(false);
  expect(await offered(testIssue(1, { state: 'done' }))).toBe(false);
  expect(await offered(testIssue(1, { state: 'on_hold', paused_from: 'todo' }))).toBe(false);
});

test('reopen asks for target and reason', async () => {
  view([testIssue(1, { state: 'done' })]);
  await flush();
  await userEvent.click(button(m.reopen));
  const dialog = screen.getByRole('dialog');
  const radios = within(dialog).getAllByRole('radio') as HTMLInputElement[];
  expect(radios.map((r) => r.value)).toEqual(['backlog', 'todo', 'in_progress', 'review']);
  expect(radios[0]?.checked).toBe(true);
  await userEvent.click(within(dialog).getByRole('radio', { name: 'todo' }));
  await userEvent.type(within(dialog).getByRole('textbox', { name: m.reason }), 'nochmal');
  await userEvent.click(button(m.reopen, dialog));
  expectOneCall('issue_reopen', { id: ID, to: 'todo', reason: 'nochmal' });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('delete asks orphan or recursive for sub-issues', async () => {
  view([
    testIssue(1),
    testIssue(2, { title: 'Kind', parent: ID }),
    testIssue(3, { depends_on: [tid(2)] }),
  ]);
  await flush();
  await userEvent.click(button(m.deleteNamed(ID)));
  const dialog = screen.getByRole('dialog');
  const confirm = button(m.deleteAction, dialog);
  expect(within(dialog).getByRole('link', { name: /Kind/ })).toBeTruthy();
  expect(confirm.disabled).toBe(true);
  // Mit `recursive` fällt auch das Kind weg; dann verweist Issue 3 auf ein Gelöschtes.
  await userEvent.click(within(dialog).getByRole('radio', { name: m.recursive }));
  expect(within(dialog).getByRole('checkbox', { name: m.forceDelete })).toBeTruthy();
  expect(confirm.disabled).toBe(true);
  await userEvent.click(within(dialog).getByRole('radio', { name: m.orphan }));
  expect(within(dialog).queryByRole('checkbox')).toBeNull();
  expect(confirm.disabled).toBe(false);
  await userEvent.click(confirm);
  expectOneCall('issue_delete', { id: ID, children: 'orphan' });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('delete with references needs force', async () => {
  const { store } = view([testIssue(1), testIssue(2, { title: 'Abhängig', depends_on: [ID] })]);
  await flush();
  await userEvent.click(button(m.deleteNamed(ID)));
  const dialog = screen.getByRole('dialog');
  const confirm = button(m.deleteAction, dialog);
  expect(within(dialog).queryByRole('radio')).toBeNull();
  expect(within(dialog).getByRole('link', { name: /Abhängig/ })).toBeTruthy();
  expect(confirm.disabled).toBe(true);
  await userEvent.click(within(dialog).getByRole('checkbox', { name: m.forceDelete }));
  expect(confirm.disabled).toBe(false);
  await userEvent.click(confirm);
  expectOneCall('issue_delete', { id: ID, force: true });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
  act(() => {
    store.applyPatch(testPatch(2, { remove: { issues: [ID] } }));
  });
  await flush();
  expect(screen.getByText(m.deletedNotice)).toBeTruthy();
  expect(screen.queryByRole('button', { name: m.deleteNamed(ID) })).toBeNull();
  // Die Bedienelemente sind weg; der Fokus steht auf »Tab schließen«.
  expect(document.activeElement).toBe(button(m.closeTab));
});

test('cancelling the delete dialog returns focus to its button', async () => {
  view([testIssue(1)]);
  await flush();
  await userEvent.click(button(m.deleteNamed(ID)));
  await userEvent.click(button(w.cancel, screen.getByRole('dialog')));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(button(m.deleteNamed(ID)));
});

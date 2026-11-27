/** Schnell anlegen am Fuß einer Zelle des Boards (ui.md §2.8, §2.12). */
import type { StateJson } from '@backe/ui/api.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../data/api-client.ts';
import { board, call, laneOf, registerBoardViewHarness } from '../../test/board-view.tsx';
import { testIssue } from '../../test/state.ts';
import { m } from '../../views/board.messages.ts';

registerBoardViewHarness();

const sprints = [{ slug: 's1', title: 'Sprint 1', start: '2026-11-01' }] as StateJson['sprints'];
const plusOf = (lane: string, column: string) =>
  within(laneOf(lane)).getByRole('button', { name: m.newIssue(column, lane) });
const issues = () => [testIssue(1, { sprints: ['s1'] })];

test('plus creates an issue with the title in column and lane', async () => {
  board(issues(), { over: { sprints } });
  await userEvent.click(plusOf('Sprint 1', 'todo'));
  const field = within(laneOf('Sprint 1')).getByRole('textbox', { name: m.titleLabel });
  expect(document.activeElement).toBe(field);
  await userEvent.type(field, 'T{Enter}');
  expect(call).toHaveBeenCalledWith('issue_create', {
    title: 'T',
    state: 'todo',
    projects: [],
    sprints: ['s1'],
    repos: [],
  });
  await waitFor(() => expect((field as HTMLInputElement).value).toBe(''));
  await waitFor(() => expect(document.activeElement).toBe(field));
});

test('an empty title sends nothing, escape closes', async () => {
  board(issues(), { over: { sprints } });
  const plus = plusOf('Sprint 1', 'todo');
  await userEvent.click(plus);
  await userEvent.keyboard('{Enter}');
  expect(call).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  expect(within(laneOf('Sprint 1')).queryByRole('textbox', { name: m.titleLabel })).toBeNull();
  expect(document.activeElement).toBe(plus);
});

test('a create error stays with its hint', async () => {
  board(issues(), { over: { sprints } });
  call.mockRejectedValue(new ApiError(400, 'invariant', 'Kaputt', 'backe issue create --help'));
  await userEvent.click(plusOf('Sprint 1', 'todo'));
  await userEvent.type(
    screen.getAllByRole('textbox', { name: m.titleLabel })[0] as Element,
    'T{Enter}',
  );
  expect(await screen.findByText('backe issue create --help')).toBeTruthy();
  expect(
    (screen.getAllByRole('textbox', { name: m.titleLabel })[0] as HTMLInputElement).value,
  ).toBe('T');
});

test('more opens the dialog prefilled from the lane', async () => {
  board(issues(), { over: { sprints } });
  await userEvent.click(plusOf('Sprint 1', 'review'));
  await userEvent.type(
    within(laneOf('Sprint 1')).getByRole('textbox', { name: m.titleLabel }),
    'T',
  );
  await userEvent.click(within(laneOf('Sprint 1')).getByRole('button', { name: m.more }));
  const dialog = await screen.findByRole('dialog');
  expect(
    (within(dialog).getByRole('textbox', { name: m.titleLabel }) as HTMLInputElement).value,
  ).toBe('T');
  expect(dialog.textContent).toContain('review');
  expect(dialog.textContent).toContain('s1');
  expect(call).not.toHaveBeenCalled();
});

test('no plus without write access', () => {
  board(issues(), { over: { sprints }, canWrite: false });
  expect(
    within(laneOf('Sprint 1')).queryByRole('button', { name: m.newIssue('todo', 'Sprint 1') }),
  ).toBeNull();
});

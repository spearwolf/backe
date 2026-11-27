/** Schnell anlegen am Fuß einer Zelle des Boards (ui.md §2.8, §2.12). */
import type { StateJson } from '@backe/ui/api.ts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../../data/api-client.ts';
import {
  answerNever,
  board,
  call,
  laneOf,
  registerBoardViewHarness,
} from '../../test/board-view.tsx';
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

const fieldOf = (lane: string) =>
  within(laneOf(lane)).getByRole('textbox', { name: m.titleLabel }) as HTMLInputElement;

test('a create error stays with its hint', async () => {
  board(issues(), { over: { sprints } });
  call.mockRejectedValue(new ApiError(400, 'invariant', 'Kaputt', 'backe issue create --help'));
  await userEvent.click(plusOf('Sprint 1', 'todo'));
  await userEvent.type(fieldOf('Sprint 1'), 'T{Enter}');
  expect(await screen.findByText('backe issue create --help')).toBeTruthy();
  expect(fieldOf('Sprint 1').value).toBe('T');
});

test('while the write hangs the field and more are locked and a second enter sends nothing', async () => {
  board(issues(), { over: { sprints } });
  answerNever();
  await userEvent.click(plusOf('Sprint 1', 'todo'));
  await userEvent.type(fieldOf('Sprint 1'), 'T{Enter}');
  await waitFor(() => expect(fieldOf('Sprint 1').disabled).toBe(true));
  expect(
    (within(laneOf('Sprint 1')).getByRole('button', { name: m.more }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await userEvent.keyboard('{Enter}');
  expect(call).toHaveBeenCalledTimes(1);
});

test('escape after an error closes and clears it, focus returns to plus', async () => {
  board(issues(), { over: { sprints } });
  call.mockRejectedValue(new ApiError(400, 'invariant', 'Kaputt', 'backe issue create --help'));
  const plus = plusOf('Sprint 1', 'todo');
  await userEvent.click(plus);
  await userEvent.type(fieldOf('Sprint 1'), 'T{Enter}');
  expect(await screen.findByText('backe issue create --help')).toBeTruthy();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByText('backe issue create --help')).toBeNull();
  expect(within(laneOf('Sprint 1')).queryByRole('textbox', { name: m.titleLabel })).toBeNull();
  expect(document.activeElement).toBe(plus);
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
  // Der Entwurf gehört nun dem Dialog: Feld zu, Titel weg, kein zweites Anlegen per Enter.
  // Solange der Dialog offen ist, steht das Board für Hilfsmittel versteckt; erst schließen.
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(within(laneOf('Sprint 1')).queryByRole('textbox', { name: m.titleLabel })).toBeNull();
  await userEvent.click(plusOf('Sprint 1', 'review'));
  expect(fieldOf('Sprint 1').value).toBe('');
});

test('no plus without write access', () => {
  board(issues(), { over: { sprints }, canWrite: false });
  expect(
    within(laneOf('Sprint 1')).queryByRole('button', { name: m.newIssue('todo', 'Sprint 1') }),
  ).toBeNull();
});

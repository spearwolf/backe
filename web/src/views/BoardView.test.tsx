import type { StateJson } from '@backe/ui/api.ts';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { m as w } from '../components/write/write.messages.ts';
import {
  board,
  cardIds,
  cardOf,
  cellOf,
  columnsOf,
  foldOf,
  laneLabels,
  laneOf,
  registerBoardViewHarness,
} from '../test/board-view.tsx';
import { testIssue, testPatch, tid } from '../test/state.ts';
import { m as b } from './backlog.messages.ts';
import { m } from './board.messages.ts';

registerBoardViewHarness();

const sprints = [
  { slug: 's1', title: 'Sprint 1', start: '2026-11-01' },
  { slug: 's2', title: 'Sprint 2', start: '2026-11-15' },
  { slug: 's0', title: 'Sprint 0', start: '2026-10-01', closed: true },
] as StateJson['sprints'];

const OPEN = ['todo', 'in_progress', 'review', 'done'];

test('lanes and columns follow the model', () => {
  board(
    [
      testIssue(1, { sprints: ['s1'], rank: 5000 }),
      testIssue(2, { sprints: ['s1'] }),
      testIssue(3, { state: 'in_progress', sprints: ['s1', 's2'] }),
      testIssue(4),
      testIssue(5, { state: 'backlog', sprints: ['s2'] }),
      testIssue(6, { state: 'cancelled' }),
    ],
    { over: { sprints } },
  );
  expect(laneLabels()).toEqual(['Sprint 2', 'Sprint 1', 'Sprint 0', m.noSprint]);
  expect(columnsOf('Sprint 1')).toEqual(OPEN);
  // Rang-Reihenfolge in der Zelle: `bk-t0002` (2000) vor `bk-t0001` (5000).
  expect(cardIds('Sprint 1', 'todo')).toEqual([tid(2), tid(1)]);
  // Ein Issue in zwei Sprints steht in beiden Bahnen.
  expect(cardIds('Sprint 1', 'in_progress')).toEqual([tid(3)]);
  expect(cardIds('Sprint 2', 'in_progress')).toEqual([tid(3)]);
  expect(cardIds('Sprint 2', 'todo')).toEqual([]);
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(4)]);
  // Anzahlen lesen Hilfsmittel als Satz, die Zahl daneben ist nur zum Sehen.
  const count = within(laneOf('Sprint 1')).getByText(m.cardCount(3));
  expect(count.previousElementSibling?.textContent).toBe('3');
  expect(count.previousElementSibling?.getAttribute('aria-hidden')).toBe('true');
  // Der Spaltenkopf je Bahn zählt die Karten seiner Zelle.
  const head = laneOf('Sprint 1').querySelector('[data-head="todo"]') as HTMLElement;
  expect(within(head).getByText('todo')).toBeTruthy();
  expect(within(head).getByText(m.cardCount(2))).toBeTruthy();
  const done = laneOf('Sprint 1').querySelector('[data-head="done"]') as HTMLElement;
  expect(within(done).getByText(m.cardCount(0))).toBeTruthy();
  expect(cardOf(tid(5))).toBeNull();
  expect(cardOf(tid(6))).toBeNull();
});

test('closed sprints are folded and a fold sticks', async () => {
  const issues = [testIssue(1, { sprints: ['s0'] }), testIssue(2, { sprints: ['s1'] })];
  const first = board(issues, { over: { sprints } });
  expect(foldOf('Sprint 0').getAttribute('aria-expanded')).toBe('false');
  expect(columnsOf('Sprint 0')).toEqual([]);
  expect(foldOf('Sprint 1').getAttribute('aria-expanded')).toBe('true');

  await userEvent.click(foldOf('Sprint 0'));
  expect(foldOf('Sprint 0').getAttribute('aria-expanded')).toBe('true');
  expect(cardIds('Sprint 0', 'todo')).toEqual([tid(1)]);
  await userEvent.click(foldOf('Sprint 1'));
  expect(columnsOf('Sprint 1')).toEqual([]);

  first.unmount();
  board(issues, { over: { sprints } });
  expect(foldOf('Sprint 0').getAttribute('aria-expanded')).toBe('true');
  expect(foldOf('Sprint 1').getAttribute('aria-expanded')).toBe('false');
});

test('grouping and the backlog column are remembered', async () => {
  const issues = [
    testIssue(1, { projects: ['web'] }),
    testIssue(2, { projects: ['api', 'web'], state: 'backlog' }),
    testIssue(3),
  ];
  const over = { projects: [{ path: 'web' }, { path: 'api' }] as StateJson['projects'] };
  const first = board(issues, { over });
  await userEvent.selectOptions(screen.getByLabelText(m.lanes), 'project');
  expect(laneLabels()).toEqual(['api', 'web', m.noProject]);
  expect(columnsOf('api')).toEqual(OPEN);

  await userEvent.click(screen.getByRole('checkbox', { name: m.showBacklog }));
  expect(columnsOf('api')).toEqual(['backlog', ...OPEN]);
  expect(cardIds('api', 'backlog')).toEqual([tid(2)]);
  expect(cardIds('web', 'backlog')).toEqual([tid(2)]);
  expect(JSON.parse(localStorage.getItem('backe-ui:acme:board-view') ?? 'null')).toEqual({
    group: 'project',
    showBacklog: true,
  });

  first.unmount();
  board(issues, { over });
  expect((screen.getByLabelText(m.lanes) as HTMLSelectElement).value).toBe('project');
  expect((screen.getByRole('checkbox', { name: m.showBacklog }) as HTMLInputElement).checked).toBe(
    true,
  );
  expect(laneLabels()).toEqual(['api', 'web', m.noProject]);

  // Ohne Gruppierung gibt es eine Bahn ohne Kopf.
  await userEvent.selectOptions(screen.getByLabelText(m.lanes), 'none');
  expect(laneLabels()).toEqual([m.allIssues]);
  expect(within(laneOf(m.allIssues)).queryByRole('button', { name: m.allIssues })).toBeNull();
  expect(cardIds(m.allIssues, 'todo')).toEqual([tid(1), tid(3)]);
});

test('repo lanes go by name and end with the lane without repo', async () => {
  board(
    [
      testIssue(1, { repos: ['api@main'] }),
      testIssue(2, { repos: ['web', 'api@dev'], state: 'review' }),
      testIssue(3),
    ],
    { over: { repos: [{ name: 'web' }, { name: 'core' }] as StateJson['repos'] } },
  );
  await userEvent.selectOptions(screen.getByLabelText(m.lanes), 'repo');
  // Bekannte Repos auch ohne Karte, unbekannte Namen aus den Refs, »ohne Repo« zuletzt.
  expect(laneLabels()).toEqual(['api', 'core', 'web', m.noRepo]);
  expect(cardIds('api', 'todo')).toEqual([tid(1)]);
  expect(cardIds('api', 'review')).toEqual([tid(2)]);
  expect(cardIds('web', 'review')).toEqual([tid(2)]);
  expect(cardIds('core', 'todo')).toEqual([]);
  expect(cardIds(m.noRepo, 'todo')).toEqual([tid(3)]);
  expect(cellOf(m.noRepo, 'todo').dataset.lane).toBe('');
  expect(cellOf('api', 'todo').dataset.lane).toBe('api');
});

test('a card shows title, id, initials and its marks', () => {
  board(
    [
      testIssue(1, { state: 'blocked', paused_from: 'in_progress', assignee: 'spw' }),
      testIssue(2, {
        state: 'on_hold',
        paused_from: 'todo',
        assignee: 'claude-bot',
        depends_on: [tid(3)],
      }),
      testIssue(3),
      testIssue(4, { state: 'done', parent: tid(1) }),
      testIssue(5, { state: 'cancelled', parent: tid(1) }),
      testIssue(6, { parent: tid(1) }),
    ],
    {
      over: {
        users: [
          { handle: 'spw', name: 'Wolfger Schramm', kind: 'human', admin: true },
        ] as StateJson['users'],
      },
    },
  );
  expect(cardIds(m.noSprint, 'in_progress')).toEqual([tid(1)]);
  const blocked = cardOf(tid(1));
  const card = within(blocked);
  expect(card.getByText('Issue 1')).toBeTruthy();
  expect(card.getByText(tid(1))).toBeTruthy();
  expect(card.getByText('BLOCKED')).toBeTruthy();
  expect(blocked.className).toContain('border-2');
  expect(blocked.className).toContain('border-foreground');
  expect(card.getByText('2/3')).toBeTruthy();
  const initials = card.getByRole('img', { name: 'spw' });
  expect(initials.textContent).toBe('WS');
  expect(initials.getAttribute('title')).toBe('spw');
  expect(blocked.dataset.lane).toBe('');

  const held = cardOf(tid(2));
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(2), tid(3), tid(6)]);
  expect(within(held).getByText('ON HOLD')).toBeTruthy();
  expect(held.className).not.toContain('border-2');
  expect(within(held).getByLabelText(b.openDeps)).toBeTruthy();
  expect(within(held).getByRole('img', { name: 'claude-bot' }).textContent).toBe('CB');
  expect(within(cardOf(tid(3))).queryByLabelText(b.openDeps)).toBeNull();
  expect(within(cardOf(tid(3))).queryByText('BLOCKED')).toBeNull();
});

test('a click on a card opens its issue tab', async () => {
  const { router } = board([testIssue(1)]);
  const link = within(cardOf(tid(1))).getByRole('link');
  expect(link.getAttribute('draggable')).toBe('false');
  await userEvent.click(link);
  expect(router.location.value.pathname).toBe(`/b/acme/issue/${tid(1)}`);
});

test('a patch moves the card live', () => {
  const issue = testIssue(1);
  const { store } = board([issue, testIssue(2)]);
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(1), tid(2)]);
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [{ ...issue, state: 'review' }] } }));
  });
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(2)]);
  expect(cardIds(m.noSprint, 'review')).toEqual([tid(1)]);
});

test('new issue only with write access', async () => {
  const first = board([testIssue(1)]);
  await userEvent.click(screen.getByRole('button', { name: w.newIssue }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  first.unmount();
  board([testIssue(1)], { canWrite: false });
  expect(screen.queryByRole('button', { name: w.newIssue })).toBeNull();
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(1)]);
});

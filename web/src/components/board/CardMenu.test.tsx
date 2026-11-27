/**
 * Kartenmenü des Boards: jeder Zug ohne Maus (ui.md §2.8, §2.13). Geöffnet wird es wie im Tab
 * Backlog per Rechtsklick oder Umschalt+F10 an der Karte; die Züge gehen über dieselben Wege wie
 * Ziehen und `Alt`-Tasten.
 */
import type { StateJson } from '@backe/ui/api.ts';
import type { DndContext } from '@dnd-kit/core';
import { act, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { ApiError } from '../../data/api-client.ts';
import {
  answerNever,
  board,
  call,
  cardIds,
  cardLink,
  cellOf,
  registerBoardViewHarness,
} from '../../test/board-view.tsx';
import { testIssue, testPatch, tid } from '../../test/state.ts';
import { m as b } from '../../views/backlog.messages.ts';
import { m } from '../../views/board.messages.ts';
import { m as im } from '../../views/issue.messages.ts';
import { m as w } from '../write/write.messages.ts';

type DndProps = ComponentProps<typeof DndContext>;
const dnd = vi.hoisted(() => ({ started: 0 }));

// Zählt, wie oft dnd-kit ein Ziehen beginnt; sonst das echte `DndContext`.
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@dnd-kit/core')>();
  const { createElement } = await import('react');
  return {
    ...mod,
    DndContext: (props: DndProps) =>
      createElement(mod.DndContext, {
        ...props,
        onDragStart: (e: Parameters<NonNullable<DndProps['onDragStart']>>[0]) => {
          dnd.started += 1;
          props.onDragStart?.(e);
        },
      }),
  };
});

registerBoardViewHarness();
beforeEach(() => {
  dnd.started = 0;
});

const sprints = [
  { slug: 's1', title: 'Sprint 1', start: '2026-11-01' },
  { slug: 's2', title: 'Sprint 2', start: '2026-11-15' },
] as StateJson['sprints'];

const flush = () => act(async () => {});

/** Öffnet das Menü der Karte per Rechtsklick. */
function openMenu(id: string, lane?: string): HTMLElement {
  fireEvent.contextMenu(cardLink(id, lane));
  return screen.getByRole('menu');
}

/** Öffnet das Untermenü `sub` und liefert es. */
async function openSub(id: string, sub: string, lane?: string): Promise<HTMLElement> {
  openMenu(id, lane);
  await userEvent.click(screen.getByRole('menuitem', { name: sub }));
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2));
  return screen.getAllByRole('menu')[1] as HTMLElement;
}

/** Rechtsklick auf die Karte, dann im Untermenü `sub` den Eintrag `item`. */
async function pick(id: string, sub: string, item: string | RegExp, lane?: string) {
  const menu = await openSub(id, sub, lane);
  await userEvent.click(within(menu).getByRole('menuitem', { name: item }));
}

test('the card menu moves the state optimistically', async () => {
  answerNever();
  board([testIssue(1), testIssue(2)]);
  cardLink(tid(1)).focus();
  await pick(tid(1), b.menuState, 'review');
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(2)]);
  expect(cardIds(m.noSprint, 'review')).toEqual([tid(1)]);
  expect(within(cellOf(m.noSprint, 'review')).getByText(w.pending)).toBeTruthy();
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', { id: tid(1), to: 'review' });
  // Der Fokus folgt der Karte in die neue Zelle.
  await waitFor(() => expect(document.activeElement).toBe(cardLink(tid(1))));
  expect(cellOf(m.noSprint, 'review').contains(document.activeElement)).toBe(true);
});

test('a paused card resumes from the menu', async () => {
  answerNever();
  board([
    testIssue(1, { state: 'blocked', paused_from: 'in_progress', blocked_by: [tid(2)] }),
    testIssue(2),
  ]);
  // Die Spalte bleibt dieselbe; der Wechsel geht nicht als Ablegen, sondern als `issue_resume`.
  await pick(tid(1), b.menuState, 'in_progress');
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_resume', { id: tid(1) });
  expect(within(cellOf(m.noSprint, 'in_progress')).queryByText('BLOCKED')).toBeNull();
});

test('blocked asks for blocked_by', async () => {
  board([testIssue(1), testIssue(2)]);
  cardLink(tid(1)).focus();
  await pick(tid(1), b.menuState, /blocked/);
  const dialog = screen.getByRole('dialog', { name: im.stateDialogTitle('blocked') });
  expect(call).not.toHaveBeenCalled();
  await userEvent.type(within(dialog).getByRole('combobox', { name: im.blockedBy }), tid(2));
  await userEvent.click(within(dialog).getByRole('button', { name: im.confirmState }));
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', {
    id: tid(1),
    to: 'blocked',
    blocked_by: [tid(2)],
  });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
  // Nach dem Dialog steht der Fokus wieder an der Karte.
  await waitFor(() => expect(document.activeElement).toBe(cardLink(tid(1))));
});

test('a rejected side state shows in the failures', async () => {
  call.mockRejectedValue(new ApiError(400, 'invariant', 'Kein Wechsel', 'backe issue show'));
  board([testIssue(1)]);
  await pick(tid(1), b.menuState, 'cancelled');
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', { id: tid(1), to: 'cancelled' });
  const failures = await screen.findByRole('region', { name: w.failures });
  expect(within(failures).getByText('Kein Wechsel')).toBeTruthy();
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(1)]);
});

test('with reason opens the dialog for any target', async () => {
  board([testIssue(1)]);
  cardLink(tid(1)).focus();
  const menu = await openSub(tid(1), im.withReason);
  // Dieselben Ziele wie »State«, auch die Seitenzustände.
  for (const to of ['in_progress', 'done', 'on_hold', 'cancelled']) {
    expect(within(menu).getByRole('menuitem', { name: to })).toBeTruthy();
  }
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'done' }));
  const dialog = screen.getByRole('dialog', { name: im.stateDialogTitle('done') });
  expect(call).not.toHaveBeenCalled();
  await userEvent.type(within(dialog).getByRole('textbox', { name: im.reason }), 'fertig');
  await userEvent.click(within(dialog).getByRole('button', { name: im.confirmState }));
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', {
    id: tid(1),
    to: 'done',
    reason: 'fertig',
  });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(cardLink(tid(1))));
});

test('lane entries swap the membership', async () => {
  answerNever();
  board([testIssue(1, { sprints: ['s1'] })], { over: { sprints } });
  const menu = await openSub(tid(1), m.menuLane, 'Sprint 1');
  // Alle anderen Bahnen samt »ohne Sprint«, nicht die eigene.
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent),
  ).toEqual(['Sprint 2', m.noSprint]);
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sprint 2' }));
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_update', {
    id: tid(1),
    add_sprints: ['s2'],
    rm_sprints: ['s1'],
  });
  expect(cardIds('Sprint 2', 'todo')).toEqual([tid(1)]);
  expect(cardIds('Sprint 1', 'todo')).toEqual([]);
});

test('a card with another lane of the grouping is not offered no-lane', async () => {
  board([testIssue(1, { sprints: ['s1', 's2'] })], { over: { sprints } });
  // Aus `s1` genommen, stünde sie weiter in `s2`, nie in »ohne Sprint«.
  const menu = await openSub(tid(1), m.menuLane, 'Sprint 1');
  expect(
    within(menu)
      .getAllByRole('menuitem')
      .map((i) => i.textContent),
  ).toEqual(['Sprint 2']);
});

test('group none has no lane entry', () => {
  localStorage.setItem(
    'backe-ui:acme:board-view',
    JSON.stringify({ group: 'none', showBacklog: false }),
  );
  board([testIssue(1)], { over: { sprints } });
  const menu = openMenu(tid(1));
  expect(within(menu).queryByRole('menuitem', { name: m.menuLane })).toBeNull();
  expect(within(menu).getByRole('menuitem', { name: b.menuRank })).toBeTruthy();
});

test('rank entries move within the cell', async () => {
  board([testIssue(1), testIssue(2), testIssue(3)]);
  await pick(tid(3), b.menuRank, b.rankTop);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(3), top: true });
  // Ohne Commit fällt die Vorschau gleich wieder weg; der nächste Zug geht danach hinaus.
  await flush();
  call.mockClear();
  await pick(tid(1), b.menuRank, m.rankDown);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(1), after: tid(2) });
  await flush();
  call.mockClear();
  await pick(tid(2), b.menuRank, m.rankUp);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(2), before: tid(1) });
  await flush();
  call.mockClear();
  await pick(tid(1), b.menuRank, b.rankBottom);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(1), bottom: true });
});

const disabled = (menu: HTMLElement, name: string) =>
  within(menu).getByRole('menuitem', { name }).getAttribute('aria-disabled') === 'true';

test('one up and one down are disabled at the edge of the cell, top and bottom never', async () => {
  board([testIssue(1), testIssue(2), testIssue(3, { state: 'review' })]);
  let menu = await openSub(tid(1), b.menuRank);
  expect([disabled(menu, m.rankUp), disabled(menu, m.rankDown)]).toEqual([true, false]);
  // Ganz oben und ganz unten gelten backlogweit: wählbar wie im Tab Backlog.
  expect([disabled(menu, b.rankTop), disabled(menu, b.rankBottom)]).toEqual([false, false]);
  await userEvent.keyboard('{Escape}{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  // Allein in der Zelle: weder hinauf noch hinunter, ganz oben und ganz unten bleiben.
  menu = await openSub(tid(3), b.menuRank);
  expect([disabled(menu, m.rankUp), disabled(menu, m.rankDown)]).toEqual([true, true]);
  expect([disabled(menu, b.rankTop), disabled(menu, b.rankBottom)]).toEqual([false, false]);
  await userEvent.click(within(menu).getByRole('menuitem', { name: b.rankTop }));
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(3), top: true });
});

test('the open menu follows a patch that moves a neighbour', async () => {
  const { store } = board([testIssue(1), testIssue(2)]);
  const menu = await openSub(tid(1), b.menuRank);
  expect([disabled(menu, m.rankUp), disabled(menu, m.rankDown)]).toEqual([true, false]);
  // Jemand anders setzt Karte 2 vor Karte 1, während das Menü offen ist.
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(2, { rank: 1 })] } }));
  });
  // Das offene Menü blendet den Rest für Hilfsmittel aus, darum über das DOM.
  const order = [...document.querySelectorAll<HTMLElement>('li[data-card]')].map(
    (li) => li.dataset.card,
  );
  expect(order).toEqual([tid(2), tid(1)]);
  expect([disabled(menu, m.rankUp), disabled(menu, m.rankDown)]).toEqual([false, true]);
  await userEvent.click(within(menu).getByRole('menuitem', { name: m.rankUp }));
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(1), before: tid(2) });
});

test('shift+f10 opens the menu at the focused card', async () => {
  board([testIssue(1), testIssue(2)]);
  expect(cardLink(tid(1)).getAttribute('aria-keyshortcuts')).toBe(
    'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Shift+F10',
  );
  cardLink(tid(2)).focus();
  const keyed = createEvent.keyDown(cardLink(tid(2)), { key: 'F10', shiftKey: true });
  fireEvent(cardLink(tid(2)), keyed);
  // Ohne `preventDefault` öffnete der Browser sein eigenes Menü darüber.
  expect(keyed.defaultPrevented).toBe(true);
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1));
  expect(screen.getByRole('menuitem', { name: b.menuState })).toBeTruthy();
  // Das Menü gehört der fokussierten Karte: »Eine nach oben« bewegt Karte 2.
  await userEvent.click(screen.getByRole('menuitem', { name: b.menuRank }));
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(2));
  const sub = screen.getAllByRole('menu')[1] as HTMLElement;
  await userEvent.click(within(sub).getByRole('menuitem', { name: m.rankUp }));
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(2), before: tid(1) });
});

test('the context menu key opens the menu and alt arrows in the menu do not move the card', async () => {
  board([testIssue(1), testIssue(2)]);
  cardLink(tid(1)).focus();
  fireEvent.keyDown(cardLink(tid(1)), { key: 'ContextMenu' });
  await waitFor(() => expect(screen.getAllByRole('menu')).toHaveLength(1));
  // Die Taste kommt über das Portal an der Karte an; sie meint das Menü, nicht die Karte.
  fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown', altKey: true });
  expect(call).not.toHaveBeenCalled();
});

test('without write access a card has no menu', () => {
  board([testIssue(1)], { canWrite: false });
  fireEvent.contextMenu(cardLink(tid(1)));
  expect(screen.queryByRole('menu')).toBeNull();
  const keyed = createEvent.keyDown(cardLink(tid(1)), { key: 'F10', shiftKey: true });
  fireEvent(cardLink(tid(1)), keyed);
  expect(keyed.defaultPrevented).toBe(false);
  expect(screen.queryByRole('menu')).toBeNull();
});

test('the drag hint names the menu keys', () => {
  board([testIssue(1)]);
  const hint = document.getElementById(cardLink(tid(1)).getAttribute('aria-describedby') ?? '');
  expect(hint?.textContent).toBe(m.dragHint);
  expect(m.dragHint).toMatch(/F10/);
});

/** Druck mit der primären Taste und ein Weg über die Schwelle von 5 px. */
function pressAndMove(el: Element): void {
  fireEvent.pointerDown(el, { isPrimary: true, button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 40, clientY: 40 });
  fireEvent.pointerUp(document, { isPrimary: true, clientX: 40, clientY: 40 });
}

test('a press inside the open menu does not start a card drag', async () => {
  board([testIssue(1), testIssue(2)]);
  // Gegenprobe: Auf der Karte selbst beginnt dasselbe ein Ziehen.
  pressAndMove(cardLink(tid(1)));
  expect(dnd.started).toBe(1);
  dnd.started = 0;
  openMenu(tid(1));
  // React reicht den Druck aus dem Portal durch den Komponentenbaum an die Karte weiter.
  pressAndMove(screen.getByRole('menuitem', { name: b.menuState }));
  expect(dnd.started).toBe(0);
});

const plusOf = (lane: string, column: 'todo') =>
  within(cellOf(lane, column).parentElement as HTMLElement).getByRole('button', {
    name: m.newIssue(column, lane),
  });

test('a move into the hidden backlog column hands focus to a neighbour', async () => {
  answerNever();
  // In einer Sprint-Bahn: Die bleibt auch leer stehen, »ohne Sprint« ginge mit der letzten Karte.
  board(
    [1, 2, 3].map((n) => testIssue(n, { sprints: ['s1'] })),
    { over: { sprints } },
  );
  cardLink(tid(2)).focus();
  await pick(tid(2), b.menuState, 'backlog');
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', { id: tid(2), to: 'backlog' });
  expect(cardIds('Sprint 1', 'todo')).toEqual([tid(1), tid(3)]);
  // Die Spalte `backlog` ist ausgeblendet: Der Fokus geht an die nächste Karte der alten Zelle,
  await waitFor(() => expect(document.activeElement).toBe(cardLink(tid(3))));
  // ohne nächste an die vorige,
  await pick(tid(3), b.menuState, 'backlog');
  await waitFor(() => expect(document.activeElement).toBe(cardLink(tid(1))));
  // und ohne Nachbarn an das `+` der Zelle.
  await pick(tid(1), b.menuState, 'backlog');
  await waitFor(() => expect(document.activeElement).toBe(plusOf('Sprint 1', 'todo')));
  // Kein Folgen bleibt offen: Eingeblendet greift keine der Karten nach dem Fokus.
  const show = screen.getByRole('checkbox', { name: m.showBacklog });
  await userEvent.click(show);
  expect(cardIds('Sprint 1', 'backlog')).toEqual([tid(1), tid(2), tid(3)]);
  expect(document.activeElement).toBe(show);
});

test('a rejected move into the hidden column gives focus back to the card', async () => {
  call.mockRejectedValueOnce(new ApiError(400, 'invariant', 'Nicht erlaubt', 'backe issue move'));
  board([testIssue(1), testIssue(2)]);
  cardLink(tid(1)).focus();
  await pick(tid(1), b.menuState, 'backlog');
  await flush();
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(1), tid(2)]);
  await waitFor(() => expect(document.activeElement).toBe(cardLink(tid(1))));
});

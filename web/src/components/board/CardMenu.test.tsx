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
import { testIssue, tid } from '../../test/state.ts';
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

test('rank entries at the edge of the cell are disabled', async () => {
  board([testIssue(1), testIssue(2), testIssue(3, { state: 'review' })]);
  const disabled = (menu: HTMLElement, name: string) =>
    within(menu).getByRole('menuitem', { name }).getAttribute('aria-disabled') === 'true';
  let menu = await openSub(tid(1), b.menuRank);
  expect([disabled(menu, b.rankTop), disabled(menu, m.rankUp)]).toEqual([true, true]);
  expect([disabled(menu, m.rankDown), disabled(menu, b.rankBottom)]).toEqual([false, false]);
  await userEvent.keyboard('{Escape}{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  // Allein in der Zelle: kein Rangzug ändert dort etwas.
  menu = await openSub(tid(3), b.menuRank);
  for (const name of [b.rankTop, m.rankUp, m.rankDown, b.rankBottom]) {
    expect(disabled(menu, name)).toBe(true);
  }
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

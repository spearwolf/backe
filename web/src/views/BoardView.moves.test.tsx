/**
 * Züge auf dem Board. jsdom zieht nicht mit dem Zeiger (kein Layout), darum gehen die Ablagen
 * über die Handler, die `BoardView` an `DndContext` gibt, mit nachgebauten `active`/`over`; die
 * Tastatur geht den echten Weg über die Karte.
 */
import type { State } from '@backe/core/state.ts';
import type { IssueJson, StateJson } from '@backe/ui/api.ts';
import type { ClientRect, DndContext } from '@dnd-kit/core';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { m as w } from '../components/write/write.messages.ts';
import { ApiError } from '../data/api-client.ts';
import type { Store } from '../data/store.ts';
import {
  answerCommitted,
  answerNever,
  board,
  call,
  cardIds,
  cardLink,
  cardOf,
  cellOf,
  foldOf,
  registerBoardViewHarness,
} from '../test/board-view.tsx';
import { testIssue, testPatch, tid } from '../test/state.ts';
import { m } from './board.messages.ts';
import { m as im } from './issue.messages.ts';

type DndProps = ComponentProps<typeof DndContext>;
const dnd = vi.hoisted(() => ({ props: undefined as DndProps | undefined }));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@dnd-kit/core')>();
  const { createElement } = await import('react');
  return {
    ...mod,
    DndContext: (props: DndProps) => {
      dnd.props = props;
      return createElement(mod.DndContext, props);
    },
  };
});

registerBoardViewHarness();
beforeEach(() => {
  dnd.props = undefined;
});

const sprints = [
  { slug: 's1', title: 'Sprint 1', start: '2026-11-01' },
  { slug: 's2', title: 'Sprint 2', start: '2026-11-15' },
] as StateJson['sprints'];

const box = (top: number, height = 40): ClientRect => ({
  top,
  height,
  left: 0,
  width: 100,
  bottom: top + height,
  right: 100,
});

/** Die gezogene Karte; `top` ist die Oberkante ihrer Kopie unter dem Zeiger. */
const active = (n: number, lane: string, column: State, top = 0) => ({
  id: `drag:${lane}:${tid(n)}`,
  data: { current: { type: 'card', id: tid(n), lane, column } },
  rect: { current: { initial: box(0), translated: box(top) } },
});
/** Zielkarte bei 100–140: Eine Kopie mit Oberkante 80 liegt mittig davor, mit 110 dahinter. */
const overCard = (n: number, lane: string, column: State) => ({
  id: `card:${lane}:${tid(n)}`,
  rect: box(100),
  disabled: false,
  data: { current: { type: 'card', id: tid(n), lane, column } },
});
const overCell = (lane: string, column: State) => ({
  id: `cell:${lane}:${column}`,
  rect: box(0, 400),
  disabled: false,
  data: { current: { type: 'cell', lane, column } },
});

type Fake = ReturnType<typeof active>;
type FakeOver = ReturnType<typeof overCard> | ReturnType<typeof overCell>;
const event = (a: Fake, over: FakeOver | null) =>
  ({
    active: a,
    over,
    activatorEvent: new Event('pointerdown'),
    collisions: null,
    delta: { x: 0, y: 0 },
  }) as never;

const handlers = (): DndProps => {
  if (dnd.props === undefined) throw new Error('no DndContext');
  return dnd.props;
};
function start(a: Fake): void {
  act(() => handlers().onDragStart?.({ active: a, activatorEvent: new Event('x') } as never));
}
function over(a: Fake, target: FakeOver | null): void {
  act(() => handlers().onDragOver?.(event(a, target)));
}
function drop(a: Fake, target: FakeOver | null): void {
  start(a);
  act(() => handlers().onDragEnd?.(event(a, target)));
}

/** Der Patch zum ersten Commit (`c1`): Der Server schrieb genau den ersten Zug. */
function serverWrote(store: Store, issue: IssueJson): void {
  act(() => {
    store.applyPatch({
      rev: store.rev.value + 1,
      head: 'c1',
      upsert: { issues: [issue] },
      remove: {},
    });
  });
}

const alt = (key: string) => userEvent.keyboard(`{Alt>}{${key}}{/Alt}`);
const flush = () => act(async () => {});
const failures = () => screen.getByRole('region', { name: w.failures });

test('a drop into another column is optimistic and posts issue_move', () => {
  answerNever();
  board([testIssue(1), testIssue(2)]);
  drop(active(1, '', 'todo'), overCell('', 'in_progress'));
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(2)]);
  expect(cardIds(m.noSprint, 'in_progress')).toEqual([tid(1)]);
  expect(within(cardOf(tid(1))).getByText(w.pending)).toBeTruthy();
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', { id: tid(1), to: 'in_progress' });
});

test('a drop within the cell posts issue_rank', () => {
  answerNever();
  board([testIssue(1), testIssue(2), testIssue(3)]);
  drop(active(3, '', 'todo', 80), overCard(1, '', 'todo'));
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(3), tid(1), tid(2)]);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(3), before: tid(1) });
});

test('a drop into another lane swaps the sprint with issue_update', () => {
  answerNever();
  board([testIssue(1, { sprints: ['s1'] })], { over: { sprints } });
  drop(active(1, 's1', 'todo'), overCell('s2', 'todo'));
  expect(cardIds('Sprint 1', 'todo')).toEqual([]);
  expect(cardIds('Sprint 2', 'todo')).toEqual([tid(1)]);
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_update', {
    id: tid(1),
    add_sprints: ['s2'],
    rm_sprints: ['s1'],
  });
});

test('lane and column together post one batch', () => {
  answerNever();
  board([testIssue(1, { sprints: ['s1'] })], { over: { sprints } });
  drop(active(1, 's1', 'todo'), overCell('s2', 'in_progress'));
  expect(cardIds('Sprint 2', 'in_progress')).toEqual([tid(1)]);
  expect(call).toHaveBeenCalledExactlyOnceWith('batch', {
    ops: [
      { op: 'issue.edit', id: tid(1), add: { sprints: ['s2'] }, remove: { sprints: ['s1'] } },
      { op: 'issue.move', id: tid(1), from: 'todo', to: 'in_progress' },
    ],
  });
});

test('a rejected drop springs back with the hint', async () => {
  call.mockRejectedValue(
    new ApiError(400, 'invariant', 'Nicht erlaubt', 'backe issue move --to in_progress'),
  );
  board([testIssue(1)]);
  drop(active(1, '', 'todo'), overCell('', 'done'));
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', { id: tid(1), to: 'done' });
  await flush();
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(1)]);
  expect(cardIds(m.noSprint, 'done')).toEqual([]);
  expect(within(failures()).getByText('Nicht erlaubt')).toBeTruthy();
  expect(within(failures()).getByText('backe issue move --to in_progress')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('done with open sub-issues offers force for the whole move', async () => {
  answerCommitted();
  call.mockRejectedValueOnce(
    new ApiError(400, 'invariant', 'Offene Sub-Issues', 'mit --force abschließen', {
      reason: 'open_children',
      ids: [tid(2)],
    }),
  );
  const { store } = board(
    [
      testIssue(1, { state: 'review', sprints: ['s1'] }),
      testIssue(2, { title: 'Kind', parent: tid(1) }),
    ],
    { over: { sprints } },
  );
  const card = active(1, 's1', 'review');
  drop(card, overCell('s2', 'done'));
  const edit = {
    op: 'issue.edit',
    id: tid(1),
    add: { sprints: ['s2'] },
    remove: { sprints: ['s1'] },
  };
  expect(call).toHaveBeenCalledExactlyOnceWith('batch', {
    ops: [edit, { op: 'issue.move', id: tid(1), from: 'review', to: 'done' }],
  });
  call.mockClear();
  const dialog = await screen.findByRole('dialog', { name: im.stateDialogTitle('done') });
  expect(within(dialog).getByRole('link', { name: /Kind/ })).toBeTruthy();
  expect(within(dialog).getByText('mit --force abschließen')).toBeTruthy();
  // Die Karte steht wieder, wo sie war; die Ablehnung landet im Dialog, nicht in der Anzeige.
  // (Der Dialog blendet den Rest für Hilfsmittel aus, darum über das DOM.)
  const back = document.querySelector(`li[data-card="${tid(1)}"]`)?.closest('ul');
  expect([back?.dataset.lane, back?.dataset.column]).toEqual(['s1', 'review']);
  expect(screen.queryByRole('region', { name: w.failures })).toBeNull();

  await userEvent.click(within(dialog).getByRole('button', { name: im.forceDone }));
  expect(call).toHaveBeenCalledExactlyOnceWith('batch', {
    ops: [edit, { op: 'issue.move', id: tid(1), from: 'review', to: 'done', force: true }],
  });
  await flush();
  expect(screen.queryByRole('dialog')).toBeNull();
  // Mit Commit bleibt die Vorschau bis zum Patch stehen: die Karte am neuen Platz, und der Fokus
  // geht dorthin, nicht an die Bahn, aus der sie kam.
  expect(cardIds('Sprint 2', 'done')).toEqual([tid(1)]);
  expect(document.activeElement).toBe(cardLink(tid(1), 'Sprint 2'));
  serverWrote(store, { ...testIssue(1), state: 'done', sprints: ['s2'] });
  expect(document.activeElement).toBe(cardLink(tid(1), 'Sprint 2'));
});

test('a second drop waits and sends the server state', async () => {
  answerCommitted();
  const { store } = board([testIssue(1)]);
  cardLink(tid(1)).focus();
  await alt('ArrowRight');
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', { id: tid(1), to: 'in_progress' });
  call.mockClear();
  await flush();
  // Die Vorschau steht schon in `in_progress`; der zweite Zug wartet auf den Patch des ersten.
  await alt('ArrowRight');
  expect(cardIds(m.noSprint, 'review')).toEqual([tid(1)]);
  expect(call).not.toHaveBeenCalled();
  // Der Fokus folgt schon der Vorschau des wartenden Zugs und bleibt, wenn er hinausgeht.
  expect(cellOf(m.noSprint, 'review').contains(document.activeElement)).toBe(true);
  serverWrote(store, { ...testIssue(1), state: 'in_progress' });
  await flush();
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', { id: tid(1), to: 'review' });
  expect(document.activeElement).toBe(cardLink(tid(1)));
  expect(cellOf(m.noSprint, 'review').contains(document.activeElement)).toBe(true);
});

test('a second lane and column drop carries the from of the server', async () => {
  answerCommitted();
  const { store } = board([testIssue(1, { sprints: ['s1'] })], {
    over: { sprints: [...sprints, { slug: 's3', title: 'Sprint 3', start: '2026-11-20' }] },
  });
  drop(active(1, 's1', 'todo'), overCell('s2', 'in_progress'));
  call.mockClear();
  await flush();
  drop(active(1, 's2', 'in_progress'), overCell('s3', 'review'));
  expect(call).not.toHaveBeenCalled();
  // Während der zweite wartet, zeigt die Vorschau schon `review` in `s3`; gesendet wird gegen das,
  // was der Server zum ersten schrieb.
  expect(cardIds('Sprint 3', 'review')).toEqual([tid(1)]);
  serverWrote(store, { ...testIssue(1), state: 'in_progress', sprints: ['s2'] });
  await flush();
  expect(call).toHaveBeenCalledExactlyOnceWith('batch', {
    ops: [
      { op: 'issue.edit', id: tid(1), add: { sprints: ['s3'] }, remove: { sprints: ['s2'] } },
      { op: 'issue.move', id: tid(1), from: 'in_progress', to: 'review' },
    ],
  });
});

test('a drop after the issue vanished sends nothing', async () => {
  const issue = testIssue(1);
  const { store } = board([issue, testIssue(2)]);
  const card = active(1, '', 'todo');
  start(card);
  act(() => {
    store.applyPatch(testPatch(2, { remove: { issues: [tid(1)] } }));
  });
  act(() => handlers().onDragEnd?.(event(card, overCell('', 'review'))));
  // Vom Board genommen (`cancelled`), aber noch da: ebenso nichts.
  act(() => {
    store.applyPatch(
      testPatch(3, { upsert: { issues: [{ ...testIssue(2), state: 'cancelled' }] } }),
    );
  });
  drop(active(2, '', 'todo'), overCell('', 'review'));
  // Steht die Karte nicht mehr in der Zelle, aus der sie kam, ist der Zug veraltet.
  act(() => {
    store.applyPatch(testPatch(4, { upsert: { issues: [{ ...issue, state: 'review' }] } }));
  });
  drop(active(1, '', 'todo'), overCell('', 'done'));
  await flush();
  expect(call).not.toHaveBeenCalled();
  expect(cardIds(m.noSprint, 'review')).toEqual([tid(1)]);
  expect(screen.queryByRole('region', { name: w.failures })).toBeNull();
});

test('alt arrows move the card and focus follows it', async () => {
  answerNever();
  board([testIssue(1), testIssue(2)]);
  expect(cardLink(tid(1)).getAttribute('aria-keyshortcuts')).toBe(
    'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight',
  );
  // Hilfsmittel hören die Tastenzüge als Beschreibung des Links.
  const hint = document.getElementById(cardLink(tid(1)).getAttribute('aria-describedby') ?? '');
  expect(hint?.textContent).toBe(m.dragHint);
  cardLink(tid(1)).focus();
  await alt('ArrowDown');
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(1), after: tid(2) });
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(2), tid(1)]);
  expect(document.activeElement).toBe(cardLink(tid(1)));
  call.mockClear();
  await alt('ArrowRight');
  expect(cardIds(m.noSprint, 'in_progress')).toEqual([tid(1)]);
  expect(document.activeElement).toBe(cardLink(tid(1)));
  expect(cellOf(m.noSprint, 'in_progress').contains(document.activeElement)).toBe(true);
  // Am Rand und ohne Alt geht nichts hinaus.
  call.mockClear();
  await alt('ArrowUp');
  await userEvent.keyboard('{ArrowRight}');
  expect(call).not.toHaveBeenCalled();
});

test('drag markings show the line in the cell and the other cell', () => {
  board([testIssue(1), testIssue(2), testIssue(3, { state: 'review' })]);
  const card = active(1, '', 'todo', 110);
  start(card);
  over(card, overCard(2, '', 'todo'));
  expect(cardOf(tid(2)).dataset.drop).toBe('after');
  expect(cellOf(m.noSprint, 'review').dataset.over).toBeUndefined();
  over(card, overCard(3, '', 'review'));
  expect(cardOf(tid(2)).dataset.drop).toBeUndefined();
  expect(cellOf(m.noSprint, 'review').dataset.over).toBe('true');
  act(() => handlers().onDragCancel?.(event(card, null)));
  expect(cellOf(m.noSprint, 'review').dataset.over).toBeUndefined();
  expect(call).not.toHaveBeenCalled();
});

test('without write access there is no dragging and no alt keys', async () => {
  board([testIssue(1), testIssue(2)], { canWrite: false });
  expect(dnd.props).toBeUndefined();
  expect(cardLink(tid(1)).hasAttribute('aria-keyshortcuts')).toBe(false);
  expect(cardLink(tid(1)).hasAttribute('aria-describedby')).toBe(false);
  cardLink(tid(1)).focus();
  await alt('ArrowDown');
  await alt('ArrowRight');
  expect(call).not.toHaveBeenCalled();
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(1), tid(2)]);
});

test('a rejected alt move gives focus back to the card where it was', async () => {
  call.mockRejectedValueOnce(new ApiError(400, 'invariant', 'Nicht erlaubt', 'backe issue move'));
  board([testIssue(1)]);
  cardLink(tid(1)).focus();
  await alt('ArrowRight');
  await flush();
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(1)]);
  expect(document.activeElement).toBe(cardLink(tid(1)));
  expect(cellOf(m.noSprint, 'todo').contains(document.activeElement)).toBe(true);
});

test('a pending focus ends when its lane is folded', async () => {
  let reject!: (cause: unknown) => void;
  call.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  const { store } = board([testIssue(1)]);
  cardLink(tid(1)).focus();
  await alt('ArrowRight');
  // Eingeklappt, bevor die Ablehnung kommt: Die Karte springt in eine Bahn zurück, die keiner sieht.
  await userEvent.click(foldOf(m.noSprint));
  await act(async () =>
    reject(new ApiError(400, 'invariant', 'Nicht erlaubt', 'backe issue move')),
  );
  act(() => (document.activeElement as HTMLElement).blur());
  // Aufklappen ohne Fokus (`fireEvent` fokussiert nicht) und ein Patch danach: Die Karte greift
  // nicht mehr nach dem Fokus.
  fireEvent.click(foldOf(m.noSprint));
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(2)] } }));
  });
  expect(cardIds(m.noSprint, 'todo')).toEqual([tid(1), tid(2)]);
  expect(document.activeElement).toBe(document.body);
});

test('the click that ends a drag does not open the card', async () => {
  const { router } = board([testIssue(1)]);
  const card = active(1, '', 'todo');
  start(card);
  act(() => handlers().onDragEnd?.(event(card, null)));
  // Der Klick nach dem Loslassen landet auf dem Link: verworfen, auch die native Navigation.
  expect(fireEvent.click(cardLink(tid(1)))).toBe(false);
  expect(router.location.value.pathname).toBe('/b/acme/board');
  // Der nächste Klick (mit Zeiger-Druck davor) gehört wieder dem Nutzer.
  await userEvent.click(cardLink(tid(1)));
  expect(router.location.value.pathname).toBe(`/b/acme/issue/${tid(1)}`);
});

/** Ein Ziehen von Karte 1, das ohne Ziel endet; danach wartet der Wächter auf den Klick. */
function dragAndRelease(): void {
  const card = active(1, '', 'todo');
  start(card);
  act(() => handlers().onDragEnd?.(event(card, null)));
}

test('the click guard ends with the next pointer press or key', () => {
  const { router } = board([testIssue(1)]);
  dragAndRelease();
  // Kein Klick nach dem Loslassen (der Zeiger kam woanders hoch): Der nächste Druck gehört dem Nutzer.
  fireEvent.pointerDown(cardLink(tid(1)));
  fireEvent.click(cardLink(tid(1)));
  expect(router.location.value.pathname).toBe(`/b/acme/issue/${tid(1)}`);

  act(() => router.navigate('/b/acme/board'));
  dragAndRelease();
  // Mit Esc abgebrochen folgt kein Klick; Enter am Link danach öffnet das Issue wieder.
  fireEvent.keyDown(cardLink(tid(1)), { key: 'Escape' });
  fireEvent.click(cardLink(tid(1)));
  expect(router.location.value.pathname).toBe(`/b/acme/issue/${tid(1)}`);
});

test('the click guard goes with the view', () => {
  const { unmount } = board([testIssue(1)]);
  dragAndRelease();
  unmount();
  // Kein Wächter bleibt am `window` zurück: Ein Klick anderswo behält seine Wirkung.
  const link = document.createElement('a');
  link.href = '#elsewhere';
  document.body.append(link);
  expect(fireEvent.click(link)).toBe(true);
  link.remove();
});

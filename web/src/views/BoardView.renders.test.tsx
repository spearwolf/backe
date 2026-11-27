/**
 * Wie viel ein Patch, ein Tastenzug und ein Ziehen neu rendern (ui.md §0.4: ein Board mit einigen
 * tausend Issues darf beim Ziehen nicht ruckeln). Gezählt wird je Karte die Hülle (`BoardCard`)
 * und ihr Inneres (der Aufruf von `CardMenu`), dazu je Zelle ihr
 * `QuickCreate`. Das Kartenmenü läuft echt: Abonnierte es selbst einen Kontext oder ein Signal, das
 * sich mit jedem Patch ändert, rendert es ohne seinen Aufrufer; das zählt `menu` über `useMenuKey`,
 * das jedes Rendern des echten Menüs genau einmal ruft.
 */
import type { StateJson } from '@backe/ui/api.ts';
import type { ClientRect, DndContext } from '@dnd-kit/core';
import { act, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import {
  answerCommitted,
  board,
  call,
  cardLink,
  foldOf,
  registerBoardViewHarness,
} from '../test/board-view.tsx';
import { testIssue, testPatch, tid } from '../test/state.ts';

type DndProps = ComponentProps<typeof DndContext>;
const counts = vi.hoisted(() => ({
  shell: new Map<string, number>(),
  inner: new Map<string, number>(),
  cell: new Map<string, number>(),
  menu: 0,
  hooks: new Set<string>(),
  dnd: undefined as DndProps | undefined,
}));
const bump = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);

vi.mock('../components/board/CardMenu.tsx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../components/board/CardMenu.tsx')>();
  const { createElement } = await import('react');
  return {
    CardMenu: (p: ComponentProps<typeof mod.CardMenu>) => {
      bump(counts.inner, p.issue.id);
      return createElement(mod.CardMenu, p);
    },
  };
});
vi.mock('../components/RowMenu.tsx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../components/RowMenu.tsx')>();
  return {
    ...mod,
    useMenuKey: () => {
      counts.menu += 1;
      return mod.useMenuKey();
    },
  };
});
// Je Zelle genau ein `QuickCreate`: Es zählt, wie oft die Zelle rendert.
vi.mock('../components/board/QuickCreate.tsx', () => ({
  QuickCreate: (p: { lane: string; column: string }) => {
    bump(counts.cell, `${p.lane}:${p.column}`);
    return null;
  },
}));
// Die Hülle jeder Karte: gezählt über einen `memo`-Wrapper mit denselben Props wie die echte.
vi.mock('../components/board/BoardCard.tsx', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../components/board/BoardCard.tsx')>();
  const { createElement, memo } = await import('react');
  return {
    ...mod,
    BoardCard: memo((p: ComponentProps<typeof mod.BoardCard>) => {
      bump(counts.shell, p.card.issue.id);
      return createElement(mod.BoardCard, p);
    }),
  };
});
// Wer am Kontext von dnd-kit hängt: Jeder Aufruf von `useDraggable`/`useDroppable` mit seiner ID.
vi.mock('@dnd-kit/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@dnd-kit/core')>();
  const { createElement } = await import('react');
  return {
    ...mod,
    DndContext: (props: DndProps) => {
      counts.dnd = props;
      return createElement(mod.DndContext, props);
    },
    useDraggable: (args: Parameters<typeof mod.useDraggable>[0]) => {
      counts.hooks.add(String(args.id));
      return mod.useDraggable(args);
    },
    useDroppable: (args: Parameters<typeof mod.useDroppable>[0]) => {
      counts.hooks.add(String(args.id));
      return mod.useDroppable(args);
    },
  };
});

registerBoardViewHarness();
const clear = () => {
  counts.shell.clear();
  counts.inner.clear();
  counts.cell.clear();
  counts.hooks.clear();
  counts.menu = 0;
};
beforeEach(clear);

const sprints = [{ slug: 's1', title: 'Sprint 1', start: '2026-11-01' }] as StateJson['sprints'];
const issues = () => [1, 2, 3].map((n) => testIssue(n, { sprints: ['s1'] }));
const rendered = () => ({
  shell: Object.fromEntries(counts.shell),
  inner: Object.fromEntries(counts.inner),
  cell: Object.fromEntries(counts.cell),
  menu: counts.menu,
});
/** Wie oft der Aufrufer `CardMenu` rief; rendert das echte Menü öfter, rendert es von selbst. */
const calls = () => [...counts.inner.values()].reduce((a, b) => a + b, 0);
const only = (...ids: string[]) => {
  const each = Object.fromEntries(ids.map((id) => [id, 1]));
  return { shell: each, inner: each, cell: { 's1:todo': 1 }, menu: ids.length };
};

test('a patch renders only the card and the cell it touches', () => {
  const { store } = board(issues(), { over: { sprints } });
  clear();
  act(() => {
    store.applyPatch(
      testPatch(2, { upsert: { issues: [testIssue(2, { sprints: ['s1'], title: 'Neu' })] } }),
    );
  });
  expect(rendered()).toEqual(only(tid(2)));
});

test('alt arrows render only the moved card', async () => {
  answerCommitted();
  board(issues(), { over: { sprints } });
  cardLink(tid(2)).focus();
  clear();
  // Rang: Karte 2 rückt vor Karte 1; nur sie bekommt die Vorschau.
  await act(async () => {
    fireEvent.keyDown(cardLink(tid(2)), { key: 'ArrowUp', altKey: true });
  });
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(2), before: tid(1) });
  expect(rendered().inner).toEqual({ [tid(2)]: 1 });
  expect(rendered().menu).toBe(1);
  expect(Object.keys(rendered().shell)).toEqual([tid(2)]);
  clear();
  // State: Karte 2 wechselt die Spalte; die übrigen bleiben, wie sie sind.
  await act(async () => {
    fireEvent.keyDown(cardLink(tid(2)), { key: 'ArrowRight', altKey: true });
  });
  expect(Object.keys(rendered().inner)).toEqual([tid(2)]);
  expect(rendered().menu).toBe(calls());
  expect(Object.keys(rendered().shell)).toEqual([tid(2)]);
});

const box = (top: number): ClientRect => ({
  top,
  height: 40,
  left: 0,
  width: 100,
  bottom: top + 40,
  right: 100,
});
const active = (n: number) => ({
  id: 'board-card',
  data: { current: { type: 'card', id: tid(n), lane: 's1', column: 'todo' } },
  rect: { current: { initial: box(0), translated: box(0) } },
});
/** Die Zelle `s1:todo` mit der Einfügestelle vor der Karte `n` (gestellte Rechtecke, jsdom). */
const overSlot = (n: number) => ({
  id: 'cell:s1:todo',
  rect: box(0),
  disabled: false,
  data: {
    current: {
      type: 'cell',
      lane: 's1',
      column: 'todo',
      list: {
        current: {
          children: [{ dataset: { card: tid(n) }, getBoundingClientRect: () => box(500) }],
        },
      },
    },
  },
});
const dragOver = (n: number) =>
  act(() =>
    counts.dnd?.onDragOver?.({
      active: active(3),
      over: overSlot(n),
      activatorEvent: new Event('pointerdown'),
      collisions: null,
      delta: { x: 0, y: 0 },
    } as never),
  );

test('a moving drag marker renders no card face', () => {
  board(issues(), { over: { sprints } });
  act(() =>
    counts.dnd?.onDragStart?.({ active: active(3), activatorEvent: new Event('x') } as never),
  );
  clear();
  dragOver(1);
  dragOver(2);
  // Die Linie wandert von Karte 1 zu Karte 2: Nur ihre Hüllen rendern, das Innere keiner Karte.
  expect(rendered().inner).toEqual({});
  expect(rendered().menu).toBe(0);
  expect(Object.keys(rendered().shell).sort()).toEqual([tid(1), tid(2)]);
  // Die Markierung steht in einer Zelle; die übrigen Zellen und Bahnen rendern nicht mit.
  expect(Object.keys(rendered().cell)).toEqual(['s1:todo']);
});

test('folding a lane renders only that lane', async () => {
  board(issues(), {
    over: { sprints: [...sprints, { slug: 's2', title: 'Sprint 2', start: '2026-11-15' }] },
  });
  clear();
  fireEvent.click(foldOf('Sprint 2'));
  fireEvent.click(foldOf('Sprint 2'));
  // Aufgeklappt rendert `s2` frisch; `s1` bleibt, wie es war.
  expect(Object.keys(rendered().cell).every((k) => k.startsWith('s2:'))).toBe(true);
  expect(rendered().shell).toEqual({});
  expect(rendered().menu).toBe(0);
});

test('a real pointer drag renders no card', () => {
  board(issues(), { over: { sprints } });
  clear();
  // Echte Zeiger-Ereignisse: dnd-kit beginnt nach 5 px zu ziehen und ändert dabei seinen Kontext.
  // Daran hängen nur die eine Drag-Quelle und die Zellen, keine Karte.
  const li = document.querySelector(`li[data-card="${tid(1)}"]`) as HTMLElement;
  fireEvent.pointerDown(li, { isPrimary: true, button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 0, clientY: 20 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 0, clientY: 60 });
  expect(li.hasAttribute('data-dragging')).toBe(true);
  // jsdom hat kein Layout: Alle Rechtecke sind leer, die Kopie liegt unter der letzten Karte, und
  // die Linie dahinter kommt und geht. Rendern darf höchstens diese eine Hülle und ihre Zelle.
  expect(Object.keys(rendered().shell).filter((id) => id !== tid(3))).toEqual([]);
  expect(Object.keys(rendered().cell).filter((k) => k !== 's1:todo')).toEqual([]);
  expect(rendered().inner).toEqual({});
  expect(rendered().menu).toBe(0);
  // Am Kontext von dnd-kit: die eine Quelle und die Zellen, keine Karte.
  expect([...counts.hooks].filter((id) => id !== 'board-card' && !id.startsWith('cell:'))).toEqual(
    [],
  );
  expect(counts.hooks.has('board-card')).toBe(true);
  fireEvent.pointerUp(document, { isPrimary: true, clientX: 0, clientY: 60 });
  expect(li.hasAttribute('data-dragging')).toBe(false);
});

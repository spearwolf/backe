/**
 * Wie viel ein Patch, ein Tastenzug und ein Ziehen neu rendern (ui.md §0.4: ein Board mit einigen
 * tausend Issues darf beim Ziehen nicht ruckeln). Gezählt wird je Karte zweimal: die Hülle mit den
 * Hooks von dnd-kit (`useDraggable`) und ihr Inneres samt Kartenmenü (`CardMenu`).
 */
import type { ClientRect, DndContext } from '@dnd-kit/core';
import { act, fireEvent } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
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
  dnd: undefined as DndProps | undefined,
}));
const bump = (map: Map<string, number>, id: string) => map.set(id, (map.get(id) ?? 0) + 1);

vi.mock('../components/board/CardMenu.tsx', () => ({
  CardMenu: (p: { issue: { id: string }; children: ReactNode }) => {
    bump(counts.inner, p.issue.id);
    return p.children;
  },
}));
// Je Zelle genau ein `QuickCreate`: Es zählt, wie oft die Zelle rendert.
vi.mock('../components/board/QuickCreate.tsx', () => ({
  QuickCreate: (p: { lane: string; column: string }) => {
    bump(counts.cell, `${p.lane}:${p.column}`);
    return null;
  },
}));
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
      // `drag:<Bahn>:<ID>`; gezählt wird je Issue.
      bump(counts.shell, String(args.id).split(':').at(-1) ?? '');
      return mod.useDraggable(args);
    },
  };
});

registerBoardViewHarness();
const clear = () => {
  counts.shell.clear();
  counts.inner.clear();
  counts.cell.clear();
};
beforeEach(clear);

const sprints = [{ slug: 's1', title: 'Sprint 1', start: '2026-11-01' }];
const issues = () => [1, 2, 3].map((n) => testIssue(n, { sprints: ['s1'] }));
const rendered = () => ({
  shell: Object.fromEntries(counts.shell),
  inner: Object.fromEntries(counts.inner),
  cell: Object.fromEntries(counts.cell),
});
const only = (...ids: string[]) => {
  const each = Object.fromEntries(ids.map((id) => [id, 1]));
  return { shell: each, inner: each, cell: { 's1:todo': 1 } };
};

test('a patch renders only the card and the cell it touches', () => {
  const { store } = board(issues(), { over: { sprints } as never });
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
  board(issues(), { over: { sprints } as never });
  cardLink(tid(2)).focus();
  clear();
  // Rang: Karte 2 rückt vor Karte 1; nur sie bekommt die Vorschau.
  await act(async () => {
    fireEvent.keyDown(cardLink(tid(2)), { key: 'ArrowUp', altKey: true });
  });
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_rank', { id: tid(2), before: tid(1) });
  expect(rendered().inner).toEqual({ [tid(2)]: 1 });
  expect(Object.keys(rendered().shell)).toEqual([tid(2)]);
  clear();
  // State: Karte 2 wechselt die Spalte; die übrigen bleiben, wie sie sind.
  await act(async () => {
    fireEvent.keyDown(cardLink(tid(2)), { key: 'ArrowRight', altKey: true });
  });
  expect(Object.keys(rendered().inner)).toEqual([tid(2)]);
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
  id: `drag:s1:${tid(n)}`,
  data: { current: { type: 'card', id: tid(n), lane: 's1', column: 'todo' } },
  rect: { current: { initial: box(0), translated: box(110) } },
});
const overCard = (n: number) => ({
  id: `card:s1:${tid(n)}`,
  rect: box(100),
  disabled: false,
  data: { current: { type: 'card', id: tid(n), lane: 's1', column: 'todo' } },
});
const dragOver = (n: number) =>
  act(() =>
    counts.dnd?.onDragOver?.({
      active: active(1),
      over: overCard(n),
      activatorEvent: new Event('pointerdown'),
      collisions: null,
      delta: { x: 0, y: 0 },
    } as never),
  );

test('a moving drag marker renders no card face', () => {
  board(issues(), { over: { sprints } as never });
  act(() =>
    counts.dnd?.onDragStart?.({ active: active(1), activatorEvent: new Event('x') } as never),
  );
  clear();
  dragOver(2);
  dragOver(3);
  // Die Linie wandert von Karte 2 zu Karte 3: Nur ihre Hüllen rendern, das Innere keiner Karte.
  expect(rendered().inner).toEqual({});
  expect(Object.keys(rendered().shell).sort()).toEqual([tid(2), tid(3)]);
  // Die Markierung steht in einer Zelle; die übrigen Zellen und Bahnen rendern nicht mit.
  expect(Object.keys(rendered().cell)).toEqual(['s1:todo']);
});

test('folding a lane renders only that lane', async () => {
  board(issues(), {
    over: {
      sprints: [...sprints, { slug: 's2', title: 'Sprint 2', start: '2026-11-15' }],
    } as never,
  });
  clear();
  fireEvent.click(foldOf('Sprint 2'));
  fireEvent.click(foldOf('Sprint 2'));
  // Aufgeklappt rendert `s2` frisch; `s1` bleibt, wie es war.
  expect(Object.keys(rendered().cell).every((k) => k.startsWith('s2:'))).toBe(true);
  expect(rendered().shell).toEqual({});
});

test('a real pointer drag renders the shells, not the card faces', () => {
  board(issues(), { over: { sprints } as never });
  clear();
  // Echte Zeiger-Ereignisse: dnd-kit beginnt nach 5 px zu ziehen und ändert dabei seinen Kontext,
  // den jede Karte als Ziel liest.
  const li = document.querySelector(`li[data-card="${tid(1)}"]`) as HTMLElement;
  fireEvent.pointerDown(li, { isPrimary: true, button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 0, clientY: 20 });
  fireEvent.pointerMove(document, { isPrimary: true, clientX: 0, clientY: 60 });
  expect(li.className).toContain('opacity-50');
  expect(Object.keys(rendered().shell).sort()).toEqual([tid(1), tid(2), tid(3)]);
  expect(rendered().inner).toEqual({});
  fireEvent.pointerUp(document, { isPrimary: true, clientX: 0, clientY: 60 });
});

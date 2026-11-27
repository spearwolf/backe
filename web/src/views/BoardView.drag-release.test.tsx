/**
 * Die Drag-Quelle gibt sich frei, wenn der Zeiger des Drucks hochgeht, auch ohne Meldung von
 * dnd-kit: Kommt `pointerup`, bevor React den Start des Zugs gerendert hat, meldet dnd-kit weder
 * Ende noch Abbruch. Hier schweigt der Monitor von dnd-kit ganz; ohne den eigenen Weg bliebe die
 * Quelle nach dem ersten Zug gesperrt.
 */
import type { StateJson } from '@backe/ui/api.ts';
import type { DndContext } from '@dnd-kit/core';
import { fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { board, registerBoardViewHarness } from '../test/board-view.tsx';
import { testIssue, tid } from '../test/state.ts';

type DndProps = ComponentProps<typeof DndContext>;
const seen = vi.hoisted(() => ({ started: [] as (string | undefined)[] }));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@dnd-kit/core')>();
  const { createElement } = await import('react');
  return {
    ...mod,
    useDndMonitor: () => {},
    DndContext: (props: DndProps) =>
      createElement(mod.DndContext, {
        ...props,
        onDragStart: (e: Parameters<NonNullable<DndProps['onDragStart']>>[0]) => {
          seen.started.push((e.active.data.current as { id?: string } | undefined)?.id);
          props.onDragStart?.(e);
        },
      }),
  };
});

registerBoardViewHarness();
beforeEach(() => {
  seen.started.length = 0;
});

const sprints = [{ slug: 's1', title: 'Sprint 1', start: '2026-11-01' }] as StateJson['sprints'];

function dragCard(n: number, pointerId: number): void {
  const li = document.querySelector(`li[data-card="${tid(n)}"]`) as HTMLElement;
  fireEvent.pointerDown(li, { isPrimary: true, button: 0, pointerId, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(document, { isPrimary: true, pointerId, clientX: 0, clientY: 30 });
  fireEvent.pointerUp(document, { isPrimary: true, pointerId, clientX: 0, clientY: 30 });
}

test('the pointer going up frees the source even without word from dnd-kit', () => {
  board(
    [1, 2, 3].map((n) => testIssue(n, { sprints: ['s1'] })),
    { over: { sprints } },
  );
  dragCard(1, 1);
  dragCard(3, 1);
  // Ein anderer Zeiger, der hochgeht, gibt einen laufenden Druck nicht frei.
  const li = document.querySelector(`li[data-card="${tid(2)}"]`) as HTMLElement;
  fireEvent.pointerDown(li, { isPrimary: true, button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerUp(window, { isPrimary: true, pointerId: 7 });
  fireEvent.pointerDown(document.querySelector(`li[data-card="${tid(1)}"]`) as HTMLElement, {
    isPrimary: true,
    button: 0,
    pointerId: 2,
    clientX: 0,
    clientY: 0,
  });
  fireEvent.pointerMove(document, { isPrimary: true, pointerId: 1, clientX: 0, clientY: 30 });
  fireEvent.pointerUp(document, { isPrimary: true, pointerId: 1, clientX: 0, clientY: 30 });
  expect(seen.started).toEqual([tid(1), tid(3), tid(2)]);
});

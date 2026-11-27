/**
 * Große Zellen virtualisiert (`board-virtual.tsx`): Ab `VIRTUAL_FROM` Karten rendert eine Zelle nur
 * die Karten in Sichtweite, und das Fokus-Folgen holt eine Karte, die außerhalb davon landet, ins
 * Bild. jsdom rechnet kein Layout; die Stubs geben dem Scrollbereich 600 px Höhe, jeder Karte 66 px
 * und lassen `scrollTo` scrollen.
 */
import { act, fireEvent, waitFor } from '@testing-library/react';
import { VIRTUAL_FROM } from '../components/board/board-virtual.tsx';
import {
  answerNever,
  board,
  call,
  cardIds,
  cardLink,
  registerBoardViewHarness,
} from '../test/board-view.tsx';
import { testIssue, tid } from '../test/state.ts';
import { m } from './board.messages.ts';

const CARD = 66;
const keys = ['clientHeight', 'clientWidth', 'scrollTo', 'scrollHeight', 'offsetHeight'] as const;
const saved = keys.map(
  (k) => [k, Object.getOwnPropertyDescriptor(HTMLElement.prototype, k)] as const,
);
const savedRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1024 });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      if (options.top !== undefined) this.scrollTop = options.top;
      this.dispatchEvent(new Event('scroll'));
    },
  });
  // Genug Inhalt zum Scrollen; Karten 66 px hoch (gemessen über `offsetHeight`), sonst wie jsdom.
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, value: 1e6 });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this instanceof HTMLLIElement && this.dataset.card !== undefined ? CARD : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element) {
      const height = this instanceof HTMLLIElement && this.dataset.card !== undefined ? CARD : 0;
      return {
        top: 0,
        left: 0,
        right: 0,
        bottom: height,
        width: 0,
        height,
        x: 0,
        y: 0,
        toJSON() {},
      };
    },
  });
});
afterAll(() => {
  for (const [k, desc] of saved) {
    if (desc !== undefined) Object.defineProperty(HTMLElement.prototype, k, desc);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
  }
  if (savedRect !== undefined)
    Object.defineProperty(Element.prototype, 'getBoundingClientRect', savedRect);
});

registerBoardViewHarness();

const many = (count: number) => Array.from({ length: count }, (_, i) => testIssue(i + 1));

test('a big cell renders only the cards in sight', () => {
  board(many(VIRTUAL_FROM + 50));
  const shown = cardIds(m.noSprint, 'todo');
  expect(shown[0]).toBe(tid(1));
  expect(shown.length).toBeGreaterThan(5);
  expect(shown.length).toBeLessThan(40);
  // Die übrigen Karten stehen als Innenabstand unter den gerenderten.
  const ul = document.querySelector<HTMLElement>('ul[data-column="todo"]');
  expect(Number.parseFloat(ul?.style.paddingBottom ?? '0')).toBeGreaterThan(CARD * 100);
});

test('a small cell renders every card', () => {
  board(many(VIRTUAL_FROM - 1));
  expect(cardIds(m.noSprint, 'todo')).toHaveLength(VIRTUAL_FROM - 1);
});

test('focus follows a card moved past the rendered cards of a big cell', async () => {
  answerNever();
  // Die letzte Karte steht in `in_progress`; mit Alt+← geht sie nach `todo`, ans Ende nach Rang.
  const last = VIRTUAL_FROM + 50;
  board([...many(last - 1), testIssue(last, { state: 'in_progress' })]);
  cardLink(tid(last)).focus();
  await act(async () => {
    fireEvent.keyDown(cardLink(tid(last)), { key: 'ArrowLeft', altKey: true });
  });
  expect(call).toHaveBeenCalledExactlyOnceWith('issue_move', { id: tid(last), to: 'todo' });
  await waitFor(() => expect(document.activeElement).toBe(cardLink(tid(last))));
  expect(cardIds(m.noSprint, 'todo')).not.toContain(tid(1));
});

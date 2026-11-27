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
  cardOf,
  registerBoardViewHarness,
} from '../test/board-view.tsx';
import { testIssue, testPatch, tid } from '../test/state.ts';
import { m } from './board.messages.ts';

const CARD = 66;
/** Höhe jeder Karte im Stub; ein Test setzt sie höher als die Schätzung des Virtualizers. */
let cardHeight = CARD;
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
      return this instanceof HTMLLIElement && this.dataset.card !== undefined ? cardHeight : 0;
    },
  });
  Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
    configurable: true,
    value(this: Element) {
      const height =
        this instanceof HTMLLIElement && this.dataset.card !== undefined ? cardHeight : 0;
      // Eine Zelle wandert wie im Browser mit dem Scrollstand nach oben; der Scrollbereich steht.
      const cell = this instanceof HTMLUListElement && this.dataset.column !== undefined;
      const top = cell ? -(this.closest<HTMLElement>('[data-board-scroller]')?.scrollTop ?? 0) : 0;
      return {
        top,
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
afterEach(() => {
  cardHeight = CARD;
});

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

test('rendered cards of a big cell name their place and the length of the cell', () => {
  board(many(VIRTUAL_FROM + 50));
  const li = cardOf(tid(2));
  expect(li.getAttribute('aria-posinset')).toBe('2');
  expect(li.getAttribute('aria-setsize')).toBe(String(VIRTUAL_FROM + 50));
});

test('a cell crossing the threshold keeps its cards and the focus', () => {
  const { store } = board(many(VIRTUAL_FROM - 1));
  const li = cardOf(tid(1));
  cardLink(tid(1)).focus();
  // Ein Patch aus dem CLI hebt die Zelle über die Schwelle: dasselbe `<li>`, derselbe Fokus.
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(VIRTUAL_FROM)] } }));
  });
  expect(cardOf(tid(1))).toBe(li);
  expect(document.activeElement).toBe(cardLink(tid(1)));
  expect(cardOf(tid(1)).getAttribute('aria-setsize')).toBe(String(VIRTUAL_FROM));
  // Und zurück unter die Schwelle.
  act(() => {
    store.applyPatch(testPatch(3, { remove: { issues: [tid(VIRTUAL_FROM)] } }));
  });
  expect(cardOf(tid(1))).toBe(li);
  expect(document.activeElement).toBe(cardLink(tid(1)));
});

test('a focused card scrolled out of sight leaves the focus with its cell', () => {
  board(many(VIRTUAL_FROM + 50));
  cardLink(tid(1)).focus();
  const scroller = document.querySelector<HTMLElement>('[data-board-scroller]') as HTMLElement;
  act(() => scroller.scrollTo({ top: CARD * 120 }));
  expect(cardIds(m.noSprint, 'todo')).not.toContain(tid(1));
  expect(document.activeElement).toBe(document.querySelector('ul[data-column="todo"]'));
});

const scrollerOf = () =>
  document.querySelector<HTMLElement>('[data-board-scroller]') as HTMLElement;
const todoCell = () => document.querySelector('ul[data-column="todo"]');

test('a card moved out of a big cell and back still takes the focus', async () => {
  answerNever();
  // Karte 120 tief in `todo`, `in_progress` leer und klein.
  board([...many(VIRTUAL_FROM + 50)]);
  act(() => scrollerOf().scrollTo({ top: (CARD + 8) * 119 }));
  cardLink(tid(120)).focus();
  await act(async () => {
    fireEvent.keyDown(cardLink(tid(120)), { key: 'ArrowRight', altKey: true });
  });
  await waitFor(() => expect(document.activeElement).toBe(cardLink(tid(120))));
  // Oben in der Nachbarzelle; `todo` zeigt wieder ihren Anfang.
  act(() => scrollerOf().scrollTo({ top: 0 }));
  await act(async () => {
    fireEvent.keyDown(cardLink(tid(120)), { key: 'ArrowLeft', altKey: true });
  });
  // Zurück an ihren Rang, weit unter den gerenderten: Der Fokus folgt der Karte, nicht der Zelle.
  await waitFor(() => expect(document.activeElement).toBe(cardLink(tid(120))));
  expect(document.activeElement).not.toBe(todoCell());
});

test('crossing the threshold keeps a focused card deep in the cell, even when cards are taller', () => {
  // Echte Karten 86 px statt der geschätzten 66: Mit der Schätzung läge Karte 60 weit oberhalb.
  cardHeight = 86;
  const { store } = board(many(VIRTUAL_FROM - 1));
  act(() => scrollerOf().scrollTo({ top: (86 + 8) * 59 }));
  const li = cardOf(tid(60));
  cardLink(tid(60)).focus();
  act(() => {
    store.applyPatch(testPatch(2, { upsert: { issues: [testIssue(VIRTUAL_FROM)] } }));
  });
  expect(cardOf(tid(60))).toBe(li);
  expect(document.activeElement).toBe(cardLink(tid(60)));
});

test('a focused cell keeps the focus when it falls below the threshold', () => {
  const { store } = board(many(VIRTUAL_FROM));
  const cell = todoCell() as HTMLElement;
  cell.focus();
  expect(document.activeElement).toBe(cell);
  act(() => {
    store.applyPatch(testPatch(2, { remove: { issues: [tid(VIRTUAL_FROM)] } }));
  });
  expect(todoCell()).toBe(cell);
  expect(document.activeElement).toBe(cell);
});

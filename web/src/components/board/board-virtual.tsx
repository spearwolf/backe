import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type ComponentProps,
  createContext,
  type FocusEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { BoardCard as Card } from '../../app/board-model.ts';

/**
 * Große Zellen des Boards virtualisiert (ui.md §2.8 »Große Zellen«, §2.17): Ab `VIRTUAL_FROM`
 * Karten rendert eine Zelle nur die Karten in Sichtweite. Mit Tausenden Karten im DOM kosten
 * Hit-Testing, Layout und der Abgleich der Kartenliste jeden Frame mehr als einen Frame, und
 * »Board-Drag bis zur optimistischen Anzeige im selben Frame« ginge nicht. Kleine Zellen bleiben
 * vollständig im DOM — über dasselbe `<ul>`, damit eine Zelle, die die Schwelle kreuzt, weder ihre
 * Karten noch den Fokus darin neu aufbaut.
 */

/** Ab so vielen Karten rendert eine Zelle nur die sichtbaren. */
export const VIRTUAL_FROM = 100;
/** Geschätzte Höhe einer Karte in px (einzeilig mit Avatar); gemessen wird jede gerenderte. */
const CARD_ESTIMATE = 66;
/** Abstand der Karten (`gap-2`) und Innenabstand der Zelle (`p-2`) in px. */
const GAP = 8;
const PAD = 8;

/** Markiert den Scrollbereich des Boards; an ihm messen und scrollen die virtualisierten Zellen. */
export const BOARD_SCROLLER = 'data-board-scroller';

/**
 * Der Scrollbereich um `node`. Über das DOM, nicht über einen Ref des Boards: Die Layout-Effekte
 * der Zelle laufen, bevor React den Ref am (äußeren) Scrollbereich setzt.
 */
const scrollerOf = (node: Element | null): HTMLElement | null =>
  node?.closest<HTMLElement>(`[${BOARD_SCROLLER}]`) ?? null;

/**
 * Holt die Karte `id` in einer virtualisierten Zelle der Bahn `lane` ins Bild und ruft danach
 * `shown` mit ihrem Link; `false`, wenn keine solche Zelle sie hält. Für das Fokus-Folgen nach einem
 * Tastenzug (`use-board-move`): Die Karte kann außerhalb der gerenderten Karten landen.
 */
export type RevealCard = (lane: string, id: string, shown: (link: HTMLElement) => void) => boolean;

type Reveal = (id: string, shown: (link: HTMLElement) => void) => boolean;

/**
 * Die virtualisierten Zellen eines Boards: Sie holen auf Wunsch eine Karte ins Bild (`reveal`) und
 * messen nach, wo sie im gescrollten Inhalt beginnen (`relayout`, nach jedem Render des Boards).
 * Ein stabiles Objekt statt eines Kontextwerts, der sich ändert: Dessen Wechsel liefe in React über
 * jede Fiber jeder Karte.
 */
export class VirtualCells {
  readonly #cells = new Map<string, { lane: string; reveal: Reveal }>();
  readonly #layout = new Set<() => void>();

  add(key: string, lane: string, reveal: Reveal): () => void {
    const entry = { lane, reveal };
    this.#cells.set(key, entry);
    return () => {
      if (this.#cells.get(key) === entry) this.#cells.delete(key);
    };
  }

  readonly reveal: RevealCard = (lane, id, shown) => {
    for (const cell of this.#cells.values()) {
      if (cell.lane === lane && cell.reveal(id, shown)) return true;
    }
    return false;
  };

  onRelayout(measure: () => void): () => void {
    this.#layout.add(measure);
    return () => this.#layout.delete(measure);
  }

  /** Bahnen können sich umordnen, ohne dass sich die Höhe des Inhalts ändert. */
  relayout(): void {
    for (const measure of this.#layout) measure();
  }
}

export const VirtualCellsContext = createContext<VirtualCells | undefined>(undefined);

/**
 * Ein gerenderter Platz in einer virtualisierten Zelle: Index, Zahl aller Karten der Zelle (für
 * `aria-posinset`/`aria-setsize`, sonst nennt die Liste Hilfsmitteln nur die gerenderten) und der
 * Ref zum Messen.
 */
export type CardSlot = { index: number; count: number; measure: (node: Element | null) => void };

/**
 * Das `<ul>` einer Zelle samt Karten. Ab `VIRTUAL_FROM` nur die sichtbaren; die übrigen stehen als
 * Innenabstand oben und unten, so bleiben die gerenderten Karten direkte Kinder des `<ul>` in ihrer
 * Reihenfolge — Einfügestelle (`slotAt`), Fokus und Markierung arbeiten auf ihnen wie in einer
 * kleinen Zelle. Fällt die fokussierte Karte beim Scrollen aus dem gerenderten Bereich, geht der
 * Fokus an das `<ul>`, nicht an `body`.
 */
export function CellCards(props: {
  ul: ComponentProps<'ul'> & { ref: RefObject<HTMLUListElement | null> };
  lane: string;
  column: string;
  cards: readonly Card[];
  render: (card: Card, slot: CardSlot | undefined) => ReactNode;
}) {
  const { ul, lane, column, cards, render } = props;
  const virtual = cards.length >= VIRTUAL_FROM;
  const cells = useContext(VirtualCellsContext);
  // Wo die erste Karte im gescrollten Inhalt beginnt; nachgemessen bei jeder Größenänderung des
  // Inhalts (`ResizeObserver`) und nach jedem Render des Boards (`VirtualCells.relayout`), auch
  // unter der Schwelle: Kreuzt eine Zelle sie, steht der Wert schon. Gerendert wird darüber nur
  // virtualisiert, eine kleine Zelle braucht ihn nicht.
  const margin = useRef(0);
  const live = useRef(virtual);
  live.current = virtual;
  const [, remeasured] = useState(0);
  // Fläche und Scrollstand von Anfang an: Kreuzt eine Zelle die Schwelle, hätte der Virtualizer im
  // ersten Render sonst keinen Bereich, die Karten verschwänden für einen Render, und mit ihnen
  // der Fokus.
  const area = scrollerOf(ul.ref.current);
  const virtualizer = useVirtualizer({
    enabled: virtual,
    count: cards.length,
    getScrollElement: () => scrollerOf(ul.ref.current),
    estimateSize: () => CARD_ESTIMATE,
    gap: GAP,
    overscan: 6,
    scrollMargin: margin.current,
    getItemKey: (i) => cards[i]?.issue.id ?? i,
    ...(area === null
      ? {}
      : { initialRect: { width: area.clientWidth, height: area.clientHeight } }),
    initialOffset: () => scrollerOf(ul.ref.current)?.scrollTop ?? 0,
  });
  // Alle Zellen teilen sich einen Scrollbereich: Korrigierte eine Zelle `scrollTop`, weil eine Karte
  // über dem Bild ihre echte Höhe bekommt, sprängen die Nachbarspalten mit.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;

  const measure = useCallback(() => {
    const list = ul.ref.current;
    const area = scrollerOf(list);
    if (area === null || list === null) return;
    const top = list.getBoundingClientRect().top - area.getBoundingClientRect().top;
    const next = Math.round(top + area.scrollTop + PAD);
    if (next === margin.current) return;
    margin.current = next;
    if (live.current) remeasured(next);
  }, [ul.ref]);
  useLayoutEffect(() => {
    measure();
    const off = cells?.onRelayout(measure);
    const content = scrollerOf(ul.ref.current)?.firstElementChild;
    const watch =
      content === null || content === undefined || typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(measure);
    if (content !== null && content !== undefined) watch?.observe(content);
    return () => {
      off?.();
      watch?.disconnect();
    };
  }, [measure, cells, ul.ref]);

  // Hereinholen auf Wunsch: erst scrollen, nach dem Render den Link melden.
  const pending = useRef<{ id: string; shown: (link: HTMLElement) => void } | undefined>(undefined);
  useLayoutEffect(() => {
    if (!virtual || cells === undefined) return;
    return cells.add(`${lane}\n${column}`, lane, (id, shown) => {
      const index = cards.findIndex((c) => c.issue.id === id);
      if (index < 0) return false;
      pending.current = { id, shown };
      virtualizer.scrollToIndex(index, { align: 'auto' });
      return true;
    });
  }, [virtual, cells, lane, column, virtualizer, cards]);

  // Die Karte, die den Fokus hat. Ein `blur` von einem Knoten, der gerade aus dem DOM geht, zählt
  // nicht: Das ist die Karte, die aus dem gerenderten Bereich fällt.
  const focused = useRef<string | undefined>(undefined);
  const onFocus = (e: FocusEvent<HTMLUListElement>) => {
    focused.current = (e.target as Element).closest<HTMLElement>('li[data-card]')?.dataset.card;
  };
  const onBlur = (e: FocusEvent<HTMLUListElement>) => {
    const from = e.target as Node;
    if (!from.isConnected) return;
    const to = e.relatedTarget as Node | null;
    if (to === null || !e.currentTarget.contains(to)) focused.current = undefined;
  };

  useLayoutEffect(() => {
    const list = ul.ref.current;
    if (list === null) return;
    const shown = (id: string) =>
      list.querySelector<HTMLElement>(`:scope > li[data-card="${CSS.escape(id)}"] a`);
    const p = pending.current;
    if (p !== undefined) {
      const link = shown(p.id);
      if (link !== null) {
        pending.current = undefined;
        p.shown(link);
      }
    }
    // Nur, wenn die Karte noch in dieser Zelle steht: Ging sie per Zug woanders hin, folgt ihr der
    // Fokus über `use-board-move`, und das `<ul>` darf ihn nicht vorher an sich nehmen.
    const id = focused.current;
    const active = document.activeElement;
    if (
      virtual &&
      id !== undefined &&
      (active === null || active === document.body) &&
      shown(id) === null &&
      cards.some((c) => c.issue.id === id)
    ) {
      list.focus({ preventScroll: true });
    }
  });

  if (!virtual) {
    return <ul {...ul}>{cards.map((card) => render(card, undefined))}</ul>;
  }
  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items.at(-1);
  const total = virtualizer.getTotalSize();
  const before = first === undefined ? 0 : first.start - margin.current;
  const after = last === undefined ? total : Math.max(total - (last.end - margin.current), 0);
  return (
    <ul
      {...ul}
      tabIndex={-1}
      onFocus={onFocus}
      onBlur={onBlur}
      style={{ paddingTop: PAD + before, paddingBottom: PAD + after }}
    >
      {items.map((item) => {
        const card = cards[item.index];
        return card === undefined
          ? null
          : render(card, {
              index: item.index,
              count: cards.length,
              measure: virtualizer.measureElement,
            });
      })}
    </ul>
  );
}

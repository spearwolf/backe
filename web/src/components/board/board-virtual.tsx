import { useVirtualizer } from '@tanstack/react-virtual';
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { BoardCard as Card } from '../../app/board-model.ts';

/**
 * Große Zellen des Boards virtualisiert (ui.md §0.4, §2.17): Ab `VIRTUAL_FROM` Karten rendert eine
 * Zelle nur die Karten in Sichtweite. Mit Tausenden Karten im DOM kosten Hit-Testing, Layout und
 * der Abgleich der Kartenliste jeden Frame mehr als einen Frame, und »Board-Drag bis zur
 * optimistischen Anzeige im selben Frame« ginge nicht. Kleine Zellen bleiben vollständig im DOM.
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

/** Die Zellen, die gerade virtualisieren, je Bahn und Spalte. */
export class CardRevealers {
  readonly #cells = new Map<
    string,
    { lane: string; reveal: (id: string, shown: (link: HTMLElement) => void) => boolean }
  >();

  add(
    key: string,
    lane: string,
    reveal: (id: string, shown: (link: HTMLElement) => void) => boolean,
  ) {
    this.#cells.set(key, { lane, reveal });
    return () => {
      if (this.#cells.get(key)?.reveal === reveal) this.#cells.delete(key);
    };
  }

  readonly reveal: RevealCard = (lane, id, shown) => {
    for (const cell of this.#cells.values()) {
      if (cell.lane === lane && cell.reveal(id, shown)) return true;
    }
    return false;
  };
}

export const CardRevealContext = createContext<CardRevealers | undefined>(undefined);

/** Ein gerenderter Platz: die Karte, ihr Index in der Zelle und der Ref zum Messen. */
export type CardSlot = { card: Card; index: number; measure: (node: Element | null) => void };

/**
 * Das `<ul>` einer großen Zelle mit nur den sichtbaren Karten. Die übrigen stehen als Innenabstand
 * oben und unten, so bleiben die gerenderten Karten direkte Kinder des `<ul>` in ihrer Reihenfolge —
 * Einfügestelle (`slotAt`), Fokus und Markierung arbeiten auf ihnen wie in einer kleinen Zelle.
 */
export function VirtualCards(props: {
  ul: ComponentProps<'ul'> & { ref: RefObject<HTMLUListElement | null> };
  lane: string;
  column: string;
  cards: readonly Card[];
  render: (slot: CardSlot) => ReactNode;
}) {
  const { ul, lane, column, cards, render } = props;
  const revealers = useContext(CardRevealContext);
  // Abstand der ersten Karte vom Anfang des gescrollten Inhalts; ändert sich, wenn darüber etwas
  // wächst oder schrumpft (Bahnen klappen, Patches), darum über einen `ResizeObserver` nachgeführt.
  const [margin, setMargin] = useState(0);
  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => scrollerOf(ul.ref.current),
    estimateSize: () => CARD_ESTIMATE,
    gap: GAP,
    overscan: 6,
    scrollMargin: margin,
    getItemKey: (i) => cards[i]?.issue.id ?? i,
  });

  useLayoutEffect(() => {
    const list = ul.ref.current;
    const area = scrollerOf(list);
    if (area === null || list === null) return;
    const update = () => {
      const top = list.getBoundingClientRect().top - area.getBoundingClientRect().top;
      setMargin(Math.round(top + area.scrollTop + PAD));
    };
    update();
    const content = area.firstElementChild;
    if (content === null || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(update);
    watch.observe(content);
    return () => watch.disconnect();
  }, [ul.ref]);

  // Hereinholen auf Wunsch: erst scrollen, nach dem Render den Link melden.
  const pending = useRef<{ id: string; shown: (link: HTMLElement) => void } | undefined>(undefined);
  useLayoutEffect(() => {
    if (revealers === undefined) return;
    return revealers.add(`${lane}\n${column}`, lane, (id, shown) => {
      const index = cards.findIndex((c) => c.issue.id === id);
      if (index < 0) return false;
      pending.current = { id, shown };
      virtualizer.scrollToIndex(index, { align: 'auto' });
      return true;
    });
  }, [revealers, lane, column, virtualizer, cards]);
  useLayoutEffect(() => {
    const p = pending.current;
    if (p === undefined) return;
    const link = ul.ref.current?.querySelector<HTMLElement>(
      `:scope > li[data-card="${CSS.escape(p.id)}"] a`,
    );
    if (link === null || link === undefined) return;
    pending.current = undefined;
    p.shown(link);
  });

  const items = virtualizer.getVirtualItems();
  const first = items[0];
  const last = items.at(-1);
  const total = virtualizer.getTotalSize();
  const before = first === undefined ? 0 : first.start - margin;
  const after = last === undefined ? total : Math.max(total - (last.end - margin), 0);
  return (
    <ul {...ul} style={{ paddingTop: PAD + before, paddingBottom: PAD + after }}>
      {items.map((item) => {
        const card = cards[item.index];
        return card === undefined
          ? null
          : render({ card, index: item.index, measure: virtualizer.measureElement });
      })}
    </ul>
  );
}

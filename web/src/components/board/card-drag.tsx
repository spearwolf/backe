import type { State } from '@backe/core/state.ts';
import { useDndMonitor, useDraggable, useDroppable } from '@dnd-kit/core';
import {
  createContext,
  type PointerEvent,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { CardData, CellData } from './board-dnd.ts';
import { BOARD_SCROLLER } from './board-virtual.tsx';

/**
 * Ziehen auf dem Board (ui.md §2.8) ohne Karten im Kontext von dnd-kit. Ändert sich der Kontext
 * (Start, Zielwechsel, jede Bewegung, Ende), sucht React im ganzen Teilbaum unter `DndContext` nach
 * Lesern und läuft dabei über jede Fiber jeder Karte, `memo` hin oder her — bei Tausenden Karten
 * ein Long Task je Ereignis. Darum steht das Board neben dem `DndContext`, nicht darunter: Darin
 * stehen nur die eine Drag-Quelle (`CardDragSource`), je Zelle ein `CellTarget` ohne eigenes DOM
 * und die Kopie unter dem Zeiger. Das `pointerdown` fängt der Scrollbereich des Boards ab und reicht
 * es über `CardPress` an die Quelle.
 */

/** Die ID der einen Drag-Quelle; welche Karte sie gerade zieht, steht in ihren Daten. */
export const CARD_DRAG_ID = 'board-card';

/** Der Handler der Quelle für ein `pointerdown` im Board; `undefined`, solange keine Quelle steht. */
export type CardPress = { current: ((e: PointerEvent<HTMLElement>) => void) | undefined };

/**
 * Die gedrückte Karte aus einem `pointerdown`: das `<li data-card>` um das Ziel samt Zelle, nur
 * wenn es im DOM unter `root` liegt. React reicht Ereignisse aus einem Portal (Kartenmenü,
 * Dialog) durch den Komponentenbaum herauf; deren Ziel liegt außerhalb jeder Karte und zählt nicht.
 */
export function pressedCard(
  root: Element,
  target: EventTarget | null,
): { node: HTMLLIElement; data: CardData } | undefined {
  if (!(target instanceof Element)) return undefined;
  const node = target.closest<HTMLLIElement>('li[data-card]');
  if (node === null || !root.contains(node)) return undefined;
  const id = node.dataset.card;
  const lane = node.dataset.lane;
  const column = node.parentElement?.dataset.column;
  if (id === undefined || lane === undefined || column === undefined) return undefined;
  return { node, data: { type: 'card', id, lane, column: column as State } };
}

/**
 * Die einzige Drag-Quelle des Boards, im `DndContext`. Ein Druck setzt die gedrückte Karte als
 * Knoten und Daten und reicht das Ereignis an den Listener von dnd-kit.
 *
 * Die Daten gehen über einen State: dnd-kit liest sie erst beim Aktivieren, also nach den 5 px aus
 * `POINTER` in `BoardView` — da hat React den Druck längst gerendert. Der Knoten dagegen muss
 * sofort stehen, dnd-kit misst ihn beim Aktivieren; `setNodeRef` setzt ihn ohne Render.
 *
 * Ein Druck zählt nur mit dem primären Zeiger und der linken Taste (wie beim `PointerSensor`) und
 * nur, solange kein Zug läuft oder aussteht: Ein zweiter Zeiger (Finger neben der Maus, Stift)
 * tauschte sonst mitten im Zug die Daten, und das Ablegen verschöbe die falsche Karte. Laufend
 * heißt: vom angenommenen Druck bis Ende, Abbruch (Esc) oder Abbruch vor den 5 px.
 *
 * Die gezogene Karte ist halb durchsichtig über eine Regel nach ihrer ID, ohne Render der Karte. Eine
 * Regel statt eines Attributs am `<li>`: In einer virtualisierten Zelle kann die Karte beim
 * Auto-Scroll aus dem Bild fallen und mit einem neuen `<li>` zurückkommen.
 */
export function CardDragSource({ press }: { press: CardPress }) {
  const [pressed, setPressed] = useState<{ node: HTMLLIElement; data: CardData }>();
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: CARD_DRAG_ID,
    ...(pressed === undefined ? {} : { data: pressed.data }),
  });
  const busy = useRef(false);
  // Frei wird die Quelle mit Ende, Abbruch oder Abbruch vor den 5 px — und spätestens, wenn der
  // Zeiger des Drucks hochgeht oder abbricht: Kommt `pointerup`, bevor React den Start des Zugs
  // gerendert hat (schneller Wisch im selben Frame), meldet dnd-kit weder Ende noch Abbruch.
  const release = useRef<(() => void) | undefined>(undefined);
  const free = () => {
    busy.current = false;
    release.current?.();
  };
  useDndMonitor({ onDragEnd: free, onDragCancel: free, onDragAbort: free });
  useEffect(() => () => release.current?.(), []);
  // Nach jedem Render der aktuelle Handler: `listeners` kommen von dnd-kit und ändern sich mit ihm.
  useLayoutEffect(() => {
    press.current = (e) => {
      if (busy.current || !e.isPrimary || e.button !== 0) return;
      // Schon von einem anderen Sensor gefangen: dnd-kit nimmt den Druck dann nicht an.
      const native = e.nativeEvent as { dndKit?: unknown };
      if (native.dndKit !== undefined) return;
      const card = pressedCard(e.currentTarget, e.target);
      if (card === undefined) return;
      setNodeRef(card.node);
      setPressed(card);
      (listeners?.onPointerDown as ((e: PointerEvent) => void) | undefined)?.(e);
      busy.current = native.dndKit !== undefined;
      if (!busy.current) return;
      const { pointerId } = e;
      const up = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId === pointerId) free();
      };
      release.current?.();
      window.addEventListener('pointerup', up, true);
      window.addEventListener('pointercancel', up, true);
      release.current = () => {
        window.removeEventListener('pointerup', up, true);
        window.removeEventListener('pointercancel', up, true);
        release.current = undefined;
      };
    };
    return () => {
      press.current = undefined;
    };
  });
  if (!isDragging || pressed === undefined) return null;
  const { id, lane } = pressed.data;
  return (
    <style data-dragging={id}>
      {`[${BOARD_SCROLLER}] li[data-card="${CSS.escape(id)}"][data-lane="${CSS.escape(lane)}"] { opacity: 0.5; }`}
    </style>
  );
}

/**
 * Das Ziel einer Zelle im `DndContext`, ohne eigenes DOM: Es meldet das `<ul>` aus `data.list` bei
 * dnd-kit an. Nach jedem Render neu, denn eine Zelle, die beim Auf- und Zuklappen neu entsteht,
 * bringt ein neues `<ul>` in denselben Ref; eingeklappt ist er leer und das Ziel ohne Fläche.
 */
export function CellTarget({ data }: { data: CellData }) {
  const { setNodeRef } = useDroppable({ id: `cell:${data.lane}:${data.column}`, data });
  useLayoutEffect(() => {
    setNodeRef(data.list?.current ?? null);
  });
  return null;
}

/** Die Daten jeder Zelle, je Bahn und Spalte dasselbe Objekt samt Ref auf ihr `<ul>`. */
export type CellDataOf = (
  lane: string,
  column: State,
) => CellData & {
  list: RefObject<HTMLUListElement | null>;
};

/** Ein Zwischenspeicher für `CellDataOf`, über Renders dieselbe Funktion. */
export function useCellDataOf(): CellDataOf {
  const [of] = useState<CellDataOf>(() => {
    const cache = new Map<string, ReturnType<CellDataOf>>();
    return (lane: string, column: State) => {
      const key = `${lane}\n${column}`;
      let data = cache.get(key);
      if (data === undefined) {
        data = { type: 'cell', lane, column, list: { current: null } };
        cache.set(key, data);
      }
      return data;
    };
  });
  return of;
}

/** Wo die Zellen ihren Ref auf das `<ul>` herbekommen; ohne Board (Tests einzelner Bahnen) keiner. */
export const CellDataContext = createContext<CellDataOf | undefined>(undefined);
export const useCellData = (lane: string, column: State) =>
  useContext(CellDataContext)?.(lane, column);

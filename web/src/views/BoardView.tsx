import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { m as app } from '../app/app.messages.ts';
import {
  type BoardGroup,
  boardColumns,
  type BoardCard as Card,
  type BoardLane as Lane,
} from '../app/board-model.ts';
import type { BoardDrop } from '../app/board-move.ts';
import { BoardModel, BoardPrefs } from '../app/board-state.ts';
import { useUiPrefs } from '../app/ui-context.tsx';
import { BoardCardCopy } from '../components/board/BoardCard.tsx';
import {
  BoardLane,
  boardMinWidth,
  type LaneMarker,
  useLaneChoices,
} from '../components/board/BoardLane.tsx';
import { BoardToolbar } from '../components/board/BoardToolbar.tsx';
import { boardCollision, type CardData, dropFrom } from '../components/board/board-dnd.ts';
import { type BoardKey, keyDrop } from '../components/board/board-keys.ts';
import {
  BOARD_SCROLLER,
  VirtualCells,
  VirtualCellsContext,
} from '../components/board/board-virtual.tsx';
import {
  CardDragSource,
  type CardPress,
  CellDataContext,
  CellTarget,
  useCellDataOf,
} from '../components/board/card-drag.tsx';
import {
  BoardKeyContext,
  BoardMoveContext,
  useBoardMove,
} from '../components/board/use-board-move.tsx';
import type { Store } from '../data/store.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { useWrites } from '../data/write-context.tsx';
import { useOwned } from '../lib/use-owned.ts';
import { m } from './board.messages.ts';

/** Ansichtszustand aus dem `localStorage`, darüber das Modell der Bahnen. */
class BoardViewState {
  readonly prefs: BoardPrefs;
  readonly model: BoardModel;

  constructor(store: Store, backlog: string, defaultGroup?: BoardGroup) {
    this.prefs = new BoardPrefs(backlog, defaultGroup);
    this.model = new BoardModel(store, this.prefs.view.get);
  }

  dispose(): void {
    this.model.dispose();
    this.prefs.dispose();
  }
}

/**
 * Tab Board (ui.md §2.8): Werkzeugleiste oben, darunter die Bahnen. Lädt als eigener Chunk
 * (`React.lazy` in `App.tsx`), damit Backlog und Issue-Tab den Board-Code nicht mittragen.
 */
export function BoardView({ backlog }: { backlog: string }) {
  const store = useStore();
  const ui = useUiPrefs();
  // Die Default-Gruppierung zählt nur beim Aufbau: Ein Wechsel in Settings stellt kein offenes
  // Board um.
  const create = useCallback(
    () => new BoardViewState(store, backlog, ui?.boardGroup.value),
    [store, backlog, ui],
  );
  const state = useOwned(backlog, create);
  const loaded = useSignal(store.loaded);
  if (state === undefined || !loaded) {
    return <p className="p-4 text-sm text-muted-foreground">{app.loading}</p>;
  }
  return <Loaded state={state} backlog={backlog} />;
}

function Loaded({ state, backlog }: { state: BoardViewState; backlog: string }) {
  const view = useSignal(state.prefs.view);
  const lanes = useSignal(state.model.lanes);
  // Abonniert die Klappzustände; `isFolded` liest sie beim Rendern.
  useSignal(state.prefs.folded);
  const { canWrite } = useWrites();
  const { group } = view;
  const columns = useMemo(() => boardColumns(view), [view]);
  // Virtualisierte Zellen melden sich hier an; das Fokus-Folgen holt über sie eine Karte ins Bild.
  const [cells] = useState(() => new VirtualCells());
  const { move, openState, dialogs } = useBoardMove(group, cells.reveal);
  // Nach jedem Render: Bahnen können sich umordnen, ohne dass sich die Höhe des Inhalts ändert, und
  // virtualisierte Zellen messen dann nach, wo sie beginnen.
  useLayoutEffect(() => cells.relayout());
  const moves = useMemo(() => ({ move, openState }), [move, openState]);
  const drag = useBoardDrag(lanes, move);
  const press = useRef<CardPress['current']>(undefined);
  const cellData = useCellDataOf();

  // Die Tastenzüge lesen Bahnen und Spalten von gerade eben, sind selbst aber stabil: Ein Patch
  // ändert die Bahnen, und die Karten (`memo`) sollen deswegen nicht alle neu rendern.
  const latest = useRef({ lanes, columns });
  useLayoutEffect(() => {
    latest.current = { lanes, columns };
  });
  const hintId = useId();
  const keys = useMemo(
    () => ({
      hintId,
      lanes: state.model.lanes,
      onKey: (card: CardData, key: BoardKey) => {
        const drop = keyDrop(latest.current.lanes, card, key, latest.current.columns);
        if (drop !== undefined) move(drop, { focus: true });
      },
    }),
    [move, hintId, state],
  );
  const choices = useLaneChoices(group, lanes);
  // Stabil je Gruppierung: Die Bahnen sind `memo`, ein neuer Rückruf je Render renderte alle.
  const onFold = useCallback(
    (key: string, folded: boolean) => state.prefs.setFolded(group, key, folded),
    [state, group],
  );

  const body = (
    <div style={{ minWidth: boardMinWidth(columns.length) }}>
      {lanes.map((lane) => (
        <BoardLane
          key={`${group}\n${lane.key}`}
          backlog={backlog}
          group={group}
          lane={lane}
          folded={group !== 'none' && state.prefs.isFolded(group, lane)}
          onFold={onFold}
          marker={drag.markerIn(lane.key)}
          choices={choices}
        />
      ))}
    </div>
  );
  return (
    <BoardMoveContext.Provider value={moves}>
      <BoardKeyContext.Provider value={canWrite ? keys : undefined}>
        <div className="flex h-full min-h-0 flex-col">
          <BoardToolbar view={view} onView={(next) => state.prefs.setView(next)} />
          <div
            {...{ [BOARD_SCROLLER]: '' }}
            className="min-h-0 flex-1 overflow-auto"
            {...(canWrite ? { onPointerDown: (e) => press.current?.(e) } : {})}
          >
            <VirtualCellsContext.Provider value={cells}>
              <CellDataContext.Provider value={cellData}>{body}</CellDataContext.Provider>
            </VirtualCellsContext.Provider>
            {canWrite && (
              // Neben dem Board, nicht darum (`card-drag.tsx`): Die Quelle, je Zelle ein Ziel und die
              // Kopie unter dem Zeiger, sonst nichts, was mit dem Kontext von dnd-kit rendern müsste.
              <DndContext
                sensors={drag.sensors}
                collisionDetection={boardCollision}
                accessibility={DND_ACCESSIBILITY}
                onDragStart={drag.onDragStart}
                onDragOver={drag.onDragOver}
                onDragMove={drag.onDragOver}
                onDragEnd={drag.onDragEnd}
                onDragCancel={drag.onDragCancel}
              >
                <CardDragSource press={press} />
                {lanes.flatMap((lane) =>
                  lane.cells.map((cell) => (
                    <CellTarget
                      key={`${group}\n${lane.key}\n${cell.column}`}
                      data={cellData(lane.key, cell.column)}
                    />
                  )),
                )}
                {/* Ohne Rückflug: Nach dem Ablegen steht die Karte (als Vorschau) schon am Ziel. */}
                <DragOverlay dropAnimation={null}>
                  {drag.dragged === undefined ? null : <BoardCardCopy card={drag.dragged} />}
                </DragOverlay>
              </DndContext>
            )}
          </div>
        </div>
        {/* Beschreibt jedem Kartenlink die Tastenzüge (`aria-describedby`); sichtbar nur dort. */}
        {canWrite && (
          <p id={hintId} hidden>
            {m.dragHint}
          </p>
        )}
        {dialogs}
      </BoardKeyContext.Provider>
    </BoardMoveContext.Provider>
  );
}

/**
 * Hilfsmittel: dnd-kit sagt sonst auf Englisch »Picked up draggable item drag:…« an und beschreibt
 * eine Leertasten-Bedienung, die es hier nicht gibt (nur `PointerSensor`). Die Tastatur geht über
 * Alt+Pfeil an der Karte; die Ansagen bleiben darum stumm. Die Anleitung von dnd-kit hängt an den
 * `attributes`, die die Karte nicht übernimmt; ihr Text ist nur gesetzt, damit kein englischer im
 * DOM steht — den Kartenlinks beschreibt `m.dragHint` die Züge über ein eigenes Element.
 */
const silent = () => undefined;
const DND_ACCESSIBILITY = {
  announcements: {
    onDragStart: silent,
    onDragOver: silent,
    onDragEnd: silent,
    onDragCancel: silent,
  },
  screenReaderInstructions: { draggable: m.dragHint },
};

/**
 * Schluckt den Klick, mit dem ein Ziehen endet. dnd-kit hält ihn nur mit `stopPropagation` auf;
 * landet er auf einem Link, navigierte der Browser trotzdem — an `go()` vorbei, mit einem
 * Neuladen der Seite. Am `window` in der Capture-Phase, vor dem Listener von dnd-kit am Dokument.
 * Ohne Timer: Der Wächter endet mit dem geschluckten Klick, sonst mit dem nächsten Zeiger-Druck
 * oder der nächsten Taste (nach Esc folgt kein Klick, und der nächste gehört wieder dem Nutzer).
 */
function swallowNextClick(win: Window): () => void {
  const off = () => {
    win.removeEventListener('click', swallow, true);
    win.removeEventListener('pointerdown', off, true);
    win.removeEventListener('keydown', off, true);
  };
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    off();
  };
  win.addEventListener('click', swallow, true);
  win.addEventListener('pointerdown', off, true);
  win.addEventListener('keydown', off, true);
  return off;
}

const sameMarker = (a: Marker | undefined, b: Marker | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.lane === b.lane &&
    a.at.kind === b.at.kind &&
    a.at.column === b.at.column &&
    (a.at.kind === 'cell' ||
      (b.at.kind === 'line' && a.at.id === b.at.id && a.at.side === b.at.side)));

type Marker = { lane: string; at: LaneMarker };

/** Was ein Ablegen markiert: in derselben Zelle die Linie am Anker, sonst die Zielzelle. */
function markerOf(drop: BoardDrop | undefined): Marker | undefined {
  if (drop === undefined) return undefined;
  const { to, anchor } = drop;
  if (anchor === undefined) return { lane: to.lane, at: { kind: 'cell', column: to.column } };
  const [id, side] =
    'before' in anchor ? [anchor.before, 'before' as const] : [anchor.after, 'after' as const];
  return { lane: to.lane, at: { kind: 'line', id, column: to.column, side } };
}

/**
 * Erst ab 5 px Weg zieht der Zeiger, damit ein Klick weiter den Tab öffnet; `CardDragSource` liest
 * die gedrückte Karte darum erst nach dem Render des Drucks. Eine Konstante, kein Literal im
 * Render: `useSensor` merkt sich die Optionen nach ihrer Identität, und ein neues Objekt je Render
 * gäbe dnd-kit neue Aktivatoren und damit Quelle und Zellen einen neuen Kontext.
 */
const POINTER = { activationConstraint: { distance: 5 } };

/**
 * Ziehen mit dem Zeiger (ui.md §2.8), ab dem Weg aus `POINTER`.
 * `onDragOver` und `onDragMove` halten das Ziel für die Markierung — `onDragOver` allein meldet nur
 * den Wechsel des Ziels, nicht den der Hälfte über derselben Karte. `onDragEnd` legt ab.
 */
function useBoardDrag(lanes: readonly Lane[], move: (drop: BoardDrop) => void) {
  const sensors = useSensors(useSensor(PointerSensor, POINTER));
  const [dragged, setDragged] = useState<Card>();
  const [marker, setMarker] = useState<Marker>();
  const current = useRef(lanes);
  useLayoutEffect(() => {
    current.current = lanes;
  });
  const clear = () => {
    setDragged(undefined);
    setMarker(undefined);
  };
  // Endet der Lauf ohne Klick, räumt der Abbau der Ansicht den Wächter weg.
  const unguard = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => unguard.current?.(), []);
  return {
    sensors,
    dragged,
    markerIn: (lane: string) => (marker?.lane === lane ? marker.at : undefined),
    onDragStart: ({ active }: DragStartEvent) => {
      unguard.current?.();
      unguard.current = swallowNextClick(window);
      const data = active.data.current as CardData | undefined;
      const card = current.current
        .find((l) => l.key === data?.lane)
        ?.cells.find((c) => c.column === data?.column)
        ?.cards.find((c) => c.issue.id === data?.id);
      setDragged(card);
    },
    onDragOver: (event: DragOverEvent) => {
      const next = markerOf(dropFrom(event, current.current));
      setMarker((prev) => (sameMarker(prev, next) ? prev : next));
    },
    onDragEnd: (event: DragEndEvent) => {
      const drop = dropFrom(event, current.current);
      clear();
      if (drop !== undefined) move(drop);
    },
    onDragCancel: clear,
  };
}

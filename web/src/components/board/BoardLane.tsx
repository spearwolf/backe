import type { State } from '@backe/core/state.ts';
import { useDroppable } from '@dnd-kit/core';
import { ChevronRight } from 'lucide-react';
import { memo, useId, useMemo, useState } from 'react';
import {
  type BoardGroup,
  type BoardCell as Cell,
  type BoardLane as Lane,
  NO_LANE,
} from '../../app/board-model.ts';
import { useWrites } from '../../data/write-context.tsx';
import { cn } from '../../lib/utils.ts';
import { m } from '../../views/board.messages.ts';
import { StateIcon } from '../StateIcon.tsx';
import { BoardCard } from './BoardCard.tsx';
import type { CellData } from './board-dnd.ts';
import { QuickCreate } from './QuickCreate.tsx';

/** Markierung beim Ziehen in einer Bahn: Linie an einer Karte, oder eine Zelle hervorgehoben. */
export type LaneMarker =
  | { kind: 'line'; id: string; column: State; side: 'before' | 'after' }
  | { kind: 'cell'; column: State };

/** Mindestbreite einer Spalte; die Abstände in `boardMinWidth` folgen `gap-x-3` und `px-3` des Rasters. */
const COLUMN_MIN = '16rem';

/**
 * Mindestbreite des Boards bei `columns` Spalten. Steht sie am gemeinsamen Inhalt der
 * Scrollfläche, reichen Kopf und Rand jeder Bahn über die ganze gescrollte Breite; liefe nur das
 * Raster über, endeten sie am Rand des Fensters. `max-content` taugt dafür nicht: Es mäße die
 * Karten an ihrem ungebrochenen Titel.
 */
export function boardMinWidth(columns: number): string {
  return `calc(${columns} * ${COLUMN_MIN} + ${Math.max(columns - 1, 0)} * 0.75rem + 1.5rem)`;
}

/** Anzahl: sichtbar die Zahl, für Hilfsmittel als Satz; `title` allein liest nicht jeder vor. */
function Count({ count }: { count: number }) {
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      <span aria-hidden="true">{count}</span>
      <span className="sr-only">{m.cardCount(count)}</span>
    </span>
  );
}

const NO_LANE_LABEL: Record<BoardGroup, () => string> = {
  sprint: () => m.noSprint,
  project: () => m.noProject,
  repo: () => m.noRepo,
  none: () => m.allIssues,
};

/** Sichtbarer Name der Bahn; `NO_LANE` heißt je Gruppierung »ohne …«, bei `none` »alle Issues«. */
export function laneLabel(group: BoardGroup, lane: Pick<Lane, 'key' | 'label'>): string {
  return lane.key === NO_LANE ? NO_LANE_LABEL[group]() : lane.label;
}

/** Ein Eintrag unter »Bahn«: Schlüssel und sichtbarer Name. */
export type LaneChoice = { key: string; label: string };

/**
 * Die Bahnen der Gruppierung als Einträge, samt »ohne …« auch dann, wenn darin gerade nichts steht
 * (das Modell zeigt die Bahn erst mit einer Karte); bei `none` keine — es gibt nur die eine.
 */
export function laneChoices(group: BoardGroup, lanes: readonly Lane[]): LaneChoice[] {
  if (group === 'none') return [];
  const choices = lanes.map((lane) => ({ key: lane.key, label: laneLabel(group, lane) }));
  if (!lanes.some((lane) => lane.key === NO_LANE)) {
    choices.push({ key: NO_LANE, label: laneLabel(group, { key: NO_LANE, label: '' }) });
  }
  return choices;
}

const sameChoices = (a: readonly LaneChoice[], b: readonly LaneChoice[]): boolean =>
  a.length === b.length && a.every((c, i) => c.key === b[i]?.key && c.label === b[i]?.label);

/**
 * `laneChoices` als Wert, der über Patches gleich bleibt, solange sich Bahnen und Namen nicht
 * ändern: Er geht an jede Karte (`memo`), und ein Patch soll nicht alle neu rendern.
 */
export function useLaneChoices(group: BoardGroup, lanes: readonly Lane[]): LaneChoice[] {
  const next = laneChoices(group, lanes);
  const [held, setHeld] = useState(next);
  if (sameChoices(held, next)) return held;
  setHeld(next);
  return next;
}

/**
 * Eine Bahn (ui.md §2.8): Kopf mit Klappknopf und Anzahl, darunter je State eine Spalte mit Kopf
 * und Zelle. Bei `none` gibt es nur diese eine Bahn, ohne Kopf. Jede Zelle ist genau ein `<ul>`
 * mit `data-lane`/`data-column` — die Fläche, auf der abgelegt wird. Bahn und Zelle sind `memo`
 * mit stabilen Props (`BoardModel` hält Unverändertes als dieselben Objekte): Ein Patch oder eine
 * wandernde Markierung rendert nur die Bahn und die Zelle, die sie betreffen.
 */
export const BoardLane = memo(function BoardLane(props: {
  backlog: string;
  group: BoardGroup;
  lane: Lane;
  folded: boolean;
  /** Klappt die Bahn `key` auf oder zu; über Renders dieselbe Funktion. */
  onFold: (key: string, folded: boolean) => void;
  marker?: LaneMarker | undefined;
  /** Die Bahnen fürs Kartenmenü (`useLaneChoices`). */
  choices: readonly LaneChoice[];
}) {
  const { backlog, group, lane, folded, onFold, marker, choices } = props;
  const id = useId();
  const label = laneLabel(group, lane);
  const headless = group === 'none';
  const labelId = `${id}-label`;
  const cellsId = `${id}-cells`;
  return (
    <section
      {...(headless ? { 'aria-label': label } : { 'aria-labelledby': labelId })}
      className="border-b"
    >
      {!headless && (
        // Klebt an der linken Kante der Scrollfläche: Scrollt das Board waagerecht, bleibt der Name
        // der Bahn zu sehen. Nur so breit wie der Inhalt, sonst hätte `sticky` keinen Weg; der
        // Rand darunter gehört der `section` und reicht weiter über die ganze Breite.
        <div className="sticky left-0 flex w-fit items-center gap-2 px-3 py-2">
          <h2 className="text-sm font-semibold">
            <button
              id={labelId}
              type="button"
              aria-expanded={!folded}
              aria-controls={folded ? undefined : cellsId}
              onClick={() => onFold(lane.key, !folded)}
              className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight
                className={cn('size-4 shrink-0 transition-transform', !folded && 'rotate-90')}
                aria-hidden="true"
              />
              <span>{label}</span>
            </button>
          </h2>
          <Count count={lane.count} />
        </div>
      )}
      {!folded && (
        <div
          id={cellsId}
          // Mindestbreite je Spalte; reicht die Fläche nicht, scrollt das Board waagerecht.
          className={cn('grid gap-x-3 gap-y-2 px-3 pb-3', headless && 'pt-3')}
          style={{
            gridTemplateColumns: `repeat(${lane.cells.length}, minmax(${COLUMN_MIN}, 1fr))`,
          }}
        >
          {lane.cells.map((cell) => (
            <div
              key={cell.column}
              data-head={cell.column}
              className="flex items-center gap-2 px-1 text-muted-foreground"
            >
              <StateIcon state={cell.column} />
              <Count count={cell.cards.length} />
            </div>
          ))}
          {lane.cells.map((cell) => (
            <BoardCell
              key={cell.column}
              backlog={backlog}
              label={m.cell(label, cell.column)}
              laneName={label}
              lane={lane.key}
              cell={cell}
              marker={marker?.column === cell.column ? marker : undefined}
              group={group}
              choices={choices}
            />
          ))}
        </div>
      )}
    </section>
  );
});

/** Eine Zelle (Bahn × Spalte): Ziel für Karten aus anderen Zellen und für »ans Ende«. */
const BoardCell = memo(function BoardCell(props: {
  backlog: string;
  label: string;
  laneName: string;
  lane: string;
  cell: Cell;
  marker: LaneMarker | undefined;
  group: BoardGroup;
  choices: readonly LaneChoice[];
}) {
  const { backlog, label, laneName, lane, cell, marker, group, choices } = props;
  const { column } = cell;
  const data = useMemo<CellData>(() => ({ type: 'cell', lane, column }), [lane, column]);
  const { setNodeRef } = useDroppable({
    id: `cell:${lane}:${column}`,
    data,
    disabled: !useWrites().canWrite,
  });
  const over = marker?.kind === 'cell';
  return (
    <div>
      <ul
        ref={setNodeRef}
        aria-label={label}
        data-lane={lane}
        data-column={column}
        {...(over ? { 'data-over': 'true' } : {})}
        className={cn(
          'flex min-h-16 flex-col gap-2 rounded-md bg-muted/40 p-2',
          over && 'bg-accent ring-2 ring-primary',
        )}
      >
        {cell.cards.map((card) => (
          <BoardCard
            key={card.issue.id}
            backlog={backlog}
            card={card}
            lane={lane}
            column={column}
            group={group}
            choices={choices}
            drop={marker?.kind === 'line' && marker.id === card.issue.id ? marker.side : undefined}
          />
        ))}
      </ul>
      <QuickCreate group={group} lane={lane} laneName={laneName} column={column} />
    </div>
  );
});

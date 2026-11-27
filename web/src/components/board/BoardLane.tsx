import { ChevronRight } from 'lucide-react';
import { useId } from 'react';
import { type BoardGroup, type BoardLane as Lane, NO_LANE } from '../../app/board-model.ts';
import { cn } from '../../lib/utils.ts';
import { m } from '../../views/board.messages.ts';
import { StateIcon } from '../StateIcon.tsx';
import { BoardCard } from './BoardCard.tsx';

const NO_LANE_LABEL: Record<BoardGroup, () => string> = {
  sprint: () => m.noSprint,
  project: () => m.noProject,
  repo: () => m.noRepo,
  none: () => m.allIssues,
};

/** Sichtbarer Name der Bahn; `NO_LANE` heißt je Gruppierung »ohne …«, bei `none` »alle Issues«. */
export function laneLabel(group: BoardGroup, lane: Lane): string {
  return lane.key === NO_LANE ? NO_LANE_LABEL[group]() : lane.label;
}

/**
 * Eine Bahn (ui.md §2.8): Kopf mit Klappknopf und Anzahl, darunter je State eine Spalte mit Kopf
 * und Zelle. Bei `none` gibt es nur diese eine Bahn, ohne Kopf. Jede Zelle ist genau ein `<ul>`
 * mit `data-lane`/`data-column` — die Fläche, auf der später abgelegt wird.
 */
export function BoardLane(props: {
  backlog: string;
  group: BoardGroup;
  lane: Lane;
  folded: boolean;
  onFold: (folded: boolean) => void;
}) {
  const { backlog, group, lane, folded, onFold } = props;
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
        <div className="flex items-center gap-2 px-3 py-2">
          <h2 className="text-sm font-semibold">
            <button
              id={labelId}
              type="button"
              aria-expanded={!folded}
              aria-controls={folded ? undefined : cellsId}
              onClick={() => onFold(!folded)}
              className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight
                className={cn('size-4 shrink-0 transition-transform', !folded && 'rotate-90')}
                aria-hidden="true"
              />
              <span>{label}</span>
            </button>
          </h2>
          <span
            className="text-xs tabular-nums text-muted-foreground"
            title={m.cardCount(lane.count)}
          >
            {lane.count}
          </span>
        </div>
      )}
      {!folded && (
        <div
          id={cellsId}
          // Feste Mindestbreite je Spalte; reicht die Fläche nicht, scrollt das Board waagerecht.
          className={cn('grid gap-x-3 gap-y-2 px-3 pb-3', headless && 'pt-3')}
          style={{ gridTemplateColumns: `repeat(${lane.cells.length}, minmax(16rem, 1fr))` }}
        >
          {lane.cells.map((cell) => (
            <div
              key={cell.column}
              data-head={cell.column}
              className="flex items-center gap-2 px-1 text-muted-foreground"
            >
              <StateIcon state={cell.column} />
              <span className="text-xs tabular-nums">{cell.cards.length}</span>
            </div>
          ))}
          {lane.cells.map((cell) => (
            <ul
              key={cell.column}
              aria-label={m.cell(label, cell.column)}
              data-lane={lane.key}
              data-column={cell.column}
              className="flex min-h-16 flex-col gap-2 rounded-md bg-muted/40 p-2"
            >
              {cell.cards.map((card) => (
                <BoardCard key={card.issue.id} backlog={backlog} card={card} lane={lane.key} />
              ))}
            </ul>
          ))}
        </div>
      )}
    </section>
  );
}

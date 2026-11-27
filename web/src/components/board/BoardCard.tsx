import type { State } from '@backe/core/state.ts';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { Hourglass } from 'lucide-react';
import { type KeyboardEvent, memo, useCallback, useContext, useMemo } from 'react';
import type { BoardCard as Card } from '../../app/board-model.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { cn } from '../../lib/utils.ts';
import { m as b } from '../../views/backlog.messages.ts';
import { PendingMark } from '../write/PendingMark.tsx';
import type { CardData } from './board-dnd.ts';
import { BOARD_KEYS, type BoardKey } from './board-keys.ts';
import { initialsOf } from './initials.ts';
import { BoardKeyContext } from './use-board-move.tsx';

/** Marke des Seitenzustands, roh wie im CLI (ui.md §2.8). */
const MARKS: Partial<Record<Card['issue']['state'], string>> = {
  blocked: 'BLOCKED',
  on_hold: 'ON HOLD',
};

const KEY_SHORTCUTS = BOARD_KEYS.map((k) => `Alt+${k}`).join(' ');

/** Alt+Pfeil ohne weitere Modifier; sonst `undefined`. */
const boardKey = (e: KeyboardEvent): BoardKey | undefined =>
  e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && BOARD_KEYS.includes(e.key as BoardKey)
    ? (e.key as BoardKey)
    : undefined;

/**
 * Karte des Boards (ui.md §2.8). `memo`: `BoardModel` hält unveränderte Karten als dieselben
 * Objekte, ein Patch rendert so nur die Karten neu, die er berührt. Das `<li>` wird gezogen und
 * ist Ziel; der Link darin bleibt das fokussierbare Element und zieht nicht selbst
 * (`draggable={false}`). Darum gehen nur die `listeners` von dnd-kit an das `<li>`, nicht seine
 * `attributes` (sie machten das `<li>` zu einem zweiten Tab-Halt mit `role="button"`).
 */
export const BoardCard = memo(function BoardCard(props: {
  backlog: string;
  card: Card;
  lane: string;
  column: State;
  /** Markierung beim Ziehen: Die gezogene Karte landete vor bzw. hinter dieser. */
  drop?: 'before' | 'after' | undefined;
}) {
  const { backlog, card, lane, column, drop } = props;
  const { issue } = card;
  const href = routeHref({ kind: 'issue', backlog, id: issue.id });
  const go = useLinkClick();
  // Ohne Schreibrecht gibt es keine Tastenzüge und keinen `DndContext`; die Hooks laufen
  // trotzdem (Regeln der Hooks), nur abgeschaltet.
  const disabled = !useWrites().canWrite;
  const onKey = useContext(BoardKeyContext);
  const data = useMemo<CardData>(
    () => ({ type: 'card', id: issue.id, lane, column }),
    [issue.id, lane, column],
  );
  const drag = useDraggable({ id: `drag:${lane}:${issue.id}`, data, disabled });
  const target = useDroppable({ id: `card:${lane}:${issue.id}`, data, disabled });
  const { setNodeRef: dragRef } = drag;
  const { setNodeRef: dropRef } = target;
  const ref = useCallback(
    (node: HTMLLIElement | null) => {
      dragRef(node);
      dropRef(node);
    },
    [dragRef, dropRef],
  );
  return (
    <li
      ref={ref}
      data-card={issue.id}
      data-lane={lane}
      {...(drop === undefined ? {} : { 'data-drop': drop })}
      {...(disabled ? {} : drag.listeners)}
      onKeyDown={(e) => {
        const key = boardKey(e);
        if (disabled || key === undefined || onKey === undefined) return;
        // Ereignisse aus Menü und Dialogen kommen über das Portal hier an; sie meinen die Karte nicht.
        if (!e.currentTarget.contains(e.target as Node)) return;
        e.preventDefault();
        onKey(data, key);
      }}
      className={cn(
        'relative rounded-md border bg-card text-card-foreground shadow-xs',
        // `blocked` zusätzlich über die Umrandung, nicht über Farbe (ui.md §2.13).
        issue.state === 'blocked' && 'border-2 border-foreground',
        drag.isDragging && 'opacity-50',
        // Die Linie mittig im Abstand zur Nachbarkarte (`gap-2` der Zelle).
        'data-[drop]:before:absolute data-[drop]:before:inset-x-0 data-[drop]:before:h-0.5 data-[drop]:before:rounded-full data-[drop]:before:bg-primary',
        'data-[drop=before]:before:-top-[5px] data-[drop=after]:before:-bottom-[5px]',
      )}
    >
      <a
        href={href}
        draggable={false}
        onClick={go(href)}
        {...(disabled ? {} : { 'aria-keyshortcuts': KEY_SHORTCUTS })}
        className="flex flex-col gap-1.5 rounded-md p-2 text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardFace card={card} />
      </a>
    </li>
  );
});

/**
 * Die Kopie unter dem Zeiger (`DragOverlay`): dasselbe Gesicht, ohne Link und ohne Daten-Attribute,
 * damit weder ein Klick am Ende des Ziehens navigiert noch etwas sie für die Karte selbst hält.
 */
export function BoardCardCopy({ card }: { card: Card }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'flex cursor-grabbing flex-col gap-1.5 rounded-md border bg-card p-2 text-sm text-card-foreground shadow-lg',
        card.issue.state === 'blocked' && 'border-2 border-foreground',
      )}
    >
      <CardFace card={card} />
    </div>
  );
}

function CardFace({ card }: { card: Card }) {
  const { issue, openDeps, progress } = card;
  const mark = MARKS[issue.state];
  return (
    <>
      <span className="line-clamp-2 break-words">{issue.title}</span>
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="truncate font-mono">{issue.id}</span>
        {mark !== undefined && (
          <span className="shrink-0 rounded-sm border border-foreground px-1 font-semibold text-foreground">
            {mark}
          </span>
        )}
        <PendingMark id={issue.id} />
        <span className="flex-1" />
        {openDeps && (
          <Hourglass className="size-3.5 shrink-0" role="img" aria-label={b.openDeps}>
            <title>{b.openDeps}</title>
          </Hourglass>
        )}
        {progress !== undefined && (
          <span
            className="shrink-0 tabular-nums"
            title={b.progress(progress.settled, progress.total)}
          >
            {progress.settled}/{progress.total}
          </span>
        )}
        {issue.assignee !== undefined && <Assignee handle={issue.assignee} />}
      </span>
    </>
  );
}

/** Initialen aus dem Namen des Users; das Handle steht roh im `title` und für Hilfsmittel. */
function Assignee({ handle }: { handle: string }) {
  const user = useSignal(useStore().users.get(handle));
  return (
    <span
      role="img"
      aria-label={handle}
      title={handle}
      className="flex size-6 shrink-0 items-center justify-center rounded-full border text-[0.625rem] font-semibold text-foreground"
    >
      {initialsOf(handle, user?.name)}
    </span>
  );
}

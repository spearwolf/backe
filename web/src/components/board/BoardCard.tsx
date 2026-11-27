import { Hourglass } from 'lucide-react';
import { memo } from 'react';
import type { BoardCard as Card } from '../../app/board-model.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { cn } from '../../lib/utils.ts';
import { m as b } from '../../views/backlog.messages.ts';
import { PendingMark } from '../write/PendingMark.tsx';
import { initialsOf } from './initials.ts';

/** Marke des Seitenzustands, roh wie im CLI (ui.md §2.8). */
const MARKS: Partial<Record<Card['issue']['state'], string>> = {
  blocked: 'BLOCKED',
  on_hold: 'ON HOLD',
};

/**
 * Karte des Boards (ui.md §2.8). `memo`: `BoardModel` hält unveränderte Karten als dieselben
 * Objekte, ein Patch rendert so nur die Karten neu, die er berührt. Das `<li>` ist das eine
 * Element, das später gezogen wird; der Link darin zieht darum nicht selbst (`draggable={false}`).
 */
export const BoardCard = memo(function BoardCard(props: {
  backlog: string;
  card: Card;
  lane: string;
}) {
  const { backlog, card, lane } = props;
  const { issue, openDeps, progress } = card;
  const href = routeHref({ kind: 'issue', backlog, id: issue.id });
  const go = useLinkClick();
  const mark = MARKS[issue.state];
  return (
    <li
      data-card={issue.id}
      data-lane={lane}
      className={cn(
        'rounded-md border bg-card text-card-foreground shadow-xs',
        // `blocked` zusätzlich über die Umrandung, nicht über Farbe (ui.md §2.13).
        issue.state === 'blocked' && 'border-2 border-foreground',
      )}
    >
      <a
        href={href}
        draggable={false}
        onClick={go(href)}
        className="flex flex-col gap-1.5 rounded-md p-2 text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
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
      </a>
    </li>
  );
});

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

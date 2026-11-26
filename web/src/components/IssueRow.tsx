import { Hourglass } from 'lucide-react';
import { memo } from 'react';
import type { ListRow } from '../app/backlog-list.ts';
import { useLinkClick } from '../app/router.ts';
import { routeHref } from '../app/routes.ts';
import { cn } from '../lib/utils.ts';
import { m } from '../views/backlog.messages.ts';
import { StateIcon } from './StateIcon.tsx';

export const ROW_HEIGHT = 36;

const LIVE: Record<NonNullable<ListRow['live']>, string> = {
  // Hervorhebung über Hintergrund und Rand links, dazu `data-live` für Hilfsmittel und Tests.
  fresh: 'bg-accent border-l-foreground/60',
  leaving: 'opacity-0',
};

/**
 * Rahmen einer Zeile: Position und Stellung in der Liste ändern sich bei jedem Einfügen oder
 * Entfernen darüber. Er ist billig; den Inhalt rendert `RowContent` nur neu, wenn sich die Zeile
 * selbst ändert.
 */
export function IssueRow(props: {
  backlog: string;
  row: ListRow;
  index: number;
  count: number;
  top: number;
}) {
  const { backlog, row, index, count, top } = props;
  return (
    <li
      aria-setsize={count}
      aria-posinset={index + 1}
      data-id={row.issue.id}
      data-depth={row.depth}
      data-live={row.live}
      className={cn(
        'absolute inset-x-0 flex items-center border-b border-l-2 border-l-transparent transition-[opacity,background-color] duration-300',
        row.live !== undefined && LIVE[row.live],
      )}
      style={{ top, height: ROW_HEIGHT }}
    >
      <RowContent backlog={backlog} row={row} />
    </li>
  );
}

/**
 * Inhalt einer Zeile (ui.md §2.7). `memo`: Das Listenmodell hält unveränderte Zeilen als dieselben
 * Objekte, ein Patch rendert so nur die Zeilen neu, die er berührt.
 */
const RowContent = memo(function RowContent({ backlog, row }: { backlog: string; row: ListRow }) {
  const { issue, depth, openDeps, progress } = row;
  const href = routeHref({ kind: 'issue', backlog, id: issue.id });
  const go = useLinkClick();
  // Projekt und Sprint dürfen gleich heißen; der Key trägt darum die Art.
  const chips = [
    ...(issue.projects ?? []).map((name) => ({ key: `p:${name}`, name })),
    ...(issue.sprints ?? []).map((name) => ({ key: `s:${name}`, name })),
  ];
  return (
    <a
      href={href}
      onClick={go(href)}
      className="flex h-full min-w-0 flex-1 items-center gap-3 px-3 text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      style={{ paddingLeft: `calc(0.75rem + ${depth}rem)` }}
    >
      <StateIcon state={issue.state} className="w-28 shrink-0 text-muted-foreground" />
      <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{issue.id}</span>
      <span className="min-w-0 flex-1 truncate">{issue.title}</span>
      {openDeps && (
        <Hourglass
          className="size-3.5 shrink-0 text-muted-foreground"
          role="img"
          aria-label={m.openDeps}
        >
          <title>{m.openDeps}</title>
        </Hourglass>
      )}
      {progress !== undefined && (
        <span
          className="shrink-0 text-xs tabular-nums text-muted-foreground"
          title={m.progress(progress.settled, progress.total)}
        >
          {progress.settled}/{progress.total}
        </span>
      )}
      <span className="hidden shrink-0 gap-1 md:flex">
        {chips.map((chip) => (
          <span
            key={chip.key}
            className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
          >
            {chip.name}
          </span>
        ))}
      </span>
      <span className="w-24 shrink-0 truncate text-right text-xs">{issue.assignee ?? ''}</span>
    </a>
  );
});

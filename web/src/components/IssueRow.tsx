import { Hourglass } from 'lucide-react';
import { type DragEventHandler, type KeyboardEventHandler, memo } from 'react';
import type { ListRow } from '../app/backlog-list.ts';
import { useLinkClick } from '../app/router.ts';
import { routeHref } from '../app/routes.ts';
import { useWrites } from '../data/write-context.tsx';
import { cn } from '../lib/utils.ts';
import { m } from '../views/backlog.messages.ts';
import { RowMenu } from './RowMenu.tsx';
import { StateIcon } from './StateIcon.tsx';
import { PendingMark } from './write/PendingMark.tsx';

export const ROW_HEIGHT = 36;

const LIVE: Record<NonNullable<ListRow['live']>, string> = {
  // Hervorhebung über Hintergrund und Rand links, dazu `data-live` für Hilfsmittel und Tests.
  fresh: 'bg-accent border-l-foreground/60',
  leaving: 'opacity-0',
};

/** Umsortieren an der Zeile; dieselben Handler für alle Zeilen, die ID steht in `data-id`. */
export type RowReorder = {
  onDragStart: DragEventHandler<HTMLLIElement>;
  onDragOver: DragEventHandler<HTMLLIElement>;
  onDragLeave: DragEventHandler<HTMLLIElement>;
  onDrop: DragEventHandler<HTMLLIElement>;
  onDragEnd: DragEventHandler<HTMLLIElement>;
  onKeyDown: KeyboardEventHandler<HTMLLIElement>;
};

/**
 * Rahmen einer Zeile: Position und Stellung in der Liste ändern sich bei jedem Einfügen oder
 * Entfernen darüber. Er ist billig; den Inhalt rendert `RowContent` nur neu, wenn sich die Zeile
 * selbst ändert. Mit `reorder` ist die Zeile ziehbar; `drop` markiert die Einfügestelle.
 */
export function IssueRow(props: {
  backlog: string;
  row: ListRow;
  index: number;
  count: number;
  top: number;
  reorder?: RowReorder | undefined;
  drop?: 'before' | 'after' | undefined;
}) {
  const { backlog, row, index, count, top, reorder, drop } = props;
  return (
    <li
      aria-setsize={count}
      aria-posinset={index + 1}
      data-id={row.issue.id}
      data-depth={row.depth}
      data-live={row.live}
      data-drop={drop}
      draggable={reorder === undefined ? undefined : true}
      {...reorder}
      className={cn(
        'absolute inset-x-0 flex items-center border-b border-l-2 border-l-transparent transition-[opacity,background-color] duration-300',
        'data-[drop=after]:shadow-[inset_0_-2px_0_0_var(--color-foreground)] data-[drop=before]:shadow-[inset_0_2px_0_0_var(--color-foreground)]',
        row.live !== undefined && LIVE[row.live],
      )}
      style={{ top, height: ROW_HEIGHT }}
    >
      <RowContent backlog={backlog} row={row} reorder={reorder !== undefined} />
    </li>
  );
}

/** Tastenkürzel der Zeile: das Kontextmenü mit Schreibrecht, das Umsortieren nur mit `reorder`. */
function shortcuts(canWrite: boolean, reorder: boolean): string | undefined {
  const keys = [canWrite && 'Shift+F10', reorder && 'Alt+ArrowUp Alt+ArrowDown'].filter(Boolean);
  return keys.length === 0 ? undefined : keys.join(' ');
}

/**
 * Inhalt einer Zeile (ui.md §2.7). `memo`: Das Listenmodell hält unveränderte Zeilen als dieselben
 * Objekte, ein Patch rendert so nur die Zeilen neu, die er berührt.
 */
const RowContent = memo(function RowContent(props: {
  backlog: string;
  row: ListRow;
  reorder: boolean;
}) {
  const { backlog, row, reorder } = props;
  const { issue, depth, openDeps, progress } = row;
  const href = routeHref({ kind: 'issue', backlog, id: issue.id });
  const go = useLinkClick();
  const { canWrite } = useWrites();
  // Projekt und Sprint dürfen gleich heißen; der Key trägt darum die Art.
  const chips = [
    ...(issue.projects ?? []).map((name) => ({ key: `p:${name}`, name })),
    ...(issue.sprints ?? []).map((name) => ({ key: `s:${name}`, name })),
  ];
  return (
    <RowMenu issue={issue}>
      <a
        href={href}
        onClick={go(href)}
        aria-keyshortcuts={shortcuts(canWrite, reorder)}
        className="flex h-full min-w-0 flex-1 items-center gap-3 px-3 text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        style={{ paddingLeft: `calc(0.75rem + ${depth}rem)` }}
      >
        <span className="flex w-28 shrink-0 items-center gap-1 text-muted-foreground">
          <StateIcon state={issue.state} />
          <PendingMark id={issue.id} />
        </span>
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
    </RowMenu>
  );
});

import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import type { ListRow } from '../app/backlog-list.ts';
import { m } from '../views/backlog.messages.ts';
import { IssueRow, ROW_HEIGHT } from './IssueRow.tsx';

/** Die Liste des Tabs Backlog, virtualisiert: gerendert werden nur sichtbare Zeilen (ui.md §2.7). */
export function IssueList({ backlog, rows }: { backlog: string; rows: readonly ListRow[] }) {
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (i) => rows[i]?.issue.id ?? i,
  });

  if (rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{m.noIssues}</p>;
  }
  return (
    <div ref={scroller} className="min-h-0 flex-1 overflow-auto">
      <ul
        aria-label={m.issues}
        className="relative m-0 w-full list-none p-0"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return (
            row !== undefined && (
              <IssueRow
                key={item.key}
                backlog={backlog}
                row={row}
                index={item.index}
                count={rows.length}
                top={item.start}
              />
            )
          );
        })}
      </ul>
    </div>
  );
}

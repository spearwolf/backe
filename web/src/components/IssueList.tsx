import { useVirtualizer } from '@tanstack/react-virtual';
import { type DragEvent, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ListRow } from '../app/backlog-list.ts';
import { useStore } from '../data/store-context.tsx';
import { useWrites } from '../data/write-context.tsx';
import { m } from '../views/backlog.messages.ts';
import { IssueRow, ROW_HEIGHT, type RowReorder } from './IssueRow.tsx';
import { RowDialogs } from './RowMenu.tsx';
import { rank } from './rank-write.ts';
import { DRAG_TYPE, dropPosition, keyboardPosition } from './row-drag.ts';

type Drop = { id: string; side: 'before' | 'after' };

const linkIn = (scope: HTMLElement | null, id: string) =>
  scope?.querySelector<HTMLElement>(`li[data-id="${id}"] a`) ?? null;

/**
 * Die Liste des Tabs Backlog, virtualisiert: gerendert werden nur sichtbare Zeilen (ui.md §2.7).
 * Mit `reorder` (Schreibrecht und Sortierung `rank`) sortieren Ziehen und `Alt+↑`/`Alt+↓` um.
 */
export function IssueList(props: { backlog: string; rows: readonly ListRow[]; reorder: boolean }) {
  const { backlog, rows, reorder } = props;
  const store = useStore();
  const { writes } = useWrites();
  const scroller = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<Drop>();
  // Während des Ziehens verrät `dataTransfer` nur die Typen, nicht die ID: Sie steht hier.
  const dragged = useRef<string | undefined>(undefined);
  const refocus = useRef<string | undefined>(undefined);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (i) => rows[i]?.issue.id ?? i,
  });

  // Die Zeile behält ihren Key; verschiebt React beim Umsortieren aber ihren Knoten, fällt der
  // Fokus auf `body`. Dann holt ihn die Zeile zurück, sonst nirgends.
  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === undefined) return;
    refocus.current = undefined;
    const active = document.activeElement;
    if (active === null || active === document.body) linkIn(scroller.current, id)?.focus();
  });

  const focusRow = useCallback((id: string) => linkIn(scroller.current, id)?.focus(), []);

  const positionAt = (e: DragEvent<HTMLLIElement>, id: string) => {
    const target = e.currentTarget;
    if (target.dataset.live === 'leaving' || target.dataset.id === undefined) return undefined;
    const offset = e.clientY - target.getBoundingClientRect().top;
    return dropPosition(id, target.dataset.id, offset, ROW_HEIGHT);
  };
  const show = (next: Drop | undefined) =>
    setDrop((prev) => (prev?.id === next?.id && prev?.side === next?.side ? prev : next));

  const handlers: RowReorder = {
    onDragStart: (e) => {
      const id = e.currentTarget.dataset.id;
      if (id === undefined) return;
      dragged.current = id;
      e.dataTransfer.setData(DRAG_TYPE, id);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
      // Von außen (anderes Fenster) ist die ID unbekannt; dann entscheidet erst das Ablegen.
      const pos = positionAt(e, dragged.current ?? '');
      const target = e.currentTarget.dataset.id;
      if (pos === undefined || target === undefined) {
        show(undefined);
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      show({ id: target, side: 'before' in pos ? 'before' : 'after' });
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      const id = e.currentTarget.dataset.id;
      setDrop((prev) => (prev?.id === id ? undefined : prev));
    },
    onDrop: (e) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      show(undefined);
      dragged.current = undefined;
      if (id === '') return;
      const pos = positionAt(e, id);
      if (pos === undefined) return;
      e.preventDefault();
      rank(store, writes, id, pos);
    },
    onDragEnd: () => {
      show(undefined);
      dragged.current = undefined;
    },
    onKeyDown: (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      // Ereignisse aus dem Kontextmenü kommen über das Portal hier an; sie meinen nicht die Zeile.
      if (!e.currentTarget.contains(e.target as Node)) return;
      const id = e.currentTarget.dataset.id;
      if (id === undefined) return;
      e.preventDefault();
      const pos = keyboardPosition(rows, id, e.key);
      if (pos === undefined) return;
      refocus.current = id;
      rank(store, writes, id, pos);
    },
  };

  // Die Dialoge bleiben, auch wenn ihr Write die letzte Zeile aus dem Filter nimmt.
  return (
    <RowDialogs focusRow={focusRow}>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{m.noIssues}</p>
      ) : (
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
                    reorder={reorder ? handlers : undefined}
                    drop={drop?.id === row.issue.id ? drop.side : undefined}
                  />
                )
              );
            })}
          </ul>
        </div>
      )}
    </RowDialogs>
  );
}

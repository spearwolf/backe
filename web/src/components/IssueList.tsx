import { useVirtualizer } from '@tanstack/react-virtual';
import { type DragEvent, useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ListRow } from '../app/backlog-list.ts';
import { useStore } from '../data/store-context.tsx';
import { useWrites } from '../data/write-context.tsx';
import { m } from '../views/backlog.messages.ts';
import { IssueRow, ROW_HEIGHT, type RowReorder } from './IssueRow.tsx';
import { RowDialogs } from './RowMenu.tsx';
import { type RankMove, rank } from './rank-write.ts';
import { DRAG_TYPE, type DropMarker, dropTarget, keyboardPosition } from './row-drag.ts';

/** Eine umsortierte Zeile, der Scrollposition und Fokus folgen, sobald ihre Liste gerendert ist. */
type Follow = { id: string; rows: readonly ListRow[]; scrolled: boolean; waited: boolean };

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
  const [drop, setDrop] = useState<DropMarker>();
  // Während des Ziehens verrät `dataTransfer` nur die Typen, nicht die ID: Sie steht hier.
  const dragged = useRef<string | undefined>(undefined);
  const follow = useRef<Follow | undefined>(undefined);
  const current = useRef(rows);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    getItemKey: (i) => rows[i]?.issue.id ?? i,
  });

  // Nach dem Umsortieren: an die neue Stelle scrollen, und hat die Zeile den Fokus verloren (React
  // hat ihren Knoten verschoben, oder sie lag kurz außerhalb des gerenderten Bereichs), holt sie
  // ihn zurück. Liegt sie erst nach dem Scrollen im Bereich, wartet das auf genau einen Render.
  useLayoutEffect(() => {
    current.current = rows;
    const f = follow.current;
    if (f === undefined || rows === f.rows) return;
    const index = rows.findIndex((r) => r.issue.id === f.id);
    if (index < 0) {
      follow.current = undefined;
      return;
    }
    if (!f.scrolled) {
      f.scrolled = true;
      virtualizer.scrollToIndex(index);
    }
    const link = linkIn(scroller.current, f.id);
    if (link === null && !f.waited) {
      f.waited = true;
      return;
    }
    follow.current = undefined;
    const active = document.activeElement;
    if (link !== null && (active === null || active === document.body)) link.focus();
  });

  const focusRow = useCallback((id: string) => linkIn(scroller.current, id)?.focus(), []);
  /** Umsortieren, dem die Ansicht folgt; ohne Vorschau ändert sich nichts, dem zu folgen wäre. */
  const move = useCallback(
    (id: string, pos: RankMove) => {
      if (rank(store, writes, id, pos)) {
        follow.current = { id, rows: current.current, scrolled: false, waited: false };
      }
    },
    [store, writes],
  );

  const targetOf = (e: DragEvent<HTMLLIElement>, id: string) => {
    const target = e.currentTarget.dataset.id;
    if (target === undefined) return undefined;
    const offset = e.clientY - e.currentTarget.getBoundingClientRect().top;
    return dropTarget(rows, id, target, offset, ROW_HEIGHT);
  };
  const show = (next: DropMarker | undefined) =>
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
      // Ein Drag aus einem anderen Fenster hat hier keine Zeile und keine Geschwister: kein Ziel.
      const id = dragged.current;
      if (id === undefined || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
      const target = targetOf(e, id);
      show(target?.marker);
      if (target === undefined) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      // Die Markierung steht nach einem Teilbaum an dessen letzter Zeile, nicht am Ziel.
      show(undefined);
    },
    onDrop: (e) => {
      const id = e.dataTransfer.getData(DRAG_TYPE);
      show(undefined);
      dragged.current = undefined;
      const target = id === '' ? undefined : targetOf(e, id);
      if (target === undefined) return;
      e.preventDefault();
      rank(store, writes, id, target.pos);
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
      if (pos !== undefined) move(id, pos);
    },
  };

  // Die Dialoge bleiben, auch wenn ihr Write die letzte Zeile aus dem Filter nimmt.
  return (
    <RowDialogs focusRow={focusRow} move={move}>
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

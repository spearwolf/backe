/**
 * Einstieg des Graph-Chunks (ui.md §2.9.5): rechnet aus dem Snapshot Graph oder Baum und zeigt
 * sie. `DependencySection` lädt das Modul per `React.lazy`; nichts im Hauptchunk importiert es
 * statisch, sonst zögen `@xyflow/react` und dagre mit hinein.
 */
import { useCallback, useMemo, useState } from 'react';
import { depGraph, depTree } from '../../app/dep-graph.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { DepGraph } from './DepGraph.tsx';
import { DepTree } from './DepTree.tsx';

const NONE: ReadonlySet<string> = new Set();

const flip = (set: ReadonlySet<string>, key: string): ReadonlySet<string> => {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
};

export function DepPanel(props: {
  id: string;
  backlog: string;
  view: 'graph' | 'tree';
  parents: boolean;
}) {
  const { id, backlog, view, parents } = props;
  const store = useStore();
  const snapshot = useSignal(store.toSnapshot);
  // Beide Mengen leben neben der Ansicht: Ein Wechsel Graph ↔ Baum behält, was aufgeklappt war.
  const [expanded, setExpanded] = useState(NONE);
  const [toggled, setToggled] = useState(NONE);
  // Stabil über alle Renders: `DepGraph` baut sonst bei jedem neuen Callback alle Knoten neu.
  const onExpand = useCallback((node: string) => setExpanded((prev) => flip(prev, node)), []);
  const onToggle = useCallback((key: string) => setToggled((prev) => flip(prev, key)), []);

  const graph = useMemo(
    () =>
      view === 'graph' && snapshot !== undefined
        ? depGraph(snapshot, id, { parents, expanded })
        : undefined,
    [view, snapshot, id, parents, expanded],
  );
  const tree = useMemo(
    () =>
      view === 'tree' && snapshot !== undefined
        ? depTree(snapshot, id, { parents, toggled })
        : undefined,
    [view, snapshot, id, parents, toggled],
  );

  if (graph !== undefined) return <DepGraph graph={graph} backlog={backlog} onToggle={onExpand} />;
  if (tree !== undefined) return <DepTree tree={tree} backlog={backlog} onToggle={onToggle} />;
  return null;
}

/**
 * Abhängigkeitsgraph eines Issues (ui.md §2.9.5) mit xyflow. Das Modul lädt erst, wenn der
 * Abschnitt sichtbar wird; darum steht auch das Stylesheet von xyflow nur hier.
 */
import '@xyflow/react/dist/style.css';
import { type Locale, locale } from '@backe/i18n/locale.ts';
import {
  Controls,
  type Edge,
  type EdgeMarker,
  MarkerType,
  type NodeHandle,
  type NodeTypes,
  Position,
  ReactFlow,
  useOptionsStore,
  useReactFlow,
} from '@xyflow/react';
import { type CSSProperties, useEffect, useMemo, useRef } from 'react';
import type { DepEdgeKind, DepGraph as Graph } from '../../app/dep-graph.ts';
import { useResolvedTheme } from '../../lib/use-resolved-theme.ts';
import { m } from '../../views/deps.messages.ts';
import { DepIssueNode, DepMoreNode, type IssueFlowNode, type MoreFlowNode } from './DepNode.tsx';
import { DEP_MORE_ID, DEP_NODE_HEIGHT, DEP_NODE_WIDTH, layoutDeps } from './dep-layout.ts';

// Außerhalb der Komponente: xyflow warnt, wenn sich `nodeTypes` je Render ändert.
const NODE_TYPES: NodeTypes = { issue: DepIssueNode, more: DepMoreNode } as NodeTypes;

const STROKE = 'var(--muted-foreground)';
/** Linienmuster je Kantenart; `depends_on` durchgezogen. */
const DASH: Record<DepEdgeKind, string | undefined> = {
  depends_on: undefined,
  blocked_by: '6 4',
  parent: '2 4',
};
const MARKER: EdgeMarker = { type: MarkerType.ArrowClosed, color: STROKE };

const FIT = { maxZoom: 1, padding: 0.1 } as const;

/**
 * Feste Maße und Andockpunkte (Mitte oben, Mitte unten) gleich am Knoten: Ohne sie verwirft
 * xyflow bei jedem neuen Knotenobjekt die Messung, und die Kanten fehlen, bis neu gemessen ist.
 * Die `Handle`s im DOM sind auf dieselben Punkte gebracht (siehe `HANDLE_STYLE` in
 * `DepNode.tsx`), sonst springen die Kanten zwischen Vorgabe und Messung.
 */
const SIZE = {
  width: DEP_NODE_WIDTH,
  height: DEP_NODE_HEIGHT,
  measured: { width: DEP_NODE_WIDTH, height: DEP_NODE_HEIGHT },
};
const HANDLES: NodeHandle[] = [
  {
    id: null,
    type: 'target',
    position: Position.Top,
    x: DEP_NODE_WIDTH / 2,
    y: 0,
    width: 0,
    height: 0,
  },
  {
    id: null,
    type: 'source',
    position: Position.Bottom,
    x: DEP_NODE_WIDTH / 2,
    y: DEP_NODE_HEIGHT,
    width: 0,
    height: 0,
  },
];

/** Farben von xyflow auf die Tokens aus `styles.css`, damit beide Themes AA-Kontrast halten. */
const THEME = {
  '--xy-background-color': 'var(--background)',
  '--xy-controls-button-background-color': 'var(--card)',
  '--xy-controls-button-background-color-hover': 'var(--accent)',
  '--xy-controls-button-color': 'var(--foreground)',
  '--xy-controls-button-color-hover': 'var(--foreground)',
  '--xy-controls-button-border-color': 'var(--border)',
  '--xy-attribution-background-color': 'var(--background)',
} as CSSProperties;

/**
 * xyflow kennzeichnet Knoten und Kanten mit englischem `aria-roledescription`; die Rolle sagt
 * hier nichts, was Link und Beschriftung nicht schon sagen.
 */
const NO_ROLE_DESCRIPTION = { 'aria-roledescription': undefined };

/**
 * Beschriftungen der Steuerung je Locale, einmal gebaut: Ein neues Objekt je Render ließe
 * xyflow die Option jedes Mal neu setzen. Nur die Steuerung braucht sie, Knoten und Kanten
 * sind nicht fokussierbar.
 */
const ariaLabelCache = new Map<Locale, Record<string, string>>();
function ariaLabels(): Record<string, string> {
  const l = locale();
  let labels = ariaLabelCache.get(l);
  if (labels === undefined) {
    labels = {
      'controls.ariaLabel': m.controls,
      'controls.zoomIn.ariaLabel': m.zoomIn,
      'controls.zoomOut.ariaLabel': m.zoomOut,
      'controls.fitView.ariaLabel': m.fitView,
    };
    ariaLabelCache.set(l, labels);
  }
  return labels;
}

/**
 * Passt die Ansicht ein, sobald sich die Struktur ändert; Titel und States lassen sie stehen.
 * Erst mit `panZoom`: Ein `fitView` davor verwirft xyflow still (`resolveFitView` kehrt ohne
 * `panZoom` zurück), und beim Einhängen soll nicht die Reihenfolge der Effekte entscheiden.
 */
function FitOnNewKey({ graphKey }: { graphKey: string }) {
  const { fitView } = useReactFlow();
  const ready = useOptionsStore((s) => s.panZoom !== null);
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || fitted.current === graphKey) return;
    fitted.current = graphKey;
    void fitView(FIT);
  }, [ready, graphKey, fitView]);
  return null;
}

function Legend({ parents }: { parents: boolean }) {
  const kinds: DepEdgeKind[] = parents
    ? ['depends_on', 'blocked_by', 'parent']
    : ['depends_on', 'blocked_by'];
  return (
    <ul
      aria-label={m.legend}
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
    >
      {kinds.map((kind) => (
        <li key={kind} className="inline-flex items-center gap-1.5">
          <svg width="24" height="8" aria-hidden="true" className="shrink-0">
            <line
              x1="0"
              y1="4"
              x2="24"
              y2="4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeDasharray={DASH[kind]}
            />
          </svg>
          <span className="font-mono">{kind}</span>
        </li>
      ))}
    </ul>
  );
}

export function DepGraph(props: {
  graph: Graph;
  backlog: string;
  /**
   * Klappt einen Knoten auf oder zu. Muss stabil sein (etwa per `useCallback`): Ein neuer
   * Callback baut alle Knotenobjekte neu.
   */
  onToggle: (id: string) => void;
}) {
  const { graph, backlog, onToggle } = props;
  const theme = useResolvedTheme();
  const centre = graph.nodes[0]?.id ?? '';

  // Layout nur bei neuer Struktur; `key` fasst Knoten und Kanten zusammen, Titel und States
  // ändern ihn nicht.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `graph.key` ist der Auslöser, nicht `graph`.
  const positions = useMemo(() => layoutDeps(graph), [graph.key]);

  const nodes = useMemo(() => {
    const at = (id: string) => positions.get(id) ?? { x: 0, y: 0 };
    const out: (IssueFlowNode | MoreFlowNode)[] = graph.nodes.map((node) => ({
      id: node.id,
      type: 'issue',
      position: at(node.id),
      ...SIZE,
      handles: HANDLES,
      domAttributes: NO_ROLE_DESCRIPTION,
      data: { node, backlog, more: graph.more, onToggle },
    }));
    if (graph.more > 0) {
      out.push({
        id: DEP_MORE_ID,
        type: 'more',
        position: at(DEP_MORE_ID),
        ...SIZE,
        domAttributes: NO_ROLE_DESCRIPTION,
        data: { count: graph.more },
      });
    }
    return out;
  }, [graph, positions, backlog, onToggle]);

  // `depGraph` baut die Kanten bei jedem Aufruf neu; `key` ändert sich nur mit ihnen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `graph.key` ist der Auslöser, nicht `graph.edges`.
  const edges = useMemo(
    (): Edge[] =>
      graph.edges.map(({ from, to, kind }) => ({
        id: `${from}>${to}:${kind}`,
        source: from,
        target: to,
        type: 'smoothstep',
        markerEnd: MARKER,
        style: { stroke: STROKE, strokeWidth: 1.5, strokeDasharray: DASH[kind] },
        ariaLabel: m.edge(from, kind, to),
        domAttributes: NO_ROLE_DESCRIPTION,
      })),
    [graph.key],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="h-96 overflow-hidden rounded-md border">
        <ReactFlow
          aria-label={m.graphLabel(centre)}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          // Das Rad scrollt die Seite; gezoomt wird mit Strg und Rad oder per Pinch (beides
          // `zoomOnPinch`) und über die Steuerung. Eine Zoom-Taste wirkt bei
          // `preventScrolling={false}` nicht: xyflow zoomt das Rad dann nur mit `ctrlKey`.
          zoomOnScroll={false}
          preventScrolling={false}
          zoomActivationKeyCode={null}
          disableKeyboardA11y
          minZoom={0.25}
          forceColorMode={theme}
          ariaLabelConfig={ariaLabels()}
          style={THEME}
        >
          <FitOnNewKey graphKey={graph.key} />
          <Controls showInteractive={false} fitViewOptions={FIT} />
        </ReactFlow>
      </div>
      <Legend parents={graph.edges.some((e) => e.kind === 'parent')} />
    </div>
  );
}

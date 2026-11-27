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
  getViewportForBounds,
  MarkerType,
  type NodeHandle,
  type NodeTypes,
  Position,
  ReactFlow,
  useOptionsStore,
  useReactFlow,
  useViewportStore,
  type Viewport,
} from '@xyflow/react';
import { type CSSProperties, useEffect, useMemo, useRef } from 'react';
import type { DepEdgeKind, DepNode, DepGraph as Graph } from '../../app/dep-graph.ts';
import { useResolvedTheme } from '../../lib/use-resolved-theme.ts';
import { m } from '../../views/deps.messages.ts';
import {
  DepIssueNode,
  DepMoreNode,
  type IssueFlowNode,
  type IssueNodeData,
  type MoreFlowNode,
} from './DepNode.tsx';
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

const MIN_ZOOM = 0.25;
/** Unter diesem Zoom sind die Knotentexte (12–14 px) kaum noch lesbar. */
export const READABLE_ZOOM = 0.75;
/** Rand beim Einpassen; eine Zahl nähme xyflow seit Version 13 als Pixel. */
const FIT = { maxZoom: 1, padding: '10%' } as const;

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

type Positions = ReadonlyMap<string, { x: number; y: number }>;

/**
 * Startansicht: alles eingepasst, solange es lesbar bleibt; sonst `READABLE_ZOOM` mit der
 * Mitte in der Mitte der Fläche. Ein großer Graph zeigt so das Issue selbst statt eines
 * unlesbaren Ausschnitts irgendwo in einer langen Reihe.
 */
function startViewport(positions: Positions, centre: string, width: number, height: number) {
  const all = [...positions.values()];
  if (all.length === 0) return { x: 0, y: 0, zoom: 1 };
  const x = Math.min(...all.map((p) => p.x));
  const y = Math.min(...all.map((p) => p.y));
  const bounds = {
    x,
    y,
    width: Math.max(...all.map((p) => p.x)) + DEP_NODE_WIDTH - x,
    height: Math.max(...all.map((p) => p.y)) + DEP_NODE_HEIGHT - y,
  };
  const fit = getViewportForBounds(bounds, width, height, MIN_ZOOM, FIT.maxZoom, FIT.padding);
  const c = positions.get(centre);
  if (fit.zoom >= READABLE_ZOOM || c === undefined) return fit;
  const zoom = READABLE_ZOOM;
  return {
    x: width / 2 - (c.x + DEP_NODE_WIDTH / 2) * zoom,
    y: height / 2 - (c.y + DEP_NODE_HEIGHT / 2) * zoom,
    zoom,
  } satisfies Viewport;
}

/**
 * Setzt die Startansicht beim Einhängen und nach jeder neuen Struktur; Titel und States lassen
 * sie stehen. Erst mit `panZoom` und gemessener Fläche: davor verwirft xyflow die Ansicht, und
 * beim Einhängen soll nicht die Reihenfolge der Effekte entscheiden. »Graph einpassen« in der
 * Steuerung passt dagegen immer alles ein; das ist ausdrücklich gewollt.
 */
function StartView(props: { graphKey: string; positions: Positions; centre: string }) {
  const { graphKey, positions, centre } = props;
  const { setViewport } = useReactFlow();
  const ready = useOptionsStore((s) => s.panZoom !== null);
  const width = useViewportStore((s) => s.width);
  const height = useViewportStore((s) => s.height);
  const placed = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || width === 0 || height === 0 || placed.current === graphKey) return;
    placed.current = graphKey;
    void setViewport(startViewport(positions, centre, width, height));
  }, [ready, width, height, graphKey, positions, centre, setViewport]);
  return null;
}

type FlowNode = IssueFlowNode | MoreFlowNode;
type Point = { x: number; y: number };

/**
 * Darf das Knotenobjekt der letzten Runde bleiben? Nur dann behält xyflow seinen internen Knoten
 * und rendert ihn nicht neu. Das Issue zählt nach Identität: Der Store hält sie für unveränderte
 * Issues, ein Patch ersetzt nur die Objekte der geänderten.
 */
function keeps(
  old: FlowNode | undefined,
  node: DepNode,
  position: Point,
  data: Omit<IssueNodeData, 'node'>,
): old is IssueFlowNode {
  if (old?.type !== 'issue' || old.position !== position) return false;
  const d = old.data;
  return (
    d.node.issue === node.issue &&
    d.node.role === node.role &&
    d.node.open === node.open &&
    d.node.hidden === node.hidden &&
    d.node.expanded === node.expanded &&
    d.more === data.more &&
    d.backlog === data.backlog &&
    d.onToggle === data.onToggle
  );
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
   * Callback baut alle Knotenobjekte neu, und xyflow rendert jeden Knoten neu.
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

  // Knotenobjekte der letzten Runde je ID: `depGraph` baut bei jedem Patch alle `DepNode`s neu,
  // auch für Issues, die er nicht berührt. Ein unverändertes Knotenobjekt bleibt, sonst renderte
  // xyflow bei jedem Patch alle (bis zu 150) Knoten neu.
  const previous = useRef<ReadonlyMap<string, FlowNode>>(new Map());
  const nodes = useMemo(() => {
    const at = (id: string) => positions.get(id) ?? { x: 0, y: 0 };
    const last = previous.current;
    const data = { backlog, more: graph.more, onToggle };
    const out: FlowNode[] = graph.nodes.map((node) => {
      const position = at(node.id);
      const old = last.get(node.id);
      if (keeps(old, node, position, data)) return old;
      return {
        id: node.id,
        type: 'issue',
        position,
        ...SIZE,
        handles: HANDLES,
        domAttributes: NO_ROLE_DESCRIPTION,
        data: { node, ...data },
      };
    });
    if (graph.more > 0) {
      const position = at(DEP_MORE_ID);
      const old = last.get(DEP_MORE_ID);
      out.push(
        old?.type === 'more' && old.position === position && old.data.count === graph.more
          ? old
          : {
              id: DEP_MORE_ID,
              type: 'more',
              position,
              ...SIZE,
              domAttributes: NO_ROLE_DESCRIPTION,
              data: { count: graph.more },
            },
      );
    }
    previous.current = new Map(out.map((n) => [n.id, n]));
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
          minZoom={MIN_ZOOM}
          forceColorMode={theme}
          ariaLabelConfig={ariaLabels()}
          style={THEME}
          // Der Hinweis auf xyflow bleibt; sein Link (#999, etwa 2,85:1) bekommt AA-Kontrast. Die
          // Regel von xyflow steht ungeschichtet, darum `!`. Als JSX-String, damit Tailwind
          // denselben Text sieht wie der Browser (`\_` hält den Unterstrich wörtlich).
          className="[&_.react-flow\_\_attribution_a]:text-muted-foreground!"
        >
          <StartView graphKey={graph.key} positions={positions} centre={centre} />
          <Controls showInteractive={false} fitViewOptions={FIT} />
        </ReactFlow>
      </div>
      <Legend parents={graph.edges.some((e) => e.kind === 'parent')} />
    </div>
  );
}

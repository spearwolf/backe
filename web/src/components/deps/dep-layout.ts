import dagre from '@dagrejs/dagre';
import type { DepGraph } from '../../app/dep-graph.ts';

export const DEP_NODE_WIDTH = 224;
export const DEP_NODE_HEIGHT = 64;
/** Id des Sammelknotens; kann keine Issue-ID sein. */
export const DEP_MORE_ID = '…more';

/** Name der Layout-Kante zum Sammelknoten; keine Kantenart, kollidiert also mit keiner echten Kante. */
const MORE_EDGE = '·more';

/**
 * Schichtet den Graphen von oben nach unten (Voraussetzungen oben, Abhängige unten).
 * Mehrfachkanten heißen nach ihrer Art, damit zwei Arten zwischen demselben Paar
 * nebeneinander bestehen. Der Sammelknoten hängt per Layout-Kante (nicht gezeichnet)
 * an der Mitte und landet darunter. Rückgabe: linke obere Ecken (dagre liefert Mittelpunkte).
 */
export function layoutDeps(
  graph: Pick<DepGraph, 'nodes' | 'edges' | 'more'>,
): ReadonlyMap<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'TB', nodesep: 24, ranksep: 56 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of graph.nodes) g.setNode(n.id, { width: DEP_NODE_WIDTH, height: DEP_NODE_HEIGHT });
  for (const e of graph.edges) g.setEdge(e.from, e.to, {}, e.kind);

  // `depGraph` liefert die Mitte immer als ersten Knoten; ohne Knoten gibt es nichts anzuhängen.
  const centre = graph.nodes[0];
  if (graph.more > 0 && centre !== undefined) {
    g.setNode(DEP_MORE_ID, { width: DEP_NODE_WIDTH, height: DEP_NODE_HEIGHT });
    g.setEdge(centre.id, DEP_MORE_ID, {}, MORE_EDGE);
  }

  dagre.layout(g);

  const out = new Map<string, { x: number; y: number }>();
  for (const id of g.nodes()) {
    const p = g.node(id);
    out.set(id, { x: p.x - DEP_NODE_WIDTH / 2, y: p.y - DEP_NODE_HEIGHT / 2 });
  }
  return out;
}

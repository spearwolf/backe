import dagre from '@dagrejs/dagre';
import type { DepGraph } from '../../app/dep-graph.ts';

export const DEP_NODE_WIDTH = 224;
export const DEP_NODE_HEIGHT = 64;
/** Id des Sammelknotens; kann keine Issue-ID sein. */
export const DEP_MORE_ID = '…more';

const RANK_SEP = 56;

/**
 * Schichtet den Graphen von oben nach unten (Voraussetzungen oben, Abhängige unten).
 * Mehrfachkanten heißen nach ihrer Art, damit zwei Arten zwischen demselben Paar
 * nebeneinander bestehen. Rückgabe: linke obere Ecken (dagre liefert Mittelpunkte).
 *
 * Der Sammelknoten steht nicht im dagre-Graphen, sondern danach eine Ebene unter dem
 * untersten Knoten, genau unter der Mitte. Als Knoten mit Layout-Kante an der Mitte landete er
 * in der Reihe der ersten Abhängigen oder (mit `minlen: 2`) über einen Hilfsknoten am Ende
 * dieser Reihe, bei 150 Knoten jeweils weit seitlich und außer Sicht.
 */
export function layoutDeps(
  graph: Pick<DepGraph, 'nodes' | 'edges' | 'more'>,
): ReadonlyMap<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'TB', nodesep: 24, ranksep: RANK_SEP });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of graph.nodes) g.setNode(n.id, { width: DEP_NODE_WIDTH, height: DEP_NODE_HEIGHT });
  for (const e of graph.edges) g.setEdge(e.from, e.to, {}, e.kind);

  dagre.layout(g);

  const out = new Map<string, { x: number; y: number }>();
  for (const id of g.nodes()) {
    const p = g.node(id);
    out.set(id, { x: p.x - DEP_NODE_WIDTH / 2, y: p.y - DEP_NODE_HEIGHT / 2 });
  }

  // `depGraph` liefert die Mitte immer als ersten Knoten; ohne Knoten gibt es nichts anzuhängen.
  const centre = graph.nodes[0] && out.get(graph.nodes[0].id);
  if (graph.more > 0 && centre !== undefined) {
    const bottom = Math.max(...[...out.values()].map((p) => p.y));
    out.set(DEP_MORE_ID, { x: centre.x, y: bottom + DEP_NODE_HEIGHT + RANK_SEP });
  }
  return out;
}

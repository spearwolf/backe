/**
 * Abschnitt Abhängigkeiten im Tab Issue (ui.md §2.9.5): Nachbarschaft eines Issues über
 * `depends_on`, `blocked_by` und auf Wunsch `parent`, als Graph (Ebenen um die Mitte, je Knoten
 * aufklappbar) und als Baum (Pfade ab der Mitte). Rein auf dem Store-Snapshot; die Gegenrichtungen
 * kommen aus `@backe/ops/graph.ts`, damit sie denen von BK gleichen.
 */
import type { Issue } from '@backe/core/schemas.ts';
import { isSettled } from '@backe/core/state.ts';
import { blocking, graphOf } from '@backe/ops/graph.ts';
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';

/** Default-Tiefe in jede Richtung. */
export const DEP_DEPTH = 2;
/** Höchstzahl gezeigter Knoten bzw. Zeilen; der Rest geht in den Sammelknoten. */
export const DEP_NODE_LIMIT = 150;

export type DepEdgeKind = 'depends_on' | 'blocked_by' | 'parent';
/** Kante von der Voraussetzung `from` zum Abhängigen `to`; `parent` vom Sub-Issue zum Parent. */
export type DepEdge = { from: string; to: string; kind: DepEdgeKind };
export type DepNeighbour = { id: string; kind: DepEdgeKind };

/**
 * `depends_on`, dann `blocked_by` (Feldreihenfolge), mit `parents` die Sub-Issues
 * (`graphOf.children`); fehlende IDs inbegriffen. Ein fehlendes Issue hat keine eigenen Felder und
 * darum keine Voraussetzungen, auch wenn andere noch auf es zeigen (siehe `dependentsOf`).
 */
export function prerequisitesOf(s: BacklogSnapshot, id: string, parents: boolean): DepNeighbour[] {
  const issue = s.issues.get(id)?.data;
  if (issue === undefined) return [];
  const out: DepNeighbour[] = [];
  for (const dep of issue.depends_on ?? []) out.push({ id: dep, kind: 'depends_on' });
  for (const blocker of issue.blocked_by ?? []) out.push({ id: blocker, kind: 'blocked_by' });
  if (parents) {
    for (const child of graphOf(s).children.get(id) ?? []) out.push({ id: child, kind: 'parent' });
  }
  return out;
}

/**
 * `graphOf.dependents`, dann `blocking`, mit `parents` der Parent, falls er als Issue vorhanden ist.
 * Auch für eine fehlende ID: Andere Issues können weiter auf sie zeigen.
 */
export function dependentsOf(s: BacklogSnapshot, id: string, parents: boolean): DepNeighbour[] {
  const out: DepNeighbour[] = [];
  for (const dep of graphOf(s).dependents.get(id) ?? []) out.push({ id: dep, kind: 'depends_on' });
  for (const blocked of blocking(s).get(id) ?? []) out.push({ id: blocked, kind: 'blocked_by' });
  const parent = s.issues.get(id)?.data.parent;
  if (parents && parent !== undefined && s.issues.has(parent)) {
    out.push({ id: parent, kind: 'parent' });
  }
  return out;
}

/** Zeigt der Tab den Abschnitt: eine Kante in `depends_on`, `blocked_by` oder Gegenrichtung; `parent` zählt nicht. */
export function hasDependencies(s: BacklogSnapshot, id: string): boolean {
  return prerequisitesOf(s, id, false).length > 0 || dependentsOf(s, id, false).length > 0;
}

export type DepRole = 'center' | 'up' | 'down' | 'side';
export type DepNode = {
  id: string;
  /** `undefined`: die ID steht in einer Kante, das Issue fehlt. */
  issue: Issue | undefined;
  role: DepRole;
  /** offene Voraussetzung: `role === 'up'` und fehlend oder nicht erledigt. */
  open: boolean;
  /** Nachbarn (beide Richtungen), die nicht gezeigt werden. */
  hidden: number;
  expanded: boolean;
};
export type DepGraph = {
  nodes: DepNode[];
  edges: DepEdge[];
  /** Knoten im Sammelknoten; 0 ohne. */
  more: number;
  /** Knoten-IDs und Kanten; ändert sich nur mit der Struktur, nicht mit Titeln oder States. */
  key: string;
};

const ids = (list: readonly DepNeighbour[]): string[] => list.map((n) => n.id);

export function depGraph(
  s: BacklogSnapshot,
  id: string,
  opts: { parents: boolean; expanded: ReadonlySet<string>; limit?: number },
): DepGraph {
  const { parents, expanded } = opts;
  const limit = opts.limit ?? DEP_NODE_LIMIT;
  const up = (x: string) => ids(prerequisitesOf(s, x, parents));
  const down = (x: string) => ids(dependentsOf(s, x, parents));
  const exists = (x: string) => s.issues.has(x);

  const order: { id: string; role: DepRole }[] = [{ id, role: 'center' }];
  const shown = new Set<string>([id]);
  const add = (x: string, role: DepRole): boolean => {
    if (shown.has(x)) return false;
    shown.add(x);
    order.push({ id: x, role });
    return true;
  };

  // Ebenen: Voraussetzungen laufen nur weiter nach oben, Abhängige nur weiter nach unten.
  let upLayer = [id];
  let downLayer = [id];
  for (let d = 1; d <= DEP_DEPTH; d++) {
    const nextUp: string[] = [];
    const nextDown: string[] = [];
    for (const x of upLayer.filter(exists)) {
      for (const n of up(x)) if (add(n, 'up')) nextUp.push(n);
    }
    for (const x of downLayer.filter(exists)) {
      for (const n of down(x)) if (add(n, 'down')) nextDown.push(n);
    }
    upLayer = nextUp;
    downLayer = nextDown;
  }

  // Aufklappen: `order` wächst während des Durchlaufs, Angehängtes klappt selbst mit auf.
  for (let i = 1; i < order.length; i++) {
    const { id: x, role } = order[i] as (typeof order)[number];
    if (!expanded.has(x) || !exists(x)) continue;
    for (const n of up(x)) add(n, role === 'up' ? 'up' : 'side');
    for (const n of down(x)) add(n, role === 'down' ? 'down' : 'side');
  }

  const kept = order.slice(0, limit);
  const more = order.length - kept.length;
  const inGraph = new Set(kept.map((n) => n.id));

  const edges: DepEdge[] = [];
  const seen = new Set<string>();
  for (const { id: to } of kept) {
    for (const { id: from, kind } of prerequisitesOf(s, to, parents)) {
      const edgeKey = `${from}>${to}:${kind}`;
      if (!inGraph.has(from) || seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      edges.push({ from, to, kind });
    }
  }

  const nodes = kept.map(({ id: x, role }): DepNode => {
    const issue = s.issues.get(x)?.data;
    const outside =
      issue === undefined ? [] : [...up(x), ...down(x)].filter((n) => !inGraph.has(n));
    return {
      id: x,
      issue,
      role,
      open: role === 'up' && (issue === undefined || !isSettled(issue.state)),
      hidden: new Set(outside).size,
      expanded: x !== id && issue !== undefined && expanded.has(x),
    };
  });

  const key = [
    nodes.map((n) => `${n.id}:${n.role}`).join(','),
    [...seen].join(','),
    String(more),
  ].join('|');
  return { nodes, edges, more, key };
}

export type DepTreeItem = {
  /**
   * Pfad ab der Mitte: `up:<id>~<kind>/<id>~<kind>` bzw. `down:…`; Schlüssel für `toggled`. Die
   * Art je Segment hält Geschwister eindeutig, wenn eine ID über zwei Arten Nachbar ist.
   */
  key: string;
  id: string;
  issue: Issue | undefined;
  kind: DepEdgeKind;
  /** Die ID steht schon weiter oben im Pfad (oder ist die Mitte): keine Kinder. */
  cycle: boolean;
  /** Hat Nachbarn in seiner Richtung, ist kein Zyklus und nicht fehlend. */
  expandable: boolean;
  open: boolean;
  children: DepTreeItem[];
};
export type DepTree = { up: DepTreeItem[]; down: DepTreeItem[]; more: number };

export function depTree(
  s: BacklogSnapshot,
  id: string,
  opts: { parents: boolean; toggled: ReadonlySet<string>; limit?: number },
): DepTree {
  const { parents, toggled } = opts;
  const limit = opts.limit ?? DEP_NODE_LIMIT;
  let rows = 0;
  let more = 0;

  // Vorordnung: Eine Zeile zählt vor ihren Kindern; nach `limit` Zeilen zählt jede weitere nur
  // in `more`, ihr Teilbaum entsteht nicht.
  const build = (
    neighbours: (x: string) => DepNeighbour[],
    from: string,
    path: readonly string[],
    prefix: string,
  ): DepTreeItem[] => {
    const items: DepTreeItem[] = [];
    for (const { id: x, kind } of neighbours(from)) {
      if (rows >= limit) {
        more++;
        continue;
      }
      rows++;
      const key = `${prefix}${x}~${kind}`;
      const issue = s.issues.get(x)?.data;
      const cycle = path.includes(x);
      const expandable = !cycle && issue !== undefined && neighbours(x).length > 0;
      const openByDefault = path.length < DEP_DEPTH;
      const open = expandable && openByDefault !== toggled.has(key);
      items.push({
        key,
        id: x,
        issue,
        kind,
        cycle,
        expandable,
        open,
        children: open ? build(neighbours, x, [...path, x], `${key}/`) : [],
      });
    }
    return items;
  };

  const up = build((x) => prerequisitesOf(s, x, parents), id, [id], 'up:');
  const down = build((x) => dependentsOf(s, x, parents), id, [id], 'down:');
  return { up, down, more };
}

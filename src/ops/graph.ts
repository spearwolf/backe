/**
 * Graph-Logik über `parent`, `depends_on` und `blocked_by` (backe.md §2.22, §2.23): Vorfahren,
 * Zyklen, Bereitschaft und Belegung. Alles iterativ — die Stack-Tiefe hängt nicht an der
 * Kettenlänge.
 */
import { BackeError } from '../core/errors.ts';
import type { Issue } from '../core/schemas.ts';
import { isSettled } from '../core/state.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { compareIssues } from './order.ts';

export type IssueGraph = {
  /** Direkte Sub-Issues je Parent-ID. */
  children: ReadonlyMap<string, readonly string[]>;
  /** Issues, die per `depends_on` an der Schlüssel-ID hängen. */
  dependents: ReadonlyMap<string, readonly string[]>;
};

const graphCache = new WeakMap<BacklogSnapshot['issues'], IssueGraph>();

/** Berechnet die Gegenrichtungen einmal je Snapshot; Snapshots gelten als unveränderlich. */
export function graphOf(s: BacklogSnapshot): IssueGraph {
  const cached = graphCache.get(s.issues);
  if (cached) return cached;
  const children = new Map<string, Issue[]>();
  const dependents = new Map<string, Issue[]>();
  const push = (map: Map<string, Issue[]>, key: string, issue: Issue): void => {
    const list = map.get(key);
    if (list) list.push(issue);
    else map.set(key, [issue]);
  };
  for (const { data } of s.issues.values()) {
    if (data.parent !== undefined) push(children, data.parent, data);
    for (const dep of data.depends_on ?? []) push(dependents, dep, data);
  }
  const ids = (map: Map<string, Issue[]>): Map<string, string[]> =>
    new Map([...map].map(([k, v]) => [k, v.sort(compareIssues).map((i) => i.id)]));
  const graph: IssueGraph = { children: ids(children), dependents: ids(dependents) };
  graphCache.set(s.issues, graph);
  return graph;
}

function lookup(s: BacklogSnapshot, id: string): Issue {
  const found = s.issues.get(id);
  if (!found) throw new BackeError('not_found', `Issue ${id} nicht gefunden`);
  return found.data;
}

/** Vorfahren, nächster zuerst; endet an einem fehlenden Parent oder einem schon besuchten Issue. */
export function ancestors(s: BacklogSnapshot, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let current = s.issues.get(id)?.data.parent;
  while (current !== undefined && !seen.has(current) && s.issues.has(current)) {
    seen.add(current);
    out.push(current);
    current = s.issues.get(current)?.data.parent;
  }
  return out;
}

function edges(issue: Issue, field: 'parent' | 'depends_on' | 'blocked_by'): readonly string[] {
  if (field === 'parent') return issue.parent === undefined ? [] : [issue.parent];
  return issue[field] ?? [];
}

/** Ein Pfad `[start, …, start]` entlang `field`, falls `start` auf einem Zyklus liegt. */
export function findCycle(
  s: BacklogSnapshot,
  field: 'parent' | 'depends_on' | 'blocked_by',
  start: string,
): string[] | undefined {
  const first = s.issues.get(start);
  if (!first) return undefined;
  const visited = new Set<string>([start]);
  const path: string[] = [start];
  const stack: { next: readonly string[]; index: number }[] = [
    { next: edges(first.data, field), index: 0 },
  ];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as (typeof stack)[number];
    const target = frame.next[frame.index++];
    if (target === undefined) {
      stack.pop();
      path.pop();
      continue;
    }
    if (target === start) return [...path, start];
    const entity = s.issues.get(target);
    if (!entity || visited.has(target)) continue;
    visited.add(target);
    path.push(target);
    stack.push({ next: edges(entity.data, field), index: 0 });
  }
  return undefined;
}

/** Direkte Sub-Issues, die nicht erledigt sind. */
export function openChildren(s: BacklogSnapshot, id: string): string[] {
  return (graphOf(s).children.get(id) ?? []).filter((c) => {
    const child = s.issues.get(c);
    return child !== undefined && !isSettled(child.data.state);
  });
}

export type Readiness =
  | { ready: true }
  | {
      ready: false;
      reason:
        | 'state'
        | 'dependencies'
        | 'open_children'
        | 'ancestor_paused'
        | 'ancestor_dependencies';
      ids: string[];
    };

/** Abhängigkeiten, die nicht erledigt sind; eine fehlende zählt als nicht erledigt. */
function unsettled(s: BacklogSnapshot, ids: readonly string[] | undefined): string[] {
  return (ids ?? []).filter((d) => {
    const dep = s.issues.get(d);
    return dep === undefined || !isSettled(dep.data.state);
  });
}

/**
 * Bereitschaft nach backe.md §2.22; meldet den ersten Grund. Bei `level: 'top'` schließen offene
 * Sub-Issues nicht aus (backe.md §2.23). Bei `ancestor_*` nennt `ids` den betroffenen Vorfahren.
 */
export function readiness(
  s: BacklogSnapshot,
  id: string,
  opts: { level: 'leaf' | 'top' },
): Readiness {
  const issue = lookup(s, id);
  if (issue.state !== 'todo' && issue.state !== 'backlog') {
    return { ready: false, reason: 'state', ids: [] };
  }
  const deps = unsettled(s, issue.depends_on);
  if (deps.length > 0) return { ready: false, reason: 'dependencies', ids: deps };
  if (opts.level === 'leaf') {
    const open = openChildren(s, id);
    if (open.length > 0) return { ready: false, reason: 'open_children', ids: open };
  }
  for (const a of ancestors(s, id)) {
    const parent = lookup(s, a);
    if (parent.state === 'blocked' || parent.state === 'on_hold') {
      return { ready: false, reason: 'ancestor_paused', ids: [a] };
    }
    if (unsettled(s, parent.depends_on).length > 0) {
      return { ready: false, reason: 'ancestor_dependencies', ids: [a] };
    }
  }
  return { ready: true };
}

export function isReady(s: BacklogSnapshot, id: string, opts: { level: 'leaf' | 'top' }): boolean {
  return readiness(s, id, opts).ready;
}

/** `blocked` und alle `blocked_by` erledigt. */
export function isUnblockable(s: BacklogSnapshot, id: string): boolean {
  const issue = lookup(s, id);
  return issue.state === 'blocked' && unsettled(s, issue.blocked_by).length === 0;
}

/**
 * Der nächste Vorfahre, der in `in_progress` oder `review` liegt und einen gesetzten, von
 * `actor` verschiedenen Assignee hat (backe.md §2.23, »Belegung«).
 */
export function occupyingAncestor(
  s: BacklogSnapshot,
  id: string,
  actor: string,
): string | undefined {
  lookup(s, id);
  return ancestors(s, id).find((a) => {
    const { state, assignee } = lookup(s, a);
    return (
      (state === 'in_progress' || state === 'review') &&
      assignee !== undefined &&
      assignee !== actor
    );
  });
}

export type ClaimCheck =
  | { ok: true }
  | { ok: false; reason: 'not_ready' | 'occupied'; ids: string[] };

/** Claimbar (backe.md §2.22): bereit (Ebene `top`) oder schon mein laufendes Issue — und nicht belegt. */
export function isClaimable(s: BacklogSnapshot, id: string, actor: string): ClaimCheck {
  const issue = lookup(s, id);
  if (!(issue.state === 'in_progress' && issue.assignee === actor)) {
    const r = readiness(s, id, { level: 'top' });
    if (!r.ready) return { ok: false, reason: 'not_ready', ids: r.ids };
  }
  const occupier = occupyingAncestor(s, id, actor);
  if (occupier !== undefined) return { ok: false, reason: 'occupied', ids: [occupier] };
  return { ok: true };
}

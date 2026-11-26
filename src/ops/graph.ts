/**
 * Graph-Logik über `parent`, `depends_on` und `blocked_by` (backe.md §2.22, §2.23): Vorfahren,
 * Zyklen, Bereitschaft und Belegung. Alles iterativ — die Stack-Tiefe hängt nicht an der
 * Kettenlänge.
 */

import { BackeError } from '../core/errors.ts';
import type { Issue } from '../core/schemas.ts';
import { isSettled } from '../core/state.ts';
import type { BacklogSnapshot, StoredEntity } from '../store/snapshot.ts';
import { m } from './graph.messages.ts';
import { LayeredMap } from './layered-map.ts';
import { compareIssues } from './order.ts';

export type IssueGraph = {
  /** Direkte Sub-Issues je Parent-ID. */
  children: ReadonlyMap<string, readonly string[]>;
  /** Issues, die per `depends_on` an der Schlüssel-ID hängen. */
  dependents: ReadonlyMap<string, readonly string[]>;
};

type Issues = BacklogSnapshot['issues'];
const graphCache = new WeakMap<Issues, IssueGraph>();

/**
 * Berechnet die Gegenrichtungen einmal je Snapshot; Snapshots gelten als unveränderlich. Für die
 * Sicht eines Drafts (`LayeredMap`) entsteht der Graph aus dem der Basis plus den Änderungen,
 * ohne den ganzen Bestand erneut zu durchlaufen.
 */
export function graphOf(s: BacklogSnapshot): IssueGraph {
  return graphOfIssues(s.issues);
}

function graphOfIssues(issues: Issues): IssueGraph {
  const cached = graphCache.get(issues);
  if (cached) return cached;
  const graph = issues instanceof LayeredMap ? patchedGraph(issues) : builtGraph(issues);
  graphCache.set(issues, graph);
  return graph;
}

function builtGraph(issues: Issues): IssueGraph {
  const children = new Map<string, Issue[]>();
  const dependents = new Map<string, Issue[]>();
  const push = (map: Map<string, Issue[]>, key: string, issue: Issue): void => {
    const list = map.get(key);
    if (list) list.push(issue);
    else map.set(key, [issue]);
  };
  for (const { data } of issues.values()) {
    if (data.parent !== undefined) push(children, data.parent, data);
    for (const dep of data.depends_on ?? []) push(dependents, dep, data);
  }
  const ids = (map: Map<string, Issue[]>): Map<string, string[]> =>
    new Map([...map].map(([k, v]) => [k, v.sort(compareIssues).map((i) => i.id)]));
  return { children: ids(children), dependents: ids(dependents) };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);
const parentOf = (issue: Issue | undefined): readonly string[] =>
  issue?.parent === undefined ? [] : [issue.parent];
const dependsOf = (issue: Issue | undefined): readonly string[] => issue?.depends_on ?? [];

/**
 * Graph einer `LayeredMap` aus dem Graph ihrer Basis: Neu berechnet werden nur die Listen der
 * Schlüssel, die ein geändertes Issue vorher oder nachher nennt.
 */
function patchedGraph(issues: LayeredMap<StoredEntity<Issue>>): IssueGraph {
  const base = graphOfIssues(issues.base as Issues);
  const patch = (
    lists: ReadonlyMap<string, readonly string[]>,
    targets: (issue: Issue | undefined) => readonly string[],
  ): ReadonlyMap<string, readonly string[]> => {
    // Betroffen sind die Listen, in die ein Issue ein- oder austritt oder in denen es wegen
    // eines neuen `rank` (oder `created`) anders einsortiert wird.
    const affected = new Set<string>();
    for (const [id, now] of issues.changes) {
      const was = issues.base.get(id)?.data;
      const before = targets(was);
      const after = targets(now?.data);
      const resorted = was?.rank !== now?.data.rank || was?.created !== now?.data.created;
      if (!resorted && sameList(before, after)) continue;
      for (const t of before) affected.add(t);
      for (const t of after) affected.add(t);
    }
    if (affected.size === 0) return lists;
    const fresh = new Map<string, Issue[]>([...affected].map((t) => [t, []]));
    for (const t of affected) {
      for (const id of lists.get(t) ?? []) {
        const issue = issues.base.get(id)?.data;
        if (!issues.changes.has(id) && issue !== undefined) fresh.get(t)?.push(issue);
      }
    }
    for (const now of issues.changes.values()) {
      if (now === undefined) continue;
      for (const t of targets(now.data)) fresh.get(t)?.push(now.data);
    }
    const overrides = new Map(
      [...fresh].map(([t, list]) => [t, list.sort(compareIssues).map((i) => i.id)]),
    );
    return new OverriddenMap(lists, overrides);
  };
  return {
    children: patch(base.children, parentOf),
    dependents: patch(base.dependents, dependsOf),
  };
}

/** `base` mit ersetzten Listen; eine leere Liste heißt »kein Eintrag«, wie im gebauten Graph. */
class OverriddenMap implements ReadonlyMap<string, readonly string[]> {
  readonly #base: ReadonlyMap<string, readonly string[]>;
  readonly #overrides: ReadonlyMap<string, readonly string[]>;
  #merged: Map<string, readonly string[]> | undefined;

  constructor(
    base: ReadonlyMap<string, readonly string[]>,
    overrides: ReadonlyMap<string, readonly string[]>,
  ) {
    this.#base = base;
    this.#overrides = overrides;
  }

  get(key: string): readonly string[] | undefined {
    const own = this.#overrides.get(key);
    if (own === undefined) return this.#base.get(key);
    return own.length > 0 ? own : undefined;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  get size(): number {
    return this.#map().size;
  }

  forEach(
    fn: (
      value: readonly string[],
      key: string,
      map: ReadonlyMap<string, readonly string[]>,
    ) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, value] of this.#map()) fn.call(thisArg, value, key, this);
  }

  entries(): MapIterator<[string, readonly string[]]> {
    return this.#map().entries();
  }

  keys(): MapIterator<string> {
    return this.#map().keys();
  }

  values(): MapIterator<readonly string[]> {
    return this.#map().values();
  }

  [Symbol.iterator](): MapIterator<[string, readonly string[]]> {
    return this.entries();
  }

  #map(): Map<string, readonly string[]> {
    if (this.#merged === undefined) {
      const merged = new Map(this.#base);
      for (const [key, list] of this.#overrides) {
        if (list.length > 0) merged.set(key, list);
        else merged.delete(key);
      }
      this.#merged = merged;
    }
    return this.#merged;
  }
}

function lookup(s: BacklogSnapshot, id: string): Issue {
  const found = s.issues.get(id);
  if (!found) throw new BackeError('not_found', m.issueNotFound(id));
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

type EdgeField = 'parent' | 'depends_on' | 'blocked_by';

function edges(issue: Issue, field: EdgeField): readonly string[] {
  if (field === 'parent') return issue.parent === undefined ? [] : [issue.parent];
  return issue[field] ?? [];
}

/**
 * Tiefensuche über die Kanten von `from` (ohne `from` selbst als Treffer): Pfad `[from, …, to]`,
 * sobald eine Kante auf `to` zeigt. Fehlende Issues haben keine Kanten; `to` selbst darf fehlen.
 */
function walk(
  s: BacklogSnapshot,
  field: EdgeField,
  from: string,
  to: string,
): string[] | undefined {
  const first = s.issues.get(from);
  if (!first) return undefined;
  const visited = new Set<string>([from]);
  const path: string[] = [from];
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
    if (target === to) return [...path, to];
    const entity = s.issues.get(target);
    if (!entity || visited.has(target)) continue;
    visited.add(target);
    path.push(target);
    stack.push({ next: edges(entity.data, field), index: 0 });
  }
  return undefined;
}

/** Ein Pfad `[start, …, start]` entlang `field`, falls `start` auf einem Zyklus liegt. */
export function findCycle(
  s: BacklogSnapshot,
  field: EdgeField,
  start: string,
): string[] | undefined {
  return walk(s, field, start, start);
}

/** Ein Pfad `[from, …, to]` entlang `field`, falls `to` von `from` aus erreichbar ist. */
export function findPath(
  s: BacklogSnapshot,
  field: EdgeField,
  from: string,
  to: string,
): string[] | undefined {
  return from === to ? [from] : walk(s, field, from, to);
}

/** Direkte Sub-Issues, die nicht erledigt sind. */
export function openChildren(s: BacklogSnapshot, id: string): string[] {
  return (graphOf(s).children.get(id) ?? []).filter((c) => {
    const child = s.issues.get(c);
    return child !== undefined && !isSettled(child.data.state);
  });
}

/** Erledigte und alle direkten Sub-Issues; `undefined` ohne Kinder. */
export function childProgress(
  s: BacklogSnapshot,
  id: string,
): { settled: number; total: number } | undefined {
  const children = graphOf(s).children.get(id) ?? [];
  if (children.length === 0) return undefined;
  return { settled: children.length - openChildren(s, id).length, total: children.length };
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

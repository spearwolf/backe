/**
 * Der reine Kern von `issue list` (backe.md §2.17, §2.18): Filter, Bereitschaft, Sortierung und
 * Baumordnung über einem Snapshot, ohne Kontext und ohne I/O. Den aufgelösten Selektor baut der
 * Service aus Flags und Kontext; das Web-Bundle von `backe ui` nutzt dasselbe Modul.
 */
import { compareCodeUnits } from '../core/compare.ts';
import type { Issue } from '../core/schemas.ts';
import { isSettled, type State } from '../core/state.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { isReady, isUnblockable } from './graph.ts';
import { matchesContext } from './next.ts';
import { compareIssues } from './order.ts';
import { type PropFilter, propMatches } from './props.ts';

export type IssueSelector = {
  /** `undefined` = offen (nicht settled), wie `issue list` ohne `--state`. */
  states?: State[] | 'all';
  filter: { project?: string[]; sprint?: string[]; repo?: string[] };
  exact?: boolean;
  /** Aufgelöster Handle oder `'none'`. */
  assignee?: string;
  creator?: string;
  /** Volle Issue-ID. */
  parent?: string;
  topLevel?: boolean;
  /** Geparst und gegen die Config geprüft. */
  props?: PropFilter[];
  hasProps?: string[];
  mode?: 'blocked' | 'unblockable' | 'ready';
  /** Kleingeschrieben; durchsucht Titel und `body` des Snapshots. */
  text?: string;
  /**
   * IDs, deren Beschreibung `text` enthält. Gesetzt ersetzt es die Suche im `body` des Snapshots:
   * Der Client von `backe ui` hat keine Bodies und holt diese Treffer vom Server.
   */
  bodyHits?: ReadonlySet<string>;
  tree?: boolean;
  sort?: 'rank' | 'created';
};

export type SelectedIssue = { issue: Issue; depth?: number; openDeps: boolean };

export function compareCreated(a: Issue, b: Issue): number {
  return compareCodeUnits(a.created, b.created) || compareCodeUnits(a.id, b.id);
}

/** Wurzeln (Parent nicht in der Menge), darunter die Kinder rekursiv, je Ebene nach `compare`. */
function treeOrder(
  issues: readonly Issue[],
  compare: (a: Issue, b: Issue) => number,
): { issue: Issue; depth: number }[] {
  const inSet = new Set(issues.map((i) => i.id));
  const kids = new Map<string, Issue[]>();
  const roots: Issue[] = [];
  for (const issue of issues) {
    if (issue.parent !== undefined && inSet.has(issue.parent)) {
      const list = kids.get(issue.parent);
      if (list) list.push(issue);
      else kids.set(issue.parent, [issue]);
    } else {
      roots.push(issue);
    }
  }
  const out: { issue: Issue; depth: number }[] = [];
  const stack: { issue: Issue; depth: number }[] = roots
    .sort(compare)
    .reverse()
    .map((issue) => ({ issue, depth: 0 }));
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    out.push(top);
    const children = (kids.get(top.issue.id) ?? []).sort(compare).reverse();
    for (const issue of children) stack.push({ issue, depth: top.depth + 1 });
  }
  return out;
}

export function hasOpenDeps(s: BacklogSnapshot, issue: Issue): boolean {
  return (issue.depends_on ?? []).some((d) => {
    const dep = s.issues.get(d);
    return dep === undefined || !isSettled(dep.data.state);
  });
}

/** Kontextfilter (Projekt rekursiv, Sprint, Repo): je Dimension genügt ein Treffer, Dimensionen verknüpft UND. */
export function matchesFilter(
  issue: Issue,
  filter: IssueSelector['filter'],
  exact: boolean,
): boolean {
  return (
    (filter.project === undefined ||
      filter.project.some((project) =>
        matchesContext(issue, { project, ...(exact ? { projectExact: true } : {}) }),
      )) &&
    (filter.sprint === undefined ||
      filter.sprint.some((sprint) => matchesContext(issue, { sprint }))) &&
    (filter.repo === undefined || filter.repo.some((repo) => matchesContext(issue, { repo })))
  );
}

/** Alle Issues des Snapshots, die `q` erfüllen, sortiert und bei `tree` mit Tiefe; ohne Limit. */
export function selectIssues(s: BacklogSnapshot, q: IssueSelector): SelectedIssue[] {
  const { states, assignee, creator, parent, text } = q;
  const keep = (issue: Issue): boolean => {
    if (
      states === undefined
        ? isSettled(issue.state)
        : states !== 'all' && !states.includes(issue.state)
    ) {
      return false;
    }
    if (!matchesFilter(issue, q.filter, q.exact === true)) return false;
    if (
      assignee === 'none'
        ? issue.assignee !== undefined
        : assignee !== undefined && issue.assignee !== assignee
    ) {
      return false;
    }
    if (creator !== undefined && issue.creator !== creator) return false;
    if (parent !== undefined && issue.parent !== parent) return false;
    if (q.topLevel === true && issue.parent !== undefined) return false;
    if (!(q.props ?? []).every((f) => propMatches(issue.props, f, s.config))) return false;
    if (
      !(q.hasProps ?? []).every((key) => propMatches(issue.props, { key, op: 'has' }, s.config))
    ) {
      return false;
    }
    if (q.mode === 'blocked' && issue.state !== 'blocked') return false;
    if (q.mode === 'unblockable' && !isUnblockable(s, issue.id)) return false;
    if (q.mode === 'ready' && !isReady(s, issue.id, { level: 'leaf' })) return false;
    if (text !== undefined) {
      const inBody =
        q.bodyHits === undefined
          ? (s.issues.get(issue.id)?.body ?? '').toLowerCase().includes(text)
          : q.bodyHits.has(issue.id);
      if (!issue.title.toLowerCase().includes(text) && !inBody) return false;
    }
    return true;
  };

  const compare = q.sort === 'created' ? compareCreated : compareIssues;
  const matched = [...s.issues.values()].map((e) => e.data).filter(keep);
  const ordered: { issue: Issue; depth?: number }[] =
    q.tree === true
      ? treeOrder(matched, compare)
      : matched.sort(compare).map((issue) => ({ issue }));
  return ordered.map((e) => ({ ...e, openDeps: hasOpenDeps(s, e.issue) }));
}

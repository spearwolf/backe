/**
 * `issue list` (backe.md §2.17, §2.18): Filter aus Kontext und Flags, Properties, Bereitschaft,
 * Sortierung, Baumansicht und Limit. Liest nur; der Snapshot kommt aus der Arbeitskopie.
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { Issue } from '../core/schemas.ts';
import { isSettled } from '../core/state.ts';
import { isReady, isUnblockable } from '../ops/graph.ts';
import { matchesContext } from '../ops/next.ts';
import { compareIssues } from '../ops/order.ts';
import { checkPropFilter, parsePropFilter, propMatches } from '../ops/props.ts';
import type { BacklogSnapshot, Problem } from '../store/snapshot.ts';
import {
  effectiveFilter,
  normalizeStates,
  openSnapshot,
  resolveHandle,
  resolveIssueRef,
} from './read.ts';

export type IssueListQuery = {
  states?: string[];
  projects?: string[];
  exact?: boolean;
  sprints?: string[];
  repos?: string[];
  /** `me`, `none` (kein Assignee) oder ein Handle. */
  assignee?: string;
  creator?: string;
  mode?: 'blocked' | 'unblockable' | 'ready';
  parent?: string;
  topLevel?: boolean;
  props?: string[];
  hasProps?: string[];
  text?: string;
  tree?: boolean;
  sort?: 'rank' | 'created';
  all?: boolean;
  limit?: number;
};

export type IssueListItem = { issue: Issue; depth?: number; openDeps: boolean };

export type IssueListResult = {
  header: Record<string, string>;
  items: IssueListItem[];
  truncated: boolean;
  problems: Problem[];
};

function compareCreated(a: Issue, b: Issue): number {
  if (a.created !== b.created) return a.created < b.created ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

function hasOpenDeps(s: BacklogSnapshot, issue: Issue): boolean {
  return (issue.depends_on ?? []).some((d) => {
    const dep = s.issues.get(d);
    return dep === undefined || !isSettled(dep.data.state);
  });
}

export async function listIssues(
  ctx: ResolvedContext,
  q: IssueListQuery,
): Promise<IssueListResult> {
  if (q.parent !== undefined && q.topLevel === true) {
    throw new BackeError('usage', '»--parent« und »--top-level« schließen sich aus');
  }
  if (q.limit !== undefined && !(Number.isInteger(q.limit) && q.limit >= 1)) {
    throw new BackeError('validation', `Ungültiges Limit: »${q.limit}«`, {
      hint: 'erwartet eine ganze Zahl ab 1',
    });
  }
  const states = q.states === undefined ? undefined : normalizeStates(q.states);
  const { snapshot: s } = await openSnapshot(ctx);

  const assignee =
    q.assignee === undefined || q.assignee === 'none' ? q.assignee : resolveHandle(ctx, q.assignee);
  const creator = q.creator === undefined ? undefined : resolveHandle(ctx, q.creator);
  const parent = q.parent === undefined ? undefined : resolveIssueRef(s, q.parent);
  const propFilters = (q.props ?? []).map(parsePropFilter);
  for (const f of propFilters) checkPropFilter(f, s.config);
  const needle = q.text?.toLowerCase();

  const filter = effectiveFilter(
    ctx,
    {
      ...(q.projects === undefined ? {} : { project: q.projects }),
      ...(q.sprints === undefined ? {} : { sprint: q.sprints }),
      ...(q.repos === undefined ? {} : { repo: q.repos }),
    },
    q.all === true,
  );

  const inContext = (issue: Issue): boolean =>
    (filter.project === undefined ||
      filter.project.some((project) =>
        matchesContext(issue, { project, ...(q.exact === true ? { projectExact: true } : {}) }),
      )) &&
    (filter.sprint === undefined ||
      filter.sprint.some((sprint) => matchesContext(issue, { sprint }))) &&
    (filter.repo === undefined || filter.repo.some((repo) => matchesContext(issue, { repo })));

  const keep = (issue: Issue): boolean => {
    if (
      states === undefined
        ? isSettled(issue.state)
        : states !== 'all' && !states.includes(issue.state)
    ) {
      return false;
    }
    if (!inContext(issue)) return false;
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
    if (!propFilters.every((f) => propMatches(issue.props, f, s.config))) return false;
    if (
      !(q.hasProps ?? []).every((key) => propMatches(issue.props, { key, op: 'has' }, s.config))
    ) {
      return false;
    }
    if (q.mode === 'blocked' && issue.state !== 'blocked') return false;
    if (q.mode === 'unblockable' && !isUnblockable(s, issue.id)) return false;
    if (q.mode === 'ready' && !isReady(s, issue.id, { level: 'leaf' })) return false;
    if (needle !== undefined) {
      const body = s.issues.get(issue.id)?.body ?? '';
      if (!issue.title.toLowerCase().includes(needle) && !body.toLowerCase().includes(needle)) {
        return false;
      }
    }
    return true;
  };

  const compare = q.sort === 'created' ? compareCreated : compareIssues;
  const matched = [...s.issues.values()].map((e) => e.data).filter(keep);
  const ordered: { issue: Issue; depth?: number }[] =
    q.tree === true
      ? treeOrder(matched, compare)
      : matched.sort(compare).map((issue) => ({ issue }));

  const cut = q.limit === undefined ? ordered : ordered.slice(0, q.limit);
  const items: IssueListItem[] = cut.map((e) => ({
    issue: e.issue,
    ...(e.depth === undefined ? {} : { depth: e.depth }),
    openDeps: hasOpenDeps(s, e.issue),
  }));
  return {
    header: filter.header,
    items,
    truncated: cut.length < ordered.length,
    problems: s.problems.filter((p) => p.kind === 'issue'),
  };
}

/**
 * `issue list` (backe.md §2.17, §2.18): Filter aus Kontext und Flags, Properties, Bereitschaft,
 * Sortierung, Baumansicht und Limit. Liest nur; der Snapshot kommt aus der Arbeitskopie.
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { type SelectedIssue, selectIssues } from '../ops/issue-query.ts';
import { checkPropFilter, parsePropFilter } from '../ops/props.ts';
import type { Problem } from '../store/snapshot.ts';
import { m } from './issue-list.messages.ts';
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

export type IssueListItem = SelectedIssue;

export type IssueListResult = {
  header: Record<string, string>;
  items: IssueListItem[];
  truncated: boolean;
  problems: Problem[];
};

/** `--sort rank|created` für `issue list` und `sprint show`; sonst `validation`. */
export function listSort(value: string | undefined): IssueListQuery['sort'] {
  if (value === undefined || value === 'rank' || value === 'created') return value;
  throw new BackeError('validation', m.invalidSort(value), {
    hint: m.sortChoices,
  });
}

export async function listIssues(
  ctx: ResolvedContext,
  q: IssueListQuery,
): Promise<IssueListResult> {
  if (q.parent !== undefined && q.topLevel === true) {
    throw new BackeError('usage', m.parentAndTopLevelExclusive);
  }
  if (q.limit !== undefined && !(Number.isInteger(q.limit) && q.limit >= 1)) {
    throw new BackeError('validation', m.invalidLimit(q.limit), {
      hint: m.limitExpects,
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

  const ordered = selectIssues(s, {
    ...(states === undefined ? {} : { states }),
    filter,
    exact: q.exact === true,
    ...(assignee === undefined ? {} : { assignee }),
    ...(creator === undefined ? {} : { creator }),
    ...(parent === undefined ? {} : { parent }),
    topLevel: q.topLevel === true,
    props: propFilters,
    ...(q.hasProps === undefined ? {} : { hasProps: q.hasProps }),
    ...(q.mode === undefined ? {} : { mode: q.mode }),
    ...(needle === undefined ? {} : { text: needle }),
    tree: q.tree === true,
    ...(q.sort === undefined ? {} : { sort: q.sort }),
  });

  const cut = q.limit === undefined ? ordered : ordered.slice(0, q.limit);
  return {
    header: filter.header,
    items: cut,
    truncated: cut.length < ordered.length,
    problems: s.problems.filter((p) => p.kind === 'issue'),
  };
}

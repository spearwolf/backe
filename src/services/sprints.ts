/** Sprints (backe.md §2.10, §2.14, §2.18): anlegen, listen, zeigen, abschließen. */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import type { Issue, Sprint } from '../core/schemas.ts';
import { isSettled, type State } from '../core/state.ts';
import type { OpOf } from '../ops/operation.ts';
import { compareIssues } from '../ops/order.ts';
import { compareCreated, hasOpenDeps, type IssueListItem, matchesFilter } from './issue-list.ts';
import { type WriteOutcome, writeOp } from './outcome.ts';
import { effectiveFilter, openSnapshot } from './read.ts';
import type { WriteDeps } from './write.ts';

const GROUP_ORDER: readonly State[] = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'blocked',
  'on_hold',
  'cancelled',
  'rejected',
];

export function createSprint(
  ctx: ResolvedContext,
  input: { slug: string; title: string; start?: string; end?: string; body?: string },
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  const op: OpOf<'sprint.create'> = { op: 'sprint.create', slug: input.slug, title: input.title };
  if (input.start !== undefined) op.start = input.start;
  if (input.end !== undefined) op.end = input.end;
  if (input.body !== undefined) op.body = input.body;
  return writeOp(ctx, () => op, deps);
}

export async function listSprints(ctx: ResolvedContext): Promise<
  {
    slug: string;
    title: string;
    start?: string;
    end?: string;
    closed: boolean;
    open: number;
  }[]
> {
  const { snapshot: s } = await openSnapshot(ctx);
  const open = new Map<string, number>();
  for (const { data } of s.issues.values()) {
    if (isSettled(data.state)) continue;
    for (const slug of new Set(data.sprints ?? [])) open.set(slug, (open.get(slug) ?? 0) + 1);
  }
  const rows = [...s.sprints.entries()].map(([slug, { data }]) => ({
    slug,
    title: data.title,
    ...(data.start === undefined ? {} : { start: data.start }),
    ...(data.end === undefined ? {} : { end: data.end }),
    closed: data.closed === true,
    open: open.get(slug) ?? 0,
  }));
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  return rows.sort((a, b) => {
    if (a.closed !== b.closed) return a.closed ? 1 : -1;
    if (a.start !== b.start) {
      if (a.start === undefined) return 1;
      if (b.start === undefined) return -1;
      return cmp(a.start, b.start);
    }
    return cmp(a.slug, b.slug);
  });
}

export async function showSprint(
  ctx: ResolvedContext,
  slug: string,
  q: { projects?: string[]; repos?: string[]; all?: boolean; sort?: 'rank' | 'created' } = {},
): Promise<{
  header: Record<string, string>;
  sprint: Sprint;
  body: string;
  groups: { state: State; items: IssueListItem[] }[];
}> {
  const { snapshot: s } = await openSnapshot(ctx);
  const stored = s.sprints.get(slug);
  if (stored === undefined) throw new BackeError('not_found', `Sprint »${slug}« nicht gefunden`);

  // Der Sprint ist der Gegenstand; nur Projekt und Repo des Kontexts grenzen weiter ein.
  const { project, repo, header } = effectiveFilter(
    ctx,
    {
      ...(q.projects === undefined ? {} : { project: q.projects }),
      ...(q.repos === undefined ? {} : { repo: q.repos }),
    },
    q.all === true,
  );
  const filter = {
    ...(project === undefined ? {} : { project }),
    ...(repo === undefined ? {} : { repo }),
  };
  delete header.sprint;
  const shownHeader = Object.keys(header).length === 1 ? {} : header;

  const compare: (a: Issue, b: Issue) => number =
    q.sort === 'created' ? compareCreated : compareIssues;
  const members = [...s.issues.values()]
    .map((e) => e.data)
    .filter((i) => (i.sprints ?? []).includes(slug) && matchesFilter(i, filter, false))
    .sort(compare);
  const groups = GROUP_ORDER.map((state) => ({
    state,
    items: members
      .filter((i) => i.state === state)
      .map((issue) => ({ issue, openDeps: hasOpenDeps(s, issue) })),
  })).filter((g) => g.items.length > 0);
  return { header: shownHeader, sprint: stored.data, body: stored.body, groups };
}

export function closeSprint(
  ctx: ResolvedContext,
  slug: string,
  input: { carryOver?: string },
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  const op: OpOf<'sprint.close'> = { op: 'sprint.close', slug };
  if (input.carryOver !== undefined) op.carry_over = input.carryOver;
  return writeOp(ctx, () => op, deps);
}

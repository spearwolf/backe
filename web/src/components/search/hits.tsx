import { isSettled } from '@backe/core/state.ts';
import { EMPTY_FILTER, type ListFilter, listFilterSearch } from '../../app/list-filter.ts';
import { routeHref } from '../../app/routes.ts';
import {
  SEARCH_LIMIT,
  type SearchGroup,
  type SearchHit,
  type SearchIndex,
} from '../../app/search.ts';
import { m } from '../../views/search.messages.ts';
import { StateIcon } from '../StateIcon.tsx';

export const ROW = 'flex min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-sm';

export const GROUP_LABEL = {
  issue: () => m.groupIssues,
  project: () => m.groupProjects,
  sprint: () => m.groupSprints,
  repo: () => m.groupRepos,
  user: () => m.groupUsers,
} as const;

export function hitKey(hit: SearchHit): string {
  switch (hit.kind) {
    case 'issue':
      return `issue:${hit.issue.id}`;
    case 'project':
      return `project:${hit.project.path}`;
    case 'sprint':
      return `sprint:${hit.sprint.slug}`;
    case 'repo':
      return `repo:${hit.repo.name}`;
    case 'user':
      return `user:${hit.user.handle}`;
  }
}

/** Ziel einer Auswahl: Issue-Tab oder Backlog mit dem passenden Filter. */
export function hrefOf(hit: SearchHit, backlog: string): string {
  if (hit.kind === 'issue') return routeHref({ kind: 'issue', backlog, id: hit.issue.id });
  const filter: ListFilter = (() => {
    switch (hit.kind) {
      case 'project':
        return { ...EMPTY_FILTER, projects: [hit.project.path] };
      case 'sprint':
        return { ...EMPTY_FILTER, sprints: [hit.sprint.slug] };
      case 'repo':
        return { ...EMPTY_FILTER, repos: [hit.repo.name] };
      case 'user':
        return { ...EMPTY_FILTER, assignee: hit.user.handle };
    }
  })();
  return routeHref({ kind: 'backlog', backlog }) + listFilterSearch(filter);
}

/**
 * Die IDs der Serversuche als Gruppe, aufgelöst gegen den aktuellen Index: Der Server kennt
 * nur IDs, die Titel und States kommen frisch aus dem Store. Unbekannte IDs fallen weg.
 */
export function bodyGroupOf(ids: readonly string[], index: SearchIndex): SearchGroup | undefined {
  const byId = new Map(index.issues.map((e) => [e.item.id, e.item]));
  const hits: SearchHit[] = [];
  for (const id of ids) {
    const issue = byId.get(id);
    if (issue !== undefined) hits.push({ kind: 'issue', issue, exact: false });
  }
  if (hits.length === 0) return undefined;
  return {
    kind: 'issue',
    hits: hits.slice(0, SEARCH_LIMIT),
    more: Math.max(0, hits.length - SEARCH_LIMIT),
  };
}

export function HitRow({ hit }: { hit: SearchHit }) {
  switch (hit.kind) {
    case 'issue':
      return (
        <>
          <StateIcon state={hit.issue.state} className="shrink-0" />
          <span className="shrink-0 font-mono text-xs whitespace-nowrap">{hit.issue.id}</span>
          <span className="truncate">{hit.issue.title}</span>
          {hit.exact && <span className="shrink-0 text-xs text-muted-foreground">{m.exact}</span>}
          {isSettled(hit.issue.state) && (
            <span className="shrink-0 text-xs text-muted-foreground">{m.closed}</span>
          )}
        </>
      );
    case 'project':
      return (
        <>
          <span className="shrink-0 font-mono text-xs">{hit.project.path}</span>
          <span className="truncate">{hit.project.title}</span>
        </>
      );
    case 'sprint':
      return (
        <>
          <span className="shrink-0 font-mono text-xs">{hit.sprint.slug}</span>
          <span className="truncate">{hit.sprint.title}</span>
        </>
      );
    case 'repo':
      return (
        <>
          <span className="shrink-0 font-mono text-xs">{hit.repo.name}</span>
          <span className="truncate text-muted-foreground">{hit.repo.url}</span>
        </>
      );
    case 'user':
      return (
        <>
          <span className="shrink-0 font-mono text-xs">{hit.user.handle}</span>
          <span className="truncate">{hit.user.name}</span>
          {hit.user.kind === 'agent' && (
            <span className="shrink-0 text-xs text-muted-foreground">{m.agent}</span>
          )}
        </>
      );
  }
}

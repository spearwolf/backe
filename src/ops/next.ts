/**
 * Auswahl für `backe next` (backe.md §2.22, §2.23): eigene laufende Arbeit zuerst, sonst der beste
 * bereite Kandidat; ohne Kandidat nennt das Ergebnis den Grund. Alles iterativ.
 */
import { parseRepoRef } from '../core/names.ts';
import type { Issue } from '../core/schemas.ts';
import { isSettled } from '../core/state.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { ancestors, graphOf, isReady, isUnblockable, occupyingAncestor } from './graph.ts';
import type { Notice } from './notice.ts';
import { compareIssues, compareRank } from './order.ts';

export type ContextFilter = {
  project?: string;
  projectExact?: boolean;
  sprint?: string;
  repo?: string;
};

/** Projekt rekursiv (`web` umfasst `web/auth`, nicht `webapp`), Repo per Name vor dem `@`. */
export function matchesContext(issue: Issue, f: ContextFilter): boolean {
  if (f.project !== undefined) {
    const p = f.project;
    const hit = (issue.projects ?? []).some(
      (x) => x === p || (f.projectExact !== true && x.startsWith(`${p}/`)),
    );
    if (!hit) return false;
  }
  if (f.sprint !== undefined && !(issue.sprints ?? []).includes(f.sprint)) return false;
  if (f.repo !== undefined) {
    const name = f.repo;
    if (!(issue.repos ?? []).some((r) => parseRepoRef(r).name === name)) return false;
  }
  return true;
}

export type NextQuery = { actor: string; level: 'leaf' | 'top'; filter: ContextFilter };

export type NextResult = {
  id?: string;
  resumed: boolean;
  reason?: 'waiting' | 'all_assigned' | 'all_blocked' | 'nothing_open';
  waiting?: string[];
  notices: Notice[];
};

/** Offene Issues, die direkt oder transitiv an `id` hängen; jedes einmal gezählt. */
function openDependentCount(s: BacklogSnapshot, id: string): number {
  const { dependents } = graphOf(s);
  const seen = new Set<string>([id]);
  const stack = [id];
  let count = 0;
  for (let cur = stack.pop(); cur !== undefined; cur = stack.pop()) {
    for (const d of dependents.get(cur) ?? []) {
      if (seen.has(d)) continue;
      seen.add(d);
      stack.push(d);
      const issue = s.issues.get(d);
      if (issue && !isSettled(issue.data.state)) count++;
    }
  }
  return count;
}

/** Hinweis auf abgebrochene oder abgelehnte `depends_on` eines Issues (backe.md §2.22). */
export function settledDependencyNotice(s: BacklogSnapshot, issue: Issue): Notice | undefined {
  const settled = (issue.depends_on ?? []).filter((d) => {
    const state = s.issues.get(d)?.data.state;
    return state === 'cancelled' || state === 'rejected';
  });
  if (settled.length === 0) return undefined;
  return {
    code: 'settled_dependency',
    message: `${issue.id} hängt von abgebrochenen oder abgelehnten Issues ab: ${settled.join(', ')}`,
    ids: settled,
  };
}

/**
 * Hinweis auf entblockbare Issues (backe.md §2.6): alle Blocker erledigt; war ein Blocker
 * `cancelled` oder `rejected` statt `done`, steht das ausdrücklich dabei. Nicht entblockbare
 * Issues der Eingabe werden ignoriert.
 */
export function unblockableNotice(
  s: BacklogSnapshot,
  issues: readonly Issue[],
): Notice | undefined {
  const unblockable = issues.filter((i) => isUnblockable(s, i.id));
  if (unblockable.length === 0) return undefined;
  const parts = unblockable.map((i) => {
    const odd = (i.blocked_by ?? []).flatMap((b) => {
      const state = s.issues.get(b)?.data.state;
      return state === 'cancelled' || state === 'rejected' ? [`${b} (${state})`] : [];
    });
    return odd.length > 0 ? `${i.id} (nicht erledigt: ${odd.join(', ')})` : i.id;
  });
  return {
    code: 'unblockable',
    message: `Alle Blocker erledigt, entblockbar: ${parts.join('; ')}`,
    ids: unblockable.map((i) => i.id),
  };
}

function notices(s: BacklogSnapshot, chosen: Issue | undefined, inContext: Issue[]): Notice[] {
  return [
    chosen ? settledDependencyNotice(s, chosen) : undefined,
    unblockableNotice(s, inContext),
  ].filter((n): n is Notice => n !== undefined);
}

export function selectNext(s: BacklogSnapshot, q: NextQuery): NextResult {
  const inContext = [...s.issues.values()]
    .map((e) => e.data)
    .filter((i) => (q.level === 'top' ? i.parent === undefined : true))
    .filter((i) => matchesContext(i, q.filter));
  const mine = (i: Issue): boolean => i.assignee === undefined || i.assignee === q.actor;
  const open = (i: Issue): boolean => i.state === 'todo' || i.state === 'backlog';

  const own = inContext
    .filter(
      (i) =>
        i.state === 'in_progress' &&
        i.assignee === q.actor &&
        !ancestors(s, i.id).some((a) => {
          const st = s.issues.get(a)?.data.state;
          return st === 'blocked' || st === 'on_hold';
        }),
    )
    .sort(compareIssues)[0];
  if (own) return { id: own.id, resumed: true, notices: notices(s, own, inContext) };

  const candidates = inContext
    .filter(
      (i) =>
        isReady(s, i.id, { level: q.level }) &&
        mine(i) &&
        (q.level === 'top' || occupyingAncestor(s, i.id, q.actor) === undefined),
    )
    .map((i) => ({ issue: i, dependents: openDependentCount(s, i.id) }));
  candidates.sort((a, b) => {
    if (a.issue.state !== b.issue.state) return a.issue.state === 'todo' ? -1 : 1;
    return (
      compareRank(a.issue, b.issue) ||
      b.dependents - a.dependents ||
      compareIssues(a.issue, b.issue)
    );
  });
  const chosen = candidates[0]?.issue;
  if (chosen) return { id: chosen.id, resumed: false, notices: notices(s, chosen, inContext) };

  const waiting = inContext
    .filter((i) => open(i) && mine(i))
    .sort(compareIssues)
    .map((i) => i.id);
  const base = { resumed: false, notices: notices(s, undefined, inContext) };
  if (waiting.length > 0) return { ...base, reason: 'waiting', waiting };
  const assigned = inContext.some(
    (i) =>
      ((i.state === 'in_progress' || i.state === 'review') && i.assignee !== q.actor) ||
      (open(i) && !mine(i)),
  );
  if (assigned) return { ...base, reason: 'all_assigned' };
  if (inContext.some((i) => i.state === 'blocked' || i.state === 'on_hold')) {
    return { ...base, reason: 'all_blocked' };
  }
  return { ...base, reason: 'nothing_open' };
}

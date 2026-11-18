/**
 * Reihenfolge von Issues (backe.md §2.18): `rank` aufsteigend, Issues ohne `rank` zuletzt,
 * bei Gleichstand `created`, dann `id`.
 */
import type { Issue } from '../core/schemas.ts';

function cmp<T extends string | number>(a: T, b: T): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** `rank` aufsteigend, Issues ohne `rank` zuletzt; gleich bei Gleichstand. */
export function compareRank(a: Issue, b: Issue): number {
  if (a.rank === b.rank) return 0;
  if (a.rank === undefined) return 1;
  if (b.rank === undefined) return -1;
  return cmp(a.rank, b.rank);
}

export function compareIssues(a: Issue, b: Issue): number {
  return compareRank(a, b) || cmp(a.created, b.created) || cmp(a.id, b.id);
}

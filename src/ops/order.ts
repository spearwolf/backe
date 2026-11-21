/**
 * Reihenfolge von Issues (backe.md §2.18): `rank` aufsteigend, Issues ohne `rank` zuletzt,
 * bei Gleichstand `created`, dann `id`.
 */

import { compareCodeUnits } from '../core/compare.ts';
import type { Issue } from '../core/schemas.ts';

/** `rank` aufsteigend, Issues ohne `rank` zuletzt; gleich bei Gleichstand. */
export function compareRank(a: Issue, b: Issue): number {
  if (a.rank === b.rank) return 0;
  if (a.rank === undefined) return 1;
  if (b.rank === undefined) return -1;
  return compareCodeUnits(a.rank, b.rank);
}

export function compareIssues(a: Issue, b: Issue): number {
  return (
    compareRank(a, b) || compareCodeUnits(a.created, b.created) || compareCodeUnits(a.id, b.id)
  );
}

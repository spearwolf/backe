/**
 * Was `issue_delete` vorher fragt (ui.md §2.8): dieselbe Rechnung wie `issueDelete` in BK (beide
 * nutzen `deletedSet` und `referencingIssues`), damit der Dialog die Rückfragen kennt, bevor der
 * Server sie als Fehler stellt.
 */
import { deletedSet, referencingIssues } from '@backe/ops/delete-scope.ts';
import { graphOf } from '@backe/ops/graph.ts';
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';

/** Direkte Sub-Issues und Issues, die auf das Gelöschte (mit `recursive`: samt Nachfahren) verweisen. */
export function deletePlan(
  s: BacklogSnapshot,
  id: string,
  children?: 'orphan' | 'recursive',
): { children: string[]; referencing: string[] } {
  const direct = [...(graphOf(s).children.get(id) ?? [])].sort();
  const doomed = deletedSet(s, id, children === 'recursive');
  return { children: direct, referencing: referencingIssues(s, doomed).sort() };
}

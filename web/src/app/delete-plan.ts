/**
 * Was `issue_delete` vorher fragt (ui.md §2.8): dieselbe Rechnung wie `issueDelete` in BK, damit
 * der Dialog die Rückfragen kennt, bevor der Server sie als Fehler stellt.
 */
import { graphOf } from '@backe/ops/graph.ts';
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';

/** Direkte Sub-Issues und Issues, die auf das Gelöschte (mit `recursive`: samt Nachfahren) verweisen. */
export function deletePlan(
  s: BacklogSnapshot,
  id: string,
  children?: 'orphan' | 'recursive',
): { children: string[]; referencing: string[] } {
  const { children: tree } = graphOf(s);
  const direct = [...(tree.get(id) ?? [])].sort();
  const doomed = new Set([id]);
  if (children === 'recursive') {
    const stack = [id];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      for (const child of tree.get(next) ?? []) {
        if (doomed.has(child)) continue;
        doomed.add(child);
        stack.push(child);
      }
    }
  }
  const referencing: string[] = [];
  for (const [other, { data }] of s.issues) {
    if (doomed.has(other)) continue;
    const refs = [...(data.blocked_by ?? []), ...(data.depends_on ?? [])];
    if (refs.some((r) => doomed.has(r))) referencing.push(other);
  }
  return { children: direct, referencing: referencing.sort() };
}

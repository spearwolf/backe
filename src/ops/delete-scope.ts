/**
 * Reichweite von `issue.delete` auf einem Snapshot: welche Issues entfallen und wer noch auf sie
 * verweist. Rein, ohne Draft; `issueDelete` und die Rückfragen der Web-UI rechnen damit dasselbe.
 */

import type { BacklogSnapshot } from '../store/snapshot.ts';
import { graphOf } from './graph.ts';

/** Die Wurzel und, mit `recursive`, alle Nachfahren; iterativ, ohne Rekursion. */
export function deletedSet(s: BacklogSnapshot, id: string, recursive: boolean): Set<string> {
  const doomed = new Set([id]);
  if (!recursive) return doomed;
  const { children } = graphOf(s);
  const stack = [id];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    for (const child of children.get(next) ?? []) {
      if (doomed.has(child)) continue;
      doomed.add(child);
      stack.push(child);
    }
  }
  return doomed;
}

/** Überlebende Issues, deren `blocked_by` oder `depends_on` ein gelöschtes nennt, in Store-Reihenfolge. */
export function referencingIssues(s: BacklogSnapshot, doomed: ReadonlySet<string>): string[] {
  const referencing: string[] = [];
  for (const [id, { data }] of s.issues) {
    if (doomed.has(id)) continue;
    const refs = [...(data.blocked_by ?? []), ...(data.depends_on ?? [])];
    if (refs.some((r) => doomed.has(r))) referencing.push(id);
  }
  return referencing;
}

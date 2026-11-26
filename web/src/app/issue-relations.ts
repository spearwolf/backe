/**
 * Beziehungen eines Issues aus dem Store (ui.md §2.9): dieselben Listen wie `issue show`
 * (`showIssue`), gerechnet auf dem Snapshot, damit ein Patch sie ohne Neuladen ändert.
 */
import { ancestors, childProgress, graphOf } from '@backe/ops/graph.ts';
import { compareIssues } from '@backe/ops/order.ts';
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';
import type { IssueRefJson } from '@backe/ui/api.ts';

export type IssueRelations = {
  /** Vorfahren in der Reihenfolge von `ancestors`, wie `issue show`. */
  parents: IssueRefJson[];
  blockedBy: IssueRefJson[];
  dependsOn: (IssueRefJson | { id: string; missing: true })[];
  dependents: IssueRefJson[];
  children: IssueRefJson[];
  progress?: { settled: number; total: number };
};

export function issueRelations(s: BacklogSnapshot, id: string): IssueRelations | undefined {
  const issue = s.issues.get(id)?.data;
  if (issue === undefined) return undefined;
  const ref = (other: string): IssueRefJson[] => {
    const o = s.issues.get(other)?.data;
    return o === undefined
      ? []
      : [
          {
            id: o.id,
            state: o.state,
            title: o.title,
            ...(o.assignee === undefined ? {} : { assignee: o.assignee }),
          },
        ];
  };
  const sorted = (ids: readonly string[] | undefined): IssueRefJson[] =>
    (ids ?? [])
      .flatMap((x) => s.issues.get(x)?.data ?? [])
      .sort(compareIssues)
      .flatMap((i) => ref(i.id));

  const graph = graphOf(s);
  const progress = childProgress(s, id);
  return {
    parents: ancestors(s, id).flatMap(ref),
    blockedBy: (issue.blocked_by ?? []).flatMap(ref),
    dependsOn: (issue.depends_on ?? []).map((dep) => ref(dep)[0] ?? { id: dep, missing: true }),
    dependents: sorted(graph.dependents.get(id)),
    children: sorted(graph.children.get(id)),
    ...(progress === undefined ? {} : { progress }),
  };
}

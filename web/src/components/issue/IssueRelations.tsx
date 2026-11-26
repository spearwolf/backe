import type { IssueJson } from '@backe/ui/api.ts';
import type { IssueRelations as Relations } from '../../app/issue-relations.ts';
import { useWrites } from '../../data/write-context.tsx';
import { m } from '../../views/issue.messages.ts';
import { DepsEditor } from './edit/DepsEditor.tsx';
import { IssueRef } from './IssueRef.tsx';
import { RelationGroup as Group } from './parts.tsx';

/**
 * Die rechte Spalte: blocked_by, depends_on, Abhängige und Sub-Issues; leere Gruppen fehlen. Mit
 * Schreibrecht steht `depends_on` immer da, mit Entfernen und Hinzufügen.
 */
export function IssueRelations(props: { issue: IssueJson; relations: Relations; backlog: string }) {
  const { issue, relations, backlog } = props;
  const { canWrite } = useWrites();
  const { blockedBy, dependsOn, dependents, children, progress } = relations;
  const item = (id: string, node: React.ReactNode) => <li key={id}>{node}</li>;
  return (
    <div className="space-y-4">
      {blockedBy.length > 0 && (
        <Group title="blocked_by">
          {blockedBy.map((i) => item(i.id, <IssueRef issue={i} backlog={backlog} />))}
        </Group>
      )}
      {canWrite ? (
        <DepsEditor issue={issue} dependsOn={dependsOn} backlog={backlog} />
      ) : (
        dependsOn.length > 0 && (
          <Group title="depends_on">
            {dependsOn.map((i) => item(i.id, <IssueRef issue={i} backlog={backlog} />))}
          </Group>
        )
      )}
      {dependents.length > 0 && (
        <Group title={m.dependents}>
          {dependents.map((i) => item(i.id, <IssueRef issue={i} backlog={backlog} />))}
        </Group>
      )}
      {children.length > 0 && (
        <Group
          title={m.children}
          {...(progress === undefined
            ? {}
            : { note: m.progress(progress.settled, progress.total) })}
        >
          {children.map((i) => item(i.id, <IssueRef issue={i} backlog={backlog} />))}
        </Group>
      )}
    </div>
  );
}

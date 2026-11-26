import type { IssueRelations as Relations } from '../../app/issue-relations.ts';
import { m } from '../../views/issue.messages.ts';
import { IssueRef } from './IssueRef.tsx';

function Group(props: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section aria-label={props.title} className="space-y-1">
      <h2 className="flex items-baseline gap-2 text-sm font-semibold">
        {props.title}
        {props.note !== undefined && (
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {props.note}
          </span>
        )}
      </h2>
      <ul className="space-y-1">{props.children}</ul>
    </section>
  );
}

/** Die rechte Spalte: blocked_by, depends_on, Abhängige und Sub-Issues; leere Gruppen fehlen. */
export function IssueRelations({ relations, backlog }: { relations: Relations; backlog: string }) {
  const { blockedBy, dependsOn, dependents, children, progress } = relations;
  const item = (id: string, node: React.ReactNode) => <li key={id}>{node}</li>;
  return (
    <div className="space-y-4">
      {blockedBy.length > 0 && (
        <Group title="blocked_by">
          {blockedBy.map((i) => item(i.id, <IssueRef issue={i} backlog={backlog} />))}
        </Group>
      )}
      {dependsOn.length > 0 && (
        <Group title="depends_on">
          {dependsOn.map((i) => item(i.id, <IssueRef issue={i} backlog={backlog} />))}
        </Group>
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

import type { IssueJson } from '@backe/ui/api.ts';
import type { ReactNode } from 'react';
import type { IssueRelations } from '../../app/issue-relations.ts';
import { useWrites } from '../../data/write-context.tsx';
import { Markdown } from '../../markdown/index.tsx';
import { m } from '../../views/issue.messages.ts';
import { StateIcon } from '../StateIcon.tsx';
import {
  AssigneeEditor,
  ParentEditor,
  ProjectsEditor,
  SprintsEditor,
} from './edit/FieldEditors.tsx';
import type { DeclaredProps } from './edit/PropInput.tsx';
import { PropsEditor } from './edit/PropsEditor.tsx';
import { StateControl } from './edit/StateControl.tsx';
import { IssueRef } from './IssueRef.tsx';
import { Author, CopyValue, Time } from './parts.tsx';
import { RepoPath } from './RepoPath.tsx';

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className="min-w-0 text-sm">{props.children}</dd>
    </div>
  );
}

const propText = (value: unknown): string =>
  typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);

function list(items: readonly string[] | undefined): ReactNode | undefined {
  return items === undefined || items.length === 0 ? undefined : (
    <ul className="flex flex-wrap gap-1">
      {items.map((x) => (
        <li key={x} className="rounded-full border px-2 py-0.5 text-xs">
          {x}
        </li>
      ))}
    </ul>
  );
}

function PropsView({ issue, declared }: { issue: IssueJson; declared: DeclaredProps }) {
  return (
    <dl className="space-y-1">
      {Object.entries(issue.props ?? {}).map(([key, value]) => (
        <div key={key}>
          <dt className="font-mono text-xs">{key}</dt>
          <dd>
            {propText(value)}
            {declared?.[key] !== undefined && (
              <span className="block text-xs text-muted-foreground">
                {declared[key].description}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Die linke Spalte (ui.md §2.9.1): Felder des Issues aus dem Store, Leeres fehlt. Mit Schreibrecht
 * stehen die bearbeitbaren Felder immer da, jedes mit seinem Editor.
 */
export function IssueFields(props: {
  issue: IssueJson;
  backlog: string;
  parents: IssueRelations['parents'];
  declared: DeclaredProps;
  reason: string | undefined;
  markdownIssue: React.ComponentProps<typeof Markdown>['issue'];
}) {
  const { issue, backlog, parents, declared, reason, markdownIssue } = props;
  const { canWrite } = useWrites();
  const projects = list(issue.projects);
  const sprints = list(issue.sprints);
  const repos = issue.repos?.length ? (
    <ul className="space-y-0.5">
      {issue.repos.map((r) => {
        const at = r.indexOf('@');
        const name = at < 0 ? r : r.slice(0, at);
        return (
          <li key={r}>
            <span>{name}</span>
            {at >= 0 && <span className="ml-1 font-mono text-xs">{r.slice(at + 1)}</span>}
            {canWrite && <RepoPath name={name} />}
          </li>
        );
      })}
    </ul>
  ) : undefined;
  const path = parents.length > 0 && (
    <nav aria-label={m.parents}>
      <ol className="flex flex-wrap items-center gap-x-1">
        {[...parents].reverse().map((p, i) => (
          <li key={p.id} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">›</span>}
            <IssueRef issue={p} backlog={backlog} />
          </li>
        ))}
      </ol>
    </nav>
  );
  const hasProps = Object.keys(issue.props ?? {}).length > 0;
  return (
    <dl className="space-y-2">
      <Field label={m.fieldId}>
        <CopyValue value={issue.id} label={m.copyId} />
      </Field>
      <Field label={m.fieldState}>
        {canWrite ? (
          <StateControl issue={issue} />
        ) : (
          <StateIcon state={issue.state} className="text-sm" />
        )}
        {reason !== undefined && reason !== '' && (
          <Markdown
            source={reason}
            backlog={backlog}
            issue={markdownIssue}
            className="mt-1 text-xs text-muted-foreground"
          />
        )}
      </Field>
      {canWrite ? (
        <Field label={m.fieldAssignee}>
          <AssigneeEditor issue={issue} />
        </Field>
      ) : (
        issue.assignee !== undefined && (
          <Field label={m.fieldAssignee}>
            <Author handle={issue.assignee} />
          </Field>
        )
      )}
      <Field label={m.fieldCreator}>
        <Author handle={issue.creator} />
      </Field>
      <Field label={m.fieldCreated}>
        <Time iso={issue.created} />
      </Field>
      {issue.rank !== undefined && <Field label={m.fieldRank}>{issue.rank}</Field>}
      {canWrite ? (
        <>
          <Field label={m.fieldProjects}>
            <ProjectsEditor issue={issue} />
          </Field>
          <Field label={m.fieldSprints}>
            <SprintsEditor issue={issue} />
          </Field>
        </>
      ) : (
        <>
          {projects !== undefined && <Field label={m.fieldProjects}>{projects}</Field>}
          {sprints !== undefined && <Field label={m.fieldSprints}>{sprints}</Field>}
        </>
      )}
      {repos !== undefined && <Field label={m.fieldRepos}>{repos}</Field>}
      {canWrite ? (
        <Field label={m.fieldParents}>
          <div className="space-y-1">
            {path}
            <ParentEditor issue={issue} />
          </div>
        </Field>
      ) : (
        path !== false && <Field label={m.fieldParents}>{path}</Field>
      )}
      {canWrite ? (
        <Field label={m.fieldProps}>
          <PropsEditor issue={issue} declared={declared} />
        </Field>
      ) : (
        hasProps && (
          <Field label={m.fieldProps}>
            <PropsView issue={issue} declared={declared} />
          </Field>
        )
      )}
    </dl>
  );
}

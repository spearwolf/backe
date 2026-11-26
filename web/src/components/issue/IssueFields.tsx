import type { IssueJson } from '@backe/ui/api.ts';
import { Check, Copy } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import type { IssueRelations } from '../../app/issue-relations.ts';
import { Markdown } from '../../markdown/index.tsx';
import { m } from '../../views/issue.messages.ts';
import { StateIcon } from '../StateIcon.tsx';
import { Button } from '../ui/button.tsx';
import { IssueRef } from './IssueRef.tsx';
import { Author, Time } from './parts.tsx';

type Declared = Record<string, { description: string }> | undefined;

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

/** ID mit Kopier-Knopf; die Bestätigung steht in einer Live-Region. */
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!copied && !failed) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setFailed(false);
    }, 2000);
    return () => clearTimeout(timer);
  }, [copied, failed]);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono text-xs">{id}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-6"
        aria-label={m.copyId}
        onClick={() => {
          navigator.clipboard.writeText(id).then(
            () => setCopied(true),
            () => setFailed(true),
          );
        }}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
      <span role="status" className="text-xs text-muted-foreground">
        {copied ? m.copied : failed ? m.copyFailed : ''}
      </span>
    </span>
  );
}

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

/** Die linke Spalte (ui.md §2.9.1): Felder des Issues aus dem Store, Leeres fehlt. */
export function IssueFields(props: {
  issue: IssueJson;
  backlog: string;
  parents: IssueRelations['parents'];
  declared: Declared;
  reason: string | undefined;
  markdownIssue: React.ComponentProps<typeof Markdown>['issue'];
}) {
  const { issue, backlog, parents, declared, reason, markdownIssue } = props;
  const projects = list(issue.projects);
  const sprints = list(issue.sprints);
  const repos = issue.repos?.length ? (
    <ul className="space-y-0.5">
      {issue.repos.map((r) => {
        const at = r.indexOf('@');
        return (
          <li key={r}>
            <span>{at < 0 ? r : r.slice(0, at)}</span>
            {at >= 0 && <span className="ml-1 font-mono text-xs">{r.slice(at + 1)}</span>}
          </li>
        );
      })}
    </ul>
  ) : undefined;
  const props_ = Object.entries(issue.props ?? {});
  return (
    <dl className="space-y-2">
      <Field label={m.fieldId}>
        <CopyId id={issue.id} />
      </Field>
      <Field label={m.fieldState}>
        <StateIcon state={issue.state} className="text-sm" />
        {reason !== undefined && reason !== '' && (
          <Markdown
            source={reason}
            backlog={backlog}
            issue={markdownIssue}
            className="mt-1 text-xs text-muted-foreground"
          />
        )}
      </Field>
      {issue.assignee !== undefined && (
        <Field label={m.fieldAssignee}>
          <Author handle={issue.assignee} />
        </Field>
      )}
      <Field label={m.fieldCreator}>
        <Author handle={issue.creator} />
      </Field>
      <Field label={m.fieldCreated}>
        <Time iso={issue.created} />
      </Field>
      {issue.rank !== undefined && <Field label={m.fieldRank}>{issue.rank}</Field>}
      {projects !== undefined && <Field label={m.fieldProjects}>{projects}</Field>}
      {sprints !== undefined && <Field label={m.fieldSprints}>{sprints}</Field>}
      {repos !== undefined && <Field label={m.fieldRepos}>{repos}</Field>}
      {parents.length > 0 && (
        <Field label={m.fieldParents}>
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
        </Field>
      )}
      {props_.length > 0 && (
        <Field label={m.fieldProps}>
          <dl className="space-y-1">
            {props_.map(([key, value]) => (
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
        </Field>
      )}
    </dl>
  );
}

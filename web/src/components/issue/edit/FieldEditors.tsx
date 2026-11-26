/**
 * Editoren der linken Spalte (ui.md §2.9.1); die Properties stehen in `PropsEditor.tsx`. Jede
 * Änderung ist genau ein `issue_update` mit Überlagerung; während des Aufrufs ist der Editor
 * gesperrt, ein Fehler steht am Feld.
 */
import type { IssueJson } from '@backe/ui/api.ts';
import { useState } from 'react';
import { useStore } from '../../../data/store-context.tsx';
import { useSignal } from '../../../data/use-signal.ts';
import { useWrites } from '../../../data/write-context.tsx';
import { m } from '../../../views/issue.messages.ts';
import { Button } from '../../ui/button.tsx';
import { ErrorBox } from '../../write/ActionError.tsx';
import { AssigneeSelect, IssuePick, MultiPick } from './inputs.tsx';
import { openSprints } from './store-options.ts';
import { type IssueChange, useIssueUpdate } from './use-issue-update.ts';

export function AssigneeEditor({ issue }: { issue: IssueJson }) {
  const { me } = useWrites();
  const users = useSignal(useStore().users.keys);
  const { busy, error, update, scope } = useIssueUpdate(issue);
  const current = issue.assignee ?? null;
  return (
    <div ref={scope} className="space-y-1">
      <AssigneeSelect
        value={current}
        me={me}
        users={users}
        disabled={busy}
        onChange={(assignee) => {
          if (assignee !== current) void update({ assignee });
        }}
      />
      {error !== undefined && <ErrorBox error={error} compact />}
    </div>
  );
}

const LIST_KEYS = {
  projects: ['add_projects', 'rm_projects'],
  sprints: ['add_sprints', 'rm_sprints'],
} as const;

/** Die Differenz zweier Listen als `add_*`/`rm_*`; leere Seiten entfallen. */
function listChange(
  field: keyof typeof LIST_KEYS,
  before: readonly string[],
  after: readonly string[],
): IssueChange {
  const [addKey, rmKey] = LIST_KEYS[field];
  const add = after.filter((x) => !before.includes(x));
  const rm = before.filter((x) => !after.includes(x));
  const change: IssueChange = {};
  if (add.length > 0) change[addKey] = add;
  if (rm.length > 0) change[rmKey] = rm;
  return change;
}

function ListEditor(props: {
  issue: IssueJson;
  field: keyof typeof LIST_KEYS;
  label: string;
  options: readonly string[];
}) {
  const { issue, field, label, options } = props;
  const { busy, error, update, scope } = useIssueUpdate(issue);
  const values = issue[field] ?? [];
  return (
    <div ref={scope} className="space-y-1">
      <MultiPick
        label={label}
        values={values}
        options={options}
        disabled={busy}
        onChange={(next) => void update(listChange(field, values, next))}
      />
      {error !== undefined && <ErrorBox error={error} compact />}
    </div>
  );
}

export function ProjectsEditor({ issue }: { issue: IssueJson }) {
  const projects = useSignal(useStore().projects.keys);
  return <ListEditor issue={issue} field="projects" label={m.fieldProjects} options={projects} />;
}

/** Geschlossene Sprints nimmt niemand mehr auf; eingetragen bleiben sie als Chip stehen. */
export function SprintsEditor({ issue }: { issue: IssueJson }) {
  const open = useSignal(openSprints(useStore()));
  return <ListEditor issue={issue} field="sprints" label={m.fieldSprints} options={open} />;
}

export function ParentEditor({ issue }: { issue: IssueJson }) {
  const [draft, setDraft] = useState('');
  const { busy, error, update, scope } = useIssueUpdate<HTMLFormElement>(issue);
  const target = draft.trim();
  return (
    <form
      ref={scope}
      className="space-y-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (target === '') return;
        void update({ parent: target }).then((ok) => ok && setDraft(''));
      }}
    >
      <div className="flex flex-wrap items-center gap-1">
        <div className="w-40">
          <IssuePick
            label={m.parent}
            value={draft}
            exclude={[issue.id]}
            disabled={busy}
            onChange={setDraft}
          />
        </div>
        <Button type="submit" variant="outline" size="sm" disabled={busy || target === ''}>
          {m.setParent}
        </Button>
        {issue.parent !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void update({ parent: null })}
          >
            {m.removeParent}
          </Button>
        )}
      </div>
      {error !== undefined && <ErrorBox error={error} compact />}
    </form>
  );
}

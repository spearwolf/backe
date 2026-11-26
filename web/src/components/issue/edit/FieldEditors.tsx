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
import { type IssueChange, useIssueUpdate } from './use-issue-update.ts';

const added = (before: readonly string[], after: readonly string[]) =>
  after.filter((x) => !before.includes(x));

export function AssigneeEditor({ issue }: { issue: IssueJson }) {
  const { me } = useWrites();
  const users = useSignal(useStore().users.keys);
  const { busy, error, update } = useIssueUpdate(issue);
  return (
    <div className="space-y-1">
      <AssigneeSelect
        value={issue.assignee ?? null}
        me={me}
        users={users}
        disabled={busy}
        onChange={(assignee) => void update({ assignee })}
      />
      {error !== undefined && <ErrorBox error={error} compact />}
    </div>
  );
}

function ListEditor(props: {
  issue: IssueJson;
  label: string;
  values: readonly string[];
  options: readonly string[];
  change: (add: string[], rm: string[]) => IssueChange;
}) {
  const { issue, label, values, options, change } = props;
  const { busy, error, update } = useIssueUpdate(issue);
  return (
    <div className="space-y-1">
      <MultiPick
        label={label}
        values={values}
        options={options}
        disabled={busy}
        onChange={(next) => void update(change(added(values, next), added(next, values)))}
      />
      {error !== undefined && <ErrorBox error={error} compact />}
    </div>
  );
}

const projectChange = (add: string[], rm: string[]): IssueChange => ({
  ...(add.length > 0 ? { add_projects: add } : {}),
  ...(rm.length > 0 ? { rm_projects: rm } : {}),
});

const sprintChange = (add: string[], rm: string[]): IssueChange => ({
  ...(add.length > 0 ? { add_sprints: add } : {}),
  ...(rm.length > 0 ? { rm_sprints: rm } : {}),
});

export function ProjectsEditor({ issue }: { issue: IssueJson }) {
  const projects = useSignal(useStore().projects.keys);
  return (
    <ListEditor
      issue={issue}
      label={m.fieldProjects}
      values={issue.projects ?? []}
      options={projects}
      change={projectChange}
    />
  );
}

export function SprintsEditor({ issue }: { issue: IssueJson }) {
  const store = useStore();
  const slugs = useSignal(store.sprints.keys);
  // Geschlossene Sprints nimmt niemand mehr auf; eingetragen bleiben sie als Chip stehen.
  const open = slugs.filter((s) => store.sprints.get(s).value?.closed !== true);
  return (
    <ListEditor
      issue={issue}
      label={m.fieldSprints}
      values={issue.sprints ?? []}
      options={open}
      change={sprintChange}
    />
  );
}

export function ParentEditor({ issue }: { issue: IssueJson }) {
  const [draft, setDraft] = useState('');
  const { busy, error, update } = useIssueUpdate(issue);
  const target = draft.trim();
  return (
    <form
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

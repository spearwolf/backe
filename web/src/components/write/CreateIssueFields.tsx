/**
 * Die Felder des Anlegen-Dialogs (ui.md §2.12) ohne Titel und Beschreibung. Alles ist kontrolliert
 * und schreibt nichts: Der Dialog schickt den Entwurf erst beim Anlegen.
 */
import { MAIN_LINE, type State } from '@backe/core/state.ts';
import { type ReactNode, useId, useState } from 'react';
import { type CreateDraft, withParent } from '../../app/create-draft.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { m } from '../../views/issue.messages.ts';
import {
  AssigneeSelect,
  type DeclaredProps,
  IssuePick,
  MultiPick,
  PropInput,
} from '../issue/edit/inputs.tsx';
import { openSprints } from '../issue/edit/store-options.ts';
import { Button } from '../ui/button.tsx';
import { m as w } from './write.messages.ts';

export type DraftUpdate = (change: (draft: CreateDraft) => CreateDraft) => void;

type FieldsProps = { draft: CreateDraft; update: DraftUpdate; disabled: boolean };

/** Beschriftete Zeile; die Gruppe trägt den Namen des Felds für Screenreader und Tests. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <fieldset
      aria-labelledby={id}
      className="m-0 grid min-w-0 grid-cols-[7rem_1fr] items-start gap-2 border-0 p-0"
    >
      <span id={id} className="pt-1.5 text-sm text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </fieldset>
  );
}

/** Abhängigkeiten als Chips, dazu eine ID-Eingabe; Enter fügt hinzu, statt das Issue anzulegen. */
function DepsPick({ draft, update, disabled }: FieldsProps) {
  const [next, setNext] = useState('');
  const target = next.trim();
  const add = (): void => {
    if (target === '') return;
    update((d) =>
      d.depends_on.includes(target) ? d : { ...d, depends_on: [...d.depends_on, target] },
    );
    setNext('');
  };
  return (
    <div className="space-y-1">
      <MultiPick
        label={w.dependsOn}
        values={draft.depends_on}
        options={[]}
        disabled={disabled}
        onChange={(depends_on) => update((d) => ({ ...d, depends_on }))}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: fängt nur Enter aus der Eingabe ab. */}
      <div
        className="flex items-center gap-1"
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          add();
        }}
      >
        <div className="w-40">
          <IssuePick
            label={m.dependency}
            value={next}
            exclude={draft.depends_on}
            disabled={disabled}
            onChange={setNext}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || target === ''}
          onClick={add}
        >
          {m.addDep}
        </Button>
      </div>
    </div>
  );
}

function PropRow(props: FieldsProps & { name: string; decl: NonNullable<DeclaredProps>[string] }) {
  const { draft, update, disabled, name, decl } = props;
  const helpId = useId();
  return (
    <Row label={name}>
      <div className="space-y-1">
        <PropInput
          name={name}
          decl={decl}
          value={draft.props[name]}
          disabled={disabled}
          describedBy={helpId}
          onChange={(v) => update((d) => ({ ...d, props: { ...d.props, [name]: v } }))}
        />
        <p id={helpId} className="text-xs text-muted-foreground">
          {decl.description}
        </p>
      </div>
    </Row>
  );
}

export function CreateIssueFields(props: FieldsProps) {
  const { draft, update, disabled } = props;
  const { me } = useWrites();
  const store = useStore();
  const projects = useSignal(store.projects.keys);
  const sprints = useSignal(openSprints(store));
  const repos = useSignal(store.repos.keys);
  const users = useSignal(store.users.keys);
  const issueIds = useSignal(store.issues.keys);
  const declared = useSignal(store.config)?.props ?? {};
  const lists = [
    { field: 'projects', label: m.fieldProjects, options: projects },
    { field: 'sprints', label: m.fieldSprints, options: sprints },
    { field: 'repos', label: m.fieldRepos, options: repos },
  ] as const;

  // Erst eine vollständige, bekannte ID ist eine Auswahl; dann gilt die Vorbelegung des Parents.
  const onParent = (value: string): void => {
    const id = value.trim();
    const parent = issueIds.includes(id) ? store.issues.get(id).value : undefined;
    update((d) => (parent === undefined ? { ...d, parent: value } : withParent(d, parent)));
  };

  return (
    <div className="space-y-3">
      <Row label={m.fieldState}>
        <select
          aria-label={m.fieldState}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          value={draft.state}
          disabled={disabled}
          onChange={(e) => update((d) => ({ ...d, state: e.target.value as State }))}
        >
          {MAIN_LINE.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Row>
      {lists.map(({ field, label, options }) => (
        <Row key={field} label={label}>
          <MultiPick
            label={label}
            values={draft[field]}
            options={options}
            disabled={disabled}
            onChange={(next) => update((d) => ({ ...d, [field]: next }))}
          />
        </Row>
      ))}
      <Row label={m.fieldAssignee}>
        <AssigneeSelect
          value={draft.assignee}
          me={me}
          users={users}
          disabled={disabled}
          onChange={(assignee) => update((d) => ({ ...d, assignee }))}
        />
      </Row>
      <Row label={m.parent}>
        <div className="w-40">
          <IssuePick
            label={m.parent}
            value={draft.parent}
            disabled={disabled}
            onChange={onParent}
          />
        </div>
      </Row>
      <Row label={w.dependsOn}>
        <DepsPick {...props} />
      </Row>
      {Object.entries(declared).map(([name, decl]) => (
        <PropRow key={name} {...props} name={name} decl={decl} />
      ))}
    </div>
  );
}

/** Dialoge des Abschnitts Projekte: Anlegen, Verschieben, Entfernen. */
import { isProjectPath } from '@backe/core/names.ts';
import type { ToolArgs } from '@backe/ui/api.ts';
import { type FormEvent, useRef, useState } from 'react';
import type { SettingsSection as Section } from '../../app/settings-model.ts';
import { projectReferences } from '../../app/settings-model.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { m } from '../../views/settings.messages.ts';
import { ConfirmDialog } from '../write/ConfirmDialog.tsx';
import { useAction } from '../write/use-action.ts';
import type { DialogFocus } from './dialog-focus.ts';
import { Field, SELECT_CLASS, TextAreaField, TextField } from './fields.tsx';
import { ReferenceList, useAllIssues } from './references.tsx';
import { sectionId } from './SettingsSection.tsx';
import { usersOf } from './settings-memos.ts';

/**
 * Fehlertext eines Pfads. Ein Pfad, der auf `/` endet, ist noch unfertig (so steht der vorbelegte
 * Pfad eines Unterprojekts da): Er sperrt, gilt aber noch nicht als Fehler.
 */
const pathError = (path: string): string | undefined =>
  path !== '' && !path.endsWith('/') && !isProjectPath(path) ? m.invalidProjectPath : undefined;

/** Dialog »Hinzufügen« bzw. »Unterprojekt«; nur zum Öffnen gemountet, damit er leer beginnt. */
export function AddProjectDialog({
  section,
  parent,
  focus,
  onOpenChange,
}: {
  section: Section;
  parent: string | undefined;
  focus: DialogFocus;
  onOpenChange: (open: boolean) => void;
}) {
  const { writes } = useWrites();
  const users = useSignal(usersOf(useStore()));
  const { busy, error, run } = useAction();
  const [path, setPath] = useState(parent === undefined ? '' : `${parent}/`);
  const caretPlaced = useRef(false);
  const [title, setTitle] = useState('');
  const [lead, setLead] = useState('');
  const [body, setBody] = useState('');
  const formId = `${sectionId(section)}-add-form`;
  const pathMessage = pathError(path);
  const blocked = !isProjectPath(path);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (blocked) return;
    // Leere optionale Felder gehen nicht mit: Ohne Titel gilt das letzte Pfadsegment.
    const args: ToolArgs['project_create'] = {
      path,
      ...(title.trim() === '' ? {} : { title: title.trim() }),
      ...(lead === '' ? {} : { lead }),
      ...(body.trim() === '' ? {} : { body }),
    };
    void run(() => writes.run('project_create', args)).then((ok) => {
      if (ok) onOpenChange(false);
    });
  };

  return (
    <ConfirmDialog
      open
      title={m.addProjectTitle}
      confirmLabel={m.addProject}
      busy={busy}
      confirmDisabled={blocked}
      error={error}
      formId={formId}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        <TextField
          label={m.projectPath}
          hint={m.projectPathHint}
          error={pathMessage}
          value={path}
          onChange={setPath}
          // Beim vorbelegten Elternpfad tippt man hinten weiter; manche Browser setzen den Cursor
          // beim ersten Fokus an den Anfang.
          onFocus={(e) => {
            if (caretPlaced.current) return;
            caretPlaced.current = true;
            const end = e.currentTarget.value.length;
            e.currentTarget.setSelectionRange(end, end);
          }}
          disabled={busy}
          mono
          autoFocus
        />
        <TextField
          label={m.fieldTitle}
          hint={m.projectTitleHint}
          value={title}
          onChange={setTitle}
          disabled={busy}
        />
        <Field label={m.projectLeadLabel}>
          {({ id, describedBy }) => (
            <select
              id={id}
              aria-describedby={describedBy}
              className={`${SELECT_CLASS} w-fit`}
              value={lead}
              onChange={(e) => setLead(e.target.value)}
              disabled={busy}
            >
              <option value="">{m.leadNone}</option>
              {users.map((u) => (
                <option key={u.handle} value={u.handle}>
                  {m.userOption(u.name, u.handle)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <TextAreaField
          label={m.projectDescription}
          value={body}
          onChange={setBody}
          disabled={busy}
        />
      </form>
    </ConfirmDialog>
  );
}

/** Dialog »Verschieben«: neuer Pfad, vorbelegt mit dem alten; erst ein anderer gültiger schickt ab. */
export function MoveProjectDialog({
  section,
  path,
  focus,
  onOpenChange,
}: {
  section: Section;
  path: string;
  focus: DialogFocus;
  onOpenChange: (open: boolean) => void;
}) {
  const { writes } = useWrites();
  const { busy, error, run } = useAction();
  const [to, setTo] = useState(path);
  const formId = `${sectionId(section)}-move-form`;
  const pathMessage = pathError(to);
  const blocked = to === path || !isProjectPath(to);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (blocked) return;
    // Die Zeile zieht unter neuem Pfad um, der Auslöser verschwindet (siehe `useDialogFocus`).
    focus.arm(true);
    void run(() => writes.run('project_mv', { from: path, to })).then((ok) => {
      if (ok) onOpenChange(false);
      else focus.arm(false);
    });
  };

  return (
    <ConfirmDialog
      open
      title={m.moveProjectTitle(path)}
      confirmLabel={m.moveProject}
      busy={busy}
      confirmDisabled={blocked}
      error={error}
      formId={formId}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        <TextField
          label={m.moveTo}
          hint={m.moveToHint}
          error={pathMessage}
          value={to}
          onChange={setTo}
          disabled={busy}
          mono
          autoFocus
        />
      </form>
    </ConfirmDialog>
  );
}

type Choice = 'reassign' | 'detach' | undefined;

/**
 * Bestätigung zum Entfernen (BK §2.9). Nennen Issues das Projekt, ist eine Wahl Pflicht: umhängen
 * auf ein anderes Projekt oder lösen. Mit Unterprojekten bleibt »Entfernen« sicher gesperrt.
 */
export function RemoveProjectDialog({
  path,
  hasChildren,
  focus,
  onOpenChange,
}: {
  path: string;
  hasChildren: boolean;
  focus: DialogFocus;
  onOpenChange: (o: boolean) => void;
}) {
  const { writes } = useWrites();
  const store = useStore();
  const references = projectReferences(useAllIssues(), path);
  const others = useSignal(store.projects.keys)
    .filter((p) => p !== path)
    .sort();
  const [choice, setChoice] = useState<Choice>();
  const [target, setTarget] = useState('');
  const { busy, error, run } = useAction();
  const referenced = references.length > 0;
  // Ein Ziel, das per Patch verschwand, gilt nicht mehr als gewählt.
  const validTarget = others.includes(target) ? target : '';
  const chosen = choice === 'detach' || (choice === 'reassign' && validTarget !== '');
  const blocked = hasChildren || (referenced && !chosen);
  const groupName = `remove-${path}`;

  const args = (): ToolArgs['project_rm'] => {
    if (!referenced) return { path };
    return choice === 'detach' ? { path, detach: true } : { path, reassign: validTarget };
  };

  const confirm = (): void => {
    focus.arm(true);
    void run(() => writes.run('project_rm', args())).then((ok) => {
      if (ok) onOpenChange(false);
      else focus.arm(false);
    });
  };

  return (
    <ConfirmDialog
      open
      destructive
      title={m.removeProjectTitle(path)}
      confirmLabel={m.removeProject}
      busy={busy}
      confirmDisabled={blocked}
      error={error}
      onConfirm={confirm}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={focus.onCloseAutoFocus}
    >
      {hasChildren && <p className="text-sm">{m.projectHasChildren}</p>}
      {referenced && (
        <div className="space-y-3">
          <p className="text-sm">{m.projectStillReferenced}</p>
          <ReferenceList ids={references} />
          <fieldset className="space-y-2 text-sm">
            <legend className="sr-only">{m.referenceChoice}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name={groupName}
                  className="size-4 accent-foreground"
                  checked={choice === 'reassign'}
                  disabled={busy || others.length === 0}
                  onChange={() => setChoice('reassign')}
                />
                {m.reassignTo}
              </label>
              <select
                aria-label={m.chooseProject}
                className={`${SELECT_CLASS} w-fit font-mono`}
                value={validTarget}
                disabled={busy || others.length === 0}
                onChange={(e) => {
                  setTarget(e.target.value);
                  // Wer ein Ziel wählt, meint das Umhängen.
                  if (e.target.value !== '') setChoice('reassign');
                }}
              >
                <option value="">{m.chooseProject}</option>
                {others.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name={groupName}
                className="size-4 accent-foreground"
                checked={choice === 'detach'}
                disabled={busy}
                onChange={() => setChoice('detach')}
              />
              {m.detach}
            </label>
          </fieldset>
        </div>
      )}
    </ConfirmDialog>
  );
}

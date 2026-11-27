import { isProjectPath } from '@backe/core/names.ts';
import type { ToolArgs } from '@backe/ui/api.ts';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { EMPTY_FILTER, listFilterSearch } from '../../app/list-filter.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import type { ProjectRow, SettingsSection as Section } from '../../app/settings-model.ts';
import { projectReferences } from '../../app/settings-model.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { Markdown } from '../../markdown/index.tsx';
import { m } from '../../views/settings.messages.ts';
import { IssueRef } from '../issue/IssueRef.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/input.tsx';
import { Textarea } from '../ui/textarea.tsx';
import { ConfirmDialog } from '../write/ConfirmDialog.tsx';
import { useAction } from '../write/use-action.ts';
import { Field, FormSubmitShim, SELECT_CLASS } from './fields.tsx';
import { type SectionFrame, SettingsSection, sectionId } from './SettingsSection.tsx';
import { projectRowsOf } from './settings-memos.ts';

/** Höchstens fünf Ebenen (BK §2.9): Auf der fünften gibt es kein Unterprojekt mehr. */
const MAX_DEPTH = 5;

/**
 * Fehlertext eines Pfads. Ein Pfad, der auf `/` endet, ist noch unfertig (so steht der vorbelegte
 * Pfad eines Unterprojekts da): Er sperrt, gilt aber noch nicht als Fehler.
 */
const pathError = (path: string): string | undefined =>
  path !== '' && !path.endsWith('/') && !isProjectPath(path) ? m.invalidProjectPath : undefined;

/** Dialog »Hinzufügen« bzw. »Unterprojekt«; nur zum Öffnen gemountet, damit er leer beginnt. */
function AddDialog({
  section,
  parent,
  onOpenChange,
}: {
  section: Section;
  parent: string | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const { writes } = useWrites();
  const store = useStore();
  const users = [...useSignal(store.users.keys)].sort();
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
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        <FormSubmitShim disabled={blocked || busy} />
        <Field
          label={m.projectPath}
          hint={m.projectPathHint}
          {...(pathMessage ? { error: pathMessage } : {})}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={path}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => setPath(e.target.value)}
              // Beim vorbelegten Elternpfad tippt man hinten weiter; manche Browser setzen den
              // Cursor beim ersten Fokus an den Anfang.
              onFocus={(e) => {
                if (caretPlaced.current) return;
                caretPlaced.current = true;
                const end = e.currentTarget.value.length;
                e.currentTarget.setSelectionRange(end, end);
              }}
              disabled={busy}
              className="font-mono"
              autoFocus
            />
          )}
        </Field>
        <Field label={m.fieldTitle} hint={m.projectTitleHint}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={title}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
            />
          )}
        </Field>
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
              {users.map((handle) => (
                <option key={handle} value={handle}>
                  {handle}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={m.projectDescription}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              value={body}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => setBody(e.target.value)}
              disabled={busy}
              rows={4}
            />
          )}
        </Field>
      </form>
    </ConfirmDialog>
  );
}

/** Dialog »Verschieben«: neuer Pfad, vorbelegt mit dem alten; erst ein anderer gültiger schickt ab. */
function MoveDialog({
  section,
  path,
  onOpenChange,
  onMoved,
  onCloseAutoFocus,
}: {
  section: Section;
  path: string;
  onOpenChange: (open: boolean) => void;
  onMoved: () => void;
  onCloseAutoFocus: (event: Event) => void;
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
    void run(() => writes.run('project_mv', { from: path, to })).then((ok) => {
      if (!ok) return;
      onMoved();
      onOpenChange(false);
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
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <form id={formId} onSubmit={submit} className="space-y-3">
        <FormSubmitShim disabled={blocked || busy} />
        <Field
          label={m.moveTo}
          hint={m.moveToHint}
          {...(pathMessage ? { error: pathMessage } : {})}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              value={to}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(e) => setTo(e.target.value)}
              disabled={busy}
              className="font-mono"
              autoFocus
            />
          )}
        </Field>
      </form>
    </ConfirmDialog>
  );
}

function ReferencingIssue({ id }: { id: string }) {
  const { backlog } = useWrites();
  const issue = useSignal(useStore().issues.get(id));
  return <IssueRef issue={issue ?? { id, missing: true }} backlog={backlog} />;
}

type Choice = 'reassign' | 'detach' | undefined;

/**
 * Bestätigung zum Entfernen (BK §2.9). Nennen Issues das Projekt, ist eine Wahl Pflicht: umhängen
 * auf ein anderes Projekt oder lösen. Mit Unterprojekten bleibt »Entfernen« sicher gesperrt.
 */
function RemoveDialog({
  path,
  hasChildren,
  onOpenChange,
  onRemoved,
  onCloseAutoFocus,
}: {
  path: string;
  hasChildren: boolean;
  onOpenChange: (o: boolean) => void;
  onRemoved: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { writes } = useWrites();
  const store = useStore();
  // Der Snapshot ist ein Memo über alle Issues: Auch ein Patch auf `projects` eines bestehenden
  // Issues rechnet ihn neu und rendert den Dialog.
  const snapshot = useSignal(store.toSnapshot);
  const references = projectReferences(
    snapshot === undefined ? [] : [...snapshot.issues.values()].map((e) => e.data),
    path,
  );
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

  return (
    <ConfirmDialog
      open
      destructive
      title={m.removeProjectTitle(path)}
      confirmLabel={m.removeProject}
      busy={busy}
      confirmDisabled={blocked}
      error={error}
      onConfirm={() =>
        void run(() => writes.run('project_rm', args())).then((ok) => {
          if (!ok) return;
          onRemoved();
          onOpenChange(false);
        })
      }
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {hasChildren && <p className="text-sm">{m.projectHasChildren}</p>}
      {referenced && (
        <div className="space-y-3">
          <p className="text-sm">{m.projectStillReferenced}</p>
          <ul className="space-y-1">
            {references.map((id) => (
              <li key={id}>
                <ReferencingIssue id={id} />
              </li>
            ))}
          </ul>
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

function ProjectItem({
  row,
  canWrite,
  onAddChild,
  onMove,
  onRemove,
}: {
  row: ProjectRow;
  canWrite: boolean;
  onAddChild: (path: string) => void;
  onMove: (path: string) => void;
  onRemove: (path: string) => void;
}) {
  const { project, depth, open, hasChildren } = row;
  const { path } = project;
  const { backlog } = useWrites();
  const go = useLinkClick();
  const href =
    routeHref({ kind: 'backlog', backlog }) +
    listFilterSearch({ ...EMPTY_FILTER, projects: [path] });
  return (
    <li
      aria-label={path}
      className="space-y-1 rounded-md border p-3"
      style={{ marginLeft: `${depth * 1.5}rem` }}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <a
          href={href}
          onClick={go(href)}
          className="rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {project.title}
        </a>
        <code className="font-mono text-xs text-muted-foreground">{path}</code>
        {project.lead !== undefined && (
          <span className="text-sm text-muted-foreground">{m.projectLead(project.lead)}</span>
        )}
        <span className="text-sm text-muted-foreground">{m.openIssues(open)}</span>
        {canWrite && (
          <span className="ml-auto flex items-center gap-2">
            {path.split('/').length < MAX_DEPTH && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={m.addSubprojectOf(path)}
                onClick={() => onAddChild(path)}
              >
                {m.addSubproject}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={m.moveProjectOf(path)}
              onClick={() => onMove(path)}
            >
              {m.moveProject}
            </Button>
            {/* Mit Unterprojekten scheitert `project rm` sicher (BK §2.9): kein Knopf. */}
            {!hasChildren && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={m.removeProjectOf(path)}
                onClick={() => onRemove(path)}
              >
                {m.removeProject}
              </Button>
            )}
          </span>
        )}
      </div>
      {project.body !== undefined && project.body.trim() !== '' && (
        <Markdown source={project.body} backlog={backlog} className="text-sm" />
      )}
    </li>
  );
}

/**
 * Abschnitt Projekte (ui.md §2.10): Baum mit Titel, `lead` und offenen Issues; mit Schreibrecht
 * »Hinzufügen«, »Unterprojekt«, »Verschieben« und »Entfernen«.
 */
export function ProjectsSection({ id, title, folded, onToggle }: SectionFrame) {
  const store = useStore();
  const { canWrite } = useWrites();
  const rows = useSignal(projectRowsOf(store));
  const keys = useSignal(store.projects.keys);
  // `undefined`: kein Dialog; `null`: ein Projekt auf oberster Ebene; sonst das Elternprojekt.
  const [adding, setAdding] = useState<string | null>();
  const [moving, setMoving] = useState<string>();
  const [removing, setRemoving] = useState<string>();
  // Ein Projekt, das per Patch verschwand und wiederkommt, öffnet den alten Dialog nicht wieder.
  useEffect(() => {
    if (moving !== undefined && !keys.includes(moving)) setMoving(undefined);
    if (removing !== undefined && !keys.includes(removing)) setRemoving(undefined);
  }, [moving, removing, keys]);
  // Nach Verschieben oder Entfernen verschwindet der Auslöser mit der Zeile; der Fokus geht an
  // »Hinzufügen«.
  const vanished = useRef(false);
  const addId = `${sectionId(id)}-add`;
  const afterVanish = (event: Event): void => {
    if (!vanished.current) return;
    vanished.current = false;
    event.preventDefault();
    document.getElementById(addId)?.focus();
  };
  const markVanished = (): void => {
    vanished.current = true;
  };
  const removingRow = rows.find((r) => r.project.path === removing);

  const actions = canWrite ? (
    <Button id={addId} type="button" size="sm" onClick={() => setAdding(null)}>
      {m.addProject}
    </Button>
  ) : undefined;

  return (
    <SettingsSection id={id} title={title} folded={folded} onToggle={onToggle} actions={actions}>
      <div className="max-w-3xl">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.noProjects}</p>
        ) : (
          <ul aria-label={m.projectList} className="space-y-2">
            {rows.map((row) => (
              <ProjectItem
                key={row.project.path}
                row={row}
                canWrite={canWrite}
                onAddChild={setAdding}
                onMove={setMoving}
                onRemove={setRemoving}
              />
            ))}
          </ul>
        )}
      </div>
      {adding !== undefined && (
        <AddDialog
          section={id}
          parent={adding ?? undefined}
          onOpenChange={(open) => !open && setAdding(undefined)}
        />
      )}
      {/* Verschwindet das Projekt per Patch, schließt sich sein Dialog mit ihm. */}
      {moving !== undefined && keys.includes(moving) && (
        <MoveDialog
          section={id}
          path={moving}
          onOpenChange={(open) => !open && setMoving(undefined)}
          onMoved={markVanished}
          onCloseAutoFocus={afterVanish}
        />
      )}
      {removingRow !== undefined && (
        <RemoveDialog
          path={removingRow.project.path}
          hasChildren={removingRow.hasChildren}
          onOpenChange={(open) => !open && setRemoving(undefined)}
          onRemoved={markVanished}
          onCloseAutoFocus={afterVanish}
        />
      )}
    </SettingsSection>
  );
}

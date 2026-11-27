import { useEffect, useState } from 'react';
import { EMPTY_FILTER, listFilterSearch } from '../../app/list-filter.ts';
import { useLinkClick } from '../../app/router.ts';
import { routeHref } from '../../app/routes.ts';
import type { ProjectRow } from '../../app/settings-model.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { Markdown } from '../../markdown/index.tsx';
import { m } from '../../views/settings.messages.ts';
import { Button } from '../ui/button.tsx';
import { useDialogFocus } from './dialog-focus.ts';
import { AddProjectDialog, MoveProjectDialog, RemoveProjectDialog } from './project-dialogs.tsx';
import { type SectionFrame, SettingsSection, sectionId } from './SettingsSection.tsx';
import { projectRowsOf } from './settings-memos.ts';

/** Höchstens fünf Ebenen (BK §2.9): Auf der fünften gibt es kein Unterprojekt mehr. */
const MAX_DEPTH = 5;

function ProjectItem({
  row,
  canWrite,
  onAddChild,
  onMove,
  onRemove,
}: {
  row: ProjectRow;
  canWrite: boolean;
  onAddChild: (path: string, trigger: HTMLElement) => void;
  onMove: (path: string, trigger: HTMLElement) => void;
  onRemove: (path: string, trigger: HTMLElement) => void;
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
                onClick={(e) => onAddChild(path, e.currentTarget)}
              >
                {m.addSubproject}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={m.moveProjectOf(path)}
              onClick={(e) => onMove(path, e.currentTarget)}
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
                onClick={(e) => onRemove(path, e.currentTarget)}
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
  // Ein abgebrochener Dialog gibt den Fokus an seinen Auslöser zurück; verschwindet der mit der
  // Zeile (Verschieben, Entfernen), geht er an »Hinzufügen«.
  const addId = `${sectionId(id)}-add`;
  const focus = useDialogFocus(addId);
  const openAdd = (parent: string | null, trigger: HTMLElement): void => {
    focus.opened(trigger);
    setAdding(parent);
  };
  const openMove = (path: string, trigger: HTMLElement): void => {
    focus.opened(trigger);
    setMoving(path);
  };
  const openRemove = (path: string, trigger: HTMLElement): void => {
    focus.opened(trigger);
    setRemoving(path);
  };
  const removingRow = rows.find((r) => r.project.path === removing);

  const actions = canWrite ? (
    <Button id={addId} type="button" size="sm" onClick={(e) => openAdd(null, e.currentTarget)}>
      {m.addProject}
    </Button>
  ) : undefined;

  const overlays = (
    <>
      {adding !== undefined && (
        <AddProjectDialog
          section={id}
          parent={adding ?? undefined}
          focus={focus}
          onOpenChange={(open) => !open && setAdding(undefined)}
        />
      )}
      {/* Verschwindet das Projekt per Patch, schließt sich sein Dialog mit ihm. */}
      {moving !== undefined && keys.includes(moving) && (
        <MoveProjectDialog
          section={id}
          path={moving}
          focus={focus}
          onOpenChange={(open) => !open && setMoving(undefined)}
        />
      )}
      {removingRow !== undefined && (
        <RemoveProjectDialog
          path={removingRow.project.path}
          hasChildren={removingRow.hasChildren}
          focus={focus}
          onOpenChange={(open) => !open && setRemoving(undefined)}
        />
      )}
    </>
  );

  return (
    <SettingsSection
      id={id}
      title={title}
      folded={folded}
      onToggle={onToggle}
      actions={actions}
      overlays={overlays}
    >
      <div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.noProjects}</p>
        ) : (
          <ul aria-label={m.projectList} className="space-y-2">
            {rows.map((row) => (
              <ProjectItem
                key={row.project.path}
                row={row}
                canWrite={canWrite}
                onAddChild={openAdd}
                onMove={openMove}
                onRemove={openRemove}
              />
            ))}
          </ul>
        )}
      </div>
    </SettingsSection>
  );
}

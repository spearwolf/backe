import type { Attachment } from '@backe/core/schemas.ts';
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { m as app } from '../app/app.messages.ts';
import { IssueDetailModel } from '../app/issue-detail.ts';
import { ErrorAlert } from '../components/ErrorPage.tsx';
import { Attachments } from '../components/issue/Attachments.tsx';
import { DependencySection } from '../components/issue/DependencySection.tsx';
import { DescriptionEditor } from '../components/issue/edit/DescriptionEditor.tsx';
import { IssueActions } from '../components/issue/edit/IssueActions.tsx';
import { TitleEditor } from '../components/issue/edit/TitleEditor.tsx';
import { useAttachmentUpload, useUploader } from '../components/issue/edit/upload.ts';
import { IssueFields } from '../components/issue/IssueFields.tsx';
import { IssueRelations } from '../components/issue/IssueRelations.tsx';
import { Timeline } from '../components/issue/Timeline.tsx';
import { Button } from '../components/ui/button.tsx';
import { fetchAttachments, fetchIssue } from '../data/issue-api.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { useWrites, WriteContext } from '../data/write-context.tsx';
import { useOwned } from '../lib/use-owned.ts';
import { cn } from '../lib/utils.ts';
import { m } from './issue.messages.ts';

const NO_ATTACHMENTS: readonly Attachment[] = [];

/** Behält den letzten definierten Wert: Nach dem Löschen stehen die letzten Daten weiter da. */
function useLast<T>(value: T | undefined): T | undefined {
  const ref = useRef(value);
  if (value !== undefined) ref.current = value;
  return ref.current;
}

/** Pfad der Working Copy aus dem Kontext des Stores (`context.backlog.root`). */
function workingCopy(context: Record<string, unknown>): string | undefined {
  const backlog = context.backlog;
  if (typeof backlog !== 'object' || backlog === null) return undefined;
  const root = (backlog as { root?: unknown }).root;
  return typeof root === 'string' ? root : undefined;
}

type Props = { backlog: string; id: string; onClose: (id: string) => void };

const hasFiles = (e: DragEvent): boolean => e.dataTransfer.types.includes('Files');

/**
 * Der Tab Issue (ui.md §2.9): Felder, Beziehungen, Beschreibung, Zeitleiste. Mit Schreibrecht
 * (`useWrites().canWrite`) tragen Titel, Felder, Beschreibung und Kommentare ihre Editoren, und
 * Dateien, die auf den Tab fallen, werden Anhänge.
 */
export function IssueView({ backlog, id, onClose }: Props) {
  const store = useStore();
  const create = useCallback(
    (issueId: string) =>
      new IssueDetailModel(store, issueId, {
        issue: (x) => fetchIssue(backlog, x),
        attachments: (x) => fetchAttachments(backlog, x),
      }),
    [store, backlog],
  );
  const model = useOwned(id, create);
  if (model === undefined) return null;
  return <IssueBody model={model} backlog={backlog} id={id} onClose={onClose} />;
}

function IssueBody({ model, backlog, id, onClose }: Props & { model: IssueDetailModel }) {
  const store = useStore();
  const state = useSignal(model.state);
  const current = useSignal(model.relations);
  const live = useSignal(store.issues.get(id));
  const config = useSignal(store.config);
  const context = useSignal(store.context);
  const issue = useLast(live);
  const relations = useLast(current);
  const ready = useLast(state.status === 'ready' ? state : undefined);

  const attachments = issue?.attachments ?? NO_ATTACHMENTS;
  // Stabil, solange sich Anhänge nicht ändern: Sonst parst jedes Patch das ganze Markdown neu.
  const markdownIssue = useMemo(() => ({ id, attachments }), [id, attachments]);
  const deleted = state.status === 'deleted';
  const access = useWrites();
  // Ein gelöschtes Issue bleibt sichtbar, bearbeiten lässt es sich nicht mehr.
  const fieldAccess = useMemo(
    () => (deleted && access.canWrite ? { ...access, canWrite: false } : access),
    [access, deleted],
  );
  // Ein Uploader je Tab: Alle Uploads laufen nacheinander hindurch und bekommen eindeutige Namen.
  const uploads = useAttachmentUpload(useUploader(id));
  const [dropping, setDropping] = useState(false);
  const droppable = fieldAccess.canWrite;
  // Nach dem Löschen sind die Bedienelemente weg; stand der Fokus im Tab, geht er an »Tab schließen«.
  const tab = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!deleted) return;
    const active = document.activeElement;
    const lost = active === null || active === document.body;
    if (lost || (tab.current?.contains(active) ?? false)) closeButton.current?.focus();
  }, [deleted]);

  if (state.status === 'error') {
    return (
      <section className="max-w-xl p-4">
        <ErrorAlert title={m.loadFailed} message={state.error.message} hint={state.error.hint} />
      </section>
    );
  }
  const detail = ready?.detail;

  // Ohne `preventDefault` beim Darüberziehen löst der Browser kein `drop` aus.
  const dragHandlers = droppable
    ? {
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDropping(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
        },
        // Fängt ein Editor das Ablegen selbst ab (Bild in den Text), endet die Drop-Fläche trotzdem.
        onDropCapture: () => setDropping(false),
        onDrop: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          uploads.add(Array.from(e.dataTransfer.files));
        },
      }
    : {};

  return (
    <section
      ref={tab}
      className="relative space-y-4 p-4"
      aria-busy={state.status === 'loading'}
      {...dragHandlers}
    >
      {droppable && dropping && (
        <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-background/80 text-sm font-medium">
          {m.dropFiles}
        </div>
      )}
      {deleted && (
        <div role="status" className="flex items-center gap-3 rounded-md border p-3 text-sm">
          <span className="font-semibold">{app.deleted}</span>
          <span className="text-muted-foreground">{m.deletedNotice}</span>
          <Button
            ref={closeButton}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onClose(id)}
          >
            {m.closeTab}
          </Button>
        </div>
      )}
      {state.status === 'loading' && <p role="status">{app.loading}</p>}
      <WriteContext.Provider value={fieldAccess}>
        <div className={cn('space-y-4', deleted && 'opacity-60')}>
          {issue === undefined ? (
            <h1 className="text-xl font-semibold">
              <span className="font-mono">{id}</span>
            </h1>
          ) : (
            <>
              <TitleEditor issue={issue} />
              <IssueActions issue={issue} />
            </>
          )}
          {issue !== undefined && (
            <div className="grid gap-6 md:grid-cols-2">
              <IssueFields
                issue={issue}
                backlog={backlog}
                parents={relations?.parents ?? []}
                declared={config?.props}
                // `last_reason` kommt vom Server und kann nach einem Wechsel im Store schon überholt sein.
                reason={
                  detail?.last_reason?.to === issue.state ? detail.last_reason.body : undefined
                }
                markdownIssue={markdownIssue}
              />
              {relations !== undefined && (
                <IssueRelations issue={issue} relations={relations} backlog={backlog} />
              )}
            </div>
          )}
          <DescriptionEditor
            id={id}
            body={detail === undefined ? undefined : (detail.body ?? '')}
            backlog={backlog}
            issue={markdownIssue}
            uploads={uploads}
          />
          <Attachments
            attachments={ready?.attachments ?? []}
            backlog={backlog}
            id={id}
            root={workingCopy(context)}
            issue={markdownIssue}
            {...(fieldAccess.canWrite ? { uploads } : {})}
          />
          {/* Ein gelöschtes Issue hat keine Kanten mehr, die der Abschnitt live zeigen könnte. */}
          {!deleted && <DependencySection id={id} backlog={backlog} />}
          {detail !== undefined && (
            <Timeline
              id={id}
              comments={detail.comments ?? []}
              backlog={backlog}
              issue={markdownIssue}
              uploads={uploads}
            />
          )}
        </div>
      </WriteContext.Provider>
    </section>
  );
}

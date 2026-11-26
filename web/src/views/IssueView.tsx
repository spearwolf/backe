import type { Attachment } from '@backe/core/schemas.ts';
import { useCallback, useMemo, useRef } from 'react';
import { m as app } from '../app/app.messages.ts';
import { IssueDetailModel } from '../app/issue-detail.ts';
import { ErrorAlert } from '../components/ErrorPage.tsx';
import { Attachments } from '../components/issue/Attachments.tsx';
import { TitleEditor } from '../components/issue/edit/TitleEditor.tsx';
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
import { Markdown } from '../markdown/index.tsx';
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

/**
 * Der Tab Issue (ui.md §2.9): Felder, Beziehungen, Beschreibung, Zeitleiste. Mit Schreibrecht
 * (`useWrites().canWrite`) tragen Titel und Felder ihre Editoren.
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

  if (state.status === 'error') {
    return (
      <section className="max-w-xl p-4">
        <ErrorAlert title={m.loadFailed} message={state.error.message} hint={state.error.hint} />
      </section>
    );
  }
  const detail = ready?.detail;

  return (
    <section className="space-y-4 p-4" aria-busy={state.status === 'loading'}>
      {deleted && (
        <div role="status" className="flex items-center gap-3 rounded-md border p-3 text-sm">
          <span className="font-semibold">{app.deleted}</span>
          <span className="text-muted-foreground">{m.deletedNotice}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onClose(id)}>
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
            <TitleEditor issue={issue} />
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
          {detail?.body !== undefined && detail.body !== '' && (
            <section aria-labelledby="issue-description" className="space-y-2">
              <h2 id="issue-description" className="text-sm font-semibold">
                {m.description}
              </h2>
              <Markdown source={detail.body} backlog={backlog} issue={markdownIssue} />
            </section>
          )}
          <Attachments
            attachments={ready?.attachments ?? []}
            backlog={backlog}
            id={id}
            root={workingCopy(context)}
            issue={markdownIssue}
          />
          <Timeline comments={detail?.comments ?? []} backlog={backlog} issue={markdownIssue} />
        </div>
      </WriteContext.Provider>
    </section>
  );
}

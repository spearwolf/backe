import { useCallback, useRef } from 'react';
import { m as app } from '../app/app.messages.ts';
import { IssueDetailModel } from '../app/issue-detail.ts';
import { ErrorAlert } from '../components/ErrorPage.tsx';
import { IssueFields } from '../components/issue/IssueFields.tsx';
import { IssueRelations } from '../components/issue/IssueRelations.tsx';
import { Timeline } from '../components/issue/Timeline.tsx';
import { Button } from '../components/ui/button.tsx';
import { fetchAttachments, fetchIssue } from '../data/issue-api.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { useOwned } from '../lib/use-owned.ts';
import { cn } from '../lib/utils.ts';
import { Markdown } from '../markdown/index.tsx';
import { m } from './issue.messages.ts';

/** Behält den letzten definierten Wert: Nach dem Löschen stehen die letzten Daten weiter da. */
function useLast<T>(value: T | undefined): T | undefined {
  const ref = useRef(value);
  if (value !== undefined) ref.current = value;
  return ref.current;
}

type Props = { backlog: string; id: string; onClose: (id: string) => void };

/** Der Tab Issue (ui.md §2.9), nur lesend: Felder, Beziehungen, Beschreibung, Zeitleiste. */
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
  const issue = useLast(live);
  const relations = useLast(current);
  const ready = useLast(state.status === 'ready' ? state : undefined);

  if (state.status === 'error') {
    return (
      <section className="max-w-xl p-4">
        <ErrorAlert title={m.loadFailed} message={state.error.message} hint={state.error.hint} />
      </section>
    );
  }
  const deleted = state.status === 'deleted';
  const markdownIssue = { id, attachments: issue?.attachments ?? [] };
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
      <div className={cn('space-y-4', deleted && 'opacity-60')}>
        <h1 className="text-xl font-semibold">
          {issue?.title ?? <span className="font-mono">{id}</span>}
        </h1>
        {issue !== undefined && (
          <div className="grid gap-6 md:grid-cols-2">
            <IssueFields
              issue={issue}
              backlog={backlog}
              parents={relations?.parents ?? []}
              declared={config?.props}
              reason={detail?.last_reason?.body}
              markdownIssue={markdownIssue}
            />
            {relations !== undefined && <IssueRelations relations={relations} backlog={backlog} />}
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
        <Timeline comments={detail?.comments ?? []} backlog={backlog} issue={markdownIssue} />
      </div>
    </section>
  );
}

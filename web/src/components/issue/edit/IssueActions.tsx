import { isSettled } from '@backe/core/state.ts';
import type { IssueJson } from '@backe/ui/api.ts';
import { LoaderCircle } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { type StateAction, stateActions, stateCall } from '../../../app/state-actions.ts';
import { useStore } from '../../../data/store-context.tsx';
import { useSignal } from '../../../data/use-signal.ts';
import { useWrites } from '../../../data/write-context.tsx';
import { m } from '../../../views/issue.messages.ts';
import { StateIcon } from '../../StateIcon.tsx';
import { Button } from '../../ui/button.tsx';
import { Textarea } from '../../ui/textarea.tsx';
import { ErrorBox } from '../../write/ActionError.tsx';
import { ConfirmDialog } from '../../write/ConfirmDialog.tsx';
import { useAction } from '../../write/use-action.ts';
import { DeleteDialog } from './DeleteDialog.tsx';
import { overlayOf, runState } from './state-write.ts';
import { useFocusRescue, useFocusReturn } from './use-focus-return.ts';

/** Übernehmen ändert etwas nur, wo das Issue noch nicht bei mir in Arbeit ist; pausierte nicht. */
function claimable(issue: IssueJson, me: string | null): boolean {
  if (issue.state === 'backlog' || issue.state === 'todo') return true;
  return issue.state === 'in_progress' && issue.assignee !== me;
}

/**
 * Aktionen im Kopf des Tabs (ui.md §2.9.1): Übernehmen (`issue_claim`, synchron mit Fortschritt),
 * Wiedereröffnen erledigter Issues mit Ziel und Begründung, Löschen über den `DeleteDialog`.
 */
export function IssueActions({ issue }: { issue: IssueJson }) {
  const { canWrite, me, writes } = useWrites();
  const claim = useAction();
  // Während des Übernehmens ist der Knopf gesperrt (`useFocusReturn`); bringt der Patch danach
  // `in_progress` bei mir, verschwindet er (`useFocusRescue`). Beide Male landet der Fokus im Bereich.
  const { scope, capture } = useFocusReturn<HTMLDivElement>(claim.busy);
  const rescue = useFocusRescue<HTMLDivElement>();
  const reopenButton = useRef<HTMLButtonElement>(null);
  const [reopening, setReopening] = useState(false);
  const [deleting, setDeleting] = useState(false);
  if (!canWrite) return null;

  const onClaim = (): void => {
    capture();
    void claim.run(() => writes.run('issue_claim', { id: issue.id }));
  };
  // Nach dem Wiedereröffnen ist »Wiedereröffnen« schon weg (Überlagerung); dann geht der Fokus an »Löschen«.
  const afterReopen = (e: Event): void => {
    e.preventDefault();
    const target = reopenButton.current?.isConnected
      ? reopenButton.current
      : scope.current?.querySelector<HTMLElement>('[data-focus-return]');
    target?.focus();
  };

  return (
    <div ref={rescue}>
      <div ref={scope} className="space-y-1">
        <fieldset
          aria-label={m.issueActions}
          className="flex flex-wrap items-center gap-2 border-0 p-0"
        >
          {claimable(issue, me) && (
            <>
              <Button type="button" size="sm" disabled={claim.busy} onClick={onClaim}>
                {claim.busy && (
                  <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                )}
                {m.claim}
              </Button>
              <span role="status" className="text-xs text-muted-foreground">
                {claim.busy ? m.claiming : ''}
              </span>
            </>
          )}
          {isSettled(issue.state) && (
            <Button
              ref={reopenButton}
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setReopening(true)}
            >
              {m.reopen}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-focus-return
            onClick={() => setDeleting(true)}
          >
            {m.deleteIssue}
          </Button>
        </fieldset>
        {claim.error !== undefined && <ErrorBox error={claim.error} compact />}
        {reopening && (
          <ReopenDialog
            issue={issue}
            onClose={() => setReopening(false)}
            onCloseAutoFocus={afterReopen}
          />
        )}
        <DeleteDialog id={issue.id} open={deleting} onOpenChange={setDeleting} />
      </div>
    </div>
  );
}

/** Wiedereröffnen mit Ziel aus `stateActions` (wie der Server, Default `backlog`) und `reason`. */
function ReopenDialog(props: {
  issue: IssueJson;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { issue, onClose, onCloseAutoFocus } = props;
  const { writes } = useWrites();
  const store = useStore();
  const strict = useSignal(store.config)?.workflow.strict ?? false;
  const targets = stateActions(issue, strict).filter((a) => a.tool === 'issue_reopen');
  const [target, setTarget] = useState<StateAction | undefined>(targets[0]);
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const { busy, error, run } = useAction();

  const confirm = async (): Promise<void> => {
    if (target === undefined) return;
    const call = stateCall(issue.id, target, reason.trim() === '' ? {} : { reason: reason.trim() });
    if (await run(() => runState(writes, call, overlayOf(store, issue.id, target)))) onClose();
  };

  return (
    <ConfirmDialog
      open
      title={m.reopenTitle(issue.id)}
      confirmLabel={m.reopen}
      busy={busy}
      confirmDisabled={target === undefined}
      error={error}
      onConfirm={() => void confirm()}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{m.reopenTarget}</legend>
        {targets.map((a) => (
          <label key={a.to} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="reopen-target"
              value={a.to}
              checked={target?.to === a.to}
              disabled={busy}
              className="accent-primary"
              onChange={() => setTarget(a)}
            />
            <StateIcon state={a.to} />
          </label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={reasonId} className="text-sm font-medium">
          {m.reason}
        </label>
        <Textarea
          id={reasonId}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </ConfirmDialog>
  );
}

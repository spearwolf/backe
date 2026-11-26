import type { IssueJson } from '@backe/ui/api.ts';
import { Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { openChildrenOf, type StateAction, stateCall } from '../../../app/state-actions.ts';
import type { ApiError } from '../../../data/api-client.ts';
import { useStore } from '../../../data/store-context.tsx';
import { useSignal } from '../../../data/use-signal.ts';
import { useWrites } from '../../../data/write-context.tsx';
import { m } from '../../../views/issue.messages.ts';
import { Button } from '../../ui/button.tsx';
import { Textarea } from '../../ui/textarea.tsx';
import { ConfirmDialog } from '../../write/ConfirmDialog.tsx';
import { useAction } from '../../write/use-action.ts';
import { IssueRef } from '../IssueRef.tsx';
import { IssuePick } from './inputs.tsx';
import { overlayOf, runState } from './state-write.ts';

export type StateDialogProps = {
  issue: IssueJson;
  action: StateAction | undefined;
  onOpenChange: (open: boolean) => void;
  /** Eine Ablehnung, die schon vor dem Dialog kam (sofortiger Wechsel auf `done`). */
  rejected?: ApiError;
  /** Wohin der Fokus nach dem Schließen geht; `preventDefault` übernimmt ihn (Radix). */
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * Wechsel mit `reason`, bei `blocked` mit mindestens einer ID in `blocked_by`. Lehnt der Server
 * `done` wegen offener Sub-Issues ab, nennt der Dialog sie und bietet »Trotzdem abschließen« an.
 */
export function StateDialog(props: StateDialogProps) {
  if (props.action === undefined) return null;
  return (
    <OpenStateDialog
      key={`${props.action.tool}:${props.action.to}`}
      {...props}
      action={props.action}
    />
  );
}

type Blocker = { key: number; value: string };

function OpenStateDialog(props: StateDialogProps & { action: StateAction }) {
  const { issue, action, onOpenChange, rejected, onCloseAutoFocus } = props;
  const { writes } = useWrites();
  const store = useStore();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [blockers, setBlockers] = useState<Blocker[]>([{ key: 0, value: '' }]);
  // Der zuletzt gemeldete Fehler bleibt stehen, bis der nächste Lauf fertig ist oder der Nutzer
  // Begründung oder Blocker ändert. Getrennt davon die Ablehnung wegen offener Sub-Issues: Liste
  // und »Trotzdem abschließen« bleiben, auch wenn die Meldung weg ist oder ein Lauf läuft.
  const [shown, setShown] = useState(rejected);
  const [refusal, setRefusal] = useState(
    openChildrenOf(rejected) === undefined ? undefined : rejected,
  );
  const { busy, run } = useAction();

  const children = openChildrenOf(refusal);
  const edit =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setShown(undefined);
    };
  const editReason = edit(setReason);
  const editBlockers = edit(setBlockers);
  const blockedBy = blockers.map((b) => b.value.trim()).filter((b) => b !== '');
  const missing = action.needsBlockedBy && blockedBy.length === 0;

  const confirm = async (): Promise<void> => {
    const extra = {
      ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      ...(action.needsBlockedBy ? { blockedBy } : {}),
      ...(children === undefined ? {} : { force: true }),
    };
    const call = stateCall(issue.id, action, extra);
    const overlay = overlayOf(store, issue.id, action, extra.blockedBy);
    const ok = await run(() =>
      runState(writes, call, overlay).catch((cause: ApiError) => {
        setShown(cause);
        if (openChildrenOf(cause) !== undefined) setRefusal(cause);
        throw cause;
      }),
    );
    if (ok) onOpenChange(false);
  };

  const addBlocker = () =>
    editBlockers([...blockers, { key: Math.max(...blockers.map((b) => b.key)) + 1, value: '' }]);

  return (
    <ConfirmDialog
      open
      title={m.stateDialogTitle(action.to)}
      confirmLabel={children === undefined ? m.confirmState : m.forceDone}
      busy={busy}
      confirmDisabled={missing}
      error={shown}
      onConfirm={() => void confirm()}
      onOpenChange={onOpenChange}
      {...(onCloseAutoFocus === undefined ? {} : { onCloseAutoFocus })}
    >
      {action.needsBlockedBy && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">{m.blockedBy}</legend>
          {blockers.map(({ key, value }, i) => (
            <div key={key} className="flex items-center gap-1">
              <IssuePick
                label={i === 0 ? m.blockedBy : `${m.blockedBy} (${i + 1})`}
                value={value}
                exclude={[issue.id]}
                disabled={busy}
                onChange={(v) =>
                  editBlockers(blockers.map((b) => (b.key === key ? { key, value: v } : b)))
                }
              />
              {i > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={m.remove(value === '' ? `${m.blockedBy} (${i + 1})` : value)}
                  onClick={() => editBlockers(blockers.filter((b) => b.key !== key))}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={addBlocker}>
            <Plus className="size-3.5" aria-hidden="true" />
            {m.addBlocker}
          </Button>
        </fieldset>
      )}
      <div className="space-y-1">
        <label htmlFor={reasonId} className="text-sm font-medium">
          {m.reason}
        </label>
        <Textarea
          id={reasonId}
          value={reason}
          disabled={busy}
          onChange={(e) => editReason(e.target.value)}
        />
      </div>
      {children !== undefined && (
        <section aria-label={m.openChildren} className="space-y-1">
          <h3 className="text-sm font-medium">{m.openChildren}</h3>
          <ul className="space-y-1">
            {children.map((id) => (
              <li key={id}>
                <ChildRef id={id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </ConfirmDialog>
  );
}

function ChildRef({ id }: { id: string }) {
  const { backlog } = useWrites();
  const issue = useSignal(useStore().issues.get(id));
  return <IssueRef issue={issue ?? { id, missing: true }} backlog={backlog} />;
}

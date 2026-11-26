import type { IssueJson } from '@backe/ui/api.ts';
import { ChevronDown, Plus, X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { stateOverlay } from '../../../app/optimistic.ts';
import {
  openChildrenOf,
  type StateAction,
  type StateCall,
  stateActions,
  stateCall,
} from '../../../app/state-actions.ts';
import type { ApiError } from '../../../data/api-client.ts';
import type { Store } from '../../../data/store.ts';
import { useStore } from '../../../data/store-context.tsx';
import { useSignal } from '../../../data/use-signal.ts';
import { useWrites } from '../../../data/write-context.tsx';
import type { Writes } from '../../../data/writes.ts';
import { m } from '../../../views/issue.messages.ts';
import { StateIcon } from '../../StateIcon.tsx';
import { Button } from '../../ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu.tsx';
import { Textarea } from '../../ui/textarea.tsx';
import { ErrorBox } from '../../write/ActionError.tsx';
import { ConfirmDialog } from '../../write/ConfirmDialog.tsx';
import { PendingMark } from '../../write/PendingMark.tsx';
import { useAction } from '../../write/use-action.ts';
import { IssueRef } from '../IssueRef.tsx';
import { IssuePick } from './inputs.tsx';

type Overlay = ReturnType<typeof stateOverlay>;

/** Die Überlagerung ist nur Vorschau: Lehnt die Rechnung ab, entscheidet der Server allein. */
function overlayOf(store: Store, id: string, action: StateAction, blockedBy?: string[]) {
  const snapshot = store.toSnapshot();
  if (snapshot === undefined) return undefined;
  try {
    return stateOverlay(snapshot, id, action, blockedBy);
  } catch {
    return undefined;
  }
}

function runState(writes: Writes, call: StateCall, optimistic: Overlay | undefined) {
  const opts = optimistic === undefined ? {} : { optimistic };
  switch (call.name) {
    case 'issue_move':
      return writes.run(call.name, call.args, opts);
    case 'issue_resume':
      return writes.run(call.name, call.args, opts);
    case 'issue_reopen':
      return writes.run(call.name, call.args, opts);
  }
}

/** State am Feld: Menü der erlaubten Wechsel, sofort oder über den Dialog mit Begründung. */
export function StateControl({ issue }: { issue: IssueJson }) {
  const { writes } = useWrites();
  const store = useStore();
  const strict = useSignal(store.config)?.workflow.strict ?? false;
  const { busy, error, run } = useAction();
  const [dialog, setDialog] = useState<{ action: StateAction; rejected?: ApiError }>();
  const actions = stateActions(issue, strict);
  // Öffnet ein Eintrag den Dialog, gehört ihm der Fokus, nicht dem Menü-Knopf.
  const toDialog = useRef(false);
  const openDialog = (action: StateAction): void => {
    toDialog.current = true;
    setDialog({ action });
  };

  const change = (action: StateAction): void => {
    if (action.needsBlockedBy) {
      openDialog(action);
      return;
    }
    const call = stateCall(issue.id, action);
    void run(() =>
      runState(writes, call, overlayOf(store, issue.id, action)).catch((cause: ApiError) => {
        // `done` mit offenen Sub-Issues: Der Dialog nennt sie und bietet `force` an.
        if (openChildrenOf(cause) === undefined) throw cause;
        setDialog({ action, rejected: cause });
      }),
    );
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <StateIcon state={issue.state} className="text-sm" />
        <PendingMark id={issue.id} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={m.changeState}
              disabled={busy}
            >
              <ChevronDown className="size-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            onCloseAutoFocus={(e) => {
              if (toDialog.current) e.preventDefault();
              toDialog.current = false;
            }}
          >
            {actions.map((a) => (
              <DropdownMenuItem key={a.to} onSelect={() => change(a)}>
                <StateIcon state={a.to} />
                {a.needsBlockedBy && <span aria-hidden="true">…</span>}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{m.withReason}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {actions.map((a) => (
                  <DropdownMenuItem key={a.to} onSelect={() => openDialog(a)}>
                    <StateIcon state={a.to} />
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error !== undefined && <ErrorBox error={error} compact />}
      <StateDialog
        issue={issue}
        action={dialog?.action}
        {...(dialog?.rejected === undefined ? {} : { rejected: dialog.rejected })}
        onOpenChange={(open) => {
          if (!open) setDialog(undefined);
        }}
      />
    </div>
  );
}

type DialogProps = {
  issue: IssueJson;
  action: StateAction | undefined;
  onOpenChange: (open: boolean) => void;
  /** Eine Ablehnung, die schon vor dem Dialog kam (sofortiger Wechsel auf `done`). */
  rejected?: ApiError;
};

/**
 * Wechsel mit `reason`, bei `blocked` mit mindestens einer ID in `blocked_by`. Lehnt der Server
 * `done` wegen offener Sub-Issues ab, nennt der Dialog sie und bietet »Trotzdem abschließen« an.
 */
export function StateDialog(props: DialogProps) {
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

function OpenStateDialog(props: DialogProps & { action: StateAction }) {
  const { issue, action, onOpenChange, rejected } = props;
  const { writes } = useWrites();
  const store = useStore();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [blockers, setBlockers] = useState<Blocker[]>([{ key: 0, value: '' }]);
  const [ran, setRan] = useState(false);
  const { busy, error: runError, run } = useAction();

  const error = ran ? runError : rejected;
  const children = openChildrenOf(error);
  const blockedBy = blockers.map((b) => b.value.trim()).filter((b) => b !== '');
  const missing = action.needsBlockedBy && blockedBy.length === 0;

  const confirm = async (): Promise<void> => {
    setRan(true);
    const extra = {
      ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      ...(action.needsBlockedBy ? { blockedBy } : {}),
      ...(children === undefined ? {} : { force: true }),
    };
    const call = stateCall(issue.id, action, extra);
    const overlay = overlayOf(store, issue.id, action, extra.blockedBy);
    if (await run(() => runState(writes, call, overlay))) onOpenChange(false);
  };

  return (
    <ConfirmDialog
      open
      title={m.stateDialogTitle(action.to)}
      confirmLabel={children === undefined ? m.confirmState : m.forceDone}
      busy={busy}
      confirmDisabled={missing}
      error={error}
      onConfirm={() => void confirm()}
      onOpenChange={onOpenChange}
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
                  setBlockers(blockers.map((b) => (b.key === key ? { key, value: v } : b)))
                }
              />
              {i > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={m.remove(value === '' ? `${m.blockedBy} (${i + 1})` : value)}
                  onClick={() => setBlockers(blockers.filter((b) => b.key !== key))}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              setBlockers([
                ...blockers,
                { key: Math.max(...blockers.map((b) => b.key)) + 1, value: '' },
              ])
            }
          >
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
          onChange={(e) => setReason(e.target.value)}
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

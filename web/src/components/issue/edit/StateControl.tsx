import type { IssueJson } from '@backe/ui/api.ts';
import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  openChildrenOf,
  type StateAction,
  stateActions,
  stateCall,
} from '../../../app/state-actions.ts';
import type { ApiError } from '../../../data/api-client.ts';
import { useStore } from '../../../data/store-context.tsx';
import { useSignal } from '../../../data/use-signal.ts';
import { useWrites } from '../../../data/write-context.tsx';
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
import { ErrorBox } from '../../write/ActionError.tsx';
import { PendingMark } from '../../write/PendingMark.tsx';
import { useAction } from '../../write/use-action.ts';
import { StateDialog } from './StateDialog.tsx';
import { overlayOf, runState } from './state-write.ts';
import { useFocusReturn } from './use-focus-return.ts';

// Das Kontextmenü im Backlog öffnet denselben Dialog.
export { StateDialog, type StateDialogProps } from './StateDialog.tsx';

/** State am Feld: Menü der erlaubten Wechsel, sofort oder über den Dialog mit Begründung. */
export function StateControl({ issue }: { issue: IssueJson }) {
  const { writes } = useWrites();
  const store = useStore();
  const strict = useSignal(store.config)?.workflow.strict ?? false;
  const { busy, error, run } = useAction();
  const { scope, capture } = useFocusReturn<HTMLDivElement>(busy);
  const trigger = useRef<HTMLButtonElement>(null);
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
    capture();
    void run(() =>
      runState(writes, call, overlayOf(store, issue.id, action)).catch((cause: ApiError) => {
        // `done` mit offenen Sub-Issues: Der Dialog nennt sie und bietet `force` an.
        if (openChildrenOf(cause) === undefined) throw cause;
        setDialog({ action, rejected: cause });
      }),
    );
  };

  const item = (a: StateAction, select: (a: StateAction) => void, mark: boolean) => (
    <DropdownMenuItem key={a.to} onSelect={() => select(a)}>
      <StateIcon state={a.to} />
      {mark && a.needsBlockedBy && <span aria-hidden="true">…</span>}
    </DropdownMenuItem>
  );

  return (
    <div ref={scope} className="space-y-1">
      <div className="flex items-center gap-1">
        <StateIcon state={issue.state} className="text-sm" />
        <PendingMark id={issue.id} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={trigger}
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={m.changeState}
              disabled={busy}
              data-focus-return
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
            {actions.map((a) => item(a, change, true))}
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{m.withReason}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {actions.map((a) => item(a, openDialog, false))}
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
        // Der Eintrag, der den Dialog öffnete, ist weg: Der Fokus kehrt zum Menü-Knopf zurück.
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          trigger.current?.focus();
        }}
      />
    </div>
  );
}

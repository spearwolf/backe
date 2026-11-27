import type { IssueJson } from '@backe/ui/api.ts';
import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { updateOverlay } from '../app/optimistic.ts';
import { openChildrenOf, type StateAction, stateActions, stateCall } from '../app/state-actions.ts';
import type { ApiError } from '../data/api-client.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { useWrites } from '../data/write-context.tsx';
import { m } from '../views/backlog.messages.ts';
import { DeleteDialog } from './issue/edit/DeleteDialog.tsx';
import { assigneeChoices, NO_ASSIGNEE } from './issue/edit/inputs.tsx';
import { StateDialog } from './issue/edit/StateControl.tsx';
import { overlayOf, runState } from './issue/edit/state-write.ts';
import type { RankMove } from './rank-write.ts';
import { StateIcon } from './StateIcon.tsx';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './ui/context-menu.tsx';

type RowDialog =
  | { kind: 'state'; id: string; action: StateAction; rejected?: ApiError }
  | { kind: 'delete'; id: string };

type RowActions = {
  openDialog: (dialog: RowDialog) => void;
  /** Umsortieren, dem Scrollposition und Fokus folgen (die Liste ist virtualisiert). */
  move: (id: string, pos: RankMove) => void;
};

const Actions = createContext<RowActions>({ openDialog: () => {}, move: () => {} });

/**
 * Die Dialoge des Kontextmenüs hängen an der Liste, nicht an der Zeile: Die Liste ist
 * virtualisiert, und eine Zeile, die der Wechsel aus dem Filter nimmt, blendet aus und verschwindet,
 * während ihr Dialog noch schreibt. Nach dem Schließen geht der Fokus an die Zeile zurück.
 */
export function RowDialogs(props: {
  focusRow: (id: string) => void;
  move: RowActions['move'];
  children: ReactNode;
}) {
  const { focusRow, move, children } = props;
  const [dialog, setDialog] = useState<RowDialog>();
  const actions = useMemo(() => ({ openDialog: setDialog, move }), [move]);
  const close = (open: boolean) => {
    if (!open) setDialog(undefined);
  };
  const refocus = (id: string) => (e: Event) => {
    e.preventDefault();
    focusRow(id);
  };
  return (
    <Actions.Provider value={actions}>
      {children}
      {dialog?.kind === 'state' && (
        <StateHost dialog={dialog} onOpenChange={close} onCloseAutoFocus={refocus(dialog.id)} />
      )}
      <DeleteDialog
        id={dialog?.id ?? ''}
        open={dialog?.kind === 'delete'}
        onOpenChange={close}
        {...(dialog === undefined ? {} : { onCloseAutoFocus: refocus(dialog.id) })}
      />
    </Actions.Provider>
  );
}

function StateHost(props: {
  dialog: Extract<RowDialog, { kind: 'state' }>;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus: (e: Event) => void;
}) {
  const { dialog, onOpenChange, onCloseAutoFocus } = props;
  const issue = useSignal(useStore().issues.get(dialog.id));
  if (issue === undefined) return null;
  return (
    <StateDialog
      issue={issue}
      action={dialog.action}
      {...(dialog.rejected === undefined ? {} : { rejected: dialog.rejected })}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  );
}

/** Kontextmenü-Taste oder Umschalt+F10, ohne weitere Modifier. */
const isMenuKey = (e: KeyboardEvent): boolean =>
  !e.altKey &&
  !e.ctrlKey &&
  !e.metaKey &&
  (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey));

/**
 * Schluckt das nächste `contextmenu` im Dokument, einmal: Firefox schickt es zur Kontextmenü-Taste
 * erst nach dem Loslassen, wenn der Fokus schon im Menü liegt; sonst erschiene das Menü des Browsers
 * darüber. Nicht beim `keyup` beendet, denn das Ereignis kommt erst danach. Es endet mit dem
 * geschluckten Ereignis, einem Zeiger-Druck (ein Rechtsklick gehört wieder dem Nutzer) oder dem
 * Schließen des Menüs. Liefert die Funktion, die es vorzeitig beendet.
 */
function swallowNextContextMenu(doc: Document): () => void {
  const off = () => {
    doc.removeEventListener('contextmenu', swallow, true);
    doc.removeEventListener('pointerdown', off, true);
  };
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    off();
  };
  doc.addEventListener('contextmenu', swallow, true);
  doc.addEventListener('pointerdown', off, true);
  return off;
}

/**
 * Öffnet das Menü über die Tastatur: Ob der Browser aus der Taste ein `contextmenu` macht, ist
 * nicht verlässlich (manche nie, manche erst beim Loslassen). Darum geht ein eigenes `contextmenu`
 * an die Zeile, unten links an ihr; `preventDefault` hält das Menü des Browsers fern, und ein
 * spätes natives Ereignis derselben Taste schluckt `swallowNextContextMenu`. Liefert dessen Ende.
 */
function openByKey(e: KeyboardEvent<HTMLElement>): (() => void) | undefined {
  if (!isMenuKey(e)) return undefined;
  e.preventDefault();
  const el = e.currentTarget;
  const box = el.getBoundingClientRect();
  el.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: box.left,
      clientY: box.bottom,
    }),
  );
  return swallowNextContextMenu(el.ownerDocument);
}

/**
 * Kontextmenü einer Zeile (ui.md §2.7): Rechtsklick, Kontextmenü-Taste oder Umschalt+F10 an der
 * fokussierten Zeile (`openByKey`, unabhängig von der Sortierung). Ohne Schreibrecht gibt es keins.
 * Der Inhalt entsteht erst beim Öffnen: Nur dann liest die Zeile Config und Users.
 */
export function RowMenu({ issue, children }: { issue: IssueJson; children: ReactNode }) {
  const { canWrite } = useWrites();
  const toDialog = useRef(false);
  const guard = useRef<(() => void) | undefined>(undefined);
  const endGuard = useCallback(() => {
    guard.current?.();
    guard.current = undefined;
  }, []);
  // Verschwindet die Zeile mit offenem Menü, endet der Wächter mit ihr.
  useEffect(() => endGuard, [endGuard]);
  if (!canWrite) return children;
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) endGuard();
      }}
    >
      <ContextMenuTrigger
        asChild
        onKeyDown={(e) => {
          const off = openByKey(e);
          if (off === undefined) return;
          endGuard();
          guard.current = off;
        }}
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(e) => {
          // Öffnet ein Eintrag einen Dialog, gehört ihm der Fokus, nicht der Zeile.
          if (toDialog.current) e.preventDefault();
          toDialog.current = false;
        }}
      >
        <RowMenuItems issue={issue} toDialog={toDialog} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function RowMenuItems({ issue, toDialog }: { issue: IssueJson; toDialog: { current: boolean } }) {
  const { me, writes } = useWrites();
  const store = useStore();
  const strict = useSignal(store.config)?.workflow.strict ?? false;
  const users = useSignal(store.users.keys);
  const { openDialog, move: rerank } = useContext(Actions);
  const { id } = issue;
  const dialog = (d: RowDialog) => {
    toDialog.current = true;
    openDialog(d);
  };

  const move = (action: StateAction) => {
    if (action.needsBlockedBy) {
      dialog({ kind: 'state', id, action });
      return;
    }
    runState(writes, stateCall(id, action), overlayOf(store, id, action)).catch(
      (cause: ApiError) => {
        // `done` mit offenen Sub-Issues: Der Dialog nennt sie und bietet `force` an.
        if (openChildrenOf(cause) === undefined) writes.report(cause);
        else openDialog({ kind: 'state', id, action, rejected: cause });
      },
    );
  };

  const current = issue.assignee ?? null;
  const assign = (value: string) => {
    const assignee = value === NO_ASSIGNEE ? null : value;
    if (assignee === current) return;
    const args = { id, assignee };
    writes
      .run('issue_update', args, { optimistic: updateOverlay(issue, args) })
      .catch(writes.report);
  };

  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{m.menuState}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {stateActions(issue, strict).map((a) => (
            <ContextMenuItem key={a.to} onSelect={() => move(a)}>
              <StateIcon state={a.to} />
              {a.needsBlockedBy && <span aria-hidden="true">…</span>}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{m.menuAssignee}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuRadioGroup value={current ?? NO_ASSIGNEE} onValueChange={assign}>
            {assigneeChoices(current, me, users).map((c) => (
              <ContextMenuRadioItem key={c.value} value={c.value}>
                {c.label}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{m.menuRank}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem onSelect={() => rerank(id, { top: true })}>{m.rankTop}</ContextMenuItem>
          <ContextMenuItem onSelect={() => rerank(id, { bottom: true })}>
            {m.rankBottom}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => dialog({ kind: 'delete', id })}>
        {m.deleteIssue}
      </ContextMenuItem>
    </>
  );
}

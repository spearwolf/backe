/**
 * Kartenmenü des Boards (ui.md §2.8, §2.13): jeder Zug, den Ziehen und `Alt`-Tasten können, und die,
 * die sie nicht können — Seitenzustände, Begründung, Bahnwechsel —, ohne Maus. Geöffnet wie das
 * Kontextmenü im Tab Backlog: Rechtsklick, Kontextmenü-Taste oder Umschalt+F10 an der Karte.
 */
import { MAIN_LINE, type State } from '@backe/core/state.ts';
import type { IssueJson } from '@backe/ui/api.ts';
import { type ReactNode, useContext, useRef } from 'react';
import type { BoardGroup } from '../../app/board-model.ts';
import {
  openChildrenOf,
  type StateAction,
  stateActions,
  stateCall,
} from '../../app/state-actions.ts';
import type { ApiError } from '../../data/api-client.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { m as b } from '../../views/backlog.messages.ts';
import { m } from '../../views/board.messages.ts';
import { m as im } from '../../views/issue.messages.ts';
import { overlayOf, runState } from '../issue/edit/state-write.ts';
import { useMenuKey } from '../RowMenu.tsx';
import { StateIcon } from '../StateIcon.tsx';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../ui/context-menu.tsx';
import type { LaneChoice } from './BoardLane.tsx';
import type { CardData } from './board-dnd.ts';
import { sendBoardMove } from './board-write.ts';
import { BoardKeyContext, useBoardMoves } from './use-board-move.tsx';

type CardMenuProps = {
  issue: IssueJson;
  lane: string;
  column: State;
  /** Alle Bahnen der Gruppierung (`laneChoices`); die eigene lässt das Menü weg. */
  lanes: readonly LaneChoice[];
  group: BoardGroup;
  children: ReactNode;
};

/**
 * Das Menü um den Link der Karte; ohne Schreibrecht nur `children`. Der Inhalt entsteht erst beim
 * Öffnen: Nur dann liest die Karte Config und Rangnachbarn.
 */
export function CardMenu(props: CardMenuProps) {
  const { children, ...rest } = props;
  const { canWrite } = useWrites();
  const toDialog = useRef(false);
  const key = useMenuKey();
  if (!canWrite) return children;
  return (
    <ContextMenu onOpenChange={key.onOpenChange}>
      <ContextMenuTrigger asChild onKeyDown={key.onKeyDown}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(e) => {
          // Öffnet ein Eintrag einen Dialog, gehört ihm der Fokus, nicht der Karte.
          if (toDialog.current) e.preventDefault();
          toDialog.current = false;
        }}
      >
        <CardMenuItems {...rest} toDialog={toDialog} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function CardMenuItems(
  props: Omit<CardMenuProps, 'children'> & { toDialog: { current: boolean } },
) {
  const { issue, lane, column, lanes, group, toDialog } = props;
  const store = useStore();
  const { writes } = useWrites();
  const strict = useSignal(store.config)?.workflow.strict ?? false;
  const { move, openState } = useBoardMoves();
  const keys = useContext(BoardKeyContext);
  const { id } = issue;
  const from = { lane, column };
  const card: CardData = { type: 'card', id, lane, column };
  const actions = stateActions(issue, strict);

  const dialog = (action: StateAction) => {
    toDialog.current = true;
    openState({ id, action, lane });
  };

  const change = (action: StateAction) => {
    // Eine andere Spalte der Hauptlinie ist ein Ablegen dorthin: dieselbe Warteschlange wie beim
    // Ziehen, samt Rücksprung und `force`-Dialog. Die eigene Spalte bleibt für ein pausiertes Issue,
    // das dorthin zurückkehrt (`issue_resume`); das ist kein Ablegen.
    if (MAIN_LINE.includes(action.to) && action.to !== column) {
      move({ id, from, to: { lane, column: action.to } }, { focus: true });
      return;
    }
    if (action.needsBlockedBy) {
      dialog(action);
      return;
    }
    runState(writes, stateCall(id, action), overlayOf(store, id, action)).catch(
      (cause: ApiError) => {
        if (openChildrenOf(cause) === undefined) writes.report(cause);
        else openState({ id, action, rejected: cause, lane });
      },
    );
  };

  // Wie `Alt+↑/↓`: dieselbe Rechnung, `undefined` am Rand der Zelle. Ganz oben und ganz unten gibt
  // es nur, wo auch einer nach oben bzw. unten ginge; sonst stünde die Karte schon dort.
  const up = keys?.drop(card, 'ArrowUp');
  const down = keys?.drop(card, 'ArrowDown');
  const rank = (pos: { top: true } | { bottom: true }) =>
    sendBoardMove(store, writes, id, { kind: 'rank', pos });

  const otherLanes = lanes.filter((c) => c.key !== lane);

  return (
    <>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{b.menuState}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {actions.map((a) => (
            <ContextMenuItem key={a.to} onSelect={() => change(a)}>
              <StateIcon state={a.to} />
              {a.needsBlockedBy && <span aria-hidden="true">…</span>}
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{im.withReason}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {actions.map((a) => (
            <ContextMenuItem key={a.to} onSelect={() => dialog(a)}>
              <StateIcon state={a.to} />
            </ContextMenuItem>
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
      {group !== 'none' && otherLanes.length > 0 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>{m.menuLane}</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {otherLanes.map((c) => (
              <ContextMenuItem
                key={c.key}
                onSelect={() => move({ id, from, to: { lane: c.key, column } }, { focus: true })}
              >
                {c.label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuSub>
        <ContextMenuSubTrigger>{b.menuRank}</ContextMenuSubTrigger>
        <ContextMenuSubContent>
          <ContextMenuItem disabled={up === undefined} onSelect={() => rank({ top: true })}>
            {b.rankTop}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={up === undefined}
            onSelect={() => keys?.onKey(card, 'ArrowUp')}
          >
            {m.rankUp}
          </ContextMenuItem>
          <ContextMenuItem
            disabled={down === undefined}
            onSelect={() => keys?.onKey(card, 'ArrowDown')}
          >
            {m.rankDown}
          </ContextMenuItem>
          <ContextMenuItem disabled={down === undefined} onSelect={() => rank({ bottom: true })}>
            {b.rankBottom}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    </>
  );
}

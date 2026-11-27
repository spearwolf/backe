/**
 * Züge vom Board hinaus (ui.md §2.8): Plan gegen das Issue, wie es gerade dasteht, senden über
 * `sendBoardMove`, Ablehnungen in die Fehleranzeige oder — bei `done` mit offenen Sub-Issues — in
 * den State-Dialog, der denselben Zug mit `force` wiederholt. Ziehen, Tastatur und (später) das
 * Kartenmenü gehen alle hier durch.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from 'react';
import { type BoardGroup, columnOf, laneKeysOf } from '../../app/board-model.ts';
import { type BoardDrop, planDrop } from '../../app/board-move.ts';
import { openChildrenOf, type StateAction, type StateExtra } from '../../app/state-actions.ts';
import type { ApiError } from '../../data/api-client.ts';
import { useStore } from '../../data/store-context.tsx';
import { useSignal } from '../../data/use-signal.ts';
import { useWrites } from '../../data/write-context.tsx';
import { StateDialog } from '../issue/edit/StateDialog.tsx';
import type { CardData } from './board-dnd.ts';
import type { BoardKey } from './board-keys.ts';
import { sendBoardMove } from './board-write.ts';

/** Ein State-Dialog für eine Karte; `lane` sagt, wohin der Fokus nach dem Schließen geht. */
export type BoardStateDialog = {
  id: string;
  action: StateAction;
  rejected?: ApiError;
  submit?: (extra: StateExtra) => Promise<unknown>;
  lane?: string;
};

export type BoardMoves = {
  move(drop: BoardDrop, opts?: { focus?: boolean }): void;
  openState(dialog: BoardStateDialog): void;
};

/**
 * Züge und Dialoge für alles unterhalb der Ansicht, auch tief in den Karten (Kartenmenü). Ohne
 * Schreibrecht gibt es den Kontext trotzdem; es ruft ihn nur niemand.
 */
export const BoardMoveContext = createContext<BoardMoves>({
  move: () => {},
  openState: () => {},
});
export const useBoardMoves = (): BoardMoves => useContext(BoardMoveContext);

/**
 * Die Tastenzüge an der fokussierten Karte; `undefined` ohne Schreibrecht. Ein eigener Kontext mit
 * stabiler Funktion: Die Bahnen ändern sich mit jedem Patch, die Karten (`memo`) sollen deswegen
 * nicht alle neu rendern.
 */
export const BoardKeyContext = createContext<((card: CardData, key: BoardKey) => void) | undefined>(
  undefined,
);

/** Der Link der Karte `id`, bevorzugt in Bahn `lane`; ohne Treffer dort in irgendeiner. */
function cardLink(id: string, lane: string | undefined): HTMLElement | null {
  const cards = [...document.querySelectorAll<HTMLElement>('li[data-card]')].filter(
    (li) => li.dataset.card === id,
  );
  const li =
    cards.find((c) => c.dataset.lane === lane) ?? (lane === undefined ? cards[0] : undefined);
  return li?.querySelector<HTMLElement>('a') ?? null;
}

/**
 * Zug senden samt Fehlerweg und Dialogen. `group` ist die Gruppierung der Ansicht: Sie entscheidet,
 * welche Mitgliedschaft ein Bahnwechsel tauscht.
 */
export function useBoardMove(group: BoardGroup): BoardMoves & { dialogs: ReactNode } {
  const store = useStore();
  const { writes } = useWrites();
  const [dialog, setDialog] = useState<BoardStateDialog>();
  // Wohin der Fokus nach einem Tastenzug geht. Ein State statt einer Ref: Setzen rendert, und der
  // Layout-Effekt danach findet die Karte auch, wenn sie (nach einer Ablehnung) zurückspringt.
  const [follow, setFollow] = useState<{ id: string; lane: string }>();

  const openState = useCallback((d: BoardStateDialog) => setDialog(d), []);

  const move = useCallback(
    (drop: BoardDrop, opts: { focus?: boolean } = {}) => {
      const { id, from } = drop;
      // Wie es jetzt dasteht, samt Vorschau: Ein Patch kann das Issue während des Ziehens gelöscht
      // oder aus der Zelle genommen haben; dann ist das Ablegen veraltet, und nichts geht hinaus.
      const issue = store.issues.get(id).value;
      if (issue === undefined) return;
      if (columnOf(issue) !== from.column || !laneKeysOf(issue, group).includes(from.lane)) return;
      const strict = store.config.value?.workflow.strict ?? false;
      const plan = planDrop(issue, drop, group, strict);
      if (plan === undefined) return;
      const sent = sendBoardMove(store, writes, id, plan);
      if (sent === undefined) return;
      if (opts.focus === true) setFollow({ id, lane: drop.to.lane });
      if (plan.kind === 'rank') return;
      sent.catch((cause: ApiError) => {
        // Die Karte springt zurück; der Fokus geht mit, wenn er ihr gefolgt war.
        if (opts.focus === true) setFollow({ id, lane: from.lane });
        if (plan.state === undefined || openChildrenOf(cause) === undefined) {
          writes.report(cause);
          return;
        }
        // `done` mit offenen Sub-Issues: Der Dialog nennt sie, »Trotzdem abschließen« wiederholt
        // den ganzen Zug mit `force` — Bahn und Spalte, als ein `batch`, wenn es einer war.
        setDialog({
          id,
          action: plan.state,
          rejected: cause,
          lane: from.lane,
          submit: (extra) => sendBoardMove(store, writes, id, plan, extra) ?? Promise.resolve(),
        });
      });
    },
    [store, writes, group],
  );

  useLayoutEffect(() => {
    if (follow === undefined) return;
    const link = cardLink(follow.id, follow.lane);
    // Noch nicht (oder nicht mehr) zu sehen, etwa in einer eingeklappten Bahn: Nichts zu tun.
    if (link === null) return;
    setFollow(undefined);
    // Nur, wenn der Fokus mit der alten Karte verloren ging oder noch bei ihr ist; wer inzwischen
    // woanders arbeitet, dem nimmt ihn die Karte nicht weg.
    const active = document.activeElement;
    const held =
      active === null ||
      active === document.body ||
      active.closest<HTMLElement>('li[data-card]')?.dataset.card === follow.id;
    if (held) link.focus();
  });

  const close = (open: boolean) => {
    if (!open) setDialog(undefined);
  };
  const dialogs =
    dialog === undefined ? null : (
      <StateHost
        key={dialog.id}
        dialog={dialog}
        onOpenChange={close}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          cardLink(dialog.id, dialog.lane)?.focus();
        }}
      />
    );
  return { move, openState, dialogs };
}

/** Der Dialog liest das Issue live; ist es weg, gibt es nichts mehr zu bestätigen. */
function StateHost(props: {
  dialog: BoardStateDialog;
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
      {...(dialog.submit === undefined ? {} : { submit: dialog.submit })}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  );
}

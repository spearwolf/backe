/**
 * Züge vom Board hinaus (ui.md §2.8): Plan gegen das Issue, wie es gerade dasteht, senden über
 * `sendBoardMove`, Ablehnungen in die Fehleranzeige oder — bei `done` mit offenen Sub-Issues — in
 * den State-Dialog, der denselben Zug mit `force` wiederholt. Ziehen, Tastatur und (später) das
 * Kartenmenü gehen alle hier durch.
 */

import type { SignalReader } from '@spearwolf/signalize';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { type BoardGroup, type BoardLane, columnOf, laneKeysOf } from '../../app/board-model.ts';
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
 * Tastenzüge an der fokussierten Karte und die Id des Hinweises, der sie Hilfsmitteln beschreibt;
 * `undefined` ohne Schreibrecht. `lanes` ist das Signal der Bahnen, nicht ihr Wert: Das offene
 * Kartenmenü abonniert es (und sieht so live, ob »Eine nach oben/unten« etwas ändert), die Karten
 * nicht. Ein eigener Kontext mit stabilem Wert: Die Bahnen ändern sich mit jedem Patch, die Karten
 * (`memo`) sollen deswegen nicht alle neu rendern.
 */
export type BoardKeys = {
  onKey: (card: CardData, key: BoardKey) => void;
  lanes: SignalReader<readonly BoardLane[]>;
  hintId: string;
};
export const BoardKeyContext = createContext<BoardKeys | undefined>(undefined);

/**
 * Der Link der Karte `id` in Bahn `lane`. Mit `anyLane` ohne Treffer dort der in irgendeiner Bahn —
 * für die Rückkehr aus dem Dialog, nach dem die Karte auch woanders stehen kann. Ohne `anyLane`
 * streng: Der Fokus folgt einem Zug nur in die Zelle, in die er die Karte brachte.
 */
function cardLink(id: string, lane: string | undefined, anyLane = false): HTMLElement | null {
  const cards = [...document.querySelectorAll<HTMLElement>('li[data-card]')].filter(
    (li) => li.dataset.card === id,
  );
  const li = cards.find((c) => c.dataset.lane === lane) ?? (anyLane ? cards[0] : undefined);
  return li?.querySelector<HTMLElement>('a') ?? null;
}

/** Ob Zellen der Bahn `lane` zu sehen sind; eingeklappt (oder verschwunden) nicht. */
const laneShown = (lane: string): boolean =>
  [...document.querySelectorAll<HTMLElement>('ul[data-lane]')].some(
    (ul) => ul.dataset.lane === lane,
  );

/** Die Zelle `lane` × `column`; `null`, wenn sie nicht zu sehen ist (Bahn eingeklappt, Spalte aus). */
const cellOf = (lane: string, column: string): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>('ul[data-lane]')].find(
    (ul) => ul.dataset.lane === lane && ul.dataset.column === column,
  ) ?? null;

/**
 * Wer den Fokus bekommt, wenn die Karte `id` in eine Zelle geht, die nicht zu sehen ist: die
 * nächste Karte der alten Zelle, sonst die vorige, sonst ihr `+`.
 */
function standInFor(id: string, lane: string, column: string): HTMLElement | null {
  const cell = cellOf(lane, column);
  if (cell === null) return null;
  const cards = [...cell.querySelectorAll<HTMLElement>(':scope > li[data-card]')];
  const at = cards.findIndex((li) => li.dataset.card === id);
  const near = at < 0 ? undefined : (cards[at + 1] ?? cards[at - 1]);
  return (
    near?.querySelector<HTMLElement>('a') ??
    cell.parentElement?.querySelector<HTMLElement>('[data-quick-create]') ??
    null
  );
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
  // Geht die Karte in eine Zelle, die nicht zu sehen ist, nimmt `standIn` den Fokus (`null`: es
  // gibt keinen Platzhalter, das Folgen endet nur).
  const [follow, setFollow] = useState<{
    id: string;
    lane: string;
    standIn?: HTMLElement | null;
  }>();
  // Der Platzhalter, dem der Fokus zuletzt gegeben wurde: Springt die Karte nach einer Ablehnung
  // zurück, holt sie ihn sich von dort wieder.
  const standIn = useRef<HTMLElement | null>(null);
  // Wohin der Fokus nach dem Dialog geht: erst die Bahn aus dem Dialog, nach einem gelungenen
  // `submit` die Zielbahn des Zugs. Eine Ref, denn das Schließen folgt dem `submit` unmittelbar.
  const back = useRef<string | undefined>(undefined);

  const openState = useCallback((d: BoardStateDialog) => {
    back.current = d.lane;
    setDialog(d);
  }, []);

  const move = useCallback(
    (drop: BoardDrop, opts: { focus?: boolean } = {}) => {
      const { id, from, to } = drop;
      // Wie es jetzt dasteht, samt Vorschau: Ein Patch kann das Issue während des Ziehens gelöscht
      // oder aus der Zelle genommen haben; dann ist das Ablegen veraltet, und nichts geht hinaus.
      const issue = store.issues.get(id).value;
      if (issue === undefined) return;
      if (columnOf(issue) !== from.column || !laneKeysOf(issue, group).includes(from.lane)) return;
      const strict = store.config.value?.workflow.strict ?? false;
      const plan = planDrop(issue, drop, group, strict);
      if (plan === undefined) return;
      // Vor dem Senden: Danach steht die Karte (als Vorschau) schon nicht mehr in der alten Zelle.
      const hidden =
        opts.focus === true && cellOf(to.lane, to.column) === null
          ? standInFor(id, from.lane, from.column)
          : undefined;
      const sent = sendBoardMove(store, writes, id, plan);
      if (sent === undefined) return;
      // Jeder neue Zug ersetzt ein offenes Folgen, auch eines, dessen Karte nie erschien.
      standIn.current = null;
      if (opts.focus !== true) setFollow(undefined);
      else if (hidden === undefined) setFollow({ id, lane: to.lane });
      // In eine Zelle, die keiner sieht (etwa die ausgeblendete Spalte `backlog`): Der Fokus geht
      // an einen Nachbarn, statt mit der Karte zu verschwinden.
      else setFollow({ id, lane: to.lane, standIn: hidden });
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
        openState({
          id,
          action: plan.state,
          rejected: cause,
          lane: from.lane,
          submit: async (extra) => {
            await sendBoardMove(store, writes, id, plan, extra);
            back.current = to.lane;
          },
        });
      });
    },
    [store, writes, group, openState],
  );

  useLayoutEffect(() => {
    if (follow === undefined) return;
    const { standIn: instead } = follow;
    if (instead !== undefined) {
      setFollow(undefined);
      if (instead === null || !instead.isConnected || !holds(follow.id)) return;
      standIn.current = instead;
      instead.focus();
      return;
    }
    const link = cardLink(follow.id, follow.lane);
    if (link === null) {
      // Bahn eingeklappt oder weg: Das Folgen endet, sonst griffe die Karte beim Aufklappen viel
      // später nach dem Fokus. Steht die Bahn da, kommt die Karte noch (ein späterer Render).
      if (!laneShown(follow.lane)) setFollow(undefined);
      return;
    }
    setFollow(undefined);
    if (holds(follow.id)) link.focus();
  });

  // Nur, wenn der Fokus mit der alten Karte verloren ging, noch bei ihr ist oder bei ihrem
  // Platzhalter; wer inzwischen woanders arbeitet, dem nimmt ihn die Karte nicht weg.
  const holds = (id: string): boolean => {
    const active = document.activeElement;
    return (
      active === null ||
      active === document.body ||
      (active === standIn.current && standIn.current !== null) ||
      active.closest<HTMLElement>('li[data-card]')?.dataset.card === id
    );
  };

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
          cardLink(dialog.id, back.current, true)?.focus();
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

/**
 * Ansichtszustand und reaktives Modell des Tabs Board (ui.md §2.8, §2.5 »Ansichtszustand«):
 * `BoardPrefs` hält Gruppierung, eingeblendetes `backlog` und eingeklappte Bahnen je Backlog im
 * `localStorage`, `BoardModel` rechnet daraus und aus dem Store die Bahnen.
 */
import {
  createMemo,
  createSignal,
  type Signal,
  SignalGroup,
  type SignalReader,
} from '@spearwolf/signalize';
import type { Store } from '../data/store.ts';
import { readJson, writeJson } from '../lib/storage.ts';
import {
  BOARD_GROUPS,
  type BoardCard,
  type BoardGroup,
  type BoardLane,
  type BoardView,
  boardLanes,
  DEFAULT_BOARD_VIEW,
  newCard,
} from './board-model.ts';

type Folded = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isBoardView = (v: unknown): v is BoardView =>
  isRecord(v) && BOARD_GROUPS.includes(v.group as BoardGroup) && typeof v.showBacklog === 'boolean';

const isFoldedMap = (v: unknown): v is Folded =>
  isRecord(v) &&
  Object.values(v).every((lanes) =>
    isRecord(lanes) ? Object.values(lanes).every((f) => typeof f === 'boolean') : false,
  );

export class BoardPrefs {
  readonly view: Signal<BoardView>;
  /** Ausdrücklich gesetzte Klappzustände je Gruppierung; Key `backe-ui:<backlog>:board-lanes`. */
  readonly folded: Signal<Folded>;
  readonly #viewKey: string;
  readonly #foldedKey: string;

  /** `defaultGroup` aus Settings gilt nur, solange das Board dieses Backlogs keine eigene Wahl hat. */
  constructor(backlog: string, defaultGroup: BoardGroup = DEFAULT_BOARD_VIEW.group) {
    this.#viewKey = `backe-ui:${backlog}:board-view`;
    this.#foldedKey = `backe-ui:${backlog}:board-lanes`;
    const fallback: BoardView = { ...DEFAULT_BOARD_VIEW, group: defaultGroup };
    this.view = createSignal<BoardView>(readJson(this.#viewKey, fallback, isBoardView), {
      attach: this,
    });
    this.folded = createSignal<Folded>(readJson<Folded>(this.#foldedKey, {}, isFoldedMap), {
      attach: this,
    });
  }

  setView(next: BoardView): void {
    this.view.set(next);
    writeJson(this.#viewKey, next);
  }

  /**
   * Eingeklappt? Ohne gesetzten Wert gilt `lane.closed`. Nur eigene Einträge zählen: Ein Slug wie
   * `constructor` fände sonst den Prototyp des Objekts.
   */
  isFolded(group: BoardGroup, lane: BoardLane): boolean {
    const lanes = this.folded.get()[group];
    if (lanes === undefined || !Object.hasOwn(lanes, lane.key)) return lane.closed;
    return lanes[lane.key] === true;
  }

  setFolded(group: BoardGroup, key: string, folded: boolean): void {
    const all = this.folded.value;
    const next: Folded = { ...all, [group]: { ...all[group], [key]: folded } };
    this.folded.set(next);
    writeJson(this.#foldedKey, next);
  }

  dispose(): void {
    SignalGroup.delete(this);
  }
}

const sameProgress = (a: BoardCard['progress'], b: BoardCard['progress']) =>
  a?.settled === b?.settled && a?.total === b?.total;

const sameItems = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Die neuen Bahnen, wo nichts anders ist, als die alten Objekte: Eine Zelle mit denselben Karten
 * bleibt dieselbe, eine Bahn mit denselben Zellen und Werten ebenso, und ändert sich gar nichts,
 * bleibt die Liste. So rendern Bahnen und Zellen (`memo`) nur, wo ein Patch etwas ändert.
 */
function shareLanes(prev: readonly BoardLane[], next: BoardLane[]): readonly BoardLane[] {
  const old = new Map(prev.map((lane) => [lane.key, lane]));
  const shared = next.map((lane) => {
    const was = old.get(lane.key);
    if (was === undefined) return lane;
    const cells = lane.cells.map((cell) => {
      const same = was.cells.find((c) => c.column === cell.column);
      return same !== undefined && sameItems(same.cards, cell.cards) ? same : cell;
    });
    return was.label === lane.label &&
      was.closed === lane.closed &&
      was.count === lane.count &&
      sameItems(was.cells, cells)
      ? was
      : { ...lane, cells };
  });
  return sameItems(prev, shared) ? prev : shared;
}

export class BoardModel {
  readonly lanes: SignalReader<readonly BoardLane[]>;
  #cardCache = new Map<string, BoardCard>();
  #lanes: readonly BoardLane[] = [];

  constructor(store: Store, view: SignalReader<BoardView>) {
    this.lanes = createMemo(
      (): readonly BoardLane[] => {
        const snapshot = store.toSnapshot();
        const sprints = store.sprints.list();
        const projects = store.projects.list();
        const repos = store.repos.list();
        const v = view();
        if (snapshot === undefined) {
          this.#lanes = [];
          return this.#lanes;
        }
        const cache = new Map<string, BoardCard>();
        const lanes = boardLanes({
          snapshot,
          sprints,
          projects,
          repos,
          view: v,
          card: (issue, openDeps, progress) => {
            const old = this.#cardCache.get(issue.id);
            const card =
              old !== undefined &&
              old.issue === issue &&
              old.openDeps === openDeps &&
              sameProgress(old.progress, progress)
                ? old
                : newCard(issue, openDeps, progress);
            cache.set(issue.id, card);
            return card;
          },
        });
        // Unveränderte Karten bleiben dieselben Objekte, auch über einen Wechsel der Ansicht:
        // Eine Karte als `memo` rendert nur neu, was der Patch wirklich berührt (ui.md §3.6).
        this.#cardCache = cache;
        this.#lanes = shareLanes(this.#lanes, lanes);
        return this.#lanes;
      },
      { attach: this },
    );
  }

  dispose(): void {
    SignalGroup.delete(this);
  }
}

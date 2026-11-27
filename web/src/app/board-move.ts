/**
 * Züge auf dem Board (ui.md §2.8), rein: Aus einem Ablegen wird ein Plan, aus dem Plan ein Aufruf
 * und die Vorschau dazu. In derselben Zelle ändert sich nur der Rang; eine andere Spalte wechselt
 * den Zustand, eine andere Bahn tauscht die Mitgliedschaft. Beides zugleich geht als ein `batch`
 * und damit als ein Commit (BK §2.16.6), sonst stünde nach einer Ablehnung der halbe Zug da.
 */
import { isSettled, type State } from '@backe/core/state.ts';
import { editList } from '@backe/ops/edit-list.ts';
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';
import type { IssueJson, ToolArgs } from '@backe/ui/api.ts';
import type { ToolCall } from '../data/writes.ts';
import { type BoardGroup, NO_LANE, repoNameOf } from './board-model.ts';
import { preview, stateOverlay } from './optimistic.ts';
import type { RankMove } from './rank-plan.ts';
import { type StateAction, type StateExtra, stateActions, stateCall } from './state-actions.ts';

export type CellRef = { lane: string; column: State };
export type Anchor = { before: string } | { after: string };
/** Ein Ablegen: Karte `id` aus Zelle `from` nach `to`; `anchor` nur in derselben Zelle. */
export type BoardDrop = { id: string; from: CellRef; to: CellRef; anchor?: Anchor };
export type LaneChange = {
  field: 'sprints' | 'projects' | 'repos';
  remove: string[];
  add: string[];
};
export type BoardPlan =
  | { kind: 'rank'; pos: RankMove }
  | { kind: 'change'; state?: StateAction; lane?: LaneChange };
type BoardChange = Extract<BoardPlan, { kind: 'change' }>;

const LANE_FIELD: Record<BoardGroup, LaneChange['field'] | undefined> = {
  sprint: 'sprints',
  project: 'projects',
  repo: 'repos',
  none: undefined,
};

/**
 * Ziel in derselben Zelle: vor/hinter eine Karte; auf die Zelle selbst → hinter die letzte.
 * `undefined`, wenn sich nichts änderte — die Karte selbst als Ziel, oder ein Platz, an dem sie
 * schon steht. Sonst ginge ein Write hinaus, der nur einen Commit ohne Wirkung brächte.
 */
export function anchorIn(
  cards: readonly string[],
  id: string,
  target: { card: string; side: 'before' | 'after' } | 'end',
): Anchor | undefined {
  const rest = cards.filter((c) => c !== id);
  let anchor: Anchor;
  let at: number;
  if (target === 'end') {
    const last = rest.at(-1);
    if (last === undefined) return undefined;
    anchor = { after: last };
    at = rest.length;
  } else {
    if (target.card === id) return undefined;
    const i = rest.indexOf(target.card);
    if (i < 0) return undefined;
    anchor = target.side === 'before' ? { before: target.card } : { after: target.card };
    at = target.side === 'before' ? i : i + 1;
  }
  // Steht die Karte ohne sich selbst gezählt schon an dieser Stelle, ändert der Zug nichts.
  return cards.indexOf(id) === at ? undefined : anchor;
}

/**
 * Mitgliedschaft tauschen: weg aus der Bahn `from`, hinein in `to`. Ein Repo steht als Ref in der
 * Liste (`api@main`); entfernt wird genau dieser Eintrag, und ein Repo, das schon (per Ref) drin
 * ist, kommt nicht ein zweites Mal hinzu. Die Bahn »ohne …« ist keine Mitgliedschaft.
 */
export function laneChange(
  issue: IssueJson,
  group: BoardGroup,
  from: string,
  to: string,
): LaneChange | undefined {
  const field = LANE_FIELD[group];
  if (field === undefined || from === to) return undefined;
  const entries = issue[field] ?? [];
  const keyOf = field === 'repos' ? repoNameOf : (entry: string) => entry;
  const remove = from === NO_LANE ? [] : entries.filter((e) => keyOf(e) === from);
  const member = entries.some((e) => keyOf(e) === to);
  const add = to === NO_LANE || member ? [] : [to];
  return remove.length === 0 && add.length === 0 ? undefined : { field, remove, add };
}

/**
 * Wechsel in die Spalte: das Angebot von `stateActions`, sonst `issue_reopen` (erledigt) bzw.
 * `issue_move` — der Server entscheidet. Das Board bietet also auch an, was der Client für
 * verboten hält; die Ablehnung samt `hint` sagt dann mehr als eine Karte, die nicht losfliegt.
 */
export function stateTarget(issue: IssueJson, column: State, strict: boolean): StateAction {
  const offered = stateActions(issue, strict).find((a) => a.to === column);
  if (offered !== undefined) return offered;
  return {
    to: column,
    tool: isSettled(issue.state) ? 'issue_reopen' : 'issue_move',
    needsBlockedBy: false,
  };
}

export function planDrop(
  issue: IssueJson,
  drop: BoardDrop,
  group: BoardGroup,
  strict: boolean,
): BoardPlan | undefined {
  const { from, to } = drop;
  if (from.lane === to.lane && from.column === to.column) {
    return drop.anchor === undefined ? undefined : { kind: 'rank', pos: drop.anchor };
  }
  const state = from.column === to.column ? undefined : stateTarget(issue, to.column, strict);
  const lane = from.lane === to.lane ? undefined : laneChange(issue, group, from.lane, to.lane);
  if (state === undefined && lane === undefined) return undefined;
  return {
    kind: 'change',
    ...(state === undefined ? {} : { state }),
    ...(lane === undefined ? {} : { lane }),
  };
}

const nonEmpty = (list: string[]) => (list.length > 0 ? list : undefined);

function editOp(id: string, lane: LaneChange): Record<string, unknown> {
  const add = nonEmpty(lane.add);
  const remove = nonEmpty(lane.remove);
  return {
    op: 'issue.edit',
    id,
    ...(add === undefined ? {} : { add: { [lane.field]: add } }),
    ...(remove === undefined ? {} : { remove: { [lane.field]: remove } }),
  };
}

/** Die Operation zum State-Tool; `from` ist der Zustand beim Server, sonst lehnt der Batch ab. */
function transitionOp(
  server: IssueJson,
  state: StateAction,
  extra: StateExtra,
): Record<string, unknown> {
  const base = { id: server.id, from: server.state };
  const reason = extra.reason === undefined ? {} : { reason: extra.reason };
  switch (state.tool) {
    case 'issue_resume':
      return { op: 'issue.resume', ...base, ...reason };
    case 'issue_reopen':
      return { op: 'issue.reopen', ...base, to: state.to, ...reason };
    case 'issue_move':
      return {
        op: 'issue.move',
        ...base,
        to: state.to,
        ...reason,
        ...(extra.blockedBy === undefined ? {} : { blocked_by: extra.blockedBy }),
        // Das Schema kennt nur `z.literal(true)`: Ein `false` fehlt lieber ganz.
        ...(extra.force === true ? { force: true } : {}),
      };
  }
}

/** Aufruf gegen den Serverstand `server` (Issue ohne Überlagerung). */
export function boardCall(
  server: IssueJson,
  change: BoardChange,
  extra: StateExtra = {},
): ToolCall {
  const { state, lane } = change;
  if (lane === undefined) {
    // Ein Plan ohne beides entsteht in `planDrop` nicht: ein Fehler im Client, kein leerer Write.
    if (state === undefined) throw new Error('board change without state or lane');
    return stateCall(server.id, state, extra);
  }
  if (state === undefined && lane.field !== 'repos') {
    const add = nonEmpty(lane.add);
    const remove = nonEmpty(lane.remove);
    const args: ToolArgs['issue_update'] = { id: server.id };
    if (lane.field === 'sprints') {
      if (add !== undefined) args.add_sprints = add;
      if (remove !== undefined) args.rm_sprints = remove;
    } else {
      if (add !== undefined) args.add_projects = add;
      if (remove !== undefined) args.rm_projects = remove;
    }
    return { name: 'issue_update', args };
  }
  // `issue_update` kennt keine Repos, und Bahn samt Spalte ist ein Commit: beides als `batch`.
  const ops = [editOp(server.id, lane)];
  if (state !== undefined) ops.push(transitionOp(server, state, extra));
  return { name: 'batch', args: { ops } };
}

/**
 * Was der Server nach dem Zug in das Issue schriebe: Zustand über `stateOverlay`, die Liste über
 * `editList` wie `issue.edit` (Repos mit dem wörtlichen Eintrag aus `remove`). Lehnt BK eine der
 * Rechnungen ab, gibt es keine Vorschau — der Batch scheitert dann als Ganzes beim Server.
 */
export function boardOverlay(
  s: BacklogSnapshot,
  id: string,
  change: BoardChange,
  extra: StateExtra = {},
): Map<string, Partial<IssueJson>> | undefined {
  const issue = s.issues.get(id)?.data;
  if (issue === undefined) return undefined;
  const out = preview(() => {
    const merged = new Map<string, Partial<IssueJson>>();
    const merge = (key: string, fields: Partial<IssueJson>) =>
      merged.set(key, { ...merged.get(key), ...fields });
    if (change.state !== undefined) {
      for (const [key, fields] of stateOverlay(s, id, change.state, extra.blockedBy)) {
        merge(key, fields);
      }
    }
    if (change.lane !== undefined) {
      const { field, add, remove } = change.lane;
      merge(id, { [field]: editList(issue[field], add, remove) });
    }
    return merged;
  });
  return out === undefined || out.size === 0 ? undefined : out;
}

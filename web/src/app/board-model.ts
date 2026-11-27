/**
 * Das Modell des Tabs Board (ui.md §2.8), rein: Aus Snapshot, bekannten Sprints, Projekten und
 * Repos und der Ansicht rechnet es Bahnen, Spalten und Karten. Die Reihenfolge in einer Zelle ist
 * `compareIssues` wie überall im Backlog; Abgeleitetes (offene Abhängigkeiten, Fortschritt der
 * Sub-Issues) kommt aus denselben Helfern wie im Tab Backlog.
 */
import { compareCodeUnits } from '@backe/core/compare.ts';
import { MAIN_LINE, type State } from '@backe/core/state.ts';
import { childProgress } from '@backe/ops/graph.ts';
import { hasOpenDeps } from '@backe/ops/issue-query.ts';
import { compareIssues } from '@backe/ops/order.ts';
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';
import type { IssueJson, ProjectJson, RepoJson, SprintJson } from '@backe/ui/api.ts';
import type { BoardGroup, BoardView } from './board-groups.ts';

export {
  BOARD_GROUPS,
  type BoardGroup,
  type BoardView,
  DEFAULT_BOARD_VIEW,
} from './board-groups.ts';
/** Schlüssel der Bahn »ohne …« und der einzigen Bahn bei `none`. */
export const NO_LANE = '';

export type BoardCard = {
  issue: IssueJson;
  openDeps: boolean;
  progress?: { settled: number; total: number };
};
export type BoardCell = { column: State; cards: readonly BoardCard[] };
export type BoardLane = {
  key: string;
  label: string;
  closed: boolean;
  count: number;
  cells: readonly BoardCell[];
};

export function boardColumns(view: BoardView): State[] {
  return view.showBacklog ? [...MAIN_LINE] : MAIN_LINE.filter((s) => s !== 'backlog');
}

/** Spalte der Karte: Hauptlinie direkt, `blocked`/`on_hold` über `paused_from`; sonst `undefined` (nicht auf dem Board). */
export function columnOf(issue: IssueJson): State | undefined {
  if (MAIN_LINE.includes(issue.state)) return issue.state;
  if (issue.state === 'blocked' || issue.state === 'on_hold') return issue.paused_from;
  return undefined;
}

/**
 * Name eines Repo-Eintrags (`api@main` → `api`), ohne zu werfen. Wie `parseRepoRef`, nur ohne
 * Prüfung: Ein kaputter Eintrag soll das Board nicht sprengen, er bekommt eben seine eigene Bahn.
 * Ohne Namen vor dem `@` (`@main`) ist das der ganze Eintrag — sonst fiele er still in die Bahn
 * »ohne Repo« (`NO_LANE`), und ein Bahnwechsel fände ihn nicht mehr zum Entfernen.
 */
export function repoNameOf(entry: string): string {
  const at = entry.indexOf('@');
  return at <= 0 ? entry : entry.slice(0, at);
}

/** Bahn-Schlüssel des Issues; ohne Mitgliedschaft `[NO_LANE]`, bei `none` immer `[NO_LANE]`. */
export function laneKeysOf(issue: IssueJson, group: BoardGroup): string[] {
  const entries =
    group === 'sprint'
      ? issue.sprints
      : group === 'project'
        ? issue.projects
        : group === 'repo'
          ? issue.repos?.map(repoNameOf)
          : undefined;
  // Zwei Refs desselben Repos sind eine Bahn; die Karte steht darin nur einmal.
  const keys = [...new Set(entries ?? [])];
  return keys.length === 0 ? [NO_LANE] : keys;
}

/** Karte ohne Cache; `progress` fehlt ohne Sub-Issues ganz, statt `undefined` zu tragen. */
export const newCard = (
  issue: IssueJson,
  openDeps: boolean,
  progress?: BoardCard['progress'],
): BoardCard => ({ issue, openDeps, ...(progress === undefined ? {} : { progress }) });

type LaneHead = { key: string; label: string; closed: boolean };

/**
 * Offene Sprints vor geschlossenen, je Gruppe `start` absteigend (der jüngste Sprint oben), ohne
 * `start` danach, Gleichstand nach Slug. Ein unbekannter Slug zählt als offen ohne `start`.
 */
function sprintHeads(sprints: readonly SprintJson[], named: ReadonlySet<string>): LaneHead[] {
  const known = new Map(sprints.map((s) => [s.slug, s]));
  const slugs = [...new Set([...known.keys(), ...named])];
  const rows = slugs.map((slug) => {
    const s = known.get(slug);
    return { slug, start: s?.start, closed: s?.closed === true, label: s?.title || slug };
  });
  rows.sort(
    (a, b) =>
      Number(a.closed) - Number(b.closed) ||
      (a.start === b.start
        ? 0
        : a.start === undefined
          ? 1
          : b.start === undefined
            ? -1
            : compareCodeUnits(b.start, a.start)) ||
      compareCodeUnits(a.slug, b.slug),
  );
  return rows.map((r) => ({ key: r.slug, label: r.label, closed: r.closed }));
}

/** Projekte nach Pfad, Repos nach Name; das Label ist der Schlüssel selbst. */
function plainHeads(known: readonly string[], named: ReadonlySet<string>): LaneHead[] {
  return [...new Set([...known, ...named])]
    .sort(compareCodeUnits)
    .map((key) => ({ key, label: key, closed: false }));
}

/**
 * Bahnen des Boards: alle bekannten Einträge (auch leere) plus jeder unbekannte Schlüssel, den eine
 * Karte nennt. Nur Issues, die in einer angezeigten Spalte stehen, nennen Schlüssel: Ein
 * `cancelled` Issue in Sprint `ghost` oder ein `backlog`-Issue bei ausgeblendetem `backlog` macht
 * keine leere Bahn `ghost` auf — eine Bahn ohne Store-Eintrag und ohne Karte wäre bloß Rauschen.
 */
export function boardLanes(input: {
  snapshot: BacklogSnapshot;
  sprints: readonly SprintJson[];
  projects: readonly ProjectJson[];
  repos: readonly RepoJson[];
  view: BoardView;
  /** Karten-Cache: gleiche Karte → dasselbe Objekt. Default: neue Karte. */
  card?: (issue: IssueJson, openDeps: boolean, progress?: BoardCard['progress']) => BoardCard;
}): BoardLane[] {
  const { snapshot, view } = input;
  const group = view.group;
  const columns = boardColumns(view);
  const shown = new Set(columns);
  const makeCard = input.card ?? newCard;

  // Bahn → Spalte → Karten. Eine Karte je Issue, auch wenn es in mehreren Bahnen steht.
  const buckets = new Map<string, Map<State, BoardCard[]>>();
  for (const { data: issue } of snapshot.issues.values()) {
    const column = columnOf(issue);
    if (column === undefined || !shown.has(column)) continue;
    const card = makeCard(issue, hasOpenDeps(snapshot, issue), childProgress(snapshot, issue.id));
    for (const key of laneKeysOf(issue, group)) {
      let cells = buckets.get(key);
      if (cells === undefined) {
        cells = new Map();
        buckets.set(key, cells);
      }
      const cards = cells.get(column);
      if (cards === undefined) cells.set(column, [card]);
      else cards.push(card);
    }
  }

  const named = new Set([...buckets.keys()].filter((key) => key !== NO_LANE));
  const heads: LaneHead[] =
    group === 'sprint'
      ? sprintHeads(input.sprints, named)
      : group === 'project'
        ? plainHeads(
            input.projects.map((p) => p.path),
            named,
          )
        : group === 'repo'
          ? plainHeads(
              input.repos.map((r) => r.name),
              named,
            )
          : [];
  // »ohne …« zuletzt, und nur mit Issues; bei `none` ist sie das ganze Board.
  if (group === 'none' || buckets.has(NO_LANE)) {
    heads.push({ key: NO_LANE, label: '', closed: false });
  }

  return heads.map((head) => {
    const cells = buckets.get(head.key);
    let count = 0;
    const laneCells = columns.map((column): BoardCell => {
      const cards = cells?.get(column) ?? [];
      cards.sort((a, b) => compareIssues(a.issue, b.issue));
      count += cards.length;
      return { column, cards };
    });
    return { ...head, count, cells: laneCells };
  });
}

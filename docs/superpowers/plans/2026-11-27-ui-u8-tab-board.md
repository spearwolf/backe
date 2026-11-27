# backe ui U8 — Tab Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Tab Board zeigt alle Issues in Bahnen (Sprint, Projekt, Repo oder keine) und Spalten der Hauptlinie; Karten lassen sich per Drag & Drop, Tastatur und Kartenmenü verschieben, umsortieren und zwischen Bahnen tauschen, mit optimistischer Anzeige, Rücksprung samt `hint` und `force`-Dialog bei der `done`-Sperre; `+` legt ein Issue in Spalte und Bahn an.

**Architecture:** Wie U5/U7 in drei Schichten. Unten rein: `board-model.ts` rechnet aus Store-Werten Bahnen, Spalten und Karten (Sortierung über `compareIssues`, Abgeleitetes über `hasOpenDeps`/`childProgress` aus BK), `board-move.ts` macht aus einem Ablegen einen Plan (Rang, State, Bahn) und daraus den Tool-Aufruf und die Überlagerung. Darüber `BoardModel`/`BoardPrefs` (signalize, `localStorage`) und `board-write.ts`, das jeden Zug über dieselbe serielle Warteschlange schickt wie das Umsortieren im Tab Backlog (`serial-write.ts`, aus `rank-write.ts` herausgelöst). Oben React mit `@dnd-kit/core` (nur Zeiger; die Tastatur bedienen eigene Handler und das Kartenmenü), als Lazy-Chunk geladen.

**Tech Stack:** wie U7. Neu als `devDependency`: `@dnd-kit/core@6.3.1` (`pnpm add -D @dnd-kit/core@6.3.1`, Version in die Commit-Message). Kein `@dnd-kit/sortable`: Die Reihenfolge rechnet der Store, nicht eine lokale Sortierliste.

**Spec:** `docs/proposals/ui.md` §2.8, §3.7, dazu §2.5 »Optimistische Anzeige« und »Ansichtszustand«, §2.12 (Schaltfläche im Board, Vorbelegung aus der Bahn), §2.13 (Zustände über Icon und Text, `blocked` mit kräftiger Umrandung, Tastaturalternative zu jedem Drag & Drop), §2.16 »Code-Splitting«, §2.1 »Identität« (Nur lesen). BK `docs/proposals/backe.md` §2.6, §2.16.6, §2.22. Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (U8). ui.md ist `in Umsetzung`.

## Global Constraints

Alle Global Constraints des Gesamtplans und der Pläne U1–U7. Dazu für U8:

- Spalten: `todo`, `in_progress`, `review`, `done`; `backlog` nur eingeblendet (ui.md §2.8). `blocked`/`on_hold` in der Spalte von `paused_from` mit Marke `BLOCKED` bzw. `ON HOLD`; `cancelled`, `rejected` nie auf dem Board. In der Spalte `compareIssues` (`rank`, dann `created`, dann `id`).
- Bahnen: Gruppierung `sprint` (Default), `project`, `repo`, `none`. Sprints offen zuerst nach `start` absteigend, geschlossene eingeklappt am Ende; Projekte nach Pfad, Repos nach Name; »ohne …« zuletzt; ein Issue steht in jeder seiner Bahnen.
- Writes nur über `Writes` (`run`/`runCall`) mit Überlagerung vor dem `fetch`; jeder Board-Zug geht über die serielle Warteschlange je Sitzung (`serial-write.ts`) und rechnet beim Senden gegen den Serverstand (`store.issues.server`), nie gegen die Vorschau.
- Bahn und Spalte zugleich → genau **ein** `batch` (ein Commit, BK §2.16.6). Andere Spalte → State-Tool, andere Bahn → Mitgliedschaft tauschen; ein Rang ändert sich nur innerhalb derselben Zelle (Bahn × Spalte).
- Ansichtszustand (Gruppierung, `backlog` eingeblendet, eingeklappte Bahnen) je Backlog im `localStorage` über `lib/storage.ts`, fehlertolerant.
- `can_write: false` → kein Ziehen, kein Kartenmenü, keine `Alt`-Tasten, kein `+`, kein »Neues Issue«; Lesen und Live bleiben.
- Neue Texte en + de in `web/src/views/board.messages.ts`. State-Namen, Marken `BLOCKED`/`ON HOLD`, IDs, Handles, Slugs, Pfade bleiben roh.
- Initialer Chunk ≤ 300 KB gzip (`scripts/check-ui-build.ts`): `BoardView` samt `@dnd-kit/core` lädt per `React.lazy`.

## Review Focus

1. **Karte in zwei Sprints** — Issue in `s1` und `s2`, aus Bahn `s1` in Bahn `s2` gezogen. Erwartet: nur `s1` fällt weg, ein Write, die Karte steht danach einmal in `s2`. → Task 2 `a lane it already has only drops the old one`.
2. **Schneller zweiter Zug** — dieselbe Karte zweimal gezogen, bevor der Patch des ersten da ist. Erwartet: der zweite wartet auf den ersten und trägt im `batch` das `from` des Serverstands, nicht der Vorschau; kein `precondition`-Fehler. → Task 2 `board moves and ranks share one queue`, Task 4 `a second drop waits and sends the server state`.
3. **Abgelehnter Zug** — strikter Workflow `todo` → `done`, oder `done` mit offenen Sub-Issues samt Bahnwechsel. Erwartet: die Karte springt sofort zurück, Meldung samt `hint` in der Fehleranzeige; bei `open_children` der Dialog mit den Sub-Issues und »Trotzdem abschließen«, der denselben Zug (auch den `batch`) mit `force` wiederholt. → Task 4 `a rejected drop springs back with the hint`, `done with open sub-issues offers force for the whole move`.
4. **Karte verschwindet während des Ziehens** — ein Patch löscht das Issue oder nimmt es vom Board (`cancelled`), bevor es abgelegt wird. Erwartet: nichts geht hinaus, keine Ausnahme, die Ansicht bleibt bedienbar. → Task 4 `a drop after the issue vanished sends nothing`.
5. **Mitgliedschaften ohne Eintrag** — `repos: ['api@main']`, ein Sprint-Slug, den `store.sprints` nicht kennt, ein Projekt ohne Projektdatei. Erwartet: eigene Bahn je Schlüssel (Repo nach Name), ein Bahnwechsel entfernt genau den Eintrag `api@main`. → Task 1 `unknown memberships get their own lane`, Task 2 `repo lane swap removes the exact ref entry`.

---

### Task 1: Board-Modell — Bahnen, Spalten, Karten, Ansichtszustand

**Files:**
- Create: `web/src/app/board-model.ts` (rein), `web/src/app/board-state.ts` (`BoardPrefs`, `BoardModel`)
- Test: `web/src/app/board-model.test.ts`, `web/src/app/board-state.test.ts`

**Interfaces:**
- Consumes: `compareIssues` (`@backe/ops/order.ts`), `hasOpenDeps` (`@backe/ops/issue-query.ts`), `childProgress` (`@backe/ops/graph.ts`), `MAIN_LINE`, `State` (`@backe/core/state.ts`), `Store`, `readJson`/`writeJson`.
- Produces:

```ts
// board-model.ts
export type BoardGroup = 'sprint' | 'project' | 'repo' | 'none';
export type BoardView = { group: BoardGroup; showBacklog: boolean };
export const DEFAULT_BOARD_VIEW: BoardView; // { group: 'sprint', showBacklog: false }
/** Schlüssel der Bahn »ohne …« und der einzigen Bahn bei `none`. */
export const NO_LANE = '';
export type BoardCard = { issue: IssueJson; openDeps: boolean; progress?: { settled: number; total: number } };
export type BoardCell = { column: State; cards: readonly BoardCard[] };
export type BoardLane = { key: string; label: string; closed: boolean; count: number; cells: readonly BoardCell[] };
export function boardColumns(view: BoardView): State[];
/** Spalte der Karte: Hauptlinie direkt, `blocked`/`on_hold` über `paused_from`; sonst `undefined` (nicht auf dem Board). */
export function columnOf(issue: IssueJson): State | undefined;
/** Name eines Repo-Eintrags (`api@main` → `api`), ohne zu werfen. */
export function repoNameOf(entry: string): string;
/** Bahn-Schlüssel des Issues; ohne Mitgliedschaft `[NO_LANE]`, bei `none` immer `[NO_LANE]`. */
export function laneKeysOf(issue: IssueJson, group: BoardGroup): string[];
export function boardLanes(input: {
  snapshot: BacklogSnapshot; sprints: readonly SprintJson[]; projects: readonly ProjectJson[];
  repos: readonly RepoJson[]; view: BoardView;
  /** Karten-Cache: gleiche Karte → dasselbe Objekt. Default: neue Karte. */
  card?: (issue: IssueJson, openDeps: boolean, progress?: BoardCard['progress']) => BoardCard;
}): BoardLane[];
// board-state.ts
export class BoardPrefs {
  constructor(backlog: string);
  readonly view: Signal<BoardView>;          // Key `backe-ui:<backlog>:board-view`
  /** Ausdrücklich gesetzte Klappzustände je Gruppierung; Key `backe-ui:<backlog>:board-lanes`. */
  readonly folded: Signal<Readonly<Record<string, Readonly<Record<string, boolean>>>>>;
  setView(next: BoardView): void;
  /** Eingeklappt? Ohne gesetzten Wert gilt `lane.closed`. */
  isFolded(group: BoardGroup, lane: BoardLane): boolean;
  setFolded(group: BoardGroup, key: string, folded: boolean): void;
  dispose(): void;
}
export class BoardModel {
  constructor(store: Store, view: SignalReader<BoardView>);
  readonly lanes: SignalReader<readonly BoardLane[]>;
  dispose(): void;
}
```

Regeln `boardLanes`: Bahnen aus allen bekannten Einträgen (`store.sprints`/`projects`/`repos`, auch leere — sonst ließe sich nichts in eine leere Bahn ziehen) plus jedem Schlüssel, den ein Issue nennt und der Store nicht kennt. Sprint-Label = `title`, sonst Slug; Projekt- und Repo-Label = Pfad bzw. Name. Ordnung Sprints: offene vor geschlossenen (`closed: true`), je Gruppe `start` absteigend, ohne `start` danach, Gleichstand nach Slug; unbekannte Slugs zählen als offen ohne `start`. Projekte nach Pfad, Repos nach Name (`compareCodeUnits`). `NO_LANE` (Label leer, die Ansicht setzt »ohne Sprint« usw.) zuletzt und nur, wenn ein Issue darin steht oder die Gruppierung `none` ist. `count` = Karten der Bahn über alle angezeigten Spalten. `BoardModel.lanes` ist ein Memo über `store.toSnapshot()`, `store.sprints.list()`, `store.projects.list()`, `store.repos.list()` und `view`; der Karten-Cache hält je ID die Karte, solange `issue`, `openDeps` und `progress` gleich bleiben (Muster `#rowCache` in `backlog-list.ts`).

- [ ] **Step 1: Failing tests**

```ts
// board-model.test.ts — Issues über testIssue, Snapshot über Store.load(testState(…)).toSnapshot()
test('columns are the main line, backlog only when shown', …['todo','in_progress','review','done'] / mit backlog vorn);
test('paused issues stand in their paused_from column', …blocked paused_from in_progress → Zelle in_progress);
test('cancelled and rejected are not on the board', …);
test('cards sort by rank then created', …ohne rank hinter gerankten, nach created);
test('open sprints first by start descending, closed last', …s-old(start 2026-10-01), s-new(2026-11-01), s-none, s-closed(closed) → [s-new, s-old, s-none, s-closed]; closed: true nur bei s-closed);
test('an issue in two sprints stands in both lanes', …);
test('issues without membership go to the last lane', …key NO_LANE zuletzt);
test('empty known lanes are shown, an empty no-lane is not', …);
test('projects by path, repos by name', …repos ['api@main'] → Bahn 'api');
test('unknown memberships get their own lane', …sprint 'ghost' ohne Store-Eintrag, Projekt 'x/y' ohne Datei → eigene Bahnen, Label = Schlüssel);
test('group none has one lane', …);
test('cards carry open dependencies and sub-issue progress', …);
// board-state.test.ts
test('prefs survive in localStorage and tolerate garbage', …kaputtes JSON → Default; setView schreibt);
test('closed sprints start folded, a toggle sticks per group', …);
test('a patch to one issue keeps the other cards identical', …lanes vor/nach applyPatch: unberührte Karte toBe);
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run --project web web/src/app/board-`
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS; `pnpm vitest run test/conventions.test.ts` → PASS (nur Module der reinen Hülle)
- [ ] **Step 5: Commit** — `feat: Board-Modell mit Bahnen, Spalten und Karten`

### Task 2: Züge planen — Rang, State, Bahn; gemeinsame Warteschlange

**Files:**
- Create: `web/src/app/board-move.ts` (rein), `web/src/components/serial-write.ts`, `web/src/components/board/board-write.ts`
- Modify: `web/src/components/rank-write.ts` (Warteschlange nach `serial-write.ts`), `web/src/app/state-actions.ts` (`StateExtra` exportieren)
- Test: `web/src/app/board-move.test.ts`, `web/src/components/serial-write.test.ts`

**Interfaces:**
- Consumes: Task 1 (`BoardGroup`, `BoardLane`, `NO_LANE`, `repoNameOf`, `laneKeysOf`), `stateActions`, `stateCall`, `StateAction`, `stateOverlay`, `rankOverlay`, `preview`, `rankSteps`, `editList`, `isSettled`, `Writes.runCall`, `PlannedCall`, `ToolCall`, `rank` (`rank-write.ts`).
- Produces:

```ts
// state-actions.ts
export type StateExtra = { reason?: string; blockedBy?: string[]; force?: boolean }; // Parameter von stateCall
// board-move.ts
export type CellRef = { lane: string; column: State };
export type Anchor = { before: string } | { after: string };
/** Ein Ablegen: Karte `id` aus Zelle `from` nach `to`; `anchor` nur in derselben Zelle. */
export type BoardDrop = { id: string; from: CellRef; to: CellRef; anchor?: Anchor };
export type LaneChange = { field: 'sprints' | 'projects' | 'repos'; remove: string[]; add: string[] };
export type BoardPlan =
  | { kind: 'rank'; pos: RankMove }
  | { kind: 'change'; state?: StateAction; lane?: LaneChange };
/** Ziel in derselben Zelle: vor/hinter eine Karte; auf die Zelle selbst → hinter die letzte. `undefined`, wenn sich nichts änderte. */
export function anchorIn(cards: readonly string[], id: string, target: { card: string; side: 'before' | 'after' } | 'end'): Anchor | undefined;
export function laneChange(issue: IssueJson, group: BoardGroup, from: string, to: string): LaneChange | undefined;
/** Wechsel in die Spalte: das Angebot von `stateActions`, sonst `issue_reopen` (erledigt) bzw. `issue_move` — der Server entscheidet. */
export function stateTarget(issue: IssueJson, column: State, strict: boolean): StateAction;
export function planDrop(issue: IssueJson, drop: BoardDrop, group: BoardGroup, strict: boolean): BoardPlan | undefined;
/** Aufruf gegen den Serverstand `server` (Issue ohne Überlagerung). */
export function boardCall(server: IssueJson, change: Extract<BoardPlan, { kind: 'change' }>, extra?: StateExtra): ToolCall;
export function boardOverlay(s: BacklogSnapshot, id: string, change: Extract<BoardPlan, { kind: 'change' }>, extra?: StateExtra): Map<string, Partial<IssueJson>> | undefined;
// serial-write.ts — die Warteschlange aus rank-write.ts, für Backlog und Board
export function serverSnapshot(store: Store): BacklogSnapshot | undefined;
/** Wartet auf den vorigen Zug derselben Sitzung; `plan(replan)` rechnet beim Senden, mit `replan` samt neuer Vorschau. */
export function serialWrite(writes: Writes, opts: {
  optimistic?: ReadonlyMap<string, Partial<IssueJson>>;
  plan: (replan: boolean) => PlannedCall;
}): Promise<unknown>;
// board-write.ts
/** Schickt einen Plan: `rank` über `rank()`, `change` über `serialWrite`. `undefined`, wenn das Issue weg ist. Lehnt ab mit `ApiError`. */
export function sendBoardMove(store: Store, writes: Writes, id: string, plan: BoardPlan, extra?: StateExtra): Promise<unknown> | undefined;
```

Regeln:
- `planDrop`: gleiche Zelle → `rank` mit `anchor` (ohne `anchor` → `undefined`). Andere Spalte → `state: stateTarget(…)`. Andere Bahn → `lane: laneChange(…)`. Beides leer → `undefined`.
- `laneChange`: `field` aus der Gruppierung (`none` → `undefined`). `remove` = Einträge des Issues mit Schlüssel `from` (Repos per `repoNameOf`, also auch `api@main`), `add` = `[to]`, außer `to` ist `NO_LANE` oder schon Mitglied (Repos per Name). Beides leer → `undefined`.
- `boardCall`: nur `state` → `stateCall(id, state, extra)`. Nur `lane` mit `sprints`/`projects` → `issue_update {id, add_<field>?, rm_<field>?}` (leere Listen fehlen). Nur `lane` mit `repos` → `batch {ops: [edit]}`, denn `issue_update` kennt keine Repos. Beides → `batch {ops: [edit, transition]}`. `edit` = `{op: 'issue.edit', id, add?: {[field]: add}, remove?: {[field]: remove}}`; `transition` nach `state.tool`: `{op: 'issue.move', id, from: server.state, to, reason?, force?: true}`, `{op: 'issue.resume', id, from, reason?}`, `{op: 'issue.reopen', id, from, to, reason?}` — `force` nur als `true`, sonst fehlt es (`z.literal(true)`).
- `boardOverlay`: `stateOverlay` und die Liste aus `editList(issue[field], add, remove)` (Repos: `remove` wörtlich), zusammengeführt je ID; `preview` schützt vor `BackeError`; leer → `undefined`.
- `serialWrite` ist die Warteschlange aus `rank()` unverändert (je `Writes` ein `{open, tail}` in einer `WeakMap`); `rank()` ruft sie und hängt `.catch(writes.report)` an. Alle Rank-Tests aus U7 bleiben grün.
- `sendBoardMove` mit `change`: ohne `store.issues.server(id)` → `undefined`, nichts geht hinaus. Sonst Vorschau `boardOverlay(store.toSnapshot(), …)` und beim Senden `boardCall(server, …)` mit dem dann aktuellen Serverstand; ist das Issue bis dahin verschwunden, rechnet `plan` mit dem Stand von vorher weiter, und der Server meldet `not_found` wie bei jedem Write.

- [ ] **Step 1: Failing tests**

```ts
// board-move.test.ts
test('the same cell ranks before or after the target card', …anchorIn(['a','b','c'],'a',{card:'c',side:'after'}) → {after:'c'});
test('a drop that keeps the order is no move', …anchorIn(['a','b'],'a',{card:'b',side:'before'}) → undefined; 'end' mit a zuletzt → undefined);
test('another column moves the state', …planDrop todo→in_progress → {kind:'change', state:{to:'in_progress', tool:'issue_move'}});
test('a done card reopens into another column', …tool 'issue_reopen', to 'todo');
test('a blocked card leaves its column by issue_move', …blocked paused_from in_progress → review: tool 'issue_move');
test('another lane swaps the sprint', …{field:'sprints', remove:['s1'], add:['s2']});
test('a lane it already has only drops the old one', …sprints ['s1','s2'] von s1 nach s2 → {remove:['s1'], add:[]});
test('into the no-lane only removes, out of it only adds', …);
test('repo lane swap removes the exact ref entry', …repos ['api@main'] von api nach web → {field:'repos', remove:['api@main'], add:['web']});
test('group none never changes a lane', …);
test('state only calls the state tool with reason and force', …);
test('sprint or project lane only calls issue_update', …{id, add_sprints:['s2'], rm_sprints:['s1']});
test('repo lane only goes as a batch', …{name:'batch', args:{ops:[{op:'issue.edit', id, add:{repos:['web']}, remove:{repos:['api@main']}}]}});
test('lane and column together are one batch with the server state as from', …server state 'todo', ops [edit, {op:'issue.move', id, from:'todo', to:'review'}]; mit force → force:true; resume/reopen-Varianten);
test('the overlay merges state and lane', …{state:'review', paused_from:undefined, blocked_by:undefined, sprints:['s2']});
// serial-write.test.ts (vi.useFakeTimers nicht nötig; Promise-Steuerung über offene call-Mocks)
test('board moves and ranks share one queue', …rank() offen → sendBoardMove wartet, call erst nach Settle des ersten, plan(replan=true) sieht den neuen Serverstand);
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run --project web web/src/app/board-move web/src/components/serial-write`
- [ ] **Step 3: Implement**; danach `pnpm vitest run --project web web/src/components` → alle U7-Rank-Tests grün
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** — `feat: Board-Züge als Plan, gemeinsame Warteschlange mit dem Umsortieren`

### Task 3: Tab Board lesend — Bahnen, Spalten, Karten, Ansicht als Lazy-Chunk

**Files:**
- Create: `web/src/views/board.messages.ts`, `web/src/components/board/BoardCard.tsx`, `web/src/components/board/BoardLane.tsx`, `web/src/components/board/BoardToolbar.tsx`, `web/src/components/board/initials.ts`, `web/src/test/board-view.tsx`
- Modify: `web/src/views/BoardView.tsx`, `web/src/components/App.tsx` (`React.lazy` + `Suspense`, Props `backlog`, `me`)
- Test: `web/src/components/board/initials.test.ts`, `web/src/views/BoardView.test.tsx`, `web/src/components/App.test.tsx` (Board-Tab)

**Interfaces:**
- Consumes: Task 1, `StateIcon`, `PendingMark`, `useLinkClick`, `routeHref`, `useOwned`, `useSignal`, `useWrites`, `useCreateIssue`, `EMPTY_DRAFT`.
- Produces:

```ts
export function initialsOf(handle: string, name?: string): string; // 'Wolfger Schramm' → 'WS', 'spw' → 'SP', 'claude-bot' → 'CB'
export function BoardView(props: { backlog: string; me: string | null }): JSX.Element;
// test/board-view.tsx — wie backlog-view.tsx: Router, Store, echtes Writes mit call-Mock, WriteFailures, CreateIssueProvider
export const call: Mock; export function board(issues: IssueJson[], opts?: { canWrite?: boolean; over?: Partial<StateJson>; me?: string | null }): {…};
export const laneOf: (label: string) => HTMLElement; export const cellOf: (lane: string, column: State) => HTMLElement;
export const cardIds: (lane: string, column: State) => string[];
```

Darstellung:
- Werkzeugleiste: Auswahl »Bahnen« (`<select>`: Sprint, Projekt, Repo, keine), Checkbox »Spalte backlog zeigen«, mit Schreibrecht »Neues Issue« (`useCreateIssue().open(EMPTY_DRAFT)`).
- Bahn als `<section aria-labelledby>` mit Kopf: Knopf mit `aria-expanded` und Chevron (klappt per `BoardPrefs.setFolded`), Label (`NO_LANE`: »ohne Sprint«/»ohne Projekt«/»ohne Repo«; bei `none` kein Kopf), Anzahl. Eingeklappt: keine Zellen.
- Zellen als Raster mit einer Spalte je State (`min-w`, die Fläche scrollt waagerecht); Spaltenkopf je Bahn mit `StateIcon` und Anzahl; Zelle als `<ul aria-label="<lane> · <state>">` mit `data-lane`, `data-column`.
- Karte (`memo`) als `<li data-card={id} data-lane={lane}>` mit Link auf den Issue-Tab (`draggable={false}`): Titel `line-clamp-2`, ID mono, Marke `BLOCKED`/`ON HOLD` (Text, `blocked` zusätzlich `border-2 border-foreground`), `⧗` (`Hourglass`, `aria-label` »offene Abhängigkeiten«), Fortschritt `n/m`, `PendingMark`, Assignee als Initialen (`initialsOf(handle, store.users.get(handle).name)`, `title`/`aria-label` = Handle).
- `App.tsx`: `const BoardView = lazy(() => import('../views/BoardView.tsx').then((m) => ({ default: m.BoardView })))`, `<Suspense fallback={Lädt …}>`.

- [ ] **Step 1: Failing tests**

```tsx
test.each([['Wolfger Schramm', 'spw', 'WS'], [undefined, 'spw', 'SP'], [undefined, 'claude-bot', 'CB'], ['Ada', 'ada', 'AD']])('initials of %s/%s', …);
test('lanes and columns follow the model', …Bahnen-Reihenfolge, Spalten ohne backlog, Karten je Zelle in Rang-Reihenfolge);
test('closed sprints are folded and a fold sticks', …aria-expanded false; Klick → true; neu gemountet → true);
test('grouping and the backlog column are remembered', …select 'project' → Bahnen nach Pfad; Checkbox → Spalte backlog; localStorage);
test('a card shows title, id, initials and its marks', …BLOCKED mit kräftigem Rand, ON HOLD, ⧗, 2/3, Initialen mit title);
test('a click on a card opens its issue tab', …router-Pfad /b/acme/issue/<id>);
test('a patch moves the card live', …applyPatch state review → Karte in Zelle review);
// App.test.tsx
test('the board tab loads lazily and shows the board', …findByRole region/Bahn »ohne Sprint«);
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm vitest run --project web web/src/views/BoardView web/src/components/board web/src/components/App`
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS; `pnpm build` → Budget gehalten, `BoardView` als eigener Chunk in `dist/ui/assets/`
- [ ] **Step 5: Commit** — `feat: Tab Board mit Bahnen, Spalten und Karten`

### Task 4: Drag & Drop und Tastatur mit Rücksprung und `force`

**Files:**
- Create: `web/src/components/board/board-dnd.ts` (rein: Kollision, Ziel aus dem Ereignis), `web/src/components/board/use-board-move.tsx` (Zug senden, Fehler, `force`-Dialog, Fokus folgt), `web/src/components/board/board-keys.ts`
- Modify: `web/src/views/BoardView.tsx` (`DndContext`, `DragOverlay`), `BoardCard.tsx` (`useDraggable`, `useDroppable`, `onKeyDown`), `BoardLane.tsx` (Zelle `useDroppable`, Markierungen), `web/src/components/issue/edit/StateDialog.tsx` (Prop `submit`), `package.json`/`pnpm-lock.yaml` (`@dnd-kit/core@6.3.1`)
- Test: `web/src/components/board/board-dnd.test.ts`, `web/src/components/board/board-keys.test.ts`, `web/src/views/BoardView.moves.test.tsx`, `web/src/components/issue/edit/state.test.tsx` (`submit`)

**Interfaces:**
- Consumes: Task 2 (`planDrop`, `anchorIn`, `sendBoardMove`, `BoardDrop`), Task 3, `openChildrenOf`, `StateDialog`, `writes.report`.
- Produces:

```ts
// board-dnd.ts
export type CardData = { type: 'card'; id: string; lane: string; column: State };
export type CellData = { type: 'cell'; lane: string; column: State };
/** Karten vor Zellen unter dem Zeiger; sonst `rectIntersection`. */
export const boardCollision: CollisionDetection;
/** Ober- oder Unterhälfte der Zielkarte nach der Mitte der gezogenen. */
export function sideOf(activeCenterY: number, overTop: number, overHeight: number): 'before' | 'after';
/** Das Ablegen aus `active`/`over` samt Seite; `undefined` ohne Ziel oder ohne Änderung. */
export function dropOf(active: CardData, over: CardData | CellData, side: 'before' | 'after', lanes: readonly BoardLane[]): BoardDrop | undefined;
// board-keys.ts
/** Alt+↑/↓: Rang in der Zelle; Alt+←/→: Nachbarspalte derselben Bahn. */
export function keyDrop(lanes: readonly BoardLane[], card: CardData, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', columns: readonly State[]): BoardDrop | undefined;
// use-board-move.tsx
export function useBoardMove(): { move(drop: BoardDrop, opts?: { focus?: boolean }): void; dialogs: ReactNode };
// StateDialog
submit?: (extra: StateExtra) => Promise<unknown>; // statt runState; der Dialog berechnet dann keine Überlagerung
```

Regeln:
- Sensoren: nur `PointerSensor` mit `activationConstraint: { distance: 5 }` (ein Klick öffnet weiter den Tab). `useDraggable` an der Karte mit Id `drag:<lane>:<id>` und den `listeners`, ohne `attributes` (der Link bleibt das fokussierbare Element); `useDroppable` an Karte (`card:<lane>:<id>`) und Zelle (`cell:<lane>:<column>`). Ohne Schreibrecht kein `DndContext` und keine Hooks-Listener (`disabled: true`).
- `onDragOver` hält das Ziel für die Markierung: gleiche Zelle → Linie vor/hinter der Karte (`data-drop`), andere Zelle → Zelle hervorgehoben (`data-over`). `onDragEnd`: `dropOf` → `move`. `onDragCancel` räumt auf. Die gezogene Karte ist halb durchsichtig, `DragOverlay` zeigt ihre Kopie.
- `move`: `planDrop` mit dem aktuellen Issue (`store.issues.get(id).value`; fehlt es oder steht es nicht mehr in `from` → nichts), `strict` aus der Config, dann `sendBoardMove`. Fehler: `openChildrenOf` → `StateDialog` mit `rejected` und `submit = (extra) => sendBoardMove(…, plan, extra)` (wiederholt Bahn **und** Spalte mit `force`); sonst `writes.report`. Mit `focus` folgt der Fokus der Karte in ihre neue Zelle (Layout-Effekt sucht `li[data-card="<id>"][data-lane="<lane>"] a`).
- Tastatur an der fokussierten Karte (nur Schreibrecht, Ereignis aus dem Kartenknoten selbst, nicht aus Portalen): `Alt+↑/↓/←/→` → `keyDrop` → `move(…, { focus: true })`; `aria-keyshortcuts` nennt sie.

- [ ] **Step 1: Failing tests**

```ts
// board-dnd.test.ts
test('cards win over cells under the pointer', …boardCollision mit droppableRects und pointerCoordinates);
test('side by the centre', …sideOf(10, 0, 40) → 'before'; sideOf(30, 0, 40) → 'after');
test('drop on a card of the same cell anchors, on another cell changes it', …);
test('dropping a card on itself is no move', …);
// board-keys.test.ts
test('alt up and down rank within the cell, at the edge nothing', …);
test('alt left and right move to the neighbouring column of the lane', …mit/ohne backlog-Spalte; am Rand undefined);
// BoardView.moves.test.tsx — Harness aus Task 3; Züge über die Tastatur und über move() aus dropOf
test('a drop into another column is optimistic and posts issue_move', …answerNever; Karte sofort in Zielzelle, PendingMark, call('issue_move', {id, to:'in_progress'}));
test('a drop within the cell posts issue_rank', …{id, before:…});
test('a drop into another lane swaps the sprint with issue_update', …);
test('lane and column together post one batch', …call('batch', {ops:[edit, move]}), genau ein Aufruf);
test('a rejected drop springs back with the hint', …call wirft ApiError 400 mit hint → Karte in alter Zelle, Fehleranzeige mit hint);
test('done with open sub-issues offers force for the whole move', …ApiError details {reason:'open_children', ids:[child]} beim batch → Dialog nennt child; »Trotzdem abschließen« → batch mit issue.move force:true);
test('a second drop waits and sends the server state', …answerCommitted; zwei Alt+→ schnell; zweiter call erst nach land(); Argumente gegen den Serverstand);
test('a drop after the issue vanished sends nothing', …Patch remove vor move → kein call, keine Ausnahme);
test('alt arrows move the card and focus follows it', …Fokus am Link der Karte in der neuen Zelle);
// state.test.tsx
test('a dialog with submit sends through it', …submit erhält {reason, force:true}, kein issue_move über runState);
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Install** `pnpm add -D @dnd-kit/core@6.3.1`, **implementieren**
- [ ] **Step 4: Run** `pnpm vitest run --project web` → PASS
- [ ] **Step 5: Commit** — `feat: Karten per Drag und Tastatur verschieben, Rücksprung und force im Board` (Body nennt `@dnd-kit/core 6.3.1`)

### Task 5: Kartenmenü — jeder Übergang ohne Maus

**Files:**
- Create: `web/src/components/board/CardMenu.tsx`
- Modify: `BoardCard.tsx`, `web/src/views/board.messages.ts`
- Test: `web/src/components/board/CardMenu.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`useBoardMove().move`, Dialog-Host), `openByKey` (`RowMenu.tsx`), `stateActions`, `StateDialog`, `ContextMenu*`.
- Produces: `<CardMenu issue lane column lanes group>{children}</CardMenu>` — ohne Schreibrecht nur `children`.

Regeln: Rechtsklick, Kontextmenü-Taste, Umschalt+F10 an der Karte (`openByKey`, Wächter wie `RowMenu`). Einträge: »State« (Untermenü aus `stateActions`, sofort über `move` mit `{from: cell, to: {lane, column: to}}` für Hauptlinien-Ziele; `blocked`, `on_hold`, `cancelled`, `rejected` über `runState` wie `RowMenu`, `blocked` öffnet den `StateDialog`), »Mit Begründung …« (dieselben Ziele, je Eintrag `StateDialog`), bei Gruppierung ≠ `none` »Bahn« (alle anderen Bahnen samt »ohne …« → `move` mit `to.lane`), »Rang« (»Ganz oben« `top`, »Eine nach oben«/»Eine nach unten« wie `Alt+↑/↓`, »Ganz unten« `bottom`). Der Inhalt entsteht erst beim Öffnen. Nach einem Dialog geht der Fokus an die Karte zurück.

- [ ] **Step 1: Failing tests**

```tsx
test('the card menu moves the state optimistically', …contextMenu, »review« → Karte in review, issue_move);
test('blocked asks for blocked_by', …Dialog mit Blocker-Feld, issue_move {to:'blocked', blocked_by:[…]});
test('with reason opens the dialog for any target', …issue_move {reason});
test('lane entries swap the membership', …»s2« → issue_update {add_sprints:['s2'], rm_sprints:['s1']}; Gruppierung none → kein Eintrag »Bahn«);
test('rank entries move within the cell', …»Ganz oben« → issue_rank {top:true}; »Eine nach unten« → {after:…});
test('shift+f10 opens the menu at the focused card', …);
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** — `feat: Kartenmenü im Board für State, Bahn und Rang`

### Task 6: Schnell anlegen mit `+`

**Files:**
- Create: `web/src/components/board/QuickCreate.tsx`, `web/src/app/board-draft.ts`
- Modify: `BoardLane.tsx`, `web/src/views/board.messages.ts`
- Test: `web/src/app/board-draft.test.ts`, `web/src/components/board/QuickCreate.test.tsx`

**Interfaces:**
- Consumes: `EMPTY_DRAFT`, `createArgs`, `CreateDraft`, `useCreateIssue`, `useAction`, `ActionError`, Task 1 (`BoardGroup`, `NO_LANE`).
- Produces:

```ts
/** Entwurf für Spalte und Bahn: State = Spalte, Mitgliedschaft = Bahn (»ohne …« und `none`: keine). */
export function draftForCell(group: BoardGroup, lane: string, column: State, title?: string): CreateDraft;
```

Regeln: Am Fuß jeder Zelle (nur Schreibrecht) ein Knopf `+` (`aria-label` »Neues Issue in <column> · <lane>«). Er öffnet ein Eingabefeld (`aria-label` »Titel«): Enter mit Titel → `writes.run('issue_create', createArgs(draftForCell(…, title)))`, danach leer, das Feld bleibt offen und fokussiert; leerer Titel sendet nicht; `Esc` schließt, der Fokus geht an `+`. Während des Writes gesperrt, Fehler als `ActionError` mit `hint` unter dem Feld, der Titel bleibt. Daneben »Mehr …« → `useCreateIssue().open(draftForCell(…, title))` (ui.md §2.12: Dialog vorbelegt aus der Bahn). Listen gehen immer ausdrücklich mit (`createArgs`).

- [ ] **Step 1: Failing tests**

```ts
test('a sprint cell drafts state and sprint', …draftForCell('sprint','s1','todo','T') → state todo, sprints ['s1'], projects [], repos []);
test('the no-lane and group none draft no membership', …);
test('repo and project lanes draft their membership', …);
test('plus creates an issue with the title in column and lane', …call('issue_create', {title:'T', state:'todo', projects:[], sprints:['s1'], repos:[]}); Feld leer und fokussiert);
test('an empty title sends nothing, escape closes', …);
test('a create error stays with its hint', …);
test('more opens the dialog prefilled from the lane', …Dialog mit Titel, State todo, Sprint s1);
```

- [ ] **Step 2: Run, verify FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** → PASS
- [ ] **Step 5: Commit** — `feat: Schnell anlegen per + in Spalte und Bahn des Boards`

### Task 7: Nur lesen, Sichtprüfung, Docs

**Files:**
- Modify: `web/src/components/read-only.test.tsx` (Board), `docs/proposals/ui.md` (Status-Satz, Präzisierungen §2.8), `ROADMAP.md`, `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (U8 »Produziert«), dieser Plan (Häkchen)

- [ ] **Step 1: Failing test** — `read-only hides board writes`: `can_write: false`, Board mit Karten → kein »Neues Issue«, kein `+`, `contextMenu` an einer Karte öffnet kein `menu`, `Alt+→` an einer Karte sendet nichts, kein Knoten mit `aria-roledescription="draggable"`; `fetch` sieht nie `/tools/`.
- [ ] **Step 2: Run** → Lücken schließen → PASS
- [ ] **Step 3: Run** `mise run check` und `mise run smoke` → grün; Chunk-Größen aus `pnpm build` notieren (initial und Board-Chunk)
- [ ] **Step 4: Sichtprüfung** — `backe ui --port 0` gegen ein Test-Backlog unter Temp-`BACKE_HOME` im Browser (Playwright-MCP): Board mit zwei Sprints, eine Karte per Maus in eine andere Spalte, innerhalb der Spalte und in eine andere Bahn ziehen (je ein Commit, `git log`), `done` mit offenem Sub-Issue → Dialog → »Trotzdem abschließen«, Kartenmenü per Umschalt+F10, `Alt+→`, `+` in einer Zelle, Gruppierung wechseln, parallel `backe issue move` im Terminal → Karte wandert live; Nur-lesen-Identität ohne Schreibaktion.
- [ ] **Step 5: Docs** — ui.md Status: Tab Board gebaut (§2.8); offen bleiben §2.9.5, §2.10, §2.11, §2.4.1 Punkt 3, Sprachwahl, Suche, `⌘K`. Präzisierungen in §2.8 als Gegenwart: Bahnen ohne Eintrag (leere Sprints, Projekte, Repos) stehen da, »ohne …« nur mit Issues; erledigte Karten verlassen `done` per `issue_reopen`; ein Rang ändert sich nur innerhalb derselben Zelle, Spalten- und Bahnwechsel behalten den Rang; ein Repo-Bahnwechsel geht als `batch` (`issue_update` kennt keine Repos); Tastatur `Alt+Pfeile` und Kartenmenü; Gruppierung, `backlog`-Spalte und eingeklappte Bahnen im `localStorage`; das Board lädt als eigener Chunk. ROADMAP »Tab Board« abhaken. Gesamtplan U8 »Produziert«: `boardLanes`, `BoardModel`, `planDrop`, `boardCall`, `serialWrite`, `useBoardMove`, `draftForCell`, `StateDialog.submit`.
- [ ] **Step 6: Commit** — `feat: Nur-lesen im Board, Tab Board fertig`

## Festlegungen

| Stelle | Festlegung |
| --- | --- |
| Rang nur in derselben Zelle | ui.md §2.8 nennt für »andere Spalte« nur `issue_move` und für »andere Bahn« nur den Tausch. Der Rang gilt backlogweit (BK §2.22); ein Spaltenwechsel ist kein Prioritätswechsel. Die Karte landet in der Zielzelle an der Stelle ihres Rangs; die Markierung zeigt dort die ganze Zelle, keine Einfügelinie. |
| Erledigte Karten | `done` verlässt man nur über `issue_reopen` (BK §2.6, `planTransition` lehnt `move` ab). Ein Zug aus `done` in eine andere Spalte ist darum `issue_reopen` mit `to`, im `batch` `issue.reopen`. |
| Nicht angebotene Wechsel | Der Client schickt den Zug trotzdem, wenn `stateActions` ihn nicht anbietet (strikter Workflow): ui.md §2.8 verlangt Rücksprung **mit der Meldung des Servers**. Die Vorschau rechnet `stateOverlay` mit `strict: false`, die Karte springt nach der Ablehnung zurück. |
| Repo-Bahn als `batch` | `issue_update` hat keine Repo-Parameter (Katalog `src/tools/write.ts`); `issue.edit` mit `add`/`remove.repos` im `batch` schon. Neuer Eintrag ohne Ref (`web`), entfernt wird der Eintrag wörtlich (`api@main`). |
| Leere Bahnen | Alle Sprints, Projekte und Repos des Stores sind Bahnen, auch ohne Issue, sonst ließe sich keine Karte in einen frischen Sprint ziehen. Die Bahn »ohne …« erscheint nur mit Issues. |
| Gemeinsame Warteschlange | Board-Züge tragen im `batch` ein `from` (State, Rang). Damit ein schneller zweiter Zug nicht am veralteten `from` scheitert, laufen sie seriell über dieselbe Warteschlange wie das Umsortieren im Tab Backlog (ui.md §2.7). |
| Tastatur ohne `KeyboardSensor` | `Alt+↑/↓` wie im Tab Backlog, `Alt+←/→` für die Nachbarspalte, alles andere im Kartenmenü. Der `KeyboardSensor` von `@dnd-kit` bräuchte einen eigenen Modus mit Ansagen; Menü und Kürzel decken jeden Zug ab (ui.md §2.13). |
| Kein `@dnd-kit/sortable` | Die Reihenfolge rechnet der Store aus dem Rang; eine lokale Sortierliste im Drag würde mit Patches konkurrieren. `@dnd-kit/core` mit `DragOverlay` genügt. |
| Lazy-Chunk | Das Board lädt per `React.lazy`: Es braucht `@dnd-kit/core` und viel Ansichtscode, der für Backlog und Issue-Tab nicht nötig ist; das Budget von 300 KB bleibt für U9/U10. |
| Kein Paused ohne `paused_from` | Das Schema verlangt `paused_from` für `blocked`/`on_hold`; ein Issue ohne steht nicht auf dem Board (`columnOf` → `undefined`), statt in einer geratenen Spalte. |

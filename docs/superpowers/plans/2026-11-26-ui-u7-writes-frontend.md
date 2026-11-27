# backe ui U7 — Writes im Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die UI schreibt: Felder, Beschreibung, Kommentare und Anhänge im Tab Issue bearbeiten, Issues anlegen (`c`), im Tab Backlog per Kontextmenü und Zeilen-Drag ändern — mit optimistischer Anzeige, Fehlern samt `hint` und ohne jede Schreibaktion für eine Nur-lesen-Identität.

**Architecture:** Drei Schichten wie U5/U6. Unten `callTool`/`uploadAttachment` (reiner Transport) und im Store eine Überlagerung je Write-Token, die `EntityTable` über den Serverstand legt — jede Ansicht liest weiter `store.issues.get(id)` und sieht den optimistischen Wert ohne Umbau. Darüber `Writes` je Sitzung: ruft Tools, setzt und löst Überlagerungen (Patch mit dem `commit`, Serverstand zeigt die Werte, oder nach 5 s `/state` neu), sammelt Fehler für die globale Anzeige. Optimistische Werte und erlaubte State-Wechsel rechnet der Client mit `planTransition` (`@backe/core/state.ts`) und `rankPlacement` (`@backe/ops/rank.ts`), nicht mit eigener Logik. Oben React: `WriteContext` (`canWrite`, `me`, `writes`), Dialog-Bausteine, Markdown-Editor, Feldeditoren, Anlegen-Dialog, Kontextmenü und Drag im Tab Backlog.

**Tech Stack:** wie U6. Keine neuen Pakete außer shadcn-Komponenten `context-menu` und `textarea` (`pnpm dlx shadcn@4.23.1 add context-menu textarea`; ohne Netz von Hand nach dem Muster von `web/src/components/ui/dropdown-menu.tsx` auf `radix-ui`). Drag im Tab Backlog mit nativem HTML-Drag-and-drop (die virtualisierte Liste verträgt `@dnd-kit` schlecht; `@dnd-kit` kommt mit U8 für das Board).

**Spec:** `docs/proposals/ui.md` §2.5 »Optimistische Anzeige«, §2.6 »Tastatur« (`c`, `Esc`), §2.7 »Aktionen«, §2.9.1 »Bearbeiten«, »Aktionen« und der lokale Repo-Pfad, §2.9.2 »Bearbeiten« und »Paralleles Ändern«, §2.9.3 zweiter Punkt, §2.9.4 Hochladen und Entfernen, §2.12, §2.13 »Tastaturalternative«, §2.1 »Identität« (Nur lesen), §2.3.2 (Tools, Upload). BK `docs/proposals/backe.md` §2.6, §2.7, §2.8, §2.22–§2.24. Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (U7, Review Focus Punkt 5). ui.md ist `in Umsetzung`.

## Global Constraints

Alle Global Constraints des Gesamtplans und der Pläne U1–U6. Dazu für U7:

- Schreiben nur über `POST /api/b/<b>/tools/<tool>` mit `Content-Type: application/json` und `PUT …/issues/<id>/attachments/<name>` mit `Content-Type: application/octet-stream`; Tool-Namen und Parameter wie in `src/tools/` (Paritätstest Task 1). Den neuen Zustand bringt der Event-Stream, nie die Antwort.
- `can_write: false` (`BacklogEntryJson`) → keine Schreibaktion im DOM: kein Bearbeiten-Knopf, kein Kontextmenü, kein `draggable`, kein Composer, kein Upload, `c` tut nichts. Auch `repo_locate` nicht (Tool, verlangt Schreibrecht, ui.md §2.3.2).
- Optimistische Überlagerung: Zeitkonstante `PENDING_TIMEOUT_MS = 5000` (ui.md §2.5) als einzige Stelle; Tests mit Fake Timers, nie echtes Warten.
- Fehler zeigen `message` und `hint` wörtlich vom Server (ui.md §2.14: Server-Sprache); eigene Texte nur für Rahmen und Knöpfe.
- Anhangsnamen erfüllt der Client vor dem Upload selbst: `ATTACHMENT_NAME_RE` aus `@backe/core/names.ts`, immer mit Endung (dann ist `file === name`, BK §2.8), eindeutig im Issue.
- Tastatur: jeder Drag hat eine Tastaturalternative (ui.md §2.13); `Esc` schließt Dialoge (Radix); `c` ohne Modifier, nicht in `input`, `textarea`, `select` oder `[contenteditable]`, nicht bei offenem Dialog.
- Neue Texte en + de: `web/src/views/issue.messages.ts`, `web/src/views/backlog.messages.ts`, neu `web/src/components/write/write.messages.ts`. State-Namen, IDs, Handles, Property-Keys, Pfade bleiben roh.
- `web/src/data/**` hat das Coverage-Gate `{ lines: 90, branches: 85 }`; `Writes`, `tools.ts` und die Store-Überlagerung liegen dort.

## Review Focus

1. **Patch vor der Antwort** — der Patch mit dem `commit` kommt über den Stream an, bevor `fetch` die Antwort liefert. Erwartet: die Überlagerung fällt mit der Antwort sofort weg, kein Timer, kein Neuladen. → Task 2 `a patch before the answer settles at once`.
2. **Abgelehnter Write nach optimistischer Anzeige** — strikter Workflow, `done` mit offenen Sub-Issues, Belegung. Erwartet: der alte Wert steht sofort wieder da, die Meldung samt `hint` erscheint, kein »ausstehend« bleibt hängen; bei `open_children` bietet der Dialog »trotzdem« (`force`) mit den offenen Sub-Issues. → Task 2 `a rejected write rolls back at once`, Task 6 `done with open sub-issues offers force`.
3. **Commit, der nie als Patch-`head` kommt** — Sync-Replay ändert den Hash, oder zwei Writes fallen in eine Watcher-Runde. Erwartet: zeigt der Serverstand die überlagerten Werte, fällt die Überlagerung; sonst nach 5 s genau ein `/state`. → Task 2 `a replayed commit settles by its values`, `without a matching patch the state reloads after 5 s`.
4. **Dateinamen aus der echten Welt** — `Screen Shot 2026-11-26 at 10.00.00 PM.PNG`, `.hidden`, `ümlaut.png`, ein Name mit 200 Zeichen, eingefügtes Bild ohne Namen (`image.png` aus der Zwischenablage), zweimal derselbe Name. Erwartet: jeder Upload bekommt einen gültigen, eindeutigen Namen mit Endung, kein 400 vom Server. → Task 5 `names fit the attachment rule`.
5. **Paralleles Ändern der Beschreibung** — während des Bearbeitens kommt ein Patch mit `touched` und ein neuer Body. Erwartet: Hinweis im Editor, Entwurf bleibt; »meine Fassung speichern« schickt den Entwurf, »verwerfen und neu laden« zeigt den neuen Body; nichts wird stillschweigend überschrieben. → Task 7 `a body changed meanwhile is never overwritten silently`.

---

### Task 1: Tool-Typen, `callTool` und Upload im Client

**Files:**
- Modify: `src/ui/api.ts` (Typen `WriteResultJson`, `RepoLocateJson`, `ToolArgs`, `ToolResults`, `UiToolName`)
- Modify: `web/src/data/api-client.ts` (`postJson`, `putBytes`, gemeinsame Antwortauswertung mit `getJson`)
- Create: `web/src/data/tools.ts`
- Test: `src/ui/tool-args.test.ts`, `web/src/data/api-client.test.ts`, `web/src/data/tools.test.ts`

**Interfaces:**
- Produces:

```ts
// src/ui/api.ts — weiter nur Typen
export type NoticeJson = { code?: string; message: string; ids?: string[] };
/** `outcomeJson` eines Writes; `commit` ist `null`, wenn sich nichts änderte. */
export type WriteResultJson = {
  commit: string | null; op?: string; ops?: string[]; id: string;
  notices?: NoticeJson[]; warnings?: string[];
};
export type RepoLocateJson = { name: string; url: string; canonical: string; default_ref?: string; path: string };
export type ToolArgs = {
  issue_create: { title: string; body?: string; state?: string; projects?: string[]; sprints?: string[];
    repos?: string[]; assignee?: string; depends_on?: string[]; parent?: string; props?: Record<string, unknown> };
  issue_update: { id: string; title?: string; body?: string; add_projects?: string[]; rm_projects?: string[];
    add_sprints?: string[]; rm_sprints?: string[]; add_deps?: string[]; rm_deps?: string[];
    parent?: string | null; assignee?: string | null; props?: Record<string, unknown> };
  issue_move: { id: string; to: string; reason?: string; blocked_by?: string[]; force?: boolean };
  issue_resume: { id: string; reason?: string };
  issue_reopen: { id: string; to?: string; reason?: string };
  issue_rank: { id: string; top?: boolean; bottom?: boolean; before?: string; after?: string; value?: number };
  issue_claim: { id: string };
  issue_delete: { id: string; force?: boolean; children?: 'orphan' | 'recursive' };
  comment_add: { id: string; body: string };
  comment_edit: { id: string; comment: string; body: string };
  comment_delete: { id: string; comment: string };
  attachment_rm: { id: string; name: string };
  repo_locate: { name: string };
};
export type UiToolName = keyof ToolArgs;
export type ToolResults = { [K in UiToolName]: K extends 'repo_locate' ? RepoLocateJson : WriteResultJson };

// web/src/data/api-client.ts
export function postJson<T>(path: string, body: unknown, fetchFn?: Fetch): Promise<T>;
export function putBytes<T>(path: string, bytes: Blob, fetchFn?: Fetch): Promise<T>;

// web/src/data/tools.ts
export function callTool<N extends UiToolName>(backlog: string, name: N, args: ToolArgs[N], fetchFn?: Fetch): Promise<ToolResults[N]>;
export function uploadAttachment(backlog: string, id: string, name: string, bytes: Blob, fetchFn?: Fetch): Promise<WriteResultJson>;
```

`U8` ergänzt `batch` in `ToolArgs`, U10 die Verwaltungs-Tools; der Paritätstest wächst mit.

- [x] **Step 1: Failing tests**

```ts
// src/ui/tool-args.test.ts — jeder Key des Client-Typs ist ein Parameter des Katalogs
const FULL: { [K in UiToolName]: Required<ToolArgs[K]> } = { issue_create: {…alle Keys…}, … };
test.each(Object.keys(FULL))('%s args fit the catalog schema', (name) => {
  const def = toolsFor('ui', { allowDelete: true }).find((t) => t.name === name);
  expect(def?.input.safeParse(FULL[name as UiToolName]).success).toBe(true);
});
// api-client.test.ts
test('postJson sends json with the content type and parses the answer', …method 'POST', headers 'Content-Type': 'application/json', body JSON.stringify);
test('putBytes sends octet-stream', …method 'PUT', 'Content-Type': 'application/octet-stream', body ist der Blob);
test('write errors carry code, hint and details', …400 {error:{code:'validation',message,hint,details:{reason:'open_children',ids:[…]}}} → ApiError mit allen Feldern);
test('no answer is offline', …fetch wirft → ApiError status 0 code 'offline');
// tools.test.ts
test('callTool posts to the tool endpoint', …'/api/b/a%20b/tools/issue_move');
test('uploadAttachment puts to the attachment endpoint', …'/api/b/acme/issues/bk-7f3k2/attachments/shot.png');
```

- [x] **Step 2: Run, verify FAIL** — `pnpm vitest run src/ui/tool-args.test.ts && pnpm vitest run --project web web/src/data`
- [x] **Step 3: Implement** — `getJson`, `postJson`, `putBytes` teilen eine Funktion für »kein Response → offline, nicht `ok` → `ApiError` aus dem Fehler-JSON«. `credentials` bleibt Default (same-origin). Pfadsegmente einzeln per `encodeURIComponent`.
- [x] **Step 4: Run** → PASS; `pnpm vitest run test/conventions.test.ts` → PASS (api.ts bleibt `import type`-only)
- [x] **Step 5: Commit** — `feat: Tool-Aufrufe und Upload im Client von backe ui`

### Task 2: Ausstehend-Überlagerung im Store, `Writes` mit 5-s-Rückfall

**Files:**
- Modify: `web/src/data/store.ts` (`EntityTable` mit Überlagerung, `Store.setOverlay`, `clearOverlay`, `pendingCount`)
- Create: `web/src/data/writes.ts`
- Modify: `web/src/data/session.ts` (`refresh()`, `writes`)
- Test: `web/src/data/store.test.ts`, `web/src/data/writes.test.ts`, `web/src/data/session.test.ts`

**Interfaces:**
- Consumes: Task 1 (`callTool`, `uploadAttachment`, `ToolArgs`, `ToolResults`, `WriteResultJson`), `ApiError`.
- Produces:

```ts
// store.ts
class EntityTable<T> {
  /** Serverstand ohne Überlagerung, ungetrackt. */
  server(key: string): T | undefined;
  overlay(token: number, entries: ReadonlyMap<string, Partial<T>>): void;
  dropOverlay(token: number): void;
}
class Store {
  setOverlay(token: number, issues: ReadonlyMap<string, Partial<IssueJson>>): void;
  clearOverlay(token: number): void;
  /** Anzahl offener Überlagerungen des Issues; > 0 heißt »ausstehend«. */
  pendingCount(id: string): Signal<number>;
}
// writes.ts
export const PENDING_TIMEOUT_MS = 5000;
export type WriteFailure = { id: number; error: ApiError };
export type WriteDeps = {
  call: <N extends UiToolName>(name: N, args: ToolArgs[N]) => Promise<ToolResults[N]>;
  upload: (id: string, name: string, bytes: Blob) => Promise<WriteResultJson>;
  /** Lädt `/state` neu; erfüllt, sobald das Laden fertig ist, auch nach einem Fehler. */
  refresh: () => Promise<void>;
};
export class Writes {
  constructor(store: Store, deps: WriteDeps);
  run<N extends UiToolName>(name: N, args: ToolArgs[N],
    opts?: { optimistic?: ReadonlyMap<string, Partial<IssueJson>> }): Promise<ToolResults[N]>;
  upload(id: string, name: string, bytes: Blob): Promise<WriteResultJson>;
  readonly failures: Signal<readonly WriteFailure[]>;
  /** Für Aktionen ohne eigene Fehlerfläche (Kontextmenü, Drag): `writes.run(…).catch(writes.report)`. */
  readonly report: (error: unknown) => void;
  dismiss(id: number): void;
  dispose(): void;
}
// session.ts
export type Session = { …; readonly writes: Writes; refresh(): Promise<void> };
```

Regeln:
- Überlagerung: effektiver Wert = Serverwert mit allen Überlagerungen in Token-Reihenfolge darübergelegt (`{...server, ...overlay}`; ein Key mit `undefined` entfernt das Feld). Ohne Serverwert bleibt `undefined` — eine Überlagerung legt nie ein Issue an und hält kein gelöschtes am Leben. Upsert, Remove und `replaceAll` setzen den Serverwert und veröffentlichen den effektiven neu; Key-Listen kennen nur Serverwerte. `setOverlay`/`clearOverlay` im `batch` und mit `pendingCount` je Issue.
- `Writes.run`: Überlagerung setzen (vor dem `fetch`, also im selben Frame), Tool rufen. Fehler → Überlagerung sofort weg, `ApiError` (andere Würfe als `ApiError(0, 'offline', …)`) an den Aufrufer. Erfolg ohne `commit` (auch `repo_locate`) → sofort weg. Erfolg mit `commit` → weg, sobald `store.head` den `commit` trägt (Patch oder `/state`, auch schon vor der Antwort) oder ein Patch/Neuladen nach der Antwort Serverwerte bringt, die allen überlagerten Feldern gleichen (Vergleich per JSON-Gleichheit, fehlend = `undefined`); sonst nach `PENDING_TIMEOUT_MS` genau ein `refresh()`, danach weg. Auch ein Write ohne `optimistic` mit `commit` folgt dieser Regel (der Rückfall gilt für jeden Write). Der Effekt hängt an `store.rev` und `store.head`, nicht an den Issue-Signalen.
- `upload` wie `run` ohne Überlagerung.
- `Session.refresh()` nutzt das vorhandene Laden samt `reloadPending`; alle Wartenden werden erfüllt, wenn das letzte Laden fertig ist. `dispose` der Sitzung ruft `writes.dispose()` (Timer weg, Überlagerungen weg).

- [x] **Step 1: Failing tests**

```ts
// store.test.ts
test('an overlay shows over the server value and goes away', …);
test('a patch under an overlay keeps the overlay on the new server value', …upsert title, overlay state → beides sichtbar);
test('an overlay never creates or revives an issue', …remove unter Overlay → undefined; overlay auf unbekannte ID → undefined, keys unverändert);
test('overlays stack in token order', …);
test('pendingCount counts overlays per issue', …);
// writes.test.ts (vi.useFakeTimers())
test('the overlay is set before the call answers', …);
test('a matching patch settles the overlay', …applyPatch head = commit → pendingCount 0, kein refresh);
test('a patch before the answer settles at once', …head = commit vor Auflösen des call-Promise);
test('a replayed commit settles by its values', …Patch mit anderem head, Issue-Werte = Overlay → weg);
test('without a matching patch the state reloads after 5 s', …advanceTimersByTime(4999) → refresh 0×; (1) → 1×; nach refresh weg);
test('a rejected write rolls back at once', …call wirft ApiError → Overlay weg, Promise rejected mit hint);
test('a write without commit settles at once', …);
test('report collects failures, dismiss removes them', …);
test('dispose clears timers and overlays', …);
// session.test.ts
test('refresh resolves after the reload, also on failure', …);
test('dispose of the session disposes its writes', …);
```

- [x] **Step 2: Run, verify FAIL** — `pnpm vitest run --project web web/src/data`
- [x] **Step 3: Implement**
- [x] **Step 4: Run** → PASS; Coverage für `web/src/data/**` ≥ 90/85 (`pnpm vitest run --coverage --project web`)
- [x] **Step 5: Commit** — `feat: Ausstehend-Überlagerung im Store und Writes mit Rückfall auf /state`

### Task 3: Optimistische Werte und erlaubte Aktionen aus dem Code von BK

**Files:**
- Create: `web/src/app/optimistic.ts`, `web/src/app/state-actions.ts`, `web/src/app/delete-plan.ts`
- Modify: `test/helpers/web-closure.ts` (`src/ops/rank.ts` in `WEB_ENTRIES`)
- Test: `web/src/app/optimistic.test.ts`, `web/src/app/state-actions.test.ts`, `web/src/app/delete-plan.test.ts`

**Interfaces:**
- Consumes: `planTransition`, `State`, `ALL_STATES`, `MAIN_LINE`, `isSettled` (`@backe/core/state.ts`), `rankPlacement`, `RankPosition` (`@backe/ops/rank.ts`), `graphOf` (`@backe/ops/graph.ts`), `BacklogSnapshot`, `ToolArgs`, `ApiError`.
- Produces:

```ts
// state-actions.ts
export type StateTool = 'issue_move' | 'issue_resume' | 'issue_reopen';
export type StateAction = { to: State; tool: StateTool; needsBlockedBy: boolean };
/** Erlaubte Wechsel in `ALL_STATES`-Reihenfolge, geprüft mit `planTransition` (strict aus der Config). */
export function stateActions(issue: IssueJson, strict: boolean): StateAction[];
export type StateCall =
  | { name: 'issue_move'; args: ToolArgs['issue_move'] }
  | { name: 'issue_resume'; args: ToolArgs['issue_resume'] }
  | { name: 'issue_reopen'; args: ToolArgs['issue_reopen'] };
export function stateCall(id: string, action: StateAction,
  extra?: { reason?: string; blockedBy?: string[]; force?: boolean }): StateCall;
/** IDs der offenen Sub-Issues, wenn der Server `done` mit `details.reason: 'open_children'` ablehnte. */
export function openChildrenOf(error: unknown): string[] | undefined;
// optimistic.ts — jede Funktion liefert die Überlagerung für Writes.run
export function stateOverlay(s: BacklogSnapshot, id: string, action: StateAction, blockedBy?: string[]): Map<string, Partial<IssueJson>>;
export function rankOverlay(s: BacklogSnapshot, id: string, pos: RankPosition): Map<string, Partial<IssueJson>>;
export function updateOverlay(issue: IssueJson, args: ToolArgs['issue_update']): Map<string, Partial<IssueJson>>;
// delete-plan.ts
/** Was `issue_delete` fragt: direkte Sub-Issues und Issues, die auf das Gelöschte verweisen. */
export function deletePlan(s: BacklogSnapshot, id: string, children?: 'orphan' | 'recursive'):
  { children: string[]; referencing: string[] };
```

Regeln: erledigte Issues (`isSettled`) bieten nur `issue_reopen` auf `backlog`, `todo`, `in_progress`, `review`; pausierte bieten `issue_resume` auf `paused_from` und alle `issue_move`-Ziele, die `planTransition(…, 'move')` zulässt (für `blocked` mit Platzhalter-`blockedBy`); sonst alle zulässigen `issue_move`. Die Überlagerung eines Wechsels ist das Ergebnis von `planTransition`: `state`, `paused_from` und `blocked_by`, fehlende Felder als `undefined`. `rankOverlay` setzt `rank` aller Issues aus `rankPlacement`. `updateOverlay` legt `title`, `body` (nicht im Store, entfällt), `assignee` (`null` → `undefined`), `parent`, Listen (`add_*` anhängen ohne Dubletten, `rm_*` entfernen, leer → `undefined`) und `props` (`null` entfernt den Key) über. `deletePlan` folgt `issueDelete` in `src/ops/delete-op.ts`: `referencing` ohne die gelöschten Issues, sortiert; `recursive` zählt alle Nachfahren zum Gelöschten.

- [x] **Step 1: Failing tests**

```ts
test('settled issues only reopen', …done → [backlog,todo,in_progress,review] alle issue_reopen);
test('paused issues resume to paused_from', …blocked mit paused_from in_progress → {to:'in_progress', tool:'issue_resume'} und move-Ziele);
test('strict workflow allows neighbours only', …strict, todo → backlog, in_progress, blocked, on_hold, cancelled, rejected; nicht review, done);
test('blocked needs blocked_by', …needsBlockedBy true nur für blocked);
test('state calls carry reason, blocked_by and force', …);
test('open children come from the error details', …ApiError details {reason:'open_children', ids} → ids; anderer reason → undefined);
test('state overlay equals planTransition', …blocked → paused_from und blocked_by; resume → paused_from undefined);
test('rank overlay equals rankPlacement', …before mit Umnummerierung der Nachbarn → mehrere Einträge);
test('update overlay adds, removes and unsets', …);
test('delete plan names children and references', …orphan vs recursive);
```

- [x] **Step 2: Run, verify FAIL**
- [x] **Step 3: Implement**; `src/ops/rank.ts` in `WEB_ENTRIES`
- [x] **Step 4: Run** → PASS; `pnpm vitest run test/conventions.test.ts` → PASS (Hülle ohne `node:`)
- [x] **Step 5: Commit** — `feat: Optimistische Werte und erlaubte State-Wechsel aus dem Code von BK`

### Task 4: Write-Kontext, Dialog-Bausteine, globale Fehler

**Files:**
- Create: `web/src/data/write-context.tsx`, `web/src/components/write/write.messages.ts`, `web/src/components/write/ActionError.tsx`, `web/src/components/write/ConfirmDialog.tsx`, `web/src/components/write/use-action.ts`, `web/src/components/write/WriteFailures.tsx`, `web/src/components/write/PendingMark.tsx`
- Create: `web/src/components/ui/context-menu.tsx`, `web/src/components/ui/textarea.tsx` (shadcn, s. Tech Stack)
- Modify: `web/src/components/App.tsx` (`WriteContext.Provider` je Sitzung, `<WriteFailures>` unter der Kopfzeile)
- Test: `web/src/components/write/write.test.tsx`

**Interfaces:**
- Consumes: Task 2 (`Writes`, `Session.writes`), `ErrorAlert`, `Dialog*`, `BacklogEntryJson`.
- Produces:

```ts
export type WriteAccess = { backlog: string; canWrite: boolean; me: string | null; writes: Writes };
export const WriteContext: React.Context<WriteAccess | null>;
export function useWrites(): WriteAccess;
// use-action.ts — Zustand einer Aktion mit eigener Fehlerfläche
export function useAction(): { busy: boolean; error: ApiError | undefined;
  run(fn: () => Promise<unknown>): Promise<boolean>; reset(): void };
// Komponenten
<ActionError error={ApiError | undefined} />            // ErrorAlert kompakt: message + hint, role="alert"
<ConfirmDialog open title description? confirmLabel destructive? busy error onConfirm onOpenChange>{children}</ConfirmDialog>
<WriteFailures writes={Writes} />                        // Liste der failures, je Eintrag »Schließen«
<PendingMark id={string} />                              // Loader-Icon + sr-only »ausstehend«, nichts bei pendingCount 0
```

`useAction.run` liefert `true` bei Erfolg, setzt `busy` während des Laufs, fängt jeden Wurf als `ApiError` in `error`; ein neuer Lauf löscht den alten Fehler. `ConfirmDialog` sperrt Knöpfe bei `busy`, zeigt `ActionError` im Dialog; `Esc` und »Abbrechen« schließen nur, wenn nicht `busy`.

- [x] **Step 1: Failing tests**

```tsx
test('useWrites needs a provider', …);
test('the app provides can_write and me per backlog', …mountApp mit can_write false → useWrites().canWrite false);
test('a failed action shows message and hint', …);
test('confirm dialog runs, shows errors and closes on success', …);
test('write failures are listed and dismissable', …);
test('pending mark follows pendingCount', …);
```

- [x] **Step 2: Run, verify FAIL**
- [x] **Step 3: Install und implementieren**
- [x] **Step 4: Run** `pnpm vitest run --project web` → PASS
- [x] **Step 5: Commit** — `feat: Write-Kontext, Dialog-Bausteine und Fehleranzeige im Frontend`

### Task 5: Markdown-Editor mit Vorschau und Bild-Upload

**Files:**
- Create: `web/src/app/attachment-name.ts`, `web/src/components/editor/MarkdownEditor.tsx`
- Modify: `web/src/markdown/Markdown.tsx`, `web/src/markdown/url-transform.ts` (`local`)
- Modify: `web/src/components/write/write.messages.ts`
- Test: `web/src/app/attachment-name.test.ts`, `web/src/components/editor/MarkdownEditor.test.tsx`, `web/src/markdown/url-transform.test.ts`

**Interfaces:**
- Consumes: `ATTACHMENT_NAME_RE` (`@backe/core/names.ts`), `Markdown`, `Textarea`.
- Produces:

```ts
// attachment-name.ts
/** Gültiger, im Issue eindeutiger Anhangsname mit Endung (Endung aus dem Namen, sonst aus dem MIME-Typ). */
export function attachmentNameFor(fileName: string, mime: string, taken: ReadonlySet<string>): string;
// MarkdownProps / UrlContext
local?: ReadonlyMap<string, string>;   // file → blob:-URL für noch nicht hochgeladene Bilder
// MarkdownEditor.tsx
export type MarkdownEditorProps = {
  value: string; onChange(next: string): void; label: string; backlog: string;
  issue?: MarkdownProps['issue']; local?: ReadonlyMap<string, string>;
  /** Nimmt ein Bild an und liefert seinen Anhangsnamen (= file); wirft bei Fehlern. Fehlt es, gibt es keinen Bild-Upload. */
  onImage?: (file: File) => Promise<string>;
  disabled?: boolean; autoFocus?: boolean;
};
export function MarkdownEditor(props: MarkdownEditorProps): JSX.Element;
```

Regeln `attachmentNameFor`: klein schreiben, NFKD und Diakritika weg, jedes Zeichen außerhalb `[a-z0-9._-]` → `-`, Läufe von `-` zusammenfassen, führende Zeichen bis zum ersten `[a-z0-9]` weg; leerer Stamm → `image` bzw. `file`; Endung aus dem Namen, sonst `png`, `jpg`, `gif`, `webp`, `avif`, `svg` für `image/png|jpeg|gif|webp|avif|svg+xml`, sonst `bin`; Gesamtlänge ≤ 64 mit gekürztem Stamm; belegt → `-2`, `-3`, … vor der Endung. Das Ergebnis passt immer auf `ATTACHMENT_NAME_RE`.

Editor: Umschalter Text/Vorschau als zwei Knöpfe mit `aria-pressed`; Vorschau über `<Markdown>` mit `issue` und `local`. Einfügen (`paste`) und Ablegen (`drop`, `stopPropagation`) von Dateien mit `image/*` ruft `onImage` je Datei nacheinander und fügt an der Cursorstelle `![<name>](attachments/<name>)` ein; während des Uploads eine Statuszeile (`role="status"`), ein Fehler erscheint als `ActionError` unter dem Feld, der Text bleibt unverändert. Andere Dateien ignoriert der Editor (kein `preventDefault`).

- [x] **Step 1: Failing tests**

```ts
test.each([
  ['Screen Shot 2026-11-26 at 10.00.00 PM.PNG', 'image/png', 'screen-shot-2026-11-26-at-10.00.00-pm.png'],
  ['.hidden', 'application/octet-stream', 'hidden.bin'],
  ['ümlaut.png', 'image/png', 'umlaut.png'],
  ['image.png', 'image/png', 'image.png'],
  ['', 'image/jpeg', 'image.jpg'],
])('names fit the attachment rule: %s', (name, mime, want) => { …toBe(want); toMatch(ATTACHMENT_NAME_RE) });
test('long names keep their extension within 64', …'a'.repeat(200)+'.png' → Länge 64, endet auf .png);
test('taken names count up', …taken {'shot.png','shot-2.png'} → 'shot-3.png');
test('local previews resolve to blob urls', …url-transform mit local {'shot.png' → 'blob:x'} → 'blob:x');
test('typing changes the value', …);
test('preview renders markdown', …);
test('a pasted image uploads and inserts a link', …onImage → 'shot.png', Wert enthält '![shot.png](attachments/shot.png)' an der Cursorstelle);
test('a dropped image uploads too', …);
test('a failed upload shows the error and keeps the text', …);
test('without onImage images are not taken', …);
```

- [x] **Step 2: Run, verify FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run** → PASS
- [x] **Step 5: Commit** — `feat: Markdown-Editor mit Vorschau und Bild-Upload`

### Task 6: Felder im Tab Issue bearbeiten, lokaler Repo-Pfad

**Files:**
- Create: `web/src/components/issue/edit/inputs.tsx` (wiederverwendbare, kontrollierte Eingaben), `web/src/components/issue/edit/TitleEditor.tsx`, `web/src/components/issue/edit/StateControl.tsx`, `web/src/components/issue/edit/FieldEditors.tsx` (Assignee, Projekte, Sprints, Parent, Properties), `web/src/components/issue/edit/DepsEditor.tsx`, `web/src/components/issue/RepoPath.tsx`
- Modify: `web/src/components/issue/IssueFields.tsx`, `web/src/components/issue/IssueRelations.tsx`, `web/src/views/IssueView.tsx`, `web/src/views/issue.messages.ts`
- Test: `web/src/components/issue/edit/edit.test.tsx`, `web/src/components/issue/RepoPath.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–4 (`useWrites`, `Writes.run`, `stateActions`, `stateCall`, `stateOverlay`, `updateOverlay`, `openChildrenOf`, `useAction`, `ActionError`, `PendingMark`, Dialog).
- Produces (Task 8 nutzt sie wieder):

```tsx
// inputs.tsx — kontrolliert, ohne Schreiben
<MultiPick label values={string[]} options={string[]} onChange={(next: string[]) => void} />   // Chips mit ×, Auswahl zum Hinzufügen
<AssigneeSelect value={string | null} me={string | null} users={string[]} onChange={(v: string | null) => void} />
<IssuePick label value={string} onChange exclude?={string[]} />    // ID-Eingabe mit <datalist> aus store.issues (ID + Titel)
<PropInput name={string} decl={PropDeclaration | undefined} value={unknown} onChange={(v: unknown | undefined) => void} />
// StateControl.tsx — der Dialog ist auch für das Kontextmenü (Task 9) da
<StateDialog issue={IssueJson} action={StateAction | undefined} onOpenChange={(open: boolean) => void} />
/** enum → <select>, integer/number → <input type=number>, boolean → Checkbox, string → Text, json/undeklariert → JSON-Text, geprüft per JSON.parse */
```

Regeln:
- Jeder Editor erscheint nur mit `canWrite`; ohne bleibt die lesende Darstellung aus U6 unverändert.
- Titel: Knopf »Titel bearbeiten« → Eingabe, Enter speichert (`issue_update {id, title}`), `Esc` bricht ab; leerer Titel speichert nicht.
- State: Menü (`DropdownMenu`) mit `stateActions`; ein Eintrag ohne `needsBlockedBy` wechselt sofort (`stateCall` + `stateOverlay`), »… mit Begründung« und `blocked` öffnen einen Dialog mit `reason` (Textarea) und bei `blocked` `blocked_by` (mehrere `IssuePick`, mindestens eine ID). Lehnt der Server `done` mit `open_children` ab (`openChildrenOf`), zeigt der Dialog die offenen Sub-Issues als `IssueRef` und »Trotzdem abschließen« (`force: true`). Fehler mit `hint` erscheinen am Feld; die Überlagerung ist dann schon weg.
- Assignee (`me`, `none` als `null`, Users aus `store.users`), Projekte (`store.projects`), Sprints (`store.sprints`), Parent (`IssuePick`, »entfernen« → `null`), Abhängigkeiten in `IssueRelations` (`depends_on` hinzufügen/entfernen über `add_deps`/`rm_deps`), Properties: deklarierte zuerst mit `PropInput` und `description` als Hilfetext, dann vorhandene undeklarierte, dazu »Property hinzufügen« (Key + JSON-Wert); Entfernen → `null`. Jede Änderung ist genau ein `issue_update` mit `updateOverlay`.
- `RepoPath`: je Repo-Zeile Knopf »Lokaler Pfad« → `writes.run('repo_locate', {name})`; Erfolg zeigt `path` in Monospace mit Kopier-Knopf (Muster `CopyId`), Fehler `message` und `hint` inline.
- Während eines Writes ist der Editor gesperrt (`busy`); `PendingMark` am State zeigt die Überlagerung.

- [x] **Step 1: Failing tests**

```tsx
test('title edits save on enter and cancel on escape', …issue_update {id, title:'Neu'}; Esc → kein fetch);
test('a state change is optimistic and posts issue_move', …Klick »in_progress« → sofort »in_progress« im DOM, PendingMark, POST /tools/issue_move {id, to:'in_progress'});
test('blocked asks for blocked_by and reason', …);
test('a resume uses issue_resume, a settled issue issue_reopen', …);
test('a rejected move rolls back and shows the hint', …400 mit hint → alter State, hint sichtbar);
test('done with open sub-issues offers force', …400 open_children ids [x] → Dialog nennt x, »Trotzdem abschließen« → force:true);
test('assignee, projects, sprints and parent send issue_update', …je ein Aufruf mit den Feldern aus ToolArgs);
test('dependencies are added and removed', …add_deps/rm_deps);
test('declared properties get typed inputs with their description', …enum → select mit values, boolean → Checkbox, integer → number);
test('properties are set, changed and removed', …props {k: v}, {k: null});
test('repo path comes from repo_locate and can be copied', …);
test('a repo without local path shows the hint', …404 not_found mit hint);
```

- [x] **Step 2: Run, verify FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run** `pnpm vitest run --project web` → PASS
- [x] **Step 5: Commit** — `feat: Felder im Issue-Tab bearbeiten, lokaler Repo-Pfad über repo_locate`

### Task 7: Beschreibung, Kommentare, Anhänge und Aktionen im Tab Issue

**Files:**
- Create: `web/src/components/issue/edit/DescriptionEditor.tsx`, `web/src/components/issue/edit/CommentComposer.tsx`, `web/src/components/issue/edit/IssueActions.tsx` (Übernehmen, Wiedereröffnen, Löschen), `web/src/components/issue/edit/DeleteDialog.tsx`, `web/src/components/issue/edit/upload.ts`
- Modify: `web/src/views/IssueView.tsx` (Drop-Zone über dem Tab), `web/src/components/issue/Timeline.tsx`, `web/src/components/issue/Attachments.tsx`, `web/src/views/issue.messages.ts`
- Test: `web/src/components/issue/edit/content.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–6 (`MarkdownEditor`, `attachmentNameFor`, `deletePlan`, `stateActions`, `ConfirmDialog`, `useAction`, `IssueRef`).
- Produces (Task 9 nutzt `DeleteDialog`, Task 8 `uploadFiles`):

```ts
// upload.ts
/** Lädt Dateien nacheinander hoch, Namen per attachmentNameFor gegen die schon vergebenen; liefert die Namen. */
export function uploadFiles(writes: Writes, id: string, files: readonly File[], taken: ReadonlySet<string>): Promise<string[]>;
// DeleteDialog.tsx
<DeleteDialog id={string} open onOpenChange />   // Plan aus deletePlan(store.toSnapshot(), …)
```

Regeln:
- **Beschreibung:** »Bearbeiten« → `MarkdownEditor` mit dem geladenen Body als Entwurf und Basis, `onImage` lädt sofort hoch (`uploadFiles`). »Speichern« → `issue_update {id, body}`, »Abbrechen« verwirft. Bringt ein Neuladen (`detail.body`) während des Bearbeitens einen anderen Body als die Basis, steht über dem Editor ein Hinweis (`role="status"`) mit »Meine Fassung speichern« (`issue_update` mit dem Entwurf) und »Verwerfen und neu laden« (Editor zu, der neue Body steht da). Gespeichert wird nie ohne Klick.
- **Kommentare:** unter der Zeitleiste ein `CommentComposer` (`comment_add`, nach Erfolg leer). Eigene Kommentare (`author === me`, nicht `kind: 'transition'`) bekommen »Bearbeiten« (`comment_edit {id, comment: file, body}`) und »Löschen« (`ConfirmDialog` → `comment_delete {id, comment: file}`); fremde und Transitionen nicht.
- **Anhänge:** »Hochladen« (verstecktes `<input type="file" multiple>`) und Ablegen von Dateien auf den Tab (`dragover` mit `Files` → sichtbare Drop-Fläche, `drop` → `uploadFiles`); je Datei-Anhang und URL-Anhang »Entfernen« (`ConfirmDialog` → `attachment_rm`). Fehler erscheinen über der Liste.
- **Aktionen:** »Übernehmen« bei `backlog`/`todo` oder `in_progress` mit anderem Assignee (`issue_claim`; Knopf gesperrt mit Lade-Icon und `role="status"` »Übernehme …«, Fehler samt `hint`, etwa `conflict`); »Wiedereröffnen« bei erledigten Issues (Dialog mit Ziel aus `stateActions` und `reason`); »Löschen« öffnet `DeleteDialog`: mit Sub-Issues Pflichtwahl `orphan`/`recursive`, mit Verweisen die Liste der Issues und die Checkbox »Verweise entfernen und trotzdem löschen« (`force`); ohne Wahl bzw. ohne Häkchen bleibt »Löschen« gesperrt. Nach dem Löschen zeigt der Tab »gelöscht« (U6).

- [x] **Step 1: Failing tests**

```tsx
test('the description saves with issue_update body', …);
test('a body changed meanwhile is never overwritten silently', …Entwurf tippen, Patch touched, neuer Body geladen → Hinweis, kein POST; »Meine Fassung speichern« → POST body=Entwurf; Variante »Verwerfen« → neuer Body sichtbar, kein POST);
test('a pasted image in the description uploads to the issue', …PUT …/attachments/<name>, Link im Entwurf);
test('a comment is added and the composer clears', …);
test('own comments can be edited and deleted, others not', …);
test('files upload by picker and by drop on the tab', …zwei PUT mit eindeutigen Namen);
test('an attachment is removed after confirming', …attachment_rm);
test('claim shows progress and the conflict hint', …);
test('reopen asks for target and reason', …);
test('delete asks orphan or recursive for sub-issues', …);
test('delete with references needs force', …);
```

- [x] **Step 2: Run, verify FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run** → PASS
- [x] **Step 5: Commit** — `feat: Beschreibung, Kommentare, Anhänge und Aktionen im Issue-Tab schreiben`

### Task 8: Issue anlegen (`c` und Schaltfläche)

**Files:**
- Create: `web/src/app/create-draft.ts`, `web/src/components/write/CreateIssueDialog.tsx`, `web/src/components/write/create-context.tsx`
- Modify: `web/src/components/App.tsx` (Dialog, Kürzel `c`), `web/src/views/BacklogView.tsx` (Schaltfläche »Neues Issue« neben der Filterleiste), `web/src/components/write/write.messages.ts`
- Test: `web/src/app/create-draft.test.ts`, `web/src/components/write/CreateIssueDialog.test.tsx`

**Interfaces:**
- Consumes: Tasks 4–7 (`MultiPick`, `AssigneeSelect`, `IssuePick`, `PropInput`, `MarkdownEditor`, `attachmentNameFor`, `uploadFiles`), `ListFilter`, `parseListFilter`, `MAIN_LINE`.
- Produces (U8 öffnet den Dialog mit Board-Vorbelegung):

```ts
export type CreateDraft = {
  title: string; body: string; state: State; projects: string[]; sprints: string[]; repos: string[];
  assignee: string | null; parent: string; depends_on: string[]; props: Record<string, unknown>;
};
export const EMPTY_DRAFT: CreateDraft;   // state 'backlog', alles andere leer
export function draftFromFilter(filter: ListFilter, me: string | null): CreateDraft;
/** BK §2.23: mit Parent stehen dessen projects, sprints und repos im Entwurf. */
export function withParent(draft: CreateDraft, parent: IssueJson): CreateDraft;
export function createArgs(draft: CreateDraft): ToolArgs['issue_create'];
// create-context.tsx
export function useCreateIssue(): { open(draft?: CreateDraft): void } | undefined;   // undefined ohne Schreibrecht
```

Regeln:
- `draftFromFilter`: `projects`, `sprints`, `repos` aus dem Filter; `assignee` Handle → Handle, `me` → `me`-Handle, `none`/fehlend → `null`; `state` nur bei genau einem konkreten State im Filter, sonst `backlog`. Andere Filter belegen nichts vor.
- `createArgs` schickt `projects`, `sprints`, `repos` immer als Liste (auch leer): so greift kein Kontext-Default des Servers, die UI legt an, was der Dialog zeigt. Leere Felder (`body`, `parent`, `assignee`, `depends_on`, `props`) fehlen.
- Dialog: Titel Pflicht (Absenden gesperrt, solange leer), Beschreibung mit `MarkdownEditor` — Bilder bleiben bis zum Anlegen lokal (`URL.createObjectURL`, Vorschau über `local`) und werden nach dem `issue_create` unter ihren Namen hochgeladen (`uploadFiles` mit der neuen ID); State aus `MAIN_LINE`; Projekte, Sprints, Repos (`MultiPick`), Assignee, Parent (`IssuePick`; Auswahl → `withParent`), Abhängigkeiten, deklarierte Properties (leer = nicht gesetzt). »Nach dem Anlegen öffnen« (Default an) navigiert zu `routeHref({kind: 'issue', backlog, id})`. Ein Fehler beim Anlegen bleibt im Dialog; scheitert danach ein Upload, schließt der Dialog nicht, nennt die angelegte ID und den Fehler. Blob-URLs werden beim Schließen freigegeben.
- `c` in `App`: nur mit `canWrite`, ohne Modifier, nicht in Eingabefeldern, nicht bei offenem Dialog (`document.querySelector('[role="dialog"]')`); im Tab Backlog mit `draftFromFilter(parseListFilter(location.search), me)`, sonst `EMPTY_DRAFT`.

- [x] **Step 1: Failing tests**

```ts
test('draft from filter', …{projects:['web'], sprints:['s1'], repos:['api'], assignee:'me', states:['todo']} → passend);
test('several states fall back to backlog', …);
test('a parent prefills projects, sprints and repos', …);
test('create args send lists always and skip empty fields', …);
test('c opens the dialog prefilled from the backlog filter', …);
test('c does nothing while typing or without write access', …);
test('creating posts issue_create and opens the new tab', …navigiert zu /b/acme/issue/<id aus Antwort>);
test('images upload after the issue exists', …Reihenfolge: POST issue_create, dann PUT …/<neue id>/attachments/<name>);
test('a create error stays in the dialog with its hint', …);
test('the title is required', …);
```

- [x] **Step 2: Run, verify FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run** → PASS
- [x] **Step 5: Commit** — `feat: Issue anlegen per Dialog und Tastenkürzel c`

### Task 9: Tab Backlog — Kontextmenü, Zeilen-Drag, Ausstehend

**Files:**
- Create: `web/src/components/RowMenu.tsx`, `web/src/components/row-drag.ts`
- Modify: `web/src/components/IssueRow.tsx`, `web/src/components/IssueList.tsx`, `web/src/views/BacklogView.tsx`, `web/src/views/backlog.messages.ts`
- Test: `web/src/components/RowMenu.test.tsx`, `web/src/components/row-drag.test.ts`, `web/src/views/BacklogView.test.tsx`

**Interfaces:**
- Consumes: Tasks 2–4, 7 (`Writes.run`, `report`, `stateActions`, `stateCall`, `stateOverlay`, `rankOverlay`, `DeleteDialog`, `PendingMark`), `ListRow`, `ListView`.
- Produces:

```ts
// row-drag.ts — rein
export const DRAG_TYPE = 'application/x-backe-issue';
/** Rank-Position für das Ablegen von `id` auf `target`; obere Hälfte → before, untere → after; auf sich selbst → undefined. */
export function dropPosition(id: string, target: string, offsetY: number, height: number): { before: string } | { after: string } | undefined;
/** Alt+↑/↓: vor die vorige bzw. hinter die nächste Zeile der Liste; am Rand undefined. */
export function keyboardPosition(rows: readonly ListRow[], id: string, key: 'ArrowUp' | 'ArrowDown'): { before: string } | { after: string } | undefined;
```

Regeln:
- Kontextmenü (`ContextMenu`, Rechtsklick und die Kontextmenü-Taste bzw. Umschalt+F10 an der fokussierten Zeile) nur mit `canWrite`: »State« (Untermenü aus `stateActions`; `blocked` öffnet `StateDialog` aus Task 6), »Assignee« (`me`, Users, »niemand«), »Rank« (»ganz oben« `top`, »ganz unten« `bottom`), »Löschen …« (`DeleteDialog`). State- und Rank-Aktionen optimistisch (`stateOverlay`, `rankOverlay`); Fehler über `writes.report` in die globale Anzeige.
- Ziehen nur mit `canWrite` und `view.sort === 'rank'`: `draggable` an der Zeile, `DRAG_TYPE` mit der ID, Markierung der Einfügestelle (`data-drop="before|after"`), Ablegen → `issue_rank` mit `dropPosition` und `rankOverlay`. Tastatur: `Alt+ArrowUp`/`Alt+ArrowDown` an der fokussierten Zeile mit `keyboardPosition`, der Fokus bleibt an der Zeile.
- `PendingMark` in jeder Zeile mit Überlagerung; Live-Hervorhebung und Scrollposition wie U5.

- [x] **Step 1: Failing tests**

```ts
test('drop position by half', …);
test('keyboard position moves one row', …erste Zeile ↑ → undefined);
// RowMenu/BacklogView
test('the context menu moves an issue optimistically', …fireEvent.contextMenu, »in_progress« → Zeile zeigt in_progress und »ausstehend«, POST issue_move);
test('rank top and bottom from the menu', …);
test('assignee from the menu', …issue_update {assignee});
test('delete from the menu opens the dialog', …);
test('a rejected menu action shows in the failures', …);
test('dragging a row reranks it optimistically', …dragStart/dragOver/drop mit DataTransfer-Stub → neue Reihenfolge sofort, POST issue_rank {id, before});
test('alt+arrow reranks with the keyboard', …);
test('no drag when sorted by created', …kein draggable);
```

- [x] **Step 2: Run, verify FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run** → PASS
- [x] **Step 5: Commit** — `feat: Kontextmenü und Umsortieren per Drag und Tastatur im Tab Backlog`

### Task 10: Nur lesen über alle Ansichten, Sichtprüfung, Docs

**Files:**
- Test: `web/src/components/App.test.tsx` (`read-only hides write actions`)
- Modify: `docs/proposals/ui.md` (Status-Satz, Präzisierungen §2.5, §2.9.2, §2.9.3, §2.12), `ROADMAP.md`, `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (U7 »Produziert«)

**Interfaces:**
- Consumes: alle Tasks.

- [x] **Step 1: Failing test** (fällt, wo eine Ansicht noch eine Schreibaktion zeigt)

```tsx
test('read-only hides write actions', async () => {
  // mountApp mit can_write: false, Issue mit Kommentar von 'spw', Anhang, Repo, Sub-Issue
  // Tab Backlog: kein »Neues Issue«, contextMenu an einer Zeile öffnet kein menu, keine Zeile draggable, Alt+↓ sendet nichts
  // 'c' öffnet keinen Dialog
  // Tab Issue: kein Bearbeiten-/Lokaler-Pfad-/Hochladen-/Entfernen-/Übernehmen-/Löschen-Knopf, kein Composer, State ohne Menü
  // fetch hat nie eine URL mit '/tools/' oder Methode PUT gesehen
});
```

- [x] **Step 2: Run** → bei Lücken FAIL, Lücke in der betroffenen Komponente schließen → PASS
- [x] **Step 3: Run** `mise run check` und `mise run smoke` → grün; `pnpm build` hält das Chunk-Budget (`scripts/check-ui-build.ts`)
- [x] **Step 4: Sichtprüfung** — `backe ui --port 0` gegen ein Test-Backlog unter einem Temp-`BACKE_HOME` im Browser (Playwright-MCP): Issue anlegen mit `c` samt eingefügtem Bild, Titel und State ändern, Kommentar schreiben und bearbeiten, Anhang hochladen und entfernen, Zeile per Drag umsortieren, Kontextmenü; parallel `backe issue move` im Terminal → Live-Update; Nur-lesen-Identität (`--as` ohne Key) zeigt keine Schreibaktion.
- [x] **Step 5: Docs** — ui.md Status-Satz: Tab Backlog vollständig (§2.7), Tab Issue ohne §2.9.5, Issue anlegen (§2.12), optimistische Anzeige (§2.5); offen bleiben §2.8, §2.9.5, §2.10, §2.11, §2.4.1 Punkt 3, Sprachwahl, Suche, `⌘K`. Präzisierungen als Gegenwart: §2.5 — die Überlagerung fällt auch, wenn der Serverstand die überlagerten Felder zeigt, und der 5-s-Rückfall gilt für jeden Write mit `commit`; §2.9.2 — der Client wählt den Anhangsnamen (gültig, eindeutig, mit Endung), beim Anlegen laden eingefügte Bilder nach dem `issue_create` hoch; §2.9.3 — Transitionen sind keine bearbeitbaren Kommentare; §2.12 — Projekte, Sprints und Repos gehen immer ausdrücklich mit, ohne Kontext-Default des Servers. ROADMAP »Writes im Frontend« abhaken. Gesamtplan U7 »Produziert« um `Writes`, `WriteContext`, `MarkdownEditor`, `useCreateIssue`, `stateActions`, `DeleteDialog` ergänzen.
- [x] **Step 6: Commit** — `feat: Nur-lesen blendet Schreibaktionen aus, Writes im Frontend fertig`

## Festlegungen

| Stelle | Festlegung |
| --- | --- |
| Optimistisch für alle Feldänderungen | ui.md §2.5 verlangt die Überlagerung für Board-Drag und Statuswechsel; Feldänderungen bekommen sie auch (`updateOverlay`), sonst blitzt nach dem Speichern bis zum Patch der alte Wert auf. Die Body-Änderung nicht: Bodies stehen nicht im Store. |
| Ende der Überlagerung | `head === commit` reicht nicht, wenn ein Sync-Replay den Hash ändert oder zwei Writes in eine Watcher-Runde fallen; ob ein `head` »später« ist, weiß der Client ohne Git nicht. Darum zusätzlich: Serverstand gleich den überlagerten Feldern. Sonst 5 s, dann `/state`. |
| Zeilen-Drag ohne `@dnd-kit` | Natives Drag-and-drop verträgt die virtualisierte Liste; `@dnd-kit` kommt mit dem Board (U8). Tastaturalternative `Alt+↑/↓`. |
| `done`-Sperre schon in U7 | Der »trotzdem«-Dialog (`force`) gehört laut ui.md §2.8 zum Board, betrifft aber jeden Statuswechsel; er entsteht hier im State-Dialog, U8 nutzt ihn. |
| Bilder beim Anlegen | Ohne Issue gibt es keinen Upload; der Client wählt die Namen vorher, der Body enthält sofort die endgültigen Links, hochgeladen wird nach `issue_create` (ein Commit je Bild). |
| Transitionen | Bearbeiten und Löschen nur für eigene Kommentare, nicht für Transitionen in der Zeitleiste (ui.md §2.9.3 spricht von Kommentaren). |
| Repo-Pfad auf Abruf | `repo_locate` erst per Klick: Ein Aufruf je Repo beim Öffnen des Tabs brächte für jedes Repo ohne lokalen Pfad einen Fehler in die Ansicht. |

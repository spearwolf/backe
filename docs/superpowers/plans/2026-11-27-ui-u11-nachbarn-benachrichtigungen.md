# backe ui U11 — Nachbarn und Benachrichtigungen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Schreibt eine andere Identität derselben Maschine (etwa ein Agent) in ihre eigene Arbeitskopie und pusht, startet `backe ui` nach 250 ms eine Hintergrund-Sync-Runde der eigenen Arbeitskopie, sodass die Änderung ohne Warten auf `pull_interval` als Patch ankommt; der Browser meldet nach Zustimmung, wenn mir ein Issue zugewiesen wird, jemand anderes eines meiner Issues ändert oder ein neuer Sync-Konflikt entsteht.

**Architecture:** Server: `src/ui/neighbors.ts` beobachtet die Branch-Refs von `hub.git` und die Remote-Tracking-Refs der übrigen Arbeitskopien unter `<BACKE_HOME>/backlogs/<backlog>/`, vergleicht nach 250 ms Ruhe deren Werte mit dem letzten Blick und meldet nur eine Bewegung, die die eigene Arbeitskopie noch nicht kennt; `LiveBacklog` startet darauf `scheduleSync` (das `sync.mode`, Remote und Arbeitskopie selbst prüft) und lässt sein Sicherheitsnetz auch über die Nachbarn laufen. Damit der Client »jemand anderes« erkennt, trägt ein Patch je geändertem Issue die Handles aus `Backe-Actor` der Commits, die es geändert haben (`actors`). Client: reine Regeln in `web/src/app/notes.ts`, `Session.onApplied` liefert Patch und Vorher-Stand, ein `Notifier` über der Sitzung zeigt Notifications über eine schmale Hülle um die Browser-API; der Schalter liegt in `UiPrefs` und im Abschnitt Oberfläche.

**Tech Stack:** wie U10. Keine neue Abhängigkeit.

**Spec:** `docs/proposals/ui.md` §2.4.1 Punkt 3 und 5, §2.4.2, §2.4.3 (Patch-Form), §2.10 »Oberfläche« und »Browser-Benachrichtigungen«, §5 »Live-Updates« (»Write eines zweiten Handles in seinem Clone über den lokalen Hub → `patch` ohne Warten auf `pull_interval`«); BK `docs/proposals/backe.md` §2.16.1 (Hub, Arbeitskopien unter `<BACKE_HOME>/backlogs/<backlog>/`), §2.16.2 (Hintergrund-Sync, `sync.mode`), §2.16.4 (Konflikte). Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (U11, Global Constraints, Review Focus 2). ui.md ist `in Umsetzung`.

## Global Constraints

Alle Global Constraints des Gesamtplans und der Pläne U1–U10. Dazu für U11:

- Nachbar-Debounce 250 ms als `LIVE_TIMING.neighborMs` in `src/ui/live.ts`; Sicherheitsnetz 10 s (`safetyMs`) und Watcher-Ende 30 s (`lingerMs`) gelten auch für die Nachbar-Watches.
- Beobachtet wird nur bei eigener Arbeitskopie (`hasOwnCopy`). Ob eine Bewegung eine Runde startet, entscheidet `scheduleSync(ctx, 'periodic', deps.sync)` aus `src/services/schedule.ts`: nur bei wirksamem `sync.mode: auto` (`effectiveMode`), vorhandenem Git-Remote `sync.remote` und Arbeitskopie; ohne Prüfung von `pull_interval`.
- Nachbarn sind die direkten Unterverzeichnisse von `<BACKE_HOME>/backlogs/<backlog>/`: `hub.git` (Ref `refs/heads/<sync.branch>`) und jede andere Git-Arbeitskopie (Ref `refs/remotes/<sync.remote>/<sync.branch>`), nie die eigene (`root` des Kontexts, verglichen nach `physicalPath`). Gebundene Arbeitskopien anderswo zählen nicht (ui.md §2.4.1 Punkt 3 nennt nur dieses Verzeichnis).
- Watches wie U2 über `WatchFn` (Test-Hook, kein Test-Flag im Produktionscode): je Nachbar `refs/` unter dem Common-Dir rekursiv (gefiltert auf `heads/` bzw. `remotes/`) und das Common-Dir flach (gefiltert auf `packed-refs`, `packed-refs.lock`), dazu das Backlog-Verzeichnis flach.
- Tests mit `fakeTimers()` aus `test/helpers/live.ts`; Git und `fs.watch` echt, Warten per `vi.waitFor`. Ein Hintergrund-Sync startet in Tests nie einen Prozess: `deps.sync.spawn` ist ein `vi.fn()` oder ruft `runBackground(ctx, { spawn: () => {} })` in-process.
- Benachrichtigungen nur nach `Notification.permission === 'granted'` und eingeschaltetem Schalter; Schalter-Default aus. `localStorage`-Key `backe-ui-notifications` (`'on'` an, sonst aus), Zugriff nur über `lib/storage.ts`.
- Neue Texte en + de: `web/src/views/settings.messages.ts` (Schalter), `web/src/app/notes.messages.ts` (Inhalte der Benachrichtigungen). Handles, IDs und Konflikt-Subjects bleiben roh.
- Initialer Chunk ≤ 300 KB gzip (`scripts/check-ui-build.ts`); der Notifier liegt im Hauptchunk und bringt keine Abhängigkeit mit.

## Festlegungen für U11

| Stelle | Festlegung |
| --- | --- |
| »Bewegt sich einer« | Nach 250 ms Ruhe liest `check()` die Werte aller Nachbar-Refs (`git rev-parse --verify -q`); bewegt hat sich ein Ref, dessen Wert vom letzten Blick abweicht und keinen Vorfahren von `HEAD` der eigenen Arbeitskopie bezeichnet (`isAncestor`; fehlt das Objekt dort, gilt er als unbekannt). Der eigene Push in den Hub startet so keine Runde. Auch der erste Blick zählt so: Liegt ein Nachbar beim Start der Watch oder beim Entdecken schon vor der eigenen Arbeitskopie, startet er eine Runde; ein bekannter erster Wert wird nur festgehalten. |
| Neue Nachbarn | Ereignisse im Backlog-Verzeichnis (ein Agent bekommt seine Arbeitskopie, der Hub entsteht) und jeder `check()` lesen die Einträge neu; neue Nachbarn bekommen Watches, verschwundene verlieren sie. |
| Sicherheitsnetz | Der 10-s-Takt des `LiveBacklog` ruft zusätzlich `neighbors.check()` (ohne Debounce). |
| `actors` im Patch | `actors?: Record<string, string[]>` — Issue-ID → Handles aus `Backe-Actor` der Commits zwischen altem und neuem `head`, die Pfade unter `issues/<shard>/<id>/` ändern; sortiert, ohne Doppelte; nur für Issues, die im Patch stehen (`upsert.issues`, `remove.issues`, `touched`); fehlt, wenn leer. Hand-Edits im Arbeitsbaum haben keine Actors. Kommt eine Bewegung von `HEAD` erst eine Runde später als Patch heraus (kaputter Stand dazwischen), reisen ihre Actors mit. |
| Wann gemeldet wird | Nur Patches, nie `/state` (Laden, `reset`). Ein Issue zählt, wenn `actors[id]` einen Handle ≠ ich enthält: `assigned`, wenn der Assignee vorher nicht ich war und danach ich ist; `deleted`, wenn es verschwindet und vorher mir gehörte; sonst `changed`, wenn es vorher oder nachher mir gehört (Felder, Body, Kommentare, Anhänge). Konflikte: jede Konflikt-ID im Sync-Status, die der Notifier seit seinem Start nicht kannte; der erste gesehene Status ist die Grundlinie. |
| Bündeln | Mehr als 3 Issue-Meldungen aus einem Patch → eine Sammelmeldung (»n Issues geändert«), Klick öffnet den Tab Backlog mit `?state=all&assignee=<ich>` (ein gezähltes Issue kann inzwischen geschlossen sein). |
| Klick | `window.focus()`, Issue-Meldung → Issue-Tab, Konflikt → `/b/<b>/settings/backlog`. `tag` = `backe:<backlog>:<id>`, damit ein zweites Ereignis desselben Issues das erste ersetzt. |
| Schalter | Abschnitt Oberfläche, Checkbox »Browser-Benachrichtigungen«. Einschalten fragt bei `permission: 'default'` per `Notification.requestPermission()` und schaltet nur bei `granted` ein. `denied` oder fehlende API: Checkbox gesperrt, Hinweis nennt den Grund. Angezeigt wird `prefs.notifications && permission === 'granted'`. |
| Ohne Identität | `me === null` (kein Handle) → kein Notifier. Ohne Schreibrecht meldet er trotzdem (Lesen und Live-Updates gehen). |

## Review Focus

1. **Burst und verlorene Ereignisse bei Nachbarn** — ein Agent schreibt 30-mal und pusht nach jedem dritten Write in den Hub, dazwischen `git pack-refs --all` im Hub; einmal sind alle Nachbar-Ereignisse verschluckt. Erwartet: Nach Ruhe ist der Zustand aus `/state` + allen Patches gleich einem frischen `/state`, höchstens eine Runde je Ruhephase von 250 ms; das Sicherheitsnetz startet nach 10 s die Runde, die das verlorene Ereignis hätte starten sollen. → Task 4 `neighbour pushes converge to a fresh state after a burst`, `the safety net catches a lost neighbour push`.
2. **Eigener Push als Echo** — die UI-Identität schreibt und pusht in den Hub. Erwartet: kein weiterer Sync-Start durch die eigene Hub-Bewegung. → Task 3 `a ref the own copy already has is no move`.
3. **Modus `manual`** — `sync.mode: manual` in der User-Config des Backlogs. Erwartet: Nachbar-Push startet nichts, die Änderung kommt erst mit dem nächsten Sync. → Task 4 `manual mode starts no neighbour sync`.
4. **Nachbar entsteht oder verschwindet während des Beobachtens** — Hub und Agent-Arbeitskopie entstehen nach dem Start; eine Arbeitskopie wird gelöscht. Erwartet: neue werden beobachtet, gelöschte werfen nicht, `close` hinterlässt keinen Watch und keinen Timer. → Task 3 `a neighbour that appears later is watched`, `a vanished neighbour is dropped`.
5. **Eigene Änderung, fremde Änderung, Nachladen** — eigener Write (UI oder CLI derselben Identität), fremder Kommentar an meinem Issue, `reset` mit neu geladenem Zustand, Patch-Flut mit 10 Issues. Erwartet: keine Meldung für Eigenes und fürs Laden, eine für den fremden Kommentar, eine Sammelmeldung für die Flut. → Task 6 `own changes and loads are never notes`, Task 7 `more than three notes become one summary`.

---

### Task 1: Listener-Leck in `streamRequest`

**Files:**
- Modify: `test/helpers/ui.ts` (`streamRequest`, Schreibschleife)

`r.once('drain', done); r.once('close', done)` lässt bei jedem vollen Puffer den jeweils anderen Listener stehen; ab elf Chunks mit Gegendruck meldet Node `MaxListenersExceededWarning` (ausgelöst von `a chunked json body over the limit is 400 …` in `src/ui/write-api.test.ts`). Das ist ein echtes Leck im Helper, nicht im Server.

- [x] **Step 1:** `pnpm vitest run src/ui/write-api.test.ts 2>&1 | grep -c MaxListenersExceededWarning` → ≥ 1.
- [x] **Step 2:** Warten auf `drain` oder `close` so, dass nach dem ersten Ereignis beide Listener weg sind (beide per `off` entfernen).
- [x] **Step 3:** Befehl aus Step 1 → 0; `pnpm vitest run src/ui` → PASS.
- [x] **Step 4: Commit** `test: streamRequest räumt seine Drain- und Close-Listener ab`

---

### Task 2: Actors im Patch

**Files:**
- Create: `src/ui/actors.ts`, `src/ui/actors.test.ts`
- Modify: `src/ui/delta.ts` (`issueOfPath`), `src/ui/delta.test.ts`, `src/ui/api.ts` (`PatchJson.actors`), `src/ui/live.ts` (`#refresh`), `src/ui/live.test.ts`

**Interfaces:**
- Produces:

```ts
// src/ui/api.ts, in PatchJson
/** Issue → Handles (`Backe-Actor`) der Commits, die es in diesem Patch geändert haben; fehlt, wenn leer. */
actors?: Record<string, string[]>;
// src/ui/delta.ts (rein)
/** `issues/<shard>/<id>/…` → `<id>`, sonst `undefined`. */
export function issueOfPath(path: string): string | undefined;
// src/ui/actors.ts
/** Issue → Handles aus `Backe-Actor` der Commits in `from..to` unter `issues/`; leer bei `from === to`. */
export async function issueActors(root: string, from: string, to: string): Promise<Map<string, Set<string>>>;
```

`issueActors`: ein `git -c log.showSignature=false log -z --no-renames --name-only --format=%x01%(trailers:key=Backe-Actor,valueonly,separator=%x02) --end-of-options <from>..<to> -- issues/`. Die Ausgabe je Commit ist `\x01<actors>\0\n<pfad>\0<pfad>\0…`. In `LiveBacklog.#refresh` bei bewegtem `HEAD` vor dem Setzen von `#head` aufrufen (Fehler → keine Actors), in `#actors` (Map) sammeln und beim nächsten Patch auf dessen Issues beschränkt anhängen; nach jedem Vergleich (`diffTables`), auch ohne Patch, leeren. `actors` allein macht keinen Patch.

- [x] **Step 1: Failing tests**

```ts
// delta.test.ts
test('issueOfPath reads every path below an issue', () => {
  expect(issueOfPath('issues/7f/bk-7f3k2/issue.md')).toBe('bk-7f3k2');
  expect(issueOfPath('issues/7f/bk-7f3k2/comments/x.md')).toBe('bk-7f3k2');
  expect(issueOfPath('issues/7f')).toBeUndefined();
  expect(issueOfPath('projects/a.md')).toBeUndefined();
});
// actors.test.ts — Backlog aus testBacklog(), Commits per rawCommit (test/helpers/git.ts) mit actor 'claude-1' bzw. 'spw'
test('actors come from the commits between two heads', …Map {id1 → {'claude-1','spw'}, id2 → {'spw'}});
test('the same head has no actors', …issueActors(root, h, h) → leere Map);
// live.test.ts
test('a patch names the actors of its issues', …create → patch.actors == {[id]: ['spw']});
test('a hand edit has no actors', …writeFile auf issue.md → patch ohne 'actors');
```

- [x] **Step 2:** `pnpm vitest run src/ui/delta.test.ts src/ui/actors.test.ts src/ui/live.test.ts` → FAIL.
- [x] **Step 3:** Implementieren wie oben.
- [x] **Step 4:** Dieselben Tests → PASS; `pnpm vitest run src/ui` → PASS (bestehende Patch-Erwartungen mit `toEqual` um `actors` ergänzen, wo ein Commit dahintersteht).
- [x] **Step 5: Commit** `feat: Patches von backe ui nennen, wer ein Issue geändert hat`

---

### Task 3: Nachbar-Watch

**Files:**
- Create: `src/ui/neighbors.ts`, `src/ui/neighbors.test.ts`
- Modify: `src/ui/live.ts` (`LIVE_TIMING.neighborMs: 250`)

**Interfaces:**
- Consumes: `WatchFn`, `fsWatch`, `gitDirs` (`src/ui/watch.ts`); `isAncestor` (`src/git/history.ts`); `physicalPath` (wie in `src/services/working-copy.ts`).
- Produces:

```ts
export type NeighborOptions = {
  /** `<BACKE_HOME>/backlogs/<backlog>` */
  backlogDir: string;
  /** Die eigene Arbeitskopie; zählt nie als Nachbar und entscheidet, was schon bekannt ist. */
  own: string;
  remote: string;
  branch: string;
  watch?: WatchFn;
  /** Höchstens einmal je `check`, wenn sich ein Nachbar-Ref auf einen unbekannten Stand bewegt hat. */
  onMove: () => void;
};
export class NeighborWatch {
  /** Öffnet die Watches und macht den ersten Durchlauf; ein fehlendes Backlog-Verzeichnis ist kein Fehler. */
  static start(opts: NeighborOptions): Promise<NeighborWatch>;
  /** Nachbarn neu lesen, Refs vergleichen; Single-Flight mit Nachlauf. Wirft nie. */
  check(): Promise<void>;
  /** Watches und Debounce-Timer abbauen; danach meldet `onMove` nie mehr. Erfüllt sich nach einem laufenden `check`. */
  close(): Promise<void>;
}
```

Ereignisse starten nach `LIVE_TIMING.neighborMs` Ruhe (`clearTimeout`/`setTimeout`) einen `check()`.

- [x] **Step 1: Failing tests** (echtes Git; eine aufzeichnende `WatchFn`, deren Listener der Test selbst auslöst, für die Timing-Tests; ein Test mit `fsWatch`). Aufbau: `testBacklog()`, Agent `claude-1` per `ensureWorkingCopy` (legt den Hub an, `src/services/working-copy.test.ts` »… goes through the local hub«); Agent-Writes per `writeOp(agentCtx, …)`, Push per `syncNow(agentCtx, { spawn: () => {} })`.

```ts
test('a hub move starts one check after 250 ms', …Agent pusht; Listener von hub.git/refs auslösen; advance 249 → onMove 0×; advance 1 → waitFor onMove 1×);
test('events during the debounce collapse into one move', …drei Auslösungen im Abstand 100 ms → onMove 1×);
test('a tracking ref of a neighbour counts as a move', …twoClones(): Agent pusht ins bare Remote; Listener von <agent>/.git/refs mit 'remotes/origin/main' → onMove 1×);
test('a ref the own copy already has is no move', …spw schreibt und pusht in den Hub (syncNow(ctx)); check() → onMove 0×);
test('neighbour refs other than the tracking ref are ignored', …Agent schreibt ohne Push (refs/heads bewegt); check() → onMove 0×);
test('a neighbour that appears later is watched', …Start ohne Agent (kein Hub); dann ensureWorkingCopy + Push; Listener des Backlog-Verzeichnisses auslösen → nach 250 ms onMove 1×; die WatchFn hat danach Watches auf hub.git/refs und <agent>/.git/refs);
test('a vanished neighbour is dropped', …Agent-Verzeichnis löschen; check() wirft nicht; Watches darauf geschlossen);
test('a real push in the hub reaches onMove', …fsWatch; Agent pusht; advance per vi.waitFor in 250-ms-Schritten → onMove ≥ 1×);
test('close leaves no watch and no timer', …Auslösen, close, advance 250 → onMove 0×; jedes geöffnete Handle geschlossen; vi.getTimerCount() == 0);
```

- [x] **Step 2:** `pnpm vitest run src/ui/neighbors.test.ts` → FAIL.
- [x] **Step 3:** Implementieren.
- [x] **Step 4:** → PASS.
- [x] **Step 5: Commit** `feat: backe ui beobachtet Hub und Arbeitskopien der Nachbarn`

---

### Task 4: Nachbarn im `LiveBacklog`

**Files:**
- Modify: `src/ui/live.ts` (`#open`, Sicherheitsnetz, `#teardown`), `src/ui/live.test.ts`

**Interfaces:**
- Consumes: `NeighborWatch` (Task 3); `scheduleSync` (`src/services/background.ts`); `requireHeadConfig` (`src/services/write.ts`) für `sync.remote`/`sync.branch`.
- Produces: keine neue öffentliche Oberfläche; `LiveDeps.sync.spawn` startet auch die Nachbar-Runde.

Bei eigener Arbeitskopie nach den Watchern der Arbeitskopie und vor dem Laden von `HEAD` starten (`backlogDir = join(ctx.homes.backeHome, 'backlogs', ctx.backlog.value)`), `onMove` → `void scheduleSync(ctx, 'periodic', deps.sync)`, sofern nicht beendet. Das Intervall des Sicherheitsnetzes ruft zusätzlich `void this.#neighbors?.check()`. `#teardown` schließt die Nachbar-Watch.

- [x] **Step 1: Failing tests**

```ts
const inProcess = (c: () => ResolvedContext) => vi.fn(() => void runBackground(c(), { spawn: () => {} }));
test('a neighbour write arrives as a patch without waiting for pull_interval', …setPullInterval(b, 3600); Agent schreibt »Vom Agent« und pusht; Live mit sync.spawn = inProcess; waitFor (Timer je Runde um 250 ms vorspulen) → ein Patch mit upsert.issues[0].title 'Vom Agent' und actors {[id]: ['claude-1']});
test('manual mode starts no neighbour sync', …User-Config backlogs.acme.sync.mode 'manual' (setUserConfig o. ä. wie in src/services/background.test.ts); Agent pusht; advance 250 + settle → spawn 0×);
test('neighbour pushes converge to a fresh state after a burst', …30 Agent-Writes, Push nach jedem dritten, einmal `git pack-refs --all` im Hub; inProcess-Spawn; danach Ruhe → applyPatch-Faltung == comparable(stateJson(ctx)); spawn ≤ 10×, 60_000 ms Timeout);
test('the safety net catches a lost neighbour push', …watch verschluckt alles unter backlogDir; Agent pusht; advance 250 → spawn 0×; advance safetyMs → waitFor spawn 1×);
test('a stopped watcher starts no neighbour sync', …Agent pusht, live.stop() vor Ablauf der 250 ms → spawn 0×);
```

- [x] **Step 2:** `pnpm vitest run src/ui/live.test.ts` → FAIL.
- [x] **Step 3:** Implementieren.
- [x] **Step 4:** `pnpm vitest run src/ui` → PASS.
- [x] **Step 5: Commit** `feat: Ein Push eines Nachbarn startet den Sync von backe ui`

---

### Task 5: Schalter für Benachrichtigungen

**Files:**
- Create: `web/src/app/browser-notes.ts`, `web/src/app/browser-notes.test.ts`, `web/src/test/notifications.ts`
- Modify: `web/src/app/ui-prefs.ts`, `web/src/app/ui-prefs.test.ts`, `web/src/components/settings/InterfaceSection.tsx`, `web/src/components/settings/InterfaceSection.test.tsx`, `web/src/views/settings.messages.ts`

**Interfaces:**
- Produces:

```ts
// ui-prefs.ts
export const NOTIFICATIONS_KEY = 'backe-ui-notifications';
readonly notifications: Signal<boolean>;   // 'on' → true, sonst false
setNotifications(on: boolean): void;
// browser-notes.ts
export type NotePermission = 'unsupported' | 'default' | 'granted' | 'denied';
export function notePermission(): NotePermission;
/** Fragt nur bei 'default'; sonst die aktuelle Erlaubnis. */
export function requestNotePermission(): Promise<NotePermission>;
export type ShowNote = (n: { title: string; body: string; tag: string; onClick: () => void }) => void;
/** `new Notification(title, {body, tag})`, nur bei 'granted'; Klick → window.focus(), onClick(), close(). */
export const showBrowserNote: ShowNote;
// test/notifications.ts
/** Ersetzt `globalThis.Notification` bis zum Abbau; `shown` sammelt erzeugte Meldungen. */
export function installNotifications(opts: { permission: NotificationPermission | 'missing'; answer?: NotificationPermission }):
  { shown: { title: string; body: string; tag: string; click(): void }[]; requests: number; uninstall(): void };
```

Texte (en / de): `notifications` »Browser notifications« / »Browser-Benachrichtigungen«; `notificationsHint` »While this page is open: an issue is assigned to you, someone else changes one of your issues, or a new sync conflict appears.« / »Solange diese Seite offen ist: Ein Issue wird dir zugewiesen, jemand anderes ändert eines deiner Issues, oder ein neuer Sync-Konflikt entsteht.«; `notificationsDenied` »Blocked by the browser; allow notifications for this site in its settings.« / »Vom Browser blockiert; erlaube Benachrichtigungen für diese Seite in seinen Einstellungen.«; `notificationsUnsupported` »This browser has no notifications.« / »Dieser Browser kann keine Benachrichtigungen.«

- [x] **Step 1: Failing tests**

```ts
// ui-prefs.test.ts
test('notifications are off until switched on', …default false; setNotifications(true) → localStorage 'on'; neue UiPrefs → true; 'kaputt' → false);
// browser-notes.test.ts
test('permission and request follow the browser', …missing → 'unsupported'; default + answer granted → request → 'granted', requests 1; denied → request → 'denied', requests 0);
test('a note shows only with permission and clicks through', …granted: show → shown[0] {title, body, tag}; click → onClick 1×, window.focus aufgerufen; denied: show → shown leer);
// InterfaceSection.test.tsx
test('switching notifications on asks the browser first', …permission default, answer granted: Checkbox aus, Klick → requests 1, prefs.notifications true, Checkbox an, Beschreibung m.notificationsHint);
test('a refused permission keeps notifications off', …answer denied: Klick → prefs.notifications false, Checkbox gesperrt, Beschreibung enthält m.notificationsDenied);
test('without the api the switch is disabled', …missing → disabled, m.notificationsUnsupported);
test('a stored switch without permission shows off', …localStorage 'on', permission denied → Checkbox nicht angehakt);
```

- [x] **Step 2:** `pnpm vitest run --project web web/src/app/ui-prefs.test.ts web/src/app/browser-notes.test.ts web/src/components/settings/InterfaceSection.test.tsx` → FAIL.
- [x] **Step 3:** Implementieren; die Erlaubnis hält `InterfaceSection` als lokalen React-State (`useState(notePermission)`), gesetzt nach `requestNotePermission`.
- [x] **Step 4:** → PASS.
- [x] **Step 5: Commit** `feat: Schalter für Browser-Benachrichtigungen in den Settings`

---

### Task 6: Regeln und Vorher-Stand

**Files:**
- Create: `web/src/app/notes.ts`, `web/src/app/notes.test.ts`
- Modify: `web/src/data/session.ts` (`onApplied`), `web/src/data/session.test.ts`

**Interfaces:**
- Produces:

```ts
// notes.ts (rein)
export type Note =
  | { kind: 'assigned' | 'changed' | 'deleted'; id: string; title: string; by: string[] }
  | { kind: 'conflict'; id: string; title: string };
/** Meldungen eines Patches für `me`; `before` liefert den Serverstand vor dem Patch. */
export function issueNotes(patch: PatchJson, before: (id: string) => IssueJson | undefined, me: string): Note[];
/** Konflikte, die nicht in `known` stehen; `known` danach alle aktuellen IDs. */
export function conflictNotes(known: ReadonlySet<string>, sync: Record<string, unknown> | null):
  { notes: Note[]; known: Set<string> };
// session.ts, in Session
/** Nach jedem angewendeten Patch (auch aus dem Puffer), mit dem Serverstand der betroffenen Issues davor. */
onApplied(listener: (patch: PatchJson, before: ReadonlyMap<string, IssueJson | undefined>) => void): () => void;
```

`by` = `actors[id]` ohne `me`, sortiert. `before` in `onApplied` nimmt `store.issues.server(id)` (ohne Überlagerung) für alle IDs aus `upsert.issues`, `remove.issues` und `touched`, bevor `applyPatch` läuft; `stale` und `gap` melden nichts. `conflictNotes` liest Konflikte über `syncStatusView` (`web/src/app/sync-status.ts`).

- [x] **Step 1: Failing tests**

```ts
// notes.test.ts — me = 'spw'
test('an issue assigned to me by someone else', …before assignee undefined, upsert assignee 'spw', actors ['claude-1'] → [{kind:'assigned', id, title, by:['claude-1']}]);
test('someone else changes or comments my issue', …upsert mit neuem Titel → 'changed'; nur touched mit actors ['claude-1'] → 'changed' mit Titel aus before);
test('my issue deleted or reassigned by someone else', …remove → 'deleted'; assignee spw → 'claude-1' → 'changed');
test('own changes and loads are never notes', …actors ['spw'] → []; ohne actors → []; fremdes Issue ohne mich als Assignee → []);
test('new conflicts only', …known leer + 2 Konflikte → 2 notes {kind:'conflict', id, title: subject}; dieselben noch einmal → []; null → [] und known leer);
// session.test.ts
test('onApplied gets the patch and the server state before it', …Overlay auf bk-t0001; Patch ändert Titel → before.get('bk-t0001').title alter Server-Titel; stale-Patch → kein Aufruf);
test('patches drained after a load reach onApplied', …Patch während des Ladens → nach Laden genau ein Aufruf);
```

- [x] **Step 2:** `pnpm vitest run --project web web/src/app/notes.test.ts web/src/data/session.test.ts` → FAIL.
- [x] **Step 3:** Implementieren.
- [x] **Step 4:** → PASS.
- [x] **Step 5: Commit** `feat: Regeln für Benachrichtigungen aus Patches und Sync-Status`

---

### Task 7: Notifier in der App

**Files:**
- Create: `web/src/app/notifier.ts`, `web/src/app/notifier.test.ts`, `web/src/app/notes.messages.ts`
- Modify: `web/src/components/App.tsx`, `web/src/components/App.test.tsx`

**Interfaces:**
- Consumes: `Session.onApplied`, `issueNotes`, `conflictNotes` (Task 6); `ShowNote`, `showBrowserNote`, `notePermission` (Task 5); `routeHref`, `Router.navigate`.
- Produces:

```ts
export const NOTE_SUMMARY_AFTER = 3;
export function attachNotifier(session: Session, opts: { me: string; show: ShowNote; open: (href: string) => void }): () => void;
```

Konflikte über ein Effect auf `session.store.sync` (signalize, `attach` an einen eigenen Owner, Abbau per `SignalGroup.delete`), der erste Wert ist die Grundlinie. In `App`: ein Effect hängt `attachNotifier` an, solange `session`, `current.user !== null` und `prefs.notifications` gelten (`useSignal(prefs.notifications)`), mit `show: showBrowserNote`, `open: router.navigate`; Test-Hook ist eine optionale Prop `notify?: ShowNote` an `App`, Default `showBrowserNote`.

Texte (en / de), Titel `<id> <title>` bzw. für Konflikte `syncConflict`: `assigned(by)` »Assigned to you by {by}« / »Dir zugewiesen von {by}«; `changed(by)` »Changed by {by}« / »Geändert von {by}«; `deleted(by)` »Deleted by {by}« / »Gelöscht von {by}«; `syncConflict` »Sync conflict« / »Sync-Konflikt«; `summaryTitle(n)` »{n} of your issues changed« / »{n} deiner Issues geändert«; `summaryBody(by)` »By {by}« / »Von {by}«. `by` mit `, ` verbunden.

- [x] **Step 1: Failing tests**

```ts
// notifier.test.ts — Session aus web/src/test/session-harness.ts
test('a foreign assignment shows a note that opens the issue', …show 1× {title: 'bk-t0001 Issue 1', body: m.assigned('claude-1'), tag: 'backe:main:bk-t0001'}; onClick → open('/b/main/issue/bk-t0001'));
test('more than three notes become one summary', …Patch mit 4 fremd zugewiesenen Issues → show 1× mit m.summaryTitle(4), onClick → open('/b/main?assignee=spw'));
test('a new sync conflict shows a note, the first status none', …state.sync mit 1 Konflikt → 0×; sync-Ereignis mit 2. Konflikt → 1× m.syncConflict, Body = subject, onClick → open('/b/main/settings/backlog'));
test('detached notifier stays silent', …off(); Patch → 0×);
// App.test.tsx
test('notifications follow the switch', …installNotifications granted; prefs.setNotifications(true); Patch mit fremder Zuweisung → shown 1×; setNotifications(false); weiterer Patch → shown bleibt 1);
```

- [x] **Step 2:** `pnpm vitest run --project web web/src/app/notifier.test.ts web/src/components/App.test.tsx` → FAIL.
- [x] **Step 3:** Implementieren.
- [x] **Step 4:** `pnpm vitest run --project web` → PASS; `pnpm build && pnpm tsx scripts/check-ui-build.ts` (bzw. das Skript aus `mise run check`) → initialer Chunk ≤ 307 200 B.
- [x] **Step 5: Commit** `feat: Browser-Benachrichtigungen für zugewiesene, fremd geänderte Issues und Konflikte`

---

### Task 8: Docs, Roadmap, Abnahme

- [x] ui.md: Status-Satz (§2.4 vollständig, §2.10 vollständig; offen nur noch, was U12 betrifft); §2.4.1 Punkt 3 als Gegenwart nach »Festlegungen für U11« (Wertvergleich, eigener Stand zählt nicht, neue Nachbarn, Watches, Sicherheitsnetz auch über Nachbarn, Prüfung des Modus beim Start der Runde); §2.4.3 Patch-Zeile um `actors?`; §2.10 »Browser-Benachrichtigungen« um Regeln, Bündeln, Klick und Schalter; §5 Live-Updates bleibt.
- [x] `ROADMAP.md`: »Nachbarn und Benachrichtigungen« abhaken.
- [x] Gesamtplan U11: Zeile »Produziert«.
- [x] Sichtprüfung im Browser (Playwright-MCP): Demo-Backlog unter Temp-`BACKE_HOME`, Agent mit eigener Arbeitskopie, `backe ui --port 0`; CLI-Write des Agents kommt ohne manuellen Sync live an; nach Zustimmung erscheint die Benachrichtigung für eine fremde Zuweisung. Server danach beenden, `.playwright-mcp` im Haupt-Checkout entfernen.
- [x] `mise run check`, `mise run smoke` grün.
- [x] **Commit** `docs: Nachbarn und Benachrichtigungen in ui.md, Roadmap und Gesamtplan`

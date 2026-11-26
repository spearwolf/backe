# backe ui U2 — Live-Kern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Für jedes abonnierte Backlog beobachtet `backe ui` die eigene Arbeitskopie (Refs, Arbeitsbaum, Sync-Zustand), schreibt seinen Snapshot per Delta fort und liefert die Änderungen als Server-Sent Events (`hello`, `patch`, `sync`, `reset`) mit Puffer, Wiederaufnahme per `Last-Event-ID`, Heartbeat und Ende 30 s nach dem letzten Abonnenten.

**Architecture:** Drei Schichten in `src/ui/`. `delta.ts` ist rein: Entitäts-JSON je Snapshot als Tabelle, Vergleich zweier Tabellen zu einem Patch, Pfad-Klassifikation. `watch.ts` kapselt `fs.watch` hinter einer injizierbaren `WatchFn` (Test-Hook) und meldet drei Signale: Ref bewegt, Pfade im Arbeitsbaum, Sync-Zustand. `live.ts` hält je Backlog einen `LiveBacklog` (Snapshot, Tabelle, `head`, `rev`, Ring-Puffer, Sync-JSON) und einen `LiveHub` je Serverprozess (`boot`, Lebensdauer, `rev` über Neustarts eines Watchers hinweg). `events.ts` schreibt den SSE-Strom. Die Verarbeitung ist ein Single-Flight mit Nachlauf: Ereignisse setzen nur Flags, eine Schleife arbeitet sie nacheinander ab — so verschmelzen Bursts, und kein Patch überholt einen anderen.

**Tech Stack:** unverändert. Keine neue Abhängigkeit.

**Spec:** `docs/proposals/ui.md` §2.4.1 Punkte 1, 2, 4, 5 und »Sync-Zustand«; §2.4.2; §2.4.3; §2.3.1 Zeile `events`; dazu `docs/proposals/backe.md` §2.16.1 (Schreibpfad: Dateien vor Ref), §2.16.2 (Sync-Dateien), §2.19 (»Hintergrund-Sync«). Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (Global Constraints, Festlegung »Event-ID«). ui.md ist `in Umsetzung`.

## Global Constraints

Alle Global Constraints des Gesamtplans und des U1-Plans. Dazu für U2:

- Zeitkonstanten wörtlich und an einer Stelle (`LIVE_TIMING` in `src/ui/live.ts`): Arbeitsbaum-Debounce 150 ms, Sicherheitsnetz 10 s, Heartbeat 15 s, Ende 30 s nach dem letzten Abonnenten, Puffer 200 Patches.
- Tests nutzen `vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })`: Timer sind fake, Git-Prozesse und `fs.watch` laufen echt. `Date` bleibt echt, weil Writes daraus Commit-Zeitstempel und Kommentar-Dateinamen bilden. Gewartet wird auf I/O per `vi.waitFor`, nie per `sleep` und nie per Last.
- Der Test-Hook ist `WatchFn` (`src/ui/watch.ts`): Tests reichen eine Funktion durch, die Ereignisse eines Pfads unterdrückt oder alle verschluckt. Kein Flag im Produktionscode, das nur Tests kennen.
- `src/ui/delta.ts` und die neuen Typen in `src/ui/api.ts` sind rein (kein `node:`, kein I/O); `api.ts` bleibt in `WEB_ENTRIES`.
- Patches tragen nur Sichtbares: Entitäten als vollständiges JSON (dieselbe Form wie in `/state`), `remove` als Keys, `problems` als vollständige Liste, wenn sie sich ändert. Kein Patch, wenn sich nichts Sichtbares ändert — auch nicht, wenn nur `head` wandert.
- Fehler beim Fortschreiben (kaputte `backlog.jsonc`, Git-Fehler, verschwundene Datei) beenden weder Watcher noch Server: Der Snapshot bleibt, wie er war, und die nächste Runde lädt vollständig neu.

## Festlegungen für U2

| Stelle | Festlegung |
| --- | --- |
| Was beobachtet wird | `root` des Kontexts (`ctx.backlog.root`), also dieselbe Arbeitskopie, aus der `/state` liest. Refs unter `--git-common-dir` (`refs/heads/` rekursiv, `packed-refs`), `HEAD` unter `--git-dir`; Sync-Dateien unter `stateDir(root)` nur bei eigener Arbeitskopie (dieselbe Bedingung wie `sync` ≠ `null` in `/state`). |
| Reihenfolge beim Verbinden | `hello {rev, head}` kommt immer zuerst. Mit gültiger `Last-Event-ID` folgen die verpassten Patches in Reihenfolge, sonst bei ungültiger `reset`. Danach ein `sync` mit dem aktuellen Zustand, falls es einen gibt. |
| Client-Protokoll | Der Client verbindet zuerst den Event-Stream und lädt `/state` nach `hello`. `/state.rev` liest der Server **vor** dem Laden von der Platte; der Zustand ist darum mindestens so neu wie `rev`. Patches mit `rev` ≤ `state.rev` verwirft der Client. |
| `rev` über Watcher-Neustarts | Der Hub merkt sich je Backlog den letzten `rev`. Ein neuer `LiveBacklog` beginnt bei `letzter + 1` mit leerem Puffer (erster bei 0). Eine `Last-Event-ID` aus der Zeit davor liegt damit außerhalb des Puffers → `reset`. |
| `/state.rev` | `rev` des laufenden `LiveBacklog`, sonst der letzte gemerkte, sonst 0. |
| IDs von `hello`, `sync`, `reset` | `<boot>:<rev>` mit dem aktuellen `rev`; nur `patch` erhöht `rev`, nur Patches liegen im Puffer. |
| Ref-Ereignisse | ohne Debounce; Single-Flight mit Nachlauf fasst Bursts zusammen. |
| Arbeitsbaum-Pfade | gefiltert auf `issues/`, `projects/`, `sprints/`, `repos/`, `users/`, `.backe/` (und nie `.git/`). Temp-Dateien von `writeFileAtomic` (`isAtomicTemp`) und Editor-Dateien zählen nicht. Ein Ereignis ohne Dateinamen, ein Pfad ohne `.md`-Endung außerhalb von `comments/`/`attachments/` oder eine Änderung an `.backe/backlog.jsonc` erzwingt ein vollständiges Neuladen (`loadSnapshot`); sonst `snapshotAt` mit den Pfaden plus `orphanedProjectPaths`. |
| `touched` | Issue-IDs aus Pfaden `issues/<shard>/<id>/comments[/…]` und `…/attachments[/…]`, deren Inhalt sich seit dem letzten Blick geändert hat (Hash), dazu Issues mit geändertem Body; sortiert. |
| Sync-Ereignis | nach jeder Änderung unter `stateDir` (entprellt 150 ms) und nach jeder Bewegung von `HEAD` (`unpushed`): `syncStatusJson(syncStatus(ctx))`, gesendet nur, wenn es sich vom zuletzt gesendeten unterscheidet. |
| Periodischer Sync | `startPeriodicSync(ctx, deps.sync)` beim Start eines `LiveBacklog`, Abbau mit seinem Ende. |
| Ende des Servers | `close()` baut alle `LiveBacklog`s ab (Watcher, Timer) und beendet die Event-Streams; ein Event-Stream meldet sich per `streaming(res)` und hält das Ende nicht auf. |

## Review Focus

1. **Burst und verlorene Ereignisse** — 50 schnelle Writes, `git pack-refs --all`, verschluckte `fs.watch`-Ereignisse. Erwartet: Nach Ruhe ist der Zustand aus `/state` + allen Patches gleich einem frischen `/state`. → Task 3 `patches converge to a fresh state after a burst`, `packed refs still move the head`, `the safety net catches a lost event`.
2. **Server-Neustart bei offenem Tab** — `Last-Event-ID` eines beendeten Prozesses, dessen `rev` der neue schon erreicht hat; `Last-Event-ID` aus einem früheren Watcher desselben Prozesses. Erwartet: `reset`, nie fremde Patches. → Task 4 `an event id from an earlier process gets reset`, `an event id from before a watcher restart gets reset`.
3. **Kaputter Stand** — Hand-Edit mit kaputtem Frontmatter, ungültige `.backe/backlog.jsonc`. Erwartet: `problems` im Patch bzw. kein Patch, der Watcher läuft weiter, der nächste gültige Stand kommt als Patch. → Task 3 `a broken hand edit becomes a problem, the fix a patch`, `a broken config keeps the last state until it is fixed`.
4. **Lebensdauer** — Client trennt, Server endet mit offenem Stream, Client liest nicht weiter. Erwartet: Watcher endet 30 s nach dem letzten Abonnenten, `close()` hängt nicht, keine Timer bleiben. → Task 4 `the watcher ends 30 s after the last subscriber`, `close ends open event streams`.

---

### Task 1: Reines Delta

**Files:**
- Create: `src/ui/delta.ts`, `src/ui/delta.test.ts`
- Modify: `src/ui/api.ts` (`PatchJson`, `ServerEvent`), `src/ui/state.ts` (Entitäts-JSON aus `delta.ts`)

**Interfaces:**

```ts
// api.ts
export type PatchJson = {
  rev: number; head: string;
  upsert: { issues?: IssueJson[]; projects?: ProjectJson[]; sprints?: SprintJson[];
            repos?: RepoJson[]; users?: UserJson[]; config?: StateJson['config'] };
  remove: { issues?: string[]; projects?: string[]; sprints?: string[]; repos?: string[]; users?: string[] };
  touched?: string[];
  problems?: ProblemJson[];
};
export type HelloJson = { rev: number; head: string };
export type ServerEvent =
  | { event: 'hello'; data: HelloJson } | { event: 'patch'; data: PatchJson }
  | { event: 'sync'; data: Record<string, unknown> } | { event: 'reset'; data: Record<string, never> };

// delta.ts
export type EntityTable = { /* je Art Map<key, {json, text}> */ config: string; problems: string; … };
export function entityTable(s: BacklogSnapshot): EntityTable;
export function diffTables(a: EntityTable, b: EntityTable, touched: readonly string[]):
  Omit<PatchJson, 'rev' | 'head'> | undefined;   // undefined = nichts Sichtbares
export function touchedIssues(paths: Iterable<string>): string[];
export function watchedPath(path: string): boolean;          // Präfixe, nie .git/
export function needsFullReload(path: string): boolean;      // Config, kein .md, Verzeichnis
```

`stateJson` baut `issues`/`projects`/… über dieselben Funktionen wie `entityTable`, damit Patch und `/state` dieselbe Form haben.

- [ ] **Step 1: Failing tests** in `delta.test.ts`: `an unchanged table is no patch`, `changed and new entities are upserts, missing ones removes`, `config changes upsert config and users with changed admin`, `problems come as a whole list when they change`, `touched alone makes a patch`, `touchedIssues reads comment and attachment paths`, `watchedPath filters to the backlog dirs`, `needsFullReload for config, directories and non-md paths`.
- [ ] **Step 2:** `pnpm vitest run src/ui/delta.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren; `state.ts` umstellen.
- [ ] **Step 4:** `pnpm vitest run src/ui` → PASS (auch `state.test.ts` unverändert).
- [ ] **Step 5: Commit** `feat: Delta zwischen zwei Snapshots für backe ui`

---

### Task 2: Watcher

**Files:**
- Create: `src/ui/watch.ts`, `src/ui/watch.test.ts`

**Interfaces:**

```ts
export type WatchFn = (path: string, opts: { recursive: boolean },
  listener: (filename: string | null) => void) => { close(): void };
export const fsWatch: WatchFn;   // node:fs watch; ENOENT beim Start → no-op-Handle
export type WatchSignals = { ref(): void; paths(paths: string[] | 'all'): void; sync(): void };
export type Watched = { close(): void };
/** Refs, HEAD, packed-refs, Arbeitsbaum (gefiltert, Pfade mit `/`), optional stateDir. */
export async function watchWorkingCopy(root: string, opts: { syncDir?: string; watch?: WatchFn },
  on: WatchSignals): Promise<Watched>;
export async function gitDirs(root: string): Promise<{ gitDir: string; commonDir: string }>;
```

- [ ] **Step 1: Failing tests** mit einer aufzeichnenden `WatchFn` (keine echten Ereignisse nötig): `watches refs, head and packed refs of the common dir`, `worktree events are filtered and relative`, `events without a filename mean all`, `head and packed-refs lock files count as ref events`, `sync dir events signal sync`, `close closes every handle`; ein Test mit echtem `fsWatch`: `a real write in refs/heads reaches the ref signal`.
- [ ] **Step 2–4:** rot, implementieren, grün.
- [ ] **Step 5: Commit** `feat: Watcher für Refs, Arbeitsbaum und Sync-Zustand von backe ui`

---

### Task 3: `LiveBacklog`

**Files:**
- Create: `src/ui/live.ts`, `src/ui/live.test.ts`, `test/helpers/live.ts` (Client-Modell: `applyPatch(state, patch)`, Vergleich ohne `rev`/`context`/`sync`)

**Interfaces:**

```ts
export const LIVE_TIMING = { debounceMs: 150, safetyMs: 10_000, heartbeatMs: 15_000,
  lingerMs: 30_000, buffer: 200 } as const;
export type LiveListener = (e: ServerEvent, id: string) => void;
export type LiveDeps = { watch?: WatchFn; sync?: SyncDeps };
export class LiveBacklog {
  static start(ctx: ResolvedContext, boot: string, firstRev: number, deps?: LiveDeps): Promise<LiveBacklog>;
  readonly rev: number; readonly head: string;
  /** Sendet hello, verpasste Patches oder reset, dann sync; liefert die Abmeldung. */
  subscribe(listener: LiveListener, lastEventId?: string): () => void;
  subscribers(): number;
  /** Wartet, bis keine Runde mehr läuft oder ansteht (Tests, Ende). */
  idle(): Promise<void>;
  stop(): Promise<void>;
}
```

- [ ] **Step 1: Failing tests** (echtes Git, Fake-Timer wie oben): `a cli write is exactly one patch`, `a hand edit is a patch, backe commit after it none`, `a deleted issue is a remove`, `comments and attachments mark the issue touched`, `a broken hand edit becomes a problem, the fix a patch`, `a broken config keeps the last state until it is fixed`, `patches converge to a fresh state after a burst` (50 Writes), `packed refs still move the head` (Ereignisse unter `refs/heads/` unterdrückt), `the safety net catches a lost event` (alle Ereignisse verschluckt, 10 s vorspulen), `sync state changes become sync events`, `periodic sync runs at pull_interval while watched` (`deps.sync.spawn`).
- [ ] **Step 2–4:** rot, implementieren, grün.
- [ ] **Step 5: Commit** `feat: LiveBacklog schreibt den Snapshot per Delta fort`

---

### Task 4: Hub, Event-Stream und Anbindung

**Files:**
- Create: `src/ui/events.ts`, `src/ui/events.test.ts`
- Modify: `src/ui/live.ts` (`LiveHub`), `src/ui/routes.ts` (`events`), `src/ui/read-api.ts` (`/state.rev`, `events`), `src/ui/server.ts` (Hub, `close`), `src/ui/routes.test.ts`, `test/helpers/ui.ts` (`events(path, headers)` als SSE-Leser)

**Interfaces:**

```ts
export class LiveHub {
  constructor(opts: { boot?: string; deps?: LiveDeps });
  readonly boot: string;              // 8 Hex-Zeichen
  acquire(backlog: string, ctx: () => Promise<ResolvedContext>): Promise<LiveBacklog>;
  revOf(backlog: string): number;
  close(): Promise<void>;
}
export function parseEventId(id: string | undefined): { boot: string; rev: number } | undefined;
export async function serveEvents(req, res, live: LiveBacklog): Promise<void>;
```

- [ ] **Step 1: Failing tests** über HTTP: `events stream hello first`, `a write arrives as a patch event with id boot:rev`, `reconnect with last-event-id replays missed patches`, `an event id outside the buffer gets reset`, `an event id from an earlier process gets reset`, `an event id from before a watcher restart gets reset`, `heartbeat every 15 s`, `the watcher ends 30 s after the last subscriber`, `state rev follows the live backlog`, `close ends open event streams`, `events of a backlog without working copy are 404`; `routes.test.ts`: `events route`.
- [ ] **Step 2–4:** rot, implementieren, grün.
- [ ] **Step 5: Commit** `feat: Event-Stream von backe ui mit Puffer, Wiederaufnahme und Heartbeat`

---

### Task 5: Docs, Roadmap, Abnahme

- [ ] ui.md: Status-Satz (gebaut: §2.4 ohne Punkt 3), Präzisierungen aus »Festlegungen für U2« als Gegenwart in §2.4.1–§2.4.3 (Reihenfolge beim Verbinden, Client-Protokoll, `rev` über Watcher-Neustarts, IDs von `hello`/`sync`/`reset`, Neuladen statt Delta bei Config und Verzeichnissen).
- [ ] `ROADMAP.md`: Live-Kern abhaken.
- [ ] `mise run check`, `mise run smoke` grün; MCP- und E2E-Golden-Files byte-gleich.
- [ ] **Commit** `docs: ui.md beschreibt den gebauten Live-Kern`

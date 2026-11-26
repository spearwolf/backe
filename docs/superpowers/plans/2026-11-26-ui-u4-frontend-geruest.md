# backe ui U4 — Frontend-Gerüst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backe ui` liefert eine echte App aus: `web/` (Vite, React, Tailwind, shadcn/ui) baut nach `dist/ui/`, die App-Shell zeigt Kopfzeile, Tab-Leiste und Routing, ein Backlog ist live über `Connection` (eventize) und `Store` (signalize) verbunden, und der Tarball enthält das Frontend samt erweitertem Pack-Smoke-Test.

**Architecture:** Drei Schichten im Client. `web/src/data/` hält Transport und Zustand ohne React: `Connection` kapselt `EventSource` und `fetch`, `Store` hält ein Signal je Entität plus Memos, `openSession()` verdrahtet beide nach dem Client-Protokoll aus ui.md §2.4.3. `web/src/app/` hält reine Modelle ohne JSX (Router, Tabs, Theme, Sync-Anzeige). `web/src/components/` und `web/src/views/` sind reine Darstellung und lesen den Store nur über `useSignal`. Aus `src/` kommen nur Module der reinen Hülle (`WEB_ENTRIES`); die Ansichten ab U5 sind hier Platzhalter.

**Tech Stack:** wie BK plus, alles `devDependencies` (Stand 2026-11-26, Caret): `vite@^8.4.0`, `@vitejs/plugin-react@^6.3.0`, `react@^19.3.1`, `react-dom@^19.3.1`, `@types/react@^19.3.3`, `@types/react-dom@^19.3.0`, `tailwindcss@^4.3.5`, `@tailwindcss/vite@^4.3.5`, `tw-animate-css@^1.4.0`, `radix-ui@^1.8.1`, `class-variance-authority@^0.7.1`, `clsx@^2.1.1`, `tailwind-merge@^3.7.1`, `lucide-react@^1.81.0`, `@spearwolf/signalize@^1.0.0`, `@spearwolf/eventize@^6.3.0`, `jsdom@^31.0.1`, `@testing-library/react@^16.3.3`, `@testing-library/user-event@^14.6.13`. shadcn-Komponenten per `pnpm dlx shadcn@4.23.1 add …` (die CLI ist keine Abhängigkeit).

**Spec:** `docs/proposals/ui.md` §2.2, §2.5 (Transport, Store, Patch anwenden, React-Anbindung, Ansichtszustand), §2.6, §2.13, §2.14 (Default-Sprache), §2.15 (CSP), §2.16 »Frontend«, »Code-Splitting« (Budget), »Build«, »Lint und Typen«, »Paket«; dazu `docs/proposals/backe.md` §2.16.2 (Kopfzeile), §2.21 (Tarball, Smoke-Test). Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (Global Constraints; Festlegungen »Theme ohne Aufblitzen«, »Sprache«, »Imports im Frontend«, »Snapshot im Client«, »`GET /api/backlogs`«). ui.md ist `in Umsetzung`.

## Global Constraints

Alle Global Constraints des Gesamtplans und der Pläne U1–U3. Dazu für U4:

- `web/src/**` importiert aus `src/` nur per Alias `@backe/…`, zur Laufzeit nur Dateien der Hülle `webClosure(WEB_ENTRIES)`; `import type` darf jede Datei nennen. Kein `node:`-Import in `web/src/**`, auch nicht als Typ.
- `dependencies` in `package.json` bleibt unverändert.
- CSP bleibt wörtlich; `dist/ui/index.html` enthält kein Inline-Skript und lädt `/theme.js` synchron vor jedem Stylesheet und jedem Modul-Skript.
- Initialer Chunk (Einstiegs-JS samt statisch importierter Chunks, gzip) ≤ 300 KB (307 200 Bytes).
- Jeder sichtbare Text der App steht en + de in einer `*.messages.ts` unter `web/src/` (`catalog` aus `@backe/i18n/catalog.ts`). Die Locale setzt `setLocale(lang)` aus `/api/backlogs` vor dem ersten Rendern. Backlog-Inhalte werden nie übersetzt.
- `localStorage` nur über `web/src/lib/storage.ts` (jeder Zugriff in `try/catch`, kaputtes JSON → Default).
- Zustände über Icon (`lucide-react`) und Text, nicht über Farbe; Farbe nur für destruktive Fehler und den Fokusring (ui.md §2.13).
- Client-Tests in Vitest-Projekt `web` (jsdom), ohne echtes Netz: `EventSource` und `fetch` kommen als Deps herein. Kein echtes Warten.
- Neue Coverage-Schwelle `'web/src/data/**': { lines: 90, branches: 85 }`; `web/src/**` zählt zur globalen Schwelle, außer `web/src/components/ui/**` (shadcn-Vorlagen), `web/src/main.tsx` und `web/src/test/**`.

## Festlegungen für U4

| Stelle | Festlegung |
| --- | --- |
| Präfix im Umschalter | ui.md §2.6 verlangt Name **und** ID-Präfix je Backlog; `/api/backlogs` kennt nur den Namen. `BacklogEntryJson` bekommt `prefix: string \| null` = `id_prefix` aus `headConfig(ctx.backlog.root)` (`src/services/write.ts`), `null` ohne Arbeitskopie, ohne Config oder bei `BackeError`. Präzisierung in ui.md §2.3.1 und im Gesamtplan. |
| Sync-Anzeige | Die Regel der CLI-Kopfzeile (`statusLine`, `src/services/background.ts`) wandert als `syncLineParts` in das reine Modul `src/core/sync-line.ts` und kommt in `WEB_ENTRIES`; CLI und Client nutzen dieselbe Regel. Anzeige im Client, erster Treffer gewinnt: Verbindung `offline` → `offline`; Teile vorhanden → Teile mit ` · `; sonst `up to date`. `sync: null` (keine eigene Arbeitskopie) → keine Anzeige. |
| Dev-Server | `pnpm dev:ui` = `vite --config web/vite.config.ts` auf `127.0.0.1:5173` (`strictPort`), Proxy `/api` → `http://127.0.0.1:${BACKE_UI_PORT ?? 8002}` mit `changeOrigin: true`. Der Server erlaubt zusätzlich den `Origin` aus `BACKE_UI_DEV_ORIGIN` (aus `UiOptions.env`, nicht leer). Sitzung: Cookies trennen keine Ports, also erst die Konsolen-URL von `backe ui` öffnen, dann `http://127.0.0.1:5173/`. |
| Build | `pnpm build` = `tsdown && vite build --config web/vite.config.ts && node scripts/check-ui-build.ts`. Reihenfolge zwingend: tsdown leert `dist/` (`clean: true`). Vite: `root` = `web/`, `outDir` = `../dist/ui`, `emptyOutDir: true`, `base: '/'`, `build.modulePreload.polyfill: false`, Alias `@backe` → `src`. `web/public/theme.js` landet unverändert als `dist/ui/theme.js`. |
| Typen | `web/tsconfig.json`: `lib` `es2023`, `dom`, `dom.iterable`; `jsx: react-jsx`; `moduleResolution: bundler`; `allowImportingTsExtensions`; `noEmit`; `strict`, `noUncheckedIndexedAccess`; `paths` `@backe/*` → `../src/*`; `types` `node`, `vite/client`, `vitest/globals`. `node` steht drin, weil `import type` aus `src/` Typen erreicht, die `node:`-Module nennen; die Laufzeit-Reinheit prüft der Konventionstest. `pnpm lint` = `biome check . && tsc --noEmit && tsc --noEmit -p web`. |
| Biome | `css.parser.tailwindDirectives: true` in `biome.json`; `web/` wird mitgeprüft, auch die shadcn-Vorlagen (nach `biome check --write` formatiert). |
| Theme | Key `backe-ui-theme`, Werte `light`, `dark`, `system`; fehlend oder unbekannt = `system`. `theme.js` setzt `document.documentElement.dataset.theme` auf `light` oder `dark`. Tailwind: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` und neutrale shadcn-Tokens (`neutral`) für beide Themes. |
| Ansichtszustand | Keys im `localStorage`: `backe-ui-theme` und `backe-ui:<backlog>:tabs` (JSON-Array von Issue-IDs). Mehr braucht U4 nicht. |
| Store-Snapshot | `store.toSnapshot` ist ein Memo (Aufruf `store.toSnapshot()`, wie im Gesamtplan) `BacklogSnapshot \| undefined` (`undefined` vor dem ersten `/state`); es liest `issues`, `projects` und `config` getrackt. `users`, `sprints`, `repos` sind leere `Map`s, `problems` `[]`, `attributes` `undefined`, jede `StoredEntity` `{data, extra: [], body: '', path: ''}`: `graph.ts` und `selectIssues` lesen nur `issues` und `config`. |
| Status der Verbindung | `connecting` bis zum ersten `open` des `EventSource`; `open` nach jedem `open`; jedes `error` → `offline`. Steht der `EventSource` danach auf `CLOSED` (Server antwortete 401/503), versucht die `Connection` nichts mehr; sonst verbindet der Browser selbst neu und schickt `Last-Event-ID`. |
| Routing ohne Bibliothek | Eigener Router auf `history.pushState`/`popstate` (kein neues Paket). `/` → `replace` auf `/b/<current>/backlog`, ohne Start-Backlog Auswahlseite mit dem Umschalter; `/b/<b>` und `/b/<b>/` → `replace` auf `/b/<b>/backlog`; Segmente per `encodeURIComponent`. |

## Review Focus

1. **Patches rund um das Laden von `/state`** — ein `patch` kommt nach `hello`, bevor `/state` geantwortet hat; `/state.rev` ist schon höher als ein gepufferter Patch; ein `reset` kommt, während `/state` lädt; ein Patch springt über einen `rev`. Erwartet: Der Store endet gleich einem frischen `/state` plus allen neueren Patches, nie mit einem doppelt oder gar nicht angewendeten Patch; genau ein weiteres Laden bei `reset` oder Lücke. → Task 6 `patches during the state load are applied after it`, `a patch not newer than the state is dropped`, `reset while loading loads once more`, `a gap in rev reloads the state`.
2. **Server weg oder neu gestartet** — `EventSource` meldet `error` und steht auf `CLOSED` (401 nach Neustart mit neuem Token, 503 beim Ende). Erwartet: Kopfzeile zeigt `offline`, keine Schleife aus Neuladen oder Neuverbinden, keine unbehandelte Ablehnung. → Task 4 `a closed stream goes offline and stays quiet`, Task 8 `the header shows offline`.
3. **Theme ohne Aufblitzen trotz CSP** — `localStorage` wirft (Safari privat, gesperrte Site-Daten), enthält Müll, oder fehlt; System auf dunkel. Erwartet: `theme.js` setzt `data-theme` ohne Fehler, gebautes `index.html` ohne Inline-Skript, `theme.js` vor allen Styles. → Task 3 `theme.js survives a throwing localStorage`, `check-ui-build rejects an inline script`.
4. **Reload auf einem tiefen Link** — `/b/x/issue/bk-7f3k2` frisch geladen, `localStorage` leer oder mit kaputtem Tab-JSON; danach den aktiven Issue-Tab schließen. Erwartet: Issue-Tab offen und aktiv, Schließen springt zum Nachbar-Tab bzw. zu `Backlog`, kaputtes JSON zählt als leer. → Task 7 `garbage in storage yields no tabs`, Task 8 `an issue route opens its tab`, `closing the active tab goes to its neighbour`.
5. **Ein Patch, ein Re-Render** — ein Patch ändert ein Issue unter tausend. Erwartet: Nur Komponenten, die dieses Issue (oder abgeleitete Werte) lesen, rendern neu; Patch-Anwendung in einem `batch`. → Task 5 `a patch re-renders only the subscribers of that issue`.

---

### Task 1: Regel der Sync-Kopfzeile als reines Modul

**Files:**
- Create: `src/core/sync-line.ts`, `src/core/sync-line.test.ts`
- Modify: `src/services/background.ts` (`statusLine` nutzt `syncLineParts`), `test/helpers/web-closure.ts` (`WEB_ENTRIES` + `src/core/sync-line.ts`)

**Interfaces:**
- Produces:
  ```ts
  export type SyncLineInput = {
    remote: string | null | undefined;
    mode: string;
    unpushed: number;
    last_error?: { message: string } | null;
    conflicts: readonly unknown[];
  };
  export type SyncLineParts = { unpushed?: number; conflicts?: number; failed?: string };
  export function syncLineParts(s: SyncLineInput): SyncLineParts;
  ```
  Regel wörtlich wie `statusLine` heute: `unpushed` nur mit Remote, `unpushed > 0` und (`last_error` vorhanden oder `mode === 'manual'`); `conflicts` bei `> 0`; `failed` = `last_error.message`. Leeres Objekt = nichts offen. Die Eingabe passt auf das JSON aus `syncStatusJson` (`remote: null` ohne Remote).

- [ ] **Step 1: Failing tests** in `sync-line.test.ts`: `nothing open yields no parts`, `unpushed counts only with a remote and manual mode or an error`, `conflicts and failure are reported`, `accepts the sync status json` (Objekt aus `syncStatusJson` eines `SyncStatus`-Fixtures direkt übergeben).
- [ ] **Step 2:** `pnpm vitest run src/core/sync-line` → FAIL.
- [ ] **Step 3:** Implementieren; `statusLine(s)` ruft `syncLineParts` und formatiert wie bisher.
- [ ] **Step 4:** `pnpm vitest run src/core src/services test/conventions.test.ts test/e2e` → PASS, Goldens unverändert.
- [ ] **Step 5: Commit** `refactor: Regel der Sync-Kopfzeile als reines Modul für backe ui`

---

### Task 2: Server — Präfix in der Backlog-Liste, Dev-Origin

**Files:**
- Modify: `src/ui/api.ts` (`BacklogEntryJson.prefix`), `src/ui/context.ts` (`entry`), `src/ui/server.ts` (Gate-Origins), Tests in `src/ui/context.test.ts`, `src/ui/read-api.test.ts`, `src/ui/server.test.ts`, `docs/proposals/ui.md` §2.3.1 und §2.16 »Build«

**Interfaces:**
- Produces: `BacklogEntryJson = { name; current; can_write; user; prefix: string | null }`; `devOrigins(env: Env): string[]` in `src/ui/security.ts` (`BACKE_UI_DEV_ORIGIN` getrimmt, leer → `[]`); Gate `origins: [...ownOrigins(port), ...devOrigins(opts.env)]` an beiden Stellen in `server.ts`.

- [ ] **Step 1: Failing tests:** `backlog list carries the id prefix` (registriertes Backlog mit `id_prefix: 'sm'` → `prefix: 'sm'`; registriert ohne Arbeitskopie → `null`); `dev origin may write when configured` (`env.BACKE_UI_DEV_ORIGIN = 'http://127.0.0.1:5173'`, `POST …/tools/issue_list` mit diesem `Origin` → 200); `dev origin is foreign without the env` (derselbe Request ohne Env → 403 `forbidden`); `devOrigins ignores an empty value`.
- [ ] **Step 2:** `pnpm vitest run src/ui` → FAIL.
- [ ] **Step 3:** Implementieren. ui.md §2.3.1: Zeile `GET /api/backlogs` um `prefix` (ID-Präfix aus der Backlog-Config, `null` ohne lesbare Config); §2.16 »Build«: Proxy-Ziel `BACKE_UI_PORT` (Default 8002) und Ablauf der Sitzung im Dev-Betrieb als Gegenwart.
- [ ] **Step 4:** `pnpm vitest run src/ui test/e2e` → PASS.
- [ ] **Step 5: Commit** `feat: backe ui nennt das ID-Präfix je Backlog und erlaubt einen Dev-Origin`

---

### Task 3: Werkzeugkette `web/`, Theme-Skript, Build-Prüfung

**Files:**
- Create: `web/index.html`, `web/public/theme.js`, `web/vite.config.ts`, `web/tsconfig.json`, `web/components.json`, `web/src/main.tsx` (vorläufig: rendert `<div>backe</div>` in `#root`), `web/src/styles.css`, `web/src/lib/utils.ts` (`cn`), `web/src/lib/storage.ts`, `web/src/lib/storage.test.ts`, `web/src/theme-script.test.ts`, `scripts/check-ui-build.ts`, `scripts/check-ui-build.test.ts`
- Modify: `package.json` (devDependencies, Scripts `build`, `dev:ui`, `lint`), `biome.json`, `vitest.config.ts` (Projekte `node` und `web`, Coverage), `test/conventions.test.ts`

**Interfaces:**
- Produces:
  - `web/src/lib/storage.ts`: `readJson<T>(key: string, fallback: T, guard: (v: unknown) => v is T): T`; `writeJson(key: string, value: unknown): void`; `readText(key: string): string | undefined`; `writeText(key: string, value: string): void` — jeder Zugriff in `try/catch`, ohne `localStorage` still Default.
  - `scripts/check-ui-build.ts`: `export async function checkUiBuild(dir: string): Promise<string[]>` (Liste der Verstöße, leer = gut); als Skript aufgerufen ohne Argument prüft es `dist/ui/`, druckt Verstöße auf stderr und endet mit 1. Prüft: `index.html` existiert; jedes `<script>` hat `src`; das erste `<script>` ist `src="/theme.js"` ohne `type="module"`, `async`, `defer`, und steht vor jedem `<link rel="stylesheet">` und jedem Modul-Skript; `theme.js` existiert; Summe gzip (`node:zlib` `gzipSync`, Level 9) aus Einstiegs-Skript und allen `<link rel="modulepreload">` ≤ 307 200 Bytes.
  - Vitest: Projekt `node` (bisherige Tests, unverändert konfiguriert), Projekt `web` (`environment: 'jsdom'`, Tests `web/src/**/*.test.{ts,tsx}`, Alias und React-Plugin wie `web/vite.config.ts`, dieselbe `env` und `setupFiles` wie `node`). `pnpm test` läuft beide mit gemeinsamer Coverage.
  - `web/index.html`: `<html lang="en">`, im `<head>` als erstes Skript `<script src="/theme.js"></script>`, `<body><div id="root"></div><script type="module" src="/src/main.tsx"></script>`.

- [ ] **Step 1: Abhängigkeiten installieren** mit den Versionen aus dem Kopf (`pnpm add -D …`), dann `pnpm dlx shadcn@4.23.1 add button dropdown-menu badge` mit vorher geschriebener `web/components.json` (Style `new-york`, `baseColor: neutral`, `cssVariables: true`, Aliase `@/components`, `@/lib/utils`; Alias `@` → `web/src` in Vite und `tsconfig`). Ergebnis: `web/src/components/ui/{button,dropdown-menu,badge}.tsx`.
- [ ] **Step 2: Failing tests:**
  - `web/src/theme-script.test.ts` (führt den Text von `web/public/theme.js` per `new Function` aus): `theme.js follows the stored choice` (`light`/`dark` → genau das), `theme.js follows the system without a choice` (`matchMedia('(prefers-color-scheme: dark)').matches` true → `dark`), `theme.js treats garbage as system`, `theme.js survives a throwing localStorage` (Getter wirft → System, kein Fehler).
  - `web/src/lib/storage.test.ts`: `a throwing storage yields the fallback`, `broken json yields the fallback`, `a value failing the guard yields the fallback`, `writes survive a throwing storage`.
  - `scripts/check-ui-build.test.ts` (Fixture-Verzeichnisse im Temp-Dir): `a proper build passes`, `check-ui-build rejects an inline script`, `check-ui-build rejects a stylesheet before theme.js`, `check-ui-build rejects a module script before theme.js`, `check-ui-build rejects an initial chunk over budget` (307 201 Bytes inkompressibler Inhalt).
  - `test/conventions.test.ts`: `web sources import only the pure closure from src` (jede Datei unter `web/src/` außer `*.test.*`: Laufzeit-Importe mit `@backe/` müssen auf eine Datei aus `webClosure(WEB_ENTRIES)` zeigen; kein Import mit `node:`, auch kein Typ-Import), dazu ein Negativfall mit einem Laufzeit-Import von `@backe/services/read.ts` im Test-Text.
- [ ] **Step 3:** `pnpm vitest run --project web` und `pnpm vitest run scripts test/conventions.test.ts` → FAIL.
- [ ] **Step 4:** Implementieren nach den Festlegungen »Build«, »Typen«, »Biome«, »Theme«, »Dev-Server«. `theme.js` ist ein klassisches Skript (IIFE, kein `export`), dieselbe Regel wie `resolveTheme` in Task 8.
- [ ] **Step 5:** `pnpm build && ls dist/ui` zeigt `index.html`, `theme.js`, `assets/`; `node scripts/check-ui-build.ts` → Exit 0. `pnpm lint` → grün. `pnpm test` → grün inklusive Coverage.
- [ ] **Step 6: Commit** `feat: Werkzeugkette für das Frontend von backe ui`

---

### Task 4: `Connection` und API-Client

**Files:**
- Create: `web/src/data/api-client.ts`, `web/src/data/api-client.test.ts`, `web/src/data/connection.ts`, `web/src/data/connection.test.ts`, `web/src/test/fake-event-source.ts`

**Interfaces:**
- Consumes: `StateJson`, `HelloJson`, `PatchJson`, `ErrorJson`, `BacklogsJson` aus `@backe/ui/api.ts`.
- Produces:
  ```ts
  // api-client.ts
  export class ApiError extends Error {
    readonly status: number; readonly code: string; readonly hint?: string; readonly details?: unknown;
  }
  export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
  export async function getJson<T>(path: string, fetchFn?: Fetch): Promise<T>;
  // Nicht-2xx mit Fehler-JSON → ApiError mit dessen Feldern; ohne → code 'http', message = statusText.
  // Netzfehler → ApiError status 0, code 'offline'.

  // connection.ts
  export type ConnectionStatus = 'connecting' | 'open' | 'offline';
  export type ConnectionEvents = {
    hello: [HelloJson]; patch: [PatchJson]; sync: [Record<string, unknown>]; reset: []; status: [ConnectionStatus];
  };
  export type EventSourceLike = {
    readonly readyState: number; onopen: ((e: Event) => void) | null; onerror: ((e: Event) => void) | null;
    addEventListener(type: string, fn: (e: MessageEvent<string>) => void): void; close(): void;
  };
  export type ConnectionDeps = { eventSource: (url: string) => EventSourceLike; fetch: Fetch };
  export class Connection extends Eventize<ConnectionEvents> {
    constructor(backlog: string, deps?: Partial<ConnectionDeps>);
    readonly backlog: string;
    get status(): ConnectionStatus;   // `status` ist retained
    open(): void;                     // idempotent; URL `/api/b/${encodeURIComponent(backlog)}/events`
    close(): void;                    // schließt den EventSource, kein weiteres Ereignis
    state(): Promise<StateJson>;      // GET `/api/b/<b>/state`
  }
  ```
  Ereignisdaten, die kein gültiges JSON sind, gelten als `reset`.
- `fake-event-source.ts`: `FakeEventSource` mit `emitOpen()`, `emitError(closed?: boolean)`, `emitEvent(type, data: unknown | string)`, `url`, `closed`; Fabrik `fakeEventSources()` → `{ create, last() }`.

- [ ] **Step 1: Failing tests:** `getJson returns the parsed body`, `getJson turns error json into an ApiError` (409 mit `{error:{code:'conflict',message:'x',hint:'h'}}`), `getJson without error json uses the status`, `getJson maps a network failure to offline`; `status is connecting until the stream opens`, `events are forwarded with their data`, `broken event data counts as reset`, `a reconnecting stream goes offline and back to open`, `a closed stream goes offline and stays quiet` (`emitError(true)`, danach kein neuer EventSource, keine weiteren Ereignisse), `close stops all events`, `the events url encodes the backlog`.
- [ ] **Step 2:** `pnpm vitest run --project web src/data` → FAIL.
- [ ] **Step 3:** Implementieren (eventize: `retain(this, 'status')`; Dispatch mit `emit`).
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: Verbindung des Frontends von backe ui über Event-Stream und fetch`

---

### Task 5: `Store`, `useSignal`, `useStore`

**Files:**
- Create: `web/src/data/store.ts`, `web/src/data/store.test.ts`, `web/src/data/use-signal.ts`, `web/src/data/use-signal.test.tsx`, `web/src/data/store-context.tsx`

**Interfaces:**
- Consumes: `StateJson`, `PatchJson`, `IssueJson`, `ProjectJson`, `SprintJson`, `RepoJson`, `UserJson`, `ProblemJson`; `BacklogSnapshot` (Typ, `@backe/store/snapshot.ts`).
- Produces:
  ```ts
  export class EntityTable<T> {
    constructor(keyOf: (item: T) => string);
    readonly keys: Signal<readonly string[]>;     // Reihenfolge: wie in /state, neue Keys hinten
    get(key: string): Signal<T | undefined>;      // legt für unbekannte Keys ein Signal mit undefined an
    replaceAll(items: readonly T[]): void;
    upsert(items: readonly T[]): void;
    remove(keys: readonly string[]): void;
    list(): T[];                                  // getrackt: keys und jeder Eintrag
  }
  export type PatchOutcome = 'applied' | 'stale' | 'gap';
  export class Store {
    readonly issues: EntityTable<IssueJson>;      // Key id
    readonly projects: EntityTable<ProjectJson>;  // Key path
    readonly sprints: EntityTable<SprintJson>;    // Key slug
    readonly repos: EntityTable<RepoJson>;        // Key name
    readonly users: EntityTable<UserJson>;        // Key handle
    readonly rev: Signal<number>; readonly head: Signal<string>; readonly loaded: Signal<boolean>;
    readonly context: Signal<Record<string, unknown>>;
    readonly config: Signal<StateJson['config'] | undefined>;
    readonly problems: Signal<readonly ProblemJson[]>;
    readonly sync: Signal<Record<string, unknown> | null>;
    readonly toSnapshot: SignalReader<BacklogSnapshot | undefined>;
    touchCount(id: string): Signal<number>;       // +1 je `touched`-Eintrag und je Upsert dieses Issues
    load(state: StateJson): void;                 // alles in einem batch, loaded = true
    applyPatch(p: PatchJson): PatchOutcome;       // rev <= this.rev → 'stale'; rev > this.rev + 1 → 'gap' (nichts angewendet); sonst alles in einem batch
    dispose(): void;                              // SignalGroup.delete(this)
  }
  export function useSignal<T>(source: Signal<T> | SignalReader<T>): T;  // useSyncExternalStore
  export const StoreContext: React.Context<Store | null>;
  export function useStore(): Store;              // wirft ohne Provider
  ```
  Alle Signale, Memos und Effekte mit `attach: this`; `useSignal` abonniert per Effekt und gibt ihn beim Unsubscribe frei.

- [ ] **Step 1: Failing tests** in `store.test.ts` (State-Fixtures aus Hand-JSON; für Graph-Werte dieselben Issue-Konstellationen wie `src/ops/graph.test.ts`): `load fills every table`, `a patch upserts and removes entities`, `a patch not newer than the store is stale`, `a patch beyond rev + 1 is a gap and changes nothing`, `touched bumps the touch count`, `config and problems follow the patch`, `the snapshot feeds graph and selection` (`graphOf(store.toSnapshot()!)` und `selectIssues` liefern dasselbe wie auf einem Snapshot aus denselben Issues), `the snapshot ignores users, sprints and repos` (Patch auf einen User → Memo rechnet nicht neu), `dispose leaves no signals behind` (`getSignalsCount`/`getEffectsCount` vorher = nachher).
  In `use-signal.test.tsx`: `useSignal re-renders on change`, `a patch re-renders only the subscribers of that issue` (1000 Zeilen-Komponenten je `store.issues.get(id)`, Render-Zähler; Patch auf ein Issue → genau diese Zeile +1, Liste der Keys unverändert → Liste nicht neu), `unmount releases the effect`, `useStore throws without a provider`.
- [ ] **Step 2:** `pnpm vitest run --project web src/data` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: Store des Frontends von backe ui mit Signalen je Entität`

---

### Task 6: Sitzung je Backlog — Client-Protokoll

**Files:**
- Create: `web/src/data/session.ts`, `web/src/data/session.test.ts`

**Interfaces:**
- Consumes: `Connection`, `ConnectionDeps`, `ConnectionStatus` (Task 4); `Store`, `PatchOutcome` (Task 5); `ApiError`.
- Produces:
  ```ts
  export type Session = {
    readonly backlog: string;
    readonly connection: Connection;
    readonly store: Store;
    readonly status: Signal<ConnectionStatus>;
    /** Letzter Fehler beim Laden von /state; undefined nach jedem erfolgreichen Laden. */
    readonly error: Signal<ApiError | undefined>;
    dispose(): void;
  };
  export function openSession(backlog: string, deps?: Partial<ConnectionDeps>): Session;
  ```
  Protokoll (ui.md §2.4.3): Stream öffnen; das erste `hello` lädt `/state`; Patches, die während eines Ladens kommen, landen im Puffer und gehen nach `store.load` in Reihenfolge durch `applyPatch`; `stale` wird verworfen; `gap` lädt `/state` neu; `reset` lädt neu — kommt es während eines Ladens, folgt genau ein weiteres Laden nach diesem; ein späteres `hello` (Wiederverbinden) lädt nicht. `sync` setzt `store.sync`. Ein gescheitertes Laden setzt `error` und lädt beim nächsten `hello` oder `reset` erneut. `dispose` schließt die Verbindung und den Store; danach ändert nichts mehr den Store.

- [ ] **Step 1: Failing tests** (Fake-EventSource, `fetch` als kontrollierbares Promise): `the first hello loads the state`, `patches during the state load are applied after it`, `a patch not newer than the state is dropped`, `reset while loading loads once more`, `a gap in rev reloads the state`, `a second hello does not reload`, `sync events update the store`, `a failed load sets the error and retries on reset`, `dispose stops all updates`.
- [ ] **Step 2:** `pnpm vitest run --project web src/data/session` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** → PASS; `pnpm vitest run --project web --coverage` erfüllt `web/src/data/**`.
- [ ] **Step 5: Commit** `feat: Sitzung je Backlog im Frontend von backe ui`

---

### Task 7: Router und Tab-Modell

**Files:**
- Create: `web/src/app/routes.ts`, `web/src/app/routes.test.ts`, `web/src/app/router.ts`, `web/src/app/router.test.ts`, `web/src/app/tabs.ts`, `web/src/app/tabs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // routes.ts — rein
  export type Route =
    | { kind: 'home' }
    | { kind: 'backlog'; backlog: string }
    | { kind: 'board'; backlog: string }
    | { kind: 'issue'; backlog: string; id: string }
    | { kind: 'settings'; backlog: string; section: string | undefined }
    | { kind: 'not-found'; path: string };
  export function parseRoute(pathname: string): Route;     // `/b/<b>` und `/b/<b>/` → backlog
  export function routeHref(route: Exclude<Route, { kind: 'home' | 'not-found' }>): string;
  export function canonicalPath(pathname: string): string | undefined; // `/b/<b>` → `/b/<b>/backlog`, sonst undefined

  // router.ts
  export class Router {
    constructor(win?: Pick<Window, 'location' | 'history' | 'addEventListener' | 'removeEventListener'>);
    readonly location: Signal<{ pathname: string; search: string }>;
    readonly route: SignalReader<Route>;
    navigate(href: string, opts?: { replace?: boolean }): void;
    dispose(): void;
  }
  export function useRouter(): Router;  // React-Kontext wie useStore

  // tabs.ts
  export class TabModel {
    constructor(backlog: string);            // liest `backe-ui:<backlog>:tabs` über storage.ts
    readonly issues: Signal<readonly string[]>;
    open(id: string): void;                  // hängt an, wenn neu; schreibt
    close(id: string): string | undefined;   // entfernt; liefert den Nachbarn (rechts, sonst links) oder undefined
  }
  ```

- [ ] **Step 1: Failing tests:** `parseRoute knows every view`, `a bare backlog path is canonicalised`, `unknown paths are not found`, `routeHref round-trips through parseRoute` (inkl. ID mit `%`); `navigate pushes and replace replaces`, `popstate updates the route`; `open is idempotent`, `tabs survive a reload` (neues `TabModel` desselben Backlogs liest dieselben IDs), `garbage in storage yields no tabs`, `tabs are kept per backlog`, `close returns the right neighbour, else the left`.
- [ ] **Step 2:** `pnpm vitest run --project web src/app` → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: Commit** `feat: Routing und Tab-Modell im Frontend von backe ui`

---

### Task 8: App-Shell — Kopfzeile, Tab-Leiste, Theme, Sprache, Start

**Files:**
- Create: `web/src/app/theme.ts`, `web/src/app/theme.test.ts`, `web/src/app/sync-display.ts`, `web/src/app/sync-display.test.ts`, `web/src/app/app.messages.ts`, `web/src/app/bootstrap.tsx`, `web/src/app/bootstrap.test.tsx`, `web/src/components/App.tsx`, `web/src/components/Header.tsx`, `web/src/components/BacklogSwitcher.tsx`, `web/src/components/SyncIndicator.tsx`, `web/src/components/ThemeToggle.tsx`, `web/src/components/TabBar.tsx`, `web/src/components/ErrorPage.tsx`, `web/src/components/App.test.tsx`, `web/src/views/BacklogView.tsx`, `web/src/views/BoardView.tsx`, `web/src/views/IssueView.tsx`, `web/src/views/SettingsView.tsx`
- Modify: `web/src/main.tsx` (ruft nur `bootstrap(document.getElementById('root')!)`)

**Interfaces:**
- Consumes: alles aus Task 4–7; `syncLineParts` (Task 1); `BacklogsJson` samt `prefix` (Task 2); `setLocale` aus `@backe/i18n/locale.ts`.
- Produces:
  ```ts
  // theme.ts
  export const THEME_KEY = 'backe-ui-theme';
  export type ThemeChoice = 'light' | 'dark' | 'system';
  export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark';
  export class Theme {                     // folgt matchMedia, solange choice 'system' ist
    constructor(win?: Pick<Window, 'matchMedia'>, root?: HTMLElement);
    readonly choice: Signal<ThemeChoice>;
    set(choice: ThemeChoice): void;        // schreibt über storage.ts, setzt data-theme
    dispose(): void;
  }
  // sync-display.ts
  export type SyncDisplay =
    | { kind: 'none' } | { kind: 'offline' } | { kind: 'ok' }
    | { kind: 'open'; unpushed?: number; conflicts?: number; failed?: string };
  export function syncDisplay(sync: Record<string, unknown> | null, status: ConnectionStatus): SyncDisplay;
  // bootstrap.tsx
  export type BootDeps = Partial<ConnectionDeps> & { win?: Window };
  export async function bootstrap(root: HTMLElement, deps?: BootDeps): Promise<void>;
  // GET /api/backlogs → setLocale(lang), <html lang> → App; Fehler → ErrorPage mit message und hint (Server-Sprache).
  ```
  Verhalten der Shell (ui.md §2.6): Kopfzeile `backe · <Tagline>`, Umschalter (`DropdownMenu`, Einträge `<name>` und Präfix in Monospace, aktueller markiert, Auswahl → `/b/<name>/backlog`), Identität (Handle; ohne Schreibrecht zusätzlich `Badge` mit `m.readOnly`; ohne Handle nichts), `SyncIndicator` (Icon + Text aus `syncDisplay`; Texte wie die CLI-Kopfzeile: en `up to date`, `<n> unpushed`, `<n> conflict(s)`, `last sync failed`, `offline`, de nach `background.messages.ts` und `sync.messages.ts`: `aktuell`, `<n> ungepusht`, `<n> Konflikt(e)`, `letzter Sync fehlgeschlagen`, `offline`; `failed` zeigt die Meldung als `title`), `ThemeToggle` (`DropdownMenu` hell/dunkel/System). Tab-Leiste mit `role="tablist"`, Tabs `role="tab"` und `aria-selected`: `Backlog`, `Board` fest; Issue-Tabs `<id> <Titel>` (Titel gekürzt per CSS; fehlt das Issue im geladenen Store → ID und `m.deleted`), `×`-Knopf mit `aria-label`, Mittelklick schließt; Leiste scrollt horizontal; rechts `⚙` als Link auf `/b/<b>/settings`. Eine `issue`-Route öffnet ihren Tab. Schließen des aktiven Tabs navigiert zum Nachbarn aus `TabModel.close`, sonst zu `Backlog`. Je Backlog-Route genau eine `Session` (Wechsel → alte `dispose`, neue `openSession`), bereitgestellt über `StoreContext`. Ansichten sind Platzhalter: Überschrift; `BacklogView` zusätzlich `m.issueCount(n)` aus `store.issues.keys` (beweist die Live-Anbindung). `/` mit Start-Backlog → `replace` dorthin; ohne → Seite mit `m.chooseBacklog` und dem Umschalter. Unbekannter Backlog in der URL → `m.unknownBacklog(name)` und der Umschalter. `not-found` → `m.notFound`.

- [ ] **Step 1: Failing tests:**
  - `theme.test.ts`: `resolveTheme matches theme.js` (alle 6 Kombinationen gegen das Ergebnis des Skripts aus Task 3), `set writes the choice and the attribute`, `system follows a media change`, `a throwing storage still switches the theme`.
  - `sync-display.test.ts`: `no working copy shows nothing`, `offline wins`, `open parts follow syncLineParts`, `nothing open is up to date`.
  - `App.test.tsx` (Fake-EventSource und Fake-fetch, `window.history` von jsdom): `the root redirects to the start backlog`, `without a start backlog the switcher is shown`, `the switcher lists names and prefixes and switches the backlog` (neue Session, alte geschlossen), `read-only identity is marked`, `the header shows the sync state`, `the header shows offline`, `tabs have tab roles and selection`, `an issue route opens its tab`, `closing the active tab goes to its neighbour`, `middle click closes an issue tab`, `a deleted issue keeps its tab`, `a patch updates the issue count without reload`, `unknown backlog in url shows the switcher`, `texts follow the server language` (`lang: 'de'` → deutsche Tab-Namen), `a failing backlog list shows the error with its hint`.
- [ ] **Step 2:** `pnpm vitest run --project web` → FAIL.
- [ ] **Step 3:** Implementieren. Texte en + de in `app.messages.ts`; Tastatur: alle Elemente fokussierbar, Radix-Menüs schließen mit `Esc`.
- [ ] **Step 4:** `pnpm vitest run --project web` → PASS; `pnpm build` → `check-ui-build` grün (Budget).
- [ ] **Step 5: Sichtprüfung:** `backe ui --port 0` gegen ein Temp-Backlog starten, die Konsolen-URL im Browser (Playwright-MCP) öffnen; hell und dunkel je ein Screenshot; CLI-Write in einem zweiten Terminal → Zähler im Tab `Backlog` springt ohne Reload. Ergebnis im Bericht nennen, nicht committen.
- [ ] **Step 6: Commit** `feat: App-Shell von backe ui mit Kopfzeile, Tabs und Theme`

---

### Task 9: Paket, Pack-Smoke-Test, Docs

**Files:**
- Modify: `scripts/pack-smoke.sh`, `docs/proposals/ui.md` (Status-Satz), `docs/proposals/backe.md` §2.21 »Paket« und »Pack-Smoke-Test«, `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (Festlegung »`GET /api/backlogs`« um `prefix`), `ROADMAP.md`

**Interfaces:**
- Consumes: gebautes `dist/ui/` (Task 3), Server aus U1–U3.

- [ ] **Step 1: Smoke-Test erweitern:**
  - Dateiliste: Außerhalb von `package/dist/ui/` exakt wie bisher; dazu müssen `package/dist/ui/index.html` und `package/dist/ui/theme.js` existieren, und jede weitere Datei unter `package/dist/ui/` liegt unter `package/dist/ui/assets/`.
  - Nach `verify`: `backe ui --port 0` im Hintergrund in `$T/wc` starten, stdout in eine FIFO; die erste Zeile mit `read -r -t 20` lesen (Muster `^backe ui: http://127\.0\.0\.1:[0-9]+/\?token=[0-9a-f]{64}$`). Mit `curl` (Cookie-Jar): Start-URL → 303 mit `Set-Cookie: backe_ui_<port>=`; `/` mit Cookie → 200, Body enthält `<div id="root">` und `src="/theme.js"`, Header `Content-Security-Policy` wörtlich wie in den Global Constraints; `/api/backlogs` mit Cookie → JSON mit Eintrag `name: "smoke"`, `prefix: "sm"`. Dann `kill -TERM`, `wait` → Exit-Code 0. Ein `trap` beendet den Server auch bei Fehlern.
- [ ] **Step 2:** `mise run smoke` → `pack-smoke: ok <version>`.
- [ ] **Step 3: Docs:**
  - ui.md Status-Satz: gebaut zusätzlich §2.2 (`web/`), §2.5 Transport, Store, Patch, React-Anbindung, §2.6 ohne Suche und Tastaturkürzel, §2.13, §2.14 Default-Sprache, §2.16 »Build«, »Lint und Typen«, »Paket« ohne Größenmessung; offen bleibt der Rest ab §2.7, §2.4.1 Punkt 3, Sprachwahl in Settings, Suche, `c`/`⌘K`.
  - BK §2.21: Tarball enthält zusätzlich `dist/ui/**`; der Smoke-Test startet `backe ui --port 0`, ruft Start-URL, `/` und `/api/backlogs` ab und beendet per SIGTERM. Damit ist der Wunsch »BK §2.20/§2.21« in ui.md §4.2 erfüllt → dort streichen.
  - Gesamtplan: `prefix` in der Festlegung `GET /api/backlogs`.
  - ROADMAP: »Frontend-Gerüst« abhaken.
- [ ] **Step 4:** `mise run check` und `mise run smoke` → grün.
- [ ] **Step 5: Commit** `feat: Frontend von backe ui im Paket, Smoke-Test startet die UI` (Commit-Message nennt die Doku-Änderungen in ui.md, backe.md und ROADMAP).

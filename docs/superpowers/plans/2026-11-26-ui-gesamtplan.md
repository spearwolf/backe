# backe ui — Gesamtplan der Umsetzung

> **For agentic workers:** Dieser Gesamtplan schneidet `docs/proposals/ui.md` in Meilensteine und legt die Schnittstellen zwischen ihnen fest. Umgesetzt wird nie direkt aus diesem Dokument, sondern aus dem Detailplan des jeweiligen Meilensteins (REQUIRED SUB-SKILL: superpowers:subagent-driven-development oder superpowers:executing-plans). Der Detailplan eines Meilensteins entsteht erst, wenn sein Vorgänger abgenommen ist — so plant er gegen gebauten Code statt gegen Annahmen. Der erste Detailplan ist `2026-11-26-ui-u0-vorlauf.md`.

**Goal:** `backe ui` nach `docs/proposals/ui.md` bauen — lokaler HTTP-Server als dritter Adapter über den Service-Layer, Live-Updates per Ref-Watch und SSE, React-Frontend mit Backlog, Board, Issue, Settings und Suche, ausgeliefert im npm-Paket.

**Architecture:** Server in `src/ui/` auf `node:http`, abhängig nur von `src/tools/` (neu, U0), `services/` und darunter. Frontend in `web/` (Vite, React, Tailwind, shadcn/ui), gebaut nach `dist/ui/`, Zustand in `@spearwolf/signalize`, Verbindung als `@spearwolf/eventize`-Emitter. Abgeleitete Werte rechnet der Client mit denselben reinen Modulen wie das CLI (`src/core/`, `src/ops/graph.ts`, `src/ops/issue-query.ts`). Die Meilensteine bauen von innen nach außen: erst die reine Hülle und der geteilte Tool-Katalog in BK, dann Server (Lesen, Live, Schreiben), dann Frontend Ansicht für Ansicht, zuletzt Paket und CI.

**Tech Stack:** wie BK (Node 26, TypeScript strict, ESM, pnpm, Biome, Vitest, tsdown). Neu, alles `devDependencies`: Vite, React, Tailwind CSS, shadcn/ui (Radix), `lucide-react`, `@spearwolf/signalize`, `@spearwolf/eventize`, `react-markdown`, `remark-gfm`, `rehype-raw`, `rehype-sanitize`, ein Highlighter mit Sprachen auf Abruf, `mermaid`, `@xyflow/react`, `@dagrejs/dagre`, `@dnd-kit`, `@tanstack/react-virtual`, Testing Library, jsdom, Playwright. Versionen legt der jeweilige Detailplan beim Installieren fest (aktuelle Releases, danach Renovate); dieser Plan nennt keine.

**Spec:** `docs/proposals/ui.md` (Kürzel UI), dazu BK `docs/proposals/backe.md` §2.14, §2.16, §2.18–§2.24. UI ist `spezifiziert` (freigegeben am 2026-11-26) samt den Empfehlungen in UI §4.1: SSE plus HTTP; Frontend im Hauptpaket bis +3 MB Tarball; Projekte, Sprints, Repos in Settings; `backlog.jsonc` nur lesend; externe Bilder per CSP auf `https:` mit Schalter; Fehlertexte in Server-Sprache; keine Webhooks. Kippt eine davon, ändert sich der betroffene Meilenstein, nicht der Schnitt.

## Befunde aus der Kartierung

Abweichungen zwischen Spec und Code, gefunden beim Planen. Eingeordnet nach Schritt 3 des Harness (Bug, Präzisierung, Gegenentwurf).

| Stelle | Befund | Einordnung → Meilenstein |
| --- | --- | --- |
| UI §2.2, §3.5 | `src/ops/graph.ts` ist nicht rein: `core/errors.ts` → `i18n/catalog.ts` → `i18n/locale.ts` → `context/paths.ts` zieht `node:fs/promises`, `node:os`, `node:path`, dazu `store/files.ts` und `core/ids.ts` (`node:crypto`). `core/schemas.ts` → `core/ssh.ts` zieht `node:crypto` und nutzt `Buffer`. `locale()` liest ungeschützt `process.env`. | Bug gegen BK §2.20 (»core … rein, ohne I/O«, Abhängigkeiten nur nach unten — `i18n` greift nach `context`) → U0 |
| UI §2.4.1, §2.10 | Das JSON von `sync status` baut `src/cli/commands/sync.ts:78` (`statusJson`), nicht `src/services/views.ts`. `/state.sync` und das Ereignis `sync` brauchen es im Adapter. | Präzisierung, kein Verhaltenswechsel → U0 |
| UI §2.7, §5 »Filter-Parität« | Die Filterlogik von `issue list` steckt in `listIssues` (`src/services/issue-list.ts:120`) zwischen Kontextauflösung und `openSnapshot`. Der Client kann sie so nicht nutzen. | Refactoring → U0 (`src/ops/issue-query.ts`) |
| UI §2.3.2, §3.3 | Die Tool-Definitionen hängen am `McpServer` (`defineTool` in `src/mcp/tool.ts`). Ein zweiter Adapter mit denselben Namen, Parametern und Ergebnissen braucht sie adapterneutral. | Refactoring → U0 (`src/tools/`) |
| UI §2.4.3 | »`id: <rev>`« und »`rev` aus einem früheren Serverprozess → `reset`« widersprechen sich: Ein neuer Prozess erreicht dieselben Nummern wieder, ein Client mit `Last-Event-ID: 57` bekäme Patches eines fremden Stands. | Präzisierung: Event-ID `<boot>:<rev>` (Festlegungen) → ui.md in U0, gebaut in U2 |
| UI §2.13 vs. §2.15 | »Ein Inline-Skript setzt das Theme vor dem ersten Rendern« verträgt sich nicht mit `script-src 'self'`. | Präzisierung: synchrones externes `/theme.js` im `<head>` (Festlegungen) → ui.md in U0, gebaut in U4 |
| UI §2.1 | Exit-Code 6 für »Port belegt« ist im Code der Fehlercode `sync` (`src/core/errors.ts:26`). | Präzisierung: `BackeError('sync', …)` → U1 |

`ROADMAP.md` und `docs/adr/README.md` entstehen mit diesem Plan; jeder Meilenstein hakt seinen Roadmap-Eintrag ab.

## Global Constraints

- Schichten nach BK §2.20 plus `src/tools/` (U0) zwischen `services/` und den Adaptern: `src/ui/**` importiert nichts aus `src/cli/**` oder `src/mcp/**` und umgekehrt, außer `src/cli/commands/ui.ts` → `src/ui/`.
- `web/` importiert aus `src/` nur Module der reinen Hülle (U0): keine `node:`-Imports, keine nackten Imports außer `zod`, kein `Buffer`, kein ungeschütztes `process`. Ein Konventionstest prüft das (UI §2.2).
- Keine neue Runtime-Abhängigkeit (`dependencies` in `package.json` bleibt, wie es ist; UI §2.16, BK §2.20).
- Bind nur auf `127.0.0.1`, Default-Port `8002`, `--port 0` = freier Port, belegter Port → `Error: Port 8002 is in use`, Hint `backe ui --port <n>`, Exit-Code 6 (UI §2.1).
- Start-Ausgabe genau eine Zeile `backe ui: http://127.0.0.1:<port>/?token=<token>`; Token 32 Zufallsbytes je Prozess (UI §2.1, §2.15).
- Cookie `backe_ui_<port>` (z. B. `backe_ui_8002`; Cookies gelten nicht je Port), `HttpOnly`, `SameSite=Strict`, `Path=/`. Ohne Cookie 401, falscher `Host` (nicht `127.0.0.1:<port>` oder `localhost:<port>`) oder `Origin` 403. Schreibende Anfragen: eigener `Origin` und `Content-Type: application/json` (Upload `application/octet-stream`) (UI §2.15).
- CSP wörtlich: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. Anhänge mit `X-Content-Type-Options: nosniff` und `Content-Security-Policy: sandbox` (UI §2.15).
- Fehler-JSON `{"error":{code,message,hint?,details?}}` aus `errorJson`; HTTP-Status aus dem Exit-Code: 2 → 400, 3 → 404, 4 → 409, 5 → 422, 6 → 502, 1 → 500 (UI §2.3.3).
- API-JSON hat dieselben Keys wie `--format json` des entsprechenden Befehls; Tools dieselben Namen, Parameter und Ergebnisse wie die MCP-Tools, gebaut aus demselben Katalog (UI §2.3, §3.3).
- Zeitkonstanten wörtlich: Watcher-Ende 30 s nach dem letzten Abonnenten; Arbeitsbaum-Debounce 150 ms; Nachbar-Debounce 250 ms; Sicherheitsnetz 10 s; Patch-Puffer 200; Heartbeat 15 s; optimistische Anzeige 5 s; Live-Hervorhebung 1,5 s (UI §2.4, §2.5, §2.7).
- Grenzen wörtlich: Text-Anhänge inline bis 262 144 Bytes gültiges UTF-8; Graph-Sammelknoten über 150 Knoten; Suche 8 Treffer je Gruppe; initialer Chunk ≤ 300 KB gzip (UI §2.9.4, §2.9.5, §2.11, §2.16).
- Tests: isoliert wie BK §5 (`BACKE_HOME`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, Test-Keys per `ssh-keygen`). Debounce, Heartbeat und Timeouts über Fake Timers oder Test-Hooks im Code — nie echtes Warten, nie Last (UI §5).
- Coverage-Gate neu: `'src/tools/**'` und `'src/ui/**'` je `{ lines: 90, branches: 85 }` wie `src/mcp/**`. Server-Tests laufen in-process gegen `node:http` auf Port 0 und zählen.
- Neue Texte zweisprachig in `*.messages.ts` (en + de) wie im CLI; die Konsole von `backe ui` spricht nach BK §2.18, nicht fest Englisch wie MCP.
- Code, Tests und Commit-Messages nennen Dateinamen (`ui.md`), keine Kürzel (UI-Index).

## Review Focus

1. **Fremde Webseite im selben Browser** — `fetch('http://127.0.0.1:8002/api/b/x/tools/issue_create', {method:'POST', mode:'no-cors', body})` mit `Content-Type: text/plain`, ein `Host: evil.example:8002` nach DNS-Rebinding, ein Request ohne Cookie mit gültigem Token im Referer. Erwartet: 403 bzw. 401, kein Commit, kein Lesen von Daten. → U1 `rejects foreign host and origin`, U3 `a simple cross-site post never writes`.
2. **Burst und verlorene Ereignisse** — 50 schnelle CLI-Writes, `git pack-refs --all` (der Ref verschwindet aus `refs/heads/` und steht nur noch in `packed-refs`), ein manuelles `git checkout` auf einen anderen Branch. Erwartet: Nach Ruhe ist der Client-Zustand aus `hello` + allen Patches gleich einem frischen `/state`. → U2 `patches converge to a fresh state after a burst`, `packed refs still move the head`.
3. **Server-Neustart bei offenem Tab** — der Browser verbindet sich mit `Last-Event-ID` eines beendeten Prozesses neu, dessen `rev` der neue zufällig schon erreicht hat. Erwartet: `reset`, nie fremde Patches. → U2 `an event id from an earlier process gets reset`.
4. **Kaputter oder fehlender Stand** — Hand-Edit mit kaputtem Frontmatter, ungültige `.backe/backlog.jsonc` im Arbeitsbaum, eine Identität ohne eigene Arbeitskopie. Erwartet: `/state` liefert `problems` bzw. einen Fehler nach §2.3.3, der Server läuft weiter, der nächste gültige Stand kommt als Patch. → U1 `state of a backlog without own working copy`, U2 `a broken hand edit becomes a problem, the fix a patch`.
5. **Nur-lesen-Identität** — Handle ohne Key in der User-Config. Erwartet: `can_write: false` in `/api/backlogs`, jedes `POST …/tools/*` ist ein Fehler mit `hint` (Status 400), Lesen und Live-Updates funktionieren; das Frontend blendet Schreibaktionen aus. → U3 `a read-only identity cannot write`, U7 `read-only hides write actions`.

---

## Abweichungen von UI §6

- **U0 kommt dazu:** Die reine Hülle und der adapterneutrale Tool-Katalog sind Voraussetzung für Server und Client (Befunde oben).
- **Server-Writes vor dem Frontend (U3):** Tool-Endpunkte und Upload sind serverseitig fertig und über HTTP getestet, bevor die erste Ansicht entsteht; UI §6 Schritt 6 schrumpft so auf das Frontend (U7). Die API-Parität aus UI §5 lässt sich ohne Browser prüfen.
- **`dist/ui/` im Paket schon in U4:** Sobald der Build `dist/ui/` erzeugt, landet es per `files: ["dist"]` im Tarball, und die exakte Dateiliste im Pack-Smoke-Test bricht. U4 zieht Dateiliste und Smoke-Test mit; U12 erledigt den Rest von UI §6 Schritt 11.

## Meilensteine

Jeder Meilenstein endet mit grünem `mise run check`, `mise run smoke` und einem abnehmbaren Stand. »Produziert« nennt, worauf spätere Meilensteine bauen.

### U0 — Vorlauf in BK: reine Hülle, Tool-Katalog, Listenfilter

- **Inhalt:** Reine Hülle (`core/env.ts`, `locale()` ohne `context/`, `ids.ts` über `globalThis.crypto`, `ssh.ts` ohne `Buffer` und `node:crypto`, `sshFingerprint` nach `core/fingerprint.ts`), Konventionstest der Web-Hülle; `selectIssues` als reiner Filter in `src/ops/issue-query.ts`; `syncStatusJson` nach `views.ts`; Tool-Katalog `src/tools/`, MCP registriert daraus. Proposals: BK §2.20 (Schicht `tools/`, Reinheitsregel aus UI §4.2), ui.md (Präzisierungen Event-ID und Theme-Skript, Wunsch 3 gestrichen).
- **Abnahme:** keine Verhaltensänderung — alle MCP- und E2E-Golden-Files byte-gleich.
- **Produziert:** `ToolDef`, `TOOLS`, `toolsFor`, `ToolEnv`, `runTool`, `writeQueue`, `pendingStarts` (`src/tools/`); `selectIssues`, `IssueSelector` (`src/ops/issue-query.ts`); `syncStatusJson` (`src/services/views.ts`); `WEB_ENTRIES` und `webClosure()` (`test/helpers/web-closure.ts`).

### U1 — Server-Gerüst und Lesen

- **Spec:** UI §2.1, §2.3.1 (ohne `events`), §2.3.3, §2.15, §2.16 »Server«.
- **Inhalt:** Befehl `backe ui [-p|--port] [--open]`; Start-Backlog und Fehlerfälle aus §2.1; Sitzung (Token → Cookie → Redirect), Host-/Origin-Prüfung, Sicherheits-Header; `GET /api/backlogs`, `/state`, `/issues/<id>`, `/issues/<id>/attachments/<name>`, `/search`; statische Auslieferung von `dist/ui/` mit SPA-Fallback und eingebautem Platzhalter, solange nichts gebaut ist; Ende bei SIGINT/SIGTERM.
- **Produziert:** `src/ui/api.ts` (reine Typen: `BacklogsJson`, `StateJson`, Entitäts-JSON), `createUiServer(opts): UiServer` mit `listen()`/`close()`, `uiContext(backlog)`, `httpStatus(err)`.

### U2 — Live-Kern

- **Spec:** UI §2.4.1 Punkte 1, 2, 4, 5 und Sync-Zustand; §2.4.2; §2.4.3.
- **Inhalt:** `LiveBacklog` je abonniertem Backlog: Ref-Watch (`refs/heads/`, `packed-refs`, `HEAD`), Arbeitsbaum-Watch, Sicherheitsnetz, Watch auf `.git/backe/sync.json` und `conflicts/`; Delta über `git diff --name-only -z` und `snapshotAt`; SSE mit `hello`/`patch`/`sync`/`reset`, Ring-Puffer 200, Heartbeat, Ende 30 s nach dem letzten Abonnenten. Periodischer Sync im Takt von `pull_interval` je beobachtetem Backlog (§2.4.1 Punkt 4).
- **Produziert:** `PatchJson`, `ServerEvent` in `api.ts`; `LiveBacklog.subscribe(listener, lastEventId?)`; Test-Hooks zum Unterdrücken von `fs.watch`-Ereignissen.

### U3 — Server-Writes

- **Spec:** UI §2.3.2, §2.15 »Uploads«.
- **Inhalt:** `POST /api/b/<b>/tools/<tool>` über `toolsFor('ui')`; Warteschlange und Hintergrund-Sync je Backlog (`runTool`); Katalog-Einträge nur für `ui`: `issue_delete` (immer), `issue_link`, `issue_unlink`, `comment_edit`, `comment_delete`, `attachment_rm`, `project_create|mv|rm`, `sprint_create|close`, `repo_add|rm|check`, `user_add|create_agent|revoke_key|rm`; `PUT …/attachments/<name>` mit Abbruch bei `attachments.max_bytes`, Temp-Datei im eigenen Temp-Verzeichnis; Ende wartet auf Warteschlangen, Hintergrund-Starts und synchrone Aufrufe aller Backlogs.
- **Produziert:** vollständige Server-API; Paritätstests Tool ↔ MCP ↔ CLI.

### U4 — Frontend-Gerüst

- **Spec:** UI §2.2 (`web/`), §2.5 Transport/Store/Hook, §2.6, §2.13, §2.14, §2.16 »Build«, »Lint und Typen«.
- **Inhalt:** `web/` mit Vite, React, Tailwind, shadcn/ui; Theme hell/dunkel/System per `/theme.js`; Routing `/b/<backlog>/…`; Kopfzeile mit Backlog-Umschalter, Identität, Sync-Anzeige, Theme; Tab-Leiste mit festen und Issue-Tabs; `Connection` (eventize) und `Store` (signalize) samt `useSignal`; Sprache aus `lang`; `pnpm build` baut beide, `pnpm dev:ui` mit Proxy und `BACKE_UI_DEV_ORIGIN`; Biome und `tsc` über `web/`; Vitest-Projekt `web` mit jsdom; `dist/ui/**` im Tarball, Pack-Smoke-Test startet `backe ui --port 0` und ruft Start-URL und `/api/backlogs` ab.
- **Produziert:** `Connection`, `Store` (Signale je Entität, Key-Mengen, `toSnapshot()` als Memo für die Graph-Funktionen), `useSignal`, `useStore`, App-Shell, Tab-Modell.

### U5 — Tab Backlog

- **Spec:** UI §2.7 (ohne Schreibaktionen).
- **Inhalt:** Filterleiste mit `issue list`-Semantik über `selectIssues`; Baum/flach, Sortierung; Zeilen; virtualisierte Liste; Live-Hervorhebung; Filter in der URL, übriger Ansichtszustand im `localStorage` (fehlertolerant).
- **Produziert:** Filter-Modell `ListFilter` ↔ URL; Paritätstest Client-Filter gegen `issue list --format json` auf Fixture-Backlogs.

### U6 — Tab Issue lesend

- **Spec:** UI §2.9.1 (lesend), §2.9.2 Rendering und Mermaid, §2.9.3 (lesend), §2.9.4 (lesend).
- **Inhalt:** Felder links/rechts; Markdown-Pipeline mit Sanitize-Allowlist, Issue-ID-Links, relative Bildpfade, Emoji-Shortcodes; Mermaid als Lazy-Chunk; Zeitleiste; Anhänge mit Vorschau; Neuladen bei `upsert`/`touched`; Tab »gelöscht«.
- **Produziert:** `<Markdown>`-Komponente (wiederverwendet in U7, U10).

### U7 — Writes im Frontend

- **Spec:** UI §2.5 »Optimistische Anzeige«, §2.7 Aktionen, §2.9.1 Bearbeiten und Aktionen, §2.9.2 Editor und paralleles Ändern, §2.9.3 Schreiben, §2.9.4 Hochladen/Entfernen, §2.12.
- **Inhalt:** `callTool(name, args)` im Client; lokaler Repo-Pfad über `repo_locate` (§2.9.1; `repo_locate` ist ein Tool und verlangt Schreibrecht, ui.md §2.3.2); Feld-Editoren inkl. deklarierter Properties; Editor mit Vorschau und Bild-Upload; Kommentare; Issue anlegen (`c`); Kontextmenü und Zeilen-Drag in Backlog; Ausstehend-Überlagerung mit 5-s-Rückfall auf `/state`; Fehler mit `hint`; Nur-lesen blendet aus.
- **Produziert:** `callTool`, `Pending`-Overlay im Store, Dialog-Bausteine.

### U8 — Tab Board

- **Spec:** UI §2.8, §3.7.
- **Inhalt:** Bahnen, Spalten der Hauptlinie, Seitenzustände in der Spalte von `paused_from`; Drag & Drop mit `@dnd-kit` (Spalte → `issue_move`, Reihenfolge → `issue_rank`, Bahn + Spalte → ein `batch`); Rücksprung und `done`-Dialog mit `force`; Kartenmenü als Tastaturalternative; Schnell-Anlegen.

### U9 — Abhängigkeitsgraph

- **Spec:** UI §2.9.5, §3.8.
- **Inhalt:** Graph aus dem Store mit `dagre`-Layout in `@xyflow/react`, Tiefe 2, aufklappbar, Sammelknoten über 150; Baumansicht; beides als Lazy-Chunk.

### U10 — Settings und Suche

- **Spec:** UI §2.10 (ohne Benachrichtigungen), §2.11.
- **Inhalt:** Abschnitte Repositories, Projects, Sprints, Users & Agents, Backlog, Oberfläche; Policy-Ausblendung; Suche auf dem Store mit `⌘K`, Gruppen, exakter ID-Treffer oben, »In Beschreibungen suchen« über `/search`.

### U11 — Nachbarn und Benachrichtigungen

- **Spec:** UI §2.4.1 Punkt 3, §2.10 »Browser-Benachrichtigungen«.
- **Inhalt:** Watch auf `hub.git`-Refs und Remote-Tracking-Refs der Nachbar-Arbeitskopien unter `<BACKE_HOME>/backlogs/<backlog>/`, Hintergrund-Sync nach 250 ms, nur bei `sync.mode: auto`; Benachrichtigungen nach Zustimmung.

### U12 — Paket, CI, Performance

- **Spec:** UI §2.16 »Paket«, §2.17, §5 »E2E« und »Performance«, §4.2 Wünsche 1 und 2.
- **Inhalt:** Tarball-Größe gegen die 3-MB-Schwelle aus UI §4.1 messen; Playwright-E2E in `ci.yml`; Benchmark-Skript mit 10⁴ Issues; BK §2.17 (Befehlsübersicht) und §2.21 (Tarball, Smoke-Test) nachziehen; ui.md auf `gebaut` setzen, Konsolidieren anbieten.

## Festlegungen

Stellen, die Spec offen lässt und die dieser Plan für alle Meilensteine festlegt. Präzisierungen wandern in U0 nach ui.md.

| Stelle | Festlegung |
| --- | --- |
| Schicht `src/tools/` | Adapterneutraler Katalog: `ToolDef = {name, description, input: z.ZodObject, kind, check?, surfaces: ('mcp'\|'ui')[], gate?: 'allowDelete', run(ctx, args, env)}`. `description` bleibt englisch für MCP; die UI ignoriert sie. MCP registriert `toolsFor('mcp', {allowDelete})`, die UI `toolsFor('ui', {allowDelete: true})`. Eintrittsprüfung, Warteschlange und Nachlauf (`runTool`) stehen einmal dort. |
| `batch` in der UI | Dieselbe Op-Liste wie MCP (BK §2.19) plus `issue.delete`; mehr braucht das Board nicht. |
| `attachment_add` in der UI | Parameter identisch zu MCP, auch `path` mit denselben Grenzen; das Frontend lädt aber nur per `PUT …/attachments/<name>` hoch. |
| Kontext je Backlog | `resolveContext({cwd, env, flags: {backlog: <b>, as?}})` je Anfrage, `as` aus dem Start gilt für alle Backlogs. `can_write` = `requireWriter(ctx)` gelingt. |
| `GET /api/backlogs` | `{"backlogs":[{name,current,can_write,user,prefix}],"lang":"en"\|"de"}`; `user` ist der Handle oder `null`, `prefix` der ID-Präfix oder `null`. |
| Event-ID | `id: <boot>:<rev>`; `boot` = 8 Hex-Zeichen Zufall je Serverprozess, `rev` beginnt je Backlog bei 0. `rev` in den JSON-Daten bleibt eine Zahl. `Last-Event-ID` mit anderem `boot` oder `rev` außerhalb des Puffers → `reset`. |
| Theme ohne Aufblitzen | `index.html` lädt `/theme.js` synchron im `<head>` vor allen Styles; es liest `localStorage` (try/catch) und `prefers-color-scheme` und setzt `data-theme` auf `<html>`. Kein Inline-Skript, CSP bleibt wörtlich. |
| Sprache | Der Server bestimmt die Locale nach BK §2.18 (`initLocale`), nicht fest Englisch wie MCP; `lang` in `/api/backlogs`. Das Frontend setzt seine Locale per `setLocale(lang)` vor dem ersten Rendern. |
| Port belegt | `listen` mit `EADDRINUSE` → `BackeError('sync', …)` (Exit-Code 6). |
| `--open` | `xdg-open` (Linux) bzw. `open` (macOS) detached; scheitert der Start, eine Hinweiszeile auf stderr, Exit bleibt 0. |
| Statisches Verzeichnis | `new URL('./ui/', import.meta.url)` relativ zu `dist/cli.js`, überschreibbar per Option für Tests. Fehlt `index.html`, liefert der Server eine eingebaute Platzhalterseite. |
| Imports im Frontend | Vite-Alias `@backe/` → `src/`, gleiche `paths` in `web/tsconfig.json`; nur Module aus `WEB_ENTRIES` und deren Hülle. |
| Text-Filter im Tab Backlog | Der Client hat keine Bodies (UI §3.4). Text filtert lokal über Titel und sofort; zusätzlich holt `/search?q=` die IDs mit Treffer im Body und vereinigt sie. Ergebnis gleich `issue list -q`. |
| Snapshot im Client | `toSnapshot()` baut aus dem Store ein `BacklogSnapshot` mit `body: ''`, damit `graph.ts` und `selectIssues` unverändert laufen; als Memo, neu nur bei Änderungen an Issues, Config oder Projekten. |

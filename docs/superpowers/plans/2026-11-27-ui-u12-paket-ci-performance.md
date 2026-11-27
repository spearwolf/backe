# backe ui U12 — Paket, CI, Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backe ui` ist fertig ausgeliefert: Der Anteil von `dist/ui/` am Tarball ist gemessen und gegen die 3-MB-Schwelle geprüft, Playwright-E2E laufen in drei Browsern lokal und in der CI, ein Benchmark-Skript prüft jedes Ziel aus ui.md §2.17 an 10⁴ Issues, und das Board hält das Ziel »Board-Drag bis zur optimistischen Anzeige im selben Frame« auch mit einigen tausend Karten.

**Architecture:** Paket: `scripts/pack-smoke.sh` misst den Anteil von `dist/ui/` als Differenz zweier gleich gepackter Tarballs (mit und ohne `dist/ui/`) und bricht über 3 MiB ab; `scripts/check-ui-build.ts` meldet die Größe des initialen Chunks. E2E: `@playwright/test` gegen das gebaute `dist/cli.js`; jeder Test bekommt ein frisches `BACKE_HOME` mit zwei Backlogs und einen eigenen `backe ui --port 0`. Benchmark: `scripts/bench-ui.ts` erzeugt ein Backlog mit 10⁴ Issues (deterministisch, `scripts/bench-backlog.ts`) samt Nachbar-Arbeitskopien, startet `backe ui` und misst Server und Chromium (rAF-Zeitstempel, CDP-Drosselung nur der Messseite). Board: Nur Zellen sind Drop-Ziele, die Einfügestelle kommt aus Zeiger-Y und den Kartenrechtecken der Zielzelle (binäre Suche); gezogen wird über **eine** Drag-Quelle der Ansicht statt über `useDraggable` je Karte, damit der Kontext von dnd-kit beim Start und Ende eines Zugs nur eine Handvoll Komponenten neu rendert.

**Tech Stack:** wie U11. Neu als devDependency: `@playwright/test` `^1.65.1`. Keine neue Runtime-Abhängigkeit.

**Spec:** `docs/proposals/ui.md` §2.16 »Paket« und »Code-Splitting«, §2.17, §4.1 (Zeile »Hauptpaket bis +3 MB Tarball«), §4.2 Wunsch 1, §5 »E2E« und »Performance«, §6 Schritt 11; BK `docs/proposals/backe.md` §2.17 (Befehlsübersicht), §2.21 (CI, Paket, Pack-Smoke-Test). Gesamtplan `docs/superpowers/plans/2026-11-26-ui-gesamtplan.md` (U12, Global Constraints, Review Focus, »Abweichungen von UI §6«: Dateiliste und Pack-Smoke-Test hat U4 schon mitgezogen). ui.md ist `in Umsetzung`.

## Ausgangslage (gemessen am 2026-11-27, Ryzen 9 7900X3D, 24 Threads, 60 GB RAM, CachyOS, Node 26.13.1)

| Messgröße | Wert |
| --- | --- |
| Tarball `spearwolf-backe-0.4.0.tgz` | 2 309 697 B; `dist/ui/` unkomprimiert 6 939 696 B in 123 Dateien |
| Initialer Chunk (Einstieg + Modulepreloads, gzip -9 per `node:zlib`) | 244 306 B von 307 200 B |
| Vite-Warnung | `index-*.js` 556 kB roh, `elk-*.js` (Mermaid-Layout, lazy) 1 502 kB roh |
| `/favicon.ico` | 404, Konsolenfehler auf jeder Seite |
| Board, 7 240 Karten in einer offenen Bahn, Chromium ohne Drosselung (Probe) | Drag-Start: Long Task 741 ms; Ziehen: Long Tasks 50–146 ms; Loslassen bis zum nächsten Frame: 303 ms |
| CLI-Write (`backe mv`) im Backlog mit 10⁴ Issues, mit Remote | ≈ 3,3 s Laufzeit des CLI-Prozesses (Snapshot aus Git-Objekten, Policy-Prüfung) |

Die Board-Probe bestätigt die Vermutung aus U8: dnd-kit vermisst beim Start jedes Drop-Ziel (je Karte eins, dazu je Ziel ein `ResizeObserver`), und jede Karte hängt per `useDraggable`/`useDroppable` am Kontext von dnd-kit und rendert bei Start, Zielwechsel und Ende neu.

## Global Constraints

Alle Global Constraints des Gesamtplans und der Pläne U1–U11. Dazu für U12:

- Schwelle Hauptpaket: Anteil von `dist/ui/` am Tarball ≤ 3 MiB = 3 145 728 B (ui.md §4.1 »bis +3 MB«, MiB wie das Chunk-Budget 300 KB = 307 200 B). Gerissen → messen, nicht umbauen, als Blocker melden.
- Initialer Chunk ≤ 307 200 B gzip (`INITIAL_CHUNK_BUDGET`, unverändert).
- Ziele aus ui.md §2.17 wörtlich: `GET /state` ≤ 1 s; erste vollständige Darstellung des Tabs Backlog ≤ 1,5 s; Write im CLI bis zur sichtbaren Änderung in allen offenen Ansichten ≤ 300 ms; Board-Drag bis zur optimistischen Anzeige im selben Frame; Scrollen ohne Frame-Drops bei 60 Hz.
- »Im selben Frame« heißt messbar: Zwischen `pointerup` und dem ersten `requestAnimationFrame` danach liegen ≤ 16,7 ms, und in diesem Frame steht die Karte schon in der Zielzelle. »Frame-Drop« heißt: Abstand zweier rAF-Zeitstempel > 25 ms (1,5 Frames bei 60 Hz).
- Drosselung nur per CDP auf der einzelnen Messseite (`Emulation.setCPUThrottlingRate`), nie Last auf der Maschine; keine Busy-Loops, kein `stress`.
- E2E warten nie per Zeit (`waitForTimeout` verboten), sondern auf Zustände (`expect(...).toBe…`, `expect.poll`). Jeder Test endet ohne Konsolenfehler und ohne Antwort ≥ 400 der App (Fixture prüft beides).
- Isolation wie die Tests: eigenes `HOME` und `BACKE_HOME` im Temp-Verzeichnis, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `XDG_CONFIG_HOME=/dev/null/xdg`, Keys per `ssh-keygen`, `sync.mode manual` (kein Hintergrund-Prozess überlebt das Temp-Verzeichnis). Server und Temp-Verzeichnisse räumt jeder Lauf selbst ab, auch nach einem Fehler.
- Neue Texte en + de in `*.messages.ts`. Keine Laufnummern von Reviews in Code, Kommentaren, Tests, Docs, Commits.
- CI-Änderungen werden nicht gepusht; `actionlint` über `.github/workflows/` ist grün.

## Festlegungen für U12

| Stelle | Festlegung |
| --- | --- |
| Messung des Tarball-Anteils | Im Pack-Smoke-Test: Tarball entpacken, `package/` zweimal mit `tar -cf - … \| gzip -9` packen, einmal mit `--exclude package/dist/ui`; Anteil = Differenz der Größen. Portabel für GNU tar und bsdtar (macOS-Shard). Ausgabe in der Erfolgszeile: `pack-smoke: ok <version> (tarball <n> B, dist/ui <m> B of 3145728)`. |
| Vite-Warnung | `build.chunkSizeWarningLimit: 2048` (kB roh) in `web/vite.config.ts`, mit Kommentar: Das Budget prüft `check-ui-build.ts` am initialen Chunk; über 500 kB liegen nur der Einstieg (gzip im Budget) und der Lazy-Chunk des ELK-Layouts von Mermaid. |
| Favicon | `web/public/favicon.svg` (Graustufen, keine Markenfarbe nach ui.md §2.13, eigenes `prefers-color-scheme` im SVG), `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` in `web/index.html` nach `theme.js`. Der Pack-Smoke-Test verlangt `package/dist/ui/favicon.svg`. |
| E2E-Ort | `playwright.config.ts` im Wurzelverzeichnis, Specs `test/browser/*.spec.ts`, Fixture `test/browser/fixture.ts`. Vitest schließt `test/browser/**` aus. Projekte `chromium`, `firefox`, `webkit`; `fullyParallel: true`, `workers` nach Default, `retries: 0` lokal und `1` mit `CI`; `forbidOnly` mit `CI`; Trace `retain-on-failure`. |
| E2E-Aufruf | `package.json`: `"test:e2e": "playwright test"`. `mise.toml`: Task `e2e` = `build`, dann `pnpm run test:e2e`. Nicht Teil von `mise run check` (braucht Browser). |
| CI-Job | `ci.yml` bekommt Job `e2e` (ubuntu-latest, `permissions: contents: read`): Checkout ohne Credentials, `jdx/mise-action@v5`, `pnpm install --frozen-lockfile`, `mise run build`, `pnpm exec playwright install --with-deps chromium firefox webkit`, `pnpm run test:e2e`; bei Fehler Upload von `test-results/` als Artifact (`retention-days: 7`). |
| Benchmark-Backlog | `scripts/bench-backlog.ts`, deterministisch je Index: 10 Projekte, 12 Sprints (10 geschlossen, 2 offen), States nach Anteilen `done` 45 %, `backlog` 20 %, `todo` 13 %, `in_progress` 8 %, `review` 5 %, `blocked` 3 %, `on_hold` 2 %, `cancelled` 2 %, `rejected` 2 %; erledigte Issues in geschlossenen Sprints, offene zu zwei Dritteln in den offenen Sprints, sonst ohne Sprint; jedes vierte Issue `assignee: spw`, jedes 17. mit `depends_on` auf ein früheres; `rank` = Index × 1000. Geschrieben als Dateien in die Arbeitskopie, committet per `backe commit` in Blöcken zu höchstens 800 Issues (Batch-Grenze 1000 Operationen), danach `backe sync` gegen ein Bare-Remote. |
| Nachbarn im Benchmark | 20 Klone des Remotes ohne Checkout (`git clone --no-checkout`) unter `<BACKE_HOME>/backlogs/bench/agent-<n>`: Sie tragen `refs/remotes/origin/main` und sind damit Nachbarn nach ui.md §2.4.1 Punkt 3. |
| Board-Szenarien | Default-Ansicht (Gruppierung Sprint) und Gruppierung `none` (alle Karten außer `backlog`, `cancelled`, `rejected` in einer Bahn, ≈ 7 600 Karten); Letzteres ist der Prüffall für »einige tausend Issues« (ui.md §0.4). |
| Messung CLI-Write | `t0` = Ende des CLI-Prozesses (der Ref steht), `t1` = Wanduhr im Browser, sobald der neue Titel im DOM steht, je offener Ansicht (Backlog, Board, Issue-Tab in drei Seiten). Zusätzlich die Laufzeit des CLI-Prozesses selbst, getrennt ausgewiesen: Sie gehört dem Schreibpfad von BK, nicht der UI. |
| Drop-Ziel | Nur Zellen (`useDroppable` in einer dünnen Hülle um das `<ul>`); `CellData` trägt `list: { readonly current: HTMLUListElement \| null }`. Die Einfügestelle in derselben Zelle ist der Index der ersten Karte, deren Mitte unterhalb der Mitte der gezogenen Kopie liegt (binäre Suche über `list.current.children`, misst O(log n) Karten zur Zeit des Ereignisses); kein solcher Index → ans Ende. In einer anderen Zelle bleibt es beim Zellwechsel ohne Rang (ui.md §2.8). |
| Drag-Quelle | Eine Komponente `CardDragSource` je Board hält das einzige `useDraggable({ id: 'board-card', data })`. Ein `pointerdown` an einer Karte (delegiert am Board, nur aus dem Knoten selbst, wie `ownListeners`) setzt die gedrückte Karte (`CardData`) als `data` und den Knoten per `setNodeRef`, dann ruft er den `onPointerDown`-Listener der Quelle. Die gezogene Karte bekommt `data-dragging` am `<li>` direkt (Klasse `data-[dragging]:opacity-50`), ohne Render der Karte. Karten rufen keinen Hook von dnd-kit mehr. |
| Rendern großer Zellen | Karten tragen `content-visibility: auto` mit `contain-intrinsic-size: auto 4.5rem`, damit Layout und Paint nur für sichtbare Karten anfallen. |

## Review Focus

1. **Ziehen, während das Board scrollt** — die Karte wird an den unteren Rand gezogen, dnd-kit scrollt die Fläche, abgelegt wird in der Mitte der Zelle. Erwartet: Die Einfügestelle folgt den Rechtecken zum Zeitpunkt des Ablegens, nicht denen vom Start. → Task 6 `the slot comes from the card rects at the time of the event`.
2. **Ablegen am eigenen Platz, in Lücken, unter der letzten Karte, in einer leeren Zelle** — Erwartet: kein Zug am eigenen Platz und zwischen eigener und Nachbarkarte; unter der letzten Karte ans Ende; leere Zelle ans Ende ohne Fehler. → Task 6 `slotAt finds the first card below the centre`, `dropping a card on its own slot is no move`.
3. **Patch während des Ziehens** — ein Live-Patch entfernt oder verschiebt Karten der Zielzelle, während eine Karte gezogen wird. Erwartet: Das Ablegen rechnet gegen das aktuelle Modell; eine Karte im DOM, die das Modell nicht mehr kennt, ergibt keinen Anker und keinen Fehler. → Task 6 `a card the model no longer knows anchors nothing`.
4. **Abgebrochener E2E-Lauf** — ein Test scheitert oder der Lauf wird abgebrochen. Erwartet: kein `backe ui`-Prozess und kein Temp-Verzeichnis bleibt zurück. → Task 3 Fixture räumt in `finally` ab; Step »nach dem Lauf: `pgrep -f 'dist/cli.js ui'` leer«.
5. **Tarball-Messung auf macOS** — der Pack-Smoke-Test läuft im macOS-Shard mit bsdtar. Erwartet: dieselbe Messung ohne GNU-Optionen. → Task 2 nutzt nur `tar -xzf`, `tar -cf - --exclude … -C`, `gzip -9`, `wc -c`; Step prüft die Befehlszeile gegen die bsdtar-Manpage-Optionen (`-c`, `-f`, `-C`, `--exclude`).

---

### Task 1: Favicon

**Files:**
- Create: `web/public/favicon.svg`
- Modify: `web/index.html`, `scripts/pack-smoke.sh` (Dateiliste `dist/ui`), `scripts/check-ui-build.ts` (fehlendes `favicon.svg` ist ein Verstoß), `scripts/check-ui-build.test.ts`

- [ ] **Step 1: Failing test** in `scripts/check-ui-build.test.ts`: `a missing favicon is a problem` — ein Build-Verzeichnis ohne `favicon.svg` liefert `['favicon.svg is missing']` (bestehende Fixtures der Datei bekommen ein `favicon.svg`).
- [ ] **Step 2:** `pnpm vitest run scripts/check-ui-build.test.ts` → FAIL.
- [ ] **Step 3:** `checkUiBuild` prüft `favicon.svg` wie `theme.js`; SVG anlegen (32×32-ViewBox, ein Brotlaib aus Pfaden, `currentColor` über `<style>` mit `prefers-color-scheme`), Link in `index.html` nach dem `theme.js`-Skript; `pack-smoke.sh` verlangt `package/dist/ui/favicon.svg` und lässt es in der Stray-Prüfung zu.
- [ ] **Step 4:** `pnpm vitest run scripts/check-ui-build.test.ts` → PASS; `pnpm run build` → `dist/ui/favicon.svg` vorhanden, `dist/ui/index.html` enthält den Link.
- [ ] **Step 5: Commit** `fix: backe ui liefert ein eigenes Favicon statt eines 404`

### Task 2: Tarball-Anteil und Chunk-Größe messen

**Files:**
- Modify: `scripts/pack-smoke.sh`, `scripts/check-ui-build.ts` (Erfolgszeile), `scripts/check-ui-build.test.ts`, `web/vite.config.ts`

**Interfaces:**
- Produces: `checkUiBuild(dir): Promise<{ problems: string[]; initialGzip: number }>` (statt `string[]`); CLI-Ausgabe bei Erfolg auf stdout `check-ui-build: initial chunk <n> B gzip of 307200`.

- [ ] **Step 1: Failing test** `reports the gzip size of the initial chunk`: `initialGzip` gleich der Summe von `gzipSync(level 9)` über Einstieg und Modulepreloads der Fixture.
- [ ] **Step 2:** Test → FAIL. **Step 3:** umsetzen, bestehende Aufrufer/Tests auf `.problems` umstellen. **Step 4:** Test → PASS.
- [ ] **Step 5:** `pack-smoke.sh`: nach der Dateiliste `UI_LIMIT=3145728`; Anteil wie in den Festlegungen messen, über der Grenze `fail "dist/ui vergrößert den Tarball um <m> B, mehr als 3145728 B (ui.md §4.1)"`; Erfolgszeile mit beiden Zahlen. Nur portable Optionen (Review Focus 5).
- [ ] **Step 6:** `chunkSizeWarningLimit: 2048` samt Kommentar; `pnpm run build 2>&1 | grep -c 'larger than'` → 0.
- [ ] **Step 7:** `mise run smoke` → `pack-smoke: ok 0.4.0 (tarball … B, dist/ui … B of 3145728)`; Werte in diesen Plan unter »Ergebnisse« eintragen.
- [ ] **Step 8: Commit** `test: Pack-Smoke-Test misst den Anteil der UI am Tarball` (Body: gemessene Zahlen).

### Task 3: Playwright-Gerüst und erste E2E

**Files:**
- Create: `playwright.config.ts`, `test/browser/fixture.ts`, `test/browser/backlog.spec.ts`
- Modify: `package.json` (devDependency `@playwright/test` `^1.65.1`, Script `test:e2e`), `pnpm-lock.yaml`, `mise.toml` (Task `e2e`), `vitest.config.ts` (Exclude `test/browser/**` im Projekt `node`), `.gitignore` (`test-results/`, `playwright-report/`)

**Interfaces:**
- Produces (`test/browser/fixture.ts`):

```ts
export type UiHome = {
  /** Temp-Wurzel; `home/` und `.backe/` darunter. */
  dir: string;
  env: Record<string, string>;
  /** Arbeitskopien der Backlogs `acme` (Präfix `ac`, Start-Backlog) und `beta` (Präfix `bt`). */
  acme: string;
  beta: string;
  /** `node dist/cli.js …` in `cwd` (Default `acme`), wirft bei Exit ≠ 0. */
  cli(args: string[], cwd?: string): Promise<string>;
};
export type UiServer = { url: string; origin: string; stop(): Promise<void> };
export const test: TestType<{ home: UiHome; ui: UiServer; app: Page }, object>;
export { expect } from '@playwright/test';
```

  `home` legt an (Temp-Verzeichnis, Key, `backe init` beider Backlogs mit Bare-Remote, `sync.mode manual`), `ui` startet `backe ui --port 0` in `acme` und liest die Startzeile, `app` ist `page` nach dem Öffnen der Start-URL (Cookie gesetzt, `/b/acme/backlog` geladen) und sammelt Konsolenfehler und Antworten ≥ 400; nach dem Test `expect(errors).toEqual([])`. Abbau in `finally`: SIGTERM, nach 5 s SIGKILL, Temp-Verzeichnis weg.

- [ ] **Step 1:** Spec `backlog.spec.ts` mit `creates an issue with c and shows it` (Taste `c`, Titel, Anlegen → Zeile mit dem Titel; `cli(['show', id, '--json', '--fields', 'title'])` zeigt ihn), `edits the title in the issue tab` (Zeile öffnen, Titel ändern, Enter → CLI zeigt den neuen Titel), `a parallel CLI write appears without reload` (`cli(['new', '-t', 'Parallel'])` → Zeile erscheint; `page.on('framenavigated')` zählt keine neue Navigation), `switches the backlog` (Umschalter → URL `/b/beta/backlog`, Zeile eines `beta`-Issues sichtbar).
- [ ] **Step 2:** `pnpm exec playwright test` → FAIL (Fixture fehlt).
- [ ] **Step 3:** Fixture und Config umsetzen.
- [ ] **Step 4:** `mise run e2e` → alle Tests in allen drei Projekten PASS; danach `pgrep -f 'dist/cli.js ui'` leer (Review Focus 4). `pnpm vitest run --project node` findet keine Spec aus `test/browser/`.
- [ ] **Step 5:** `mise run lint` → grün (Config und Specs unter `tsc` des Wurzelprojekts).
- [ ] **Step 6: Commit** `test: Playwright-E2E gegen das gebaute backe ui` (Body: `@playwright/test` 1.65.1).

### Task 4: Restliche E2E aus ui.md §5 und CI-Job

**Files:**
- Create: `test/browser/board.spec.ts`, `test/browser/issue.spec.ts`, `test/browser/theme.spec.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1:** Specs:
  - `board.spec.ts`: `moves a card by drag and drop` (Karte per `page.mouse` von `todo` nach `in_progress` derselben Bahn → Karte in der Zielzelle, CLI zeigt `in_progress`), `moves a card by keyboard` (Kartenlink fokussieren, `Alt+ArrowRight` → wie oben), `reorders within a cell by drag and drop` (dritte Karte über die erste → `cli ls` zeigt die neue Reihenfolge).
  - `issue.spec.ts`: `renders mermaid` (Issue mit ```` ```mermaid ```` -Block per `cli new -d` → `svg` im Diagramm-Block sichtbar, kein Fehlertext), `uploads an image attachment and shows it` (`setInputFiles` mit einer 1×1-PNG → Vorschau-`img` mit `naturalWidth > 0`; `cli(['attach', 'list', id, '--json'])` nennt den Anhang).
  - `theme.spec.ts`: `dark theme without a flash` (Init-Skript setzt `backe-ui-theme=dark` und protokolliert per `MutationObserver` jeden Wert von `data-theme` ab dem ersten Element; nach dem Laden ist das Protokoll `['dark']`), `switching the theme survives a reload without a flash` (Umschalter auf dunkel, Reload, Protokoll `['dark']`, `colorScheme: 'light'` emuliert).
- [ ] **Step 2:** `mise run e2e` → PASS in allen drei Projekten (rot gewordene Tests nach `superpowers:systematic-debugging`, nie per Wartezeit).
- [ ] **Step 3:** Job `e2e` nach den Festlegungen in `ci.yml`; `actionlint .github/workflows/*.yml` → keine Meldung.
- [ ] **Step 4: Commit** `ci: Playwright-E2E in der CI, Board, Mermaid, Anhänge, Theme`

### Task 5: Benchmark-Skript mit 10⁴ Issues

**Files:**
- Create: `scripts/bench-backlog.ts`, `scripts/bench-backlog.test.ts`, `scripts/bench-ui.ts`

**Interfaces:**
- Produces:

```ts
// scripts/bench-backlog.ts
export const BENCH_PROJECTS: readonly string[];          // 10 Pfade
export const BENCH_SPRINTS: readonly { slug: string; closed: boolean }[]; // 12
/** Frontmatter des Issues `i` von `n` nach den Festlegungen (deterministisch). */
export function benchIssue(i: number, n: number): Record<string, unknown>;
/** Schreibt Sprints, Projekte und die Issues `[from, to)` als Dateien in die Arbeitskopie `root`. */
export function writeBenchFiles(root: string, n: number, from: number, to: number): Promise<void>;
```

  `scripts/bench-ui.ts`: Aufruf `node scripts/bench-ui.ts [--issues 10000] [--neighbors 20] [--runs 5]`; legt alles im Temp-Verzeichnis an, räumt in `finally` ab, druckt Rechner-Kontext (CPU, Threads, RAM, OS, Node, Chromium-Version) und eine Markdown-Tabelle `Ziel | Messung | Wert | erreicht`. Kein Teil von `mise run check`.

- [ ] **Step 1: Failing test** `bench-backlog.test.ts`: `the state shares match the plan` (für n = 10 000 je State die Anteile aus den Festlegungen ± 1 Prozentpunkt), `done issues sit in closed sprints`, `dependencies point backwards` (jedes `depends_on`/`blocked_by` < i), `a small bench backlog loads without problems` (`writeBenchFiles` mit n = 60 in ein Temp-Verzeichnis samt `backlog.jsonc` und User → `loadSnapshot` liefert 60 Issues, `problems` leer).
- [ ] **Step 2:** FAIL → **Step 3:** umsetzen → **Step 4:** PASS.
- [ ] **Step 5:** `bench-ui.ts` mit den Messungen:
  - `GET /state`: erster Abruf (kalt, ohne Watcher) und Median von `--runs` warmen Abrufen, per `node:http` mit Cookie.
  - Tab Backlog: je Lauf neuer Browser-Kontext, `page.goto('/b/bench/backlog')`; ein Init-Skript nimmt `performance.now()` im ersten rAF, in dem die Liste Zeilen (`li[data-id]`) zeigt und kein Ladehinweis steht. Median ohne Drosselung und mit CDP-Drosselung 4×.
  - CLI-Write: drei Seiten (Backlog, Board mit Gruppierung `none`, Issue-Tab) auf ein Issue in `todo` mit kleinstem `rank`; 10 × `backe issue edit <id> --title "Bench <k>"`, je Write `t1 − t0` je Seite (Median, Maximum) und CLI-Laufzeit; die Writes verteilen sich über mehr als einen 10-s-Takt des Sicherheitsnetzes, die 20 Nachbarn sind beobachtet.
  - Board-Drag: Szenarien Default und `none`; Zug einer Karte von `todo` nach `in_progress` derselben Bahn per `page.mouse`; im Seitenkontext laufender rAF-Logger; Werte: größter rAF-Abstand beim Start (erste 300 ms nach dem Druck), beim Ziehen, und `pointerup` → erster rAF samt Prüfung, dass die Karte in diesem Frame in der Zielzelle steht. Je 5 Züge, Maximum.
  - Scrollen: Tab Backlog, rAF-Schleife setzt `scrollTop` der Liste je Frame um 48 px weiter, 4 s lang; Anzahl Frame-Drops, p95 und Maximum der Abstände; ohne Drosselung und mit 4×.
- [ ] **Step 6:** `node scripts/bench-ui.ts` laufen lassen; Tabelle als »vorher« unter »Ergebnisse« eintragen. Ein verfehltes Ziel außer Board-Drag (Task 6) bekommt einen eigenen Task in diesem Plan, sofern es sich ohne Architekturänderung beheben lässt; sonst ist es ein Blocker mit Messung.
- [ ] **Step 7: Commit** `test: Benchmark der UI gegen die Ziele aus ui.md §2.17` (Body: Kurzfassung der Messung).

### Task 6: Board-Drag im selben Frame

**Files:**
- Create: `web/src/components/board/card-drag.tsx`
- Modify: `web/src/components/board/board-dnd.ts`, `board-dnd.test.ts`, `BoardCard.tsx`, `BoardLane.tsx`, `web/src/views/BoardView.tsx`, `BoardView.moves.test.tsx` (und weitere Board-Tests, die `overCard` nutzen), `web/src/styles.css` (falls `content-visibility` nicht per Tailwind-Klasse geht)

**Interfaces:**
- Produces (`board-dnd.ts`):

```ts
export type CellData = { type: 'cell'; lane: string; column: State; list?: { readonly current: HTMLUListElement | null } };
/** Erste Karte (Index), deren Mitte unterhalb von `y` liegt; `count`, wenn keine. Binäre Suche, `rectAt` misst nur O(log count) Karten. */
export function slotAt(y: number, count: number, rectAt: (i: number) => { top: number; height: number }): number;
/** Ablegen aus `active` (Karte) und `over` (Zelle); in derselben Zelle die Karte mit der ID `slotId` als `before`-Anker, ohne sie ans Ende. */
export function dropOf(active: CardData, over: CellData, slotId: string | undefined, lanes: readonly BoardLane[]): BoardDrop | undefined;
export function dropFrom(event: { active: Pick<Active, 'data' | 'rect'>; over: Pick<Over, 'data'> | null }, lanes: readonly BoardLane[]): BoardDrop | undefined;
```

- Produces (`card-drag.tsx`): `CardDragSource` (Komponente im `DndContext`) und `useCardPress(): (e: React.PointerEvent) => void` über einen Kontext, den `BoardView` an den Scrollbereich hängt.
- `boardCollision` entfällt (nur noch Zellen: `pointerWithin`, sonst `rectIntersection`).

- [ ] **Step 1: Failing tests** in `board-dnd.test.ts`: `slotAt finds the first card below the centre` (Rechtecke 0/40, 50/40, 100/40: `y=10 → 0`, `y=30 → 1`, `y=95 → 2`, `y=500 → 3`, `count=0 → 0`, und `rectAt` wird bei 1 000 Karten höchstens 11-mal gerufen), `the slot comes from the card rects at the time of the event` (`dropFrom` mit einer `list`, deren Rechtecke sich zwischen zwei Aufrufen verschieben, liefert zwei verschiedene Anker), `dropping a card on its own slot is no move` (vor sich selbst und vor die nächste Karte → `undefined`), `a card the model no longer knows anchors nothing` (Slot-ID, die `cardsIn` nicht kennt → Zug ans Ende bzw. `undefined`, kein Fehler); die bestehenden Tests auf Zellen als Ziel umgestellt.
- [ ] **Step 2:** `pnpm vitest run web/src/components/board` → FAIL.
- [ ] **Step 3:** `slotAt`, `dropOf`, `dropFrom` umsetzen; `BoardCell` setzt `list` (Ref des `<ul>`) in seine `CellData` und ruft `useDroppable` in einer Hülle, deren Kinder die Kartenliste als stabiles Element sind (ein Zielwechsel rendert die Hülle, nicht die Karten).
- [ ] **Step 4:** `CardDragSource` und `useCardPress` nach den Festlegungen; `BoardCard` ohne Hooks von dnd-kit (Ereignisse aus Portalen ignoriert wie bisher, Schreibrecht wie bisher); `DragOverlay` bleibt; Markierung (`markerOf`) unverändert aus dem `BoardDrop`. `BoardView.moves.test.tsx` auf die neue Quelle umstellen (Ereignisse an den Handlern des `DndContext` wie bisher, `active.data.current` ist die gedrückte Karte).
- [ ] **Step 5:** `content-visibility: auto` und `contain-intrinsic-size: auto 4.5rem` an `li[data-card]`.
- [ ] **Step 6:** `pnpm vitest run --project web` → PASS; `mise run e2e` → Board-Specs PASS in allen drei Browsern.
- [ ] **Step 7:** `node scripts/bench-ui.ts` → Board-Drag in beiden Szenarien: Start, Ziehen und Loslassen ohne rAF-Abstand > 25 ms, `pointerup` → erster rAF ≤ 16,7 ms mit der Karte in der Zielzelle. Bleibt ein Wert darüber: Profil (CDP `Profiler`) des Abschnitts, Ursache beheben (etwa `BoardModel` inkrementell rechnen), bis das Ziel steht. Werte als »nachher« eintragen.
- [ ] **Step 8: Commit** `perf: Board-Drag im selben Frame auch mit einigen tausend Karten` (Body: vorher/nachher).

### Task 7: Docs

**Files:**
- Modify: `docs/proposals/ui.md` (Status-Kopf `gebaut`, §2.16 »Paket« samt Messung, §2.17 gemessene Werte als Gegenwart, §5 »E2E« Ort und Browser, §4.1-Zeile Hauptpaket mit Messwert), `docs/proposals/backe.md` (§2.17 `backe ui [-p|--port <n>] [--open]` in die Befehlsübersicht, §2.21 Job `e2e`, Pack-Smoke-Test mit Favicon und Anteilsmessung), `ROADMAP.md` (Eintrag abhaken; Zeile »Frontend im Hauptpaket oder eigenes Paket« mit Messergebnis), dieser Plan (Ergebnisse), Gesamtplan (U12 »Produziert«)

- [ ] **Step 1:** Änderungen nach `project-harness-dev-docs` (Gegenwart, keine Historie in ui.md; Verweise mit Dokument und Abschnitt).
- [ ] **Step 2:** `pnpm exec biome check .` → grün (Docs sind ausgenommen, `ROADMAP.md` nicht).
- [ ] **Step 3: Commit** `docs: backe ui gebaut, Paket, CI und Performance in ui.md, backe.md, Roadmap`

---

## Ergebnisse

Wird in Task 2, 5 und 6 gefüllt.

Paket (Task 2, `mise run smoke`, Version 0.4.0):

| Messgröße | Wert | Grenze |
| --- | --- | --- |
| Tarball gesamt | 2 310 132 B | |
| Anteil `dist/ui` (gzip -9, Differenz zweier Packläufe) | 1 991 568 B | 3 145 728 B (ui.md §4.1) |
| Initialer Chunk (Einstieg plus Modulepreloads, gzip -9) | 244 306 B | 307 200 B |

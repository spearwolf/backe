# backe ui U12 — Paket, CI, Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backe ui` ist fertig ausgeliefert: Der Anteil von `dist/ui/` am Tarball ist gemessen und gegen die 3-MB-Schwelle geprüft, Playwright-E2E laufen in drei Browsern lokal und in der CI, ein Benchmark-Skript prüft jedes Ziel aus ui.md §2.17 an 10⁴ Issues, und das Board hält das Ziel »Board-Drag bis zur optimistischen Anzeige im selben Frame« auch mit einigen tausend Karten.

**Architecture:** Paket: `scripts/pack-smoke.sh` misst den Anteil von `dist/ui/` als Differenz zweier gleich gepackter Tarballs (mit und ohne `dist/ui/`) und bricht über 3 MiB ab; `scripts/check-ui-build.ts` meldet die Größe des initialen Chunks. E2E: `@playwright/test` gegen das gebaute `dist/cli.js`; jeder Test bekommt ein frisches `BACKE_HOME` mit zwei Backlogs und einen eigenen `backe ui --port 0`. Benchmark: `scripts/bench-ui.ts` erzeugt ein Backlog mit 10⁴ Issues (deterministisch, `scripts/bench-backlog.ts`) samt Nachbar-Arbeitskopien, startet `backe ui` und misst Server und Chromium (rAF-Zeitstempel, CDP-Drosselung nur der Messseite). Board: Nur Zellen sind Drop-Ziele, die Einfügestelle kommt aus Zeiger-Y und den Kartenrechtecken der Zielzelle (binäre Suche); gezogen wird über **eine** Drag-Quelle der Ansicht statt über `useDraggable` je Karte, und das Board rendert neben dem `DndContext`, damit ein Wechsel seines Kontexts nur eine Handvoll Komponenten berührt; Zellen ab 100 Karten virtualisieren.

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
- »Im selben Frame« heißt messbar: Im ersten `requestAnimationFrame` nach `pointerup` steht die Karte schon in der Zielzelle, und dieser Frame kommt ohne Frame-Drop (≤ 25 ms nach `pointerup`). Eine Grenze von 16,7 ms ginge nicht: Das Loslassen fällt irgendwo in einen Frame, und schon zwei Frames ohne jede Arbeit liegen headless 16,5–17,3 ms auseinander. »Frame-Drop« heißt: Abstand zweier rAF-Zeitstempel > 25 ms (1,5 Frames bei 60 Hz).
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
| Drag-Quelle | Eine Komponente `CardDragSource` (`web/src/components/board/card-drag.tsx`) hält das einzige `useDraggable({ id: 'board-card', data })`. Der Scrollbereich des Boards fängt `pointerdown` ab (`CardPress`); ein Druck an einer Karte (nur aus dem Knoten selbst, Portale zählen nicht: `pressedCard`) setzt die gedrückte Karte (`CardData`) als `data` und den Knoten per `setNodeRef`, dann ruft er den `onPointerDown`-Listener der Quelle. Ein Druck zählt nur mit primärem Zeiger und linker Taste und nur, solange kein Zug läuft oder aussteht (bis `onDragEnd`, `onDragCancel` oder `onDragAbort` über `useDndMonitor`, spätestens bis `pointerup`/`pointercancel` desselben Zeigers). Die gezogene Karte ist halb durchsichtig über eine Stilregel nach ihrer ID (`style[data-dragging]`), ohne Render der Karte; sie trifft auch ein neues `<li>` nach Auto-Scroll in einer virtualisierten Zelle. Karten rufen keinen Hook von dnd-kit mehr. |
| Board neben dem `DndContext` | Das Board rendert neben dem `DndContext`, nicht darunter. Darin stehen nur `CardDragSource`, je Zelle ein `CellTarget` ohne eigenes DOM (meldet das `<ul>` über einen geteilten Ref, `useCellDataOf`/`CellDataContext`) und das `DragOverlay`. Grund (Profil): Ändert sich ein Kontext von dnd-kit (Start, Zielwechsel, jede Bewegung über `ActiveDraggableContext`, Ende), sucht React im ganzen Teilbaum unter dem Provider nach Lesern (`propagateContextChanges`) und läuft dabei über jede Fiber jeder Karte — 100 ms je Ereignis bei 7 600 Karten, `memo` hin oder her. |
| Rendern großer Zellen | Ab `VIRTUAL_FROM` = 100 Karten virtualisiert eine Zelle (`CellCards` in `web/src/components/board/board-virtual.tsx`, `@tanstack/react-virtual` wie die Liste im Tab Backlog, Scrollbereich des Boards mit `scrollMargin` je Zelle): Gerendert werden nur Karten in Sichtweite, die übrigen stehen als Innenabstand des `<ul>`; die gerenderten bleiben direkte Kinder in ihrer Reihenfolge (`slotAt`, Markierung, Fokus unverändert). Jede Zelle rendert über dasselbe `<ul>`, unter der Schwelle mit abgeschaltetem Virtualizer: Kreuzt eine Zelle die Schwelle, bleiben Karten und Fokus. Das Fokus-Folgen holt eine Karte außerhalb der gerenderten per `VirtualCells` ins Bild; fällt die fokussierte Karte beim Scrollen aus dem Bild, geht der Fokus an das `<ul>`. Gerenderte Karten tragen `aria-posinset`/`aria-setsize`; die Marge im Scrollbereich misst jede virtualisierte Zelle nach jedem Render des Boards und bei jeder Größenänderung seines Inhalts nach (ein gemeinsamer `ResizeObserver` im Board); kleine Zellen messen nichts. Beim Umschalten über die Schwelle bekommt der Virtualizer Fläche, Scrollstand und die echten Höhen der Karten im DOM (`initialMeasurementsCache`). Eine Zelle vergisst eine fokussierte Karte, die sie per Zug verlässt; das Fokus-Folgen darf den Fokus auch von einem Zellen-`<ul>` nehmen. Die Scroll-Korrektur des Virtualizers ist aus (alle Zellen teilen einen Scrollbereich), und unter der letzten gerenderten Karte gilt die im Modell folgende als Einfügestelle. `content-visibility: auto` je Karte reichte nicht: Chrome prüft dann je Karte die Relevanz (`IntersectionObserverController::computeIntersections`, 4–16 ms je Frame bei 7 600 Karten), Hit-Testing und Abgleich der langen Liste kosten weiter, und die geschätzte Höhe verschiebt das Layout beim Hineinscrollen. |

## Review Focus

1. **Ziehen, während das Board scrollt** — die Karte wird an den unteren Rand gezogen, dnd-kit scrollt die Fläche, abgelegt wird in der Mitte der Zelle. Erwartet: Die Einfügestelle folgt den Rechtecken zum Zeitpunkt des Ablegens, nicht denen vom Start. → Task 6 `the slot comes from the card rects at the time of the event`.
2. **Ablegen am eigenen Platz, in Lücken, unter der letzten Karte, in einer leeren Zelle** — Erwartet: kein Zug am eigenen Platz und zwischen eigener und Nachbarkarte; unter der letzten Karte ans Ende; leere Zelle ans Ende ohne Fehler. → Task 6 `slotAt finds the first card below the centre`, `dropping a card on its own slot is no move`.
3. **Patch während des Ziehens** — ein Live-Patch entfernt oder verschiebt Karten der Zielzelle, während eine Karte gezogen wird. Erwartet: Das Ablegen rechnet gegen das aktuelle Modell; eine Karte im DOM, die das Modell nicht mehr kennt, ergibt keinen Anker und keinen Fehler. → Task 6 `a card the model no longer knows anchors nothing`.
4. **Abgebrochener E2E-Lauf** — ein Test scheitert oder der Lauf wird abgebrochen. Erwartet: kein `backe ui`-Prozess und kein Temp-Verzeichnis bleibt zurück. → Task 3 Fixture räumt in `finally` ab; Step »nach dem Lauf: `pgrep -f 'dist/cli.js ui'` leer«. Grenze: Wird ein Worker hart beendet (SIGKILL, OOM), läuft kein `finally`, und `backe ui` samt `backe-browser-*` bleibt zurück. Reste wegräumen kann der nächste Lauf nicht gefahrlos: Neben ihm können E2E-Läufe anderer Arbeitskopien dieselben Präfixe tragen.
5. **Tarball-Messung auf macOS** — der Pack-Smoke-Test läuft im macOS-Shard mit bsdtar. Erwartet: dieselbe Messung ohne GNU-Optionen. → Task 2 nutzt nur `tar -xzf`, `tar -cf - --exclude … -C`, `gzip -9`, `wc -c`; Step prüft die Befehlszeile gegen die bsdtar-Manpage-Optionen (`-c`, `-f`, `-C`, `--exclude`).

---

### Task 1: Favicon

**Files:**
- Create: `web/public/favicon.svg`
- Modify: `web/index.html`, `scripts/pack-smoke.sh` (Dateiliste `dist/ui`), `scripts/check-ui-build.ts` (fehlendes `favicon.svg` ist ein Verstoß), `scripts/check-ui-build.test.ts`

- [x] **Step 1: Failing test** in `scripts/check-ui-build.test.ts`: `a missing favicon is a problem` — ein Build-Verzeichnis ohne `favicon.svg` liefert `['favicon.svg is missing']` (bestehende Fixtures der Datei bekommen ein `favicon.svg`).
- [x] **Step 2:** `pnpm vitest run scripts/check-ui-build.test.ts` → FAIL.
- [x] **Step 3:** `checkUiBuild` prüft `favicon.svg` wie `theme.js`; SVG anlegen (32×32-ViewBox, ein Brotlaib aus Pfaden, `currentColor` über `<style>` mit `prefers-color-scheme`), Link in `index.html` nach dem `theme.js`-Skript; `pack-smoke.sh` verlangt `package/dist/ui/favicon.svg` und lässt es in der Stray-Prüfung zu.
- [x] **Step 4:** `pnpm vitest run scripts/check-ui-build.test.ts` → PASS; `pnpm run build` → `dist/ui/favicon.svg` vorhanden, `dist/ui/index.html` enthält den Link.
- [x] **Step 5: Commit** `fix: backe ui liefert ein eigenes Favicon statt eines 404`

### Task 2: Tarball-Anteil und Chunk-Größe messen

**Files:**
- Modify: `scripts/pack-smoke.sh`, `scripts/check-ui-build.ts` (Erfolgszeile), `scripts/check-ui-build.test.ts`, `web/vite.config.ts`

**Interfaces:**
- Produces: `checkUiBuild(dir): Promise<{ problems: string[]; initialGzip: number }>` (statt `string[]`); CLI-Ausgabe bei Erfolg auf stdout `check-ui-build: initial chunk <n> B gzip of 307200`.

- [x] **Step 1: Failing test** `reports the gzip size of the initial chunk`: `initialGzip` gleich der Summe von `gzipSync(level 9)` über Einstieg und Modulepreloads der Fixture.
- [x] **Step 2:** Test → FAIL. **Step 3:** umsetzen, bestehende Aufrufer/Tests auf `.problems` umstellen. **Step 4:** Test → PASS.
- [x] **Step 5:** `pack-smoke.sh`: nach der Dateiliste `UI_LIMIT=3145728`; Anteil wie in den Festlegungen messen, über der Grenze `fail "dist/ui vergrößert den Tarball um <m> B, mehr als 3145728 B (ui.md §4.1)"`; Erfolgszeile mit beiden Zahlen. Nur portable Optionen (Review Focus 5).
- [x] **Step 6:** `chunkSizeWarningLimit: 2048` samt Kommentar; `pnpm run build 2>&1 | grep -c 'larger than'` → 0.
- [x] **Step 7:** `mise run smoke` → `pack-smoke: ok 0.4.0 (tarball … B, dist/ui … B of 3145728)`; Werte in diesen Plan unter »Ergebnisse« eintragen.
- [x] **Step 8: Commit** `test: Pack-Smoke-Test misst den Anteil der UI am Tarball` (Body: gemessene Zahlen).

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

- [x] **Step 1:** Spec `backlog.spec.ts` mit `creates an issue with c and shows it` (Taste `c`, Titel, Anlegen → Zeile mit dem Titel; `cli(['show', id, '--json', '--fields', 'title'])` zeigt ihn), `edits the title in the issue tab` (Zeile öffnen, Titel ändern, Enter → CLI zeigt den neuen Titel), `a parallel CLI write appears without reload` (`cli(['new', '-t', 'Parallel'])` → Zeile erscheint; `page.on('framenavigated')` zählt keine neue Navigation), `switches the backlog` (Umschalter → URL `/b/beta/backlog`, Zeile eines `beta`-Issues sichtbar).
- [x] **Step 2:** `pnpm exec playwright test` → FAIL (Fixture fehlt).
- [x] **Step 3:** Fixture und Config umsetzen.
- [x] **Step 4:** `mise run e2e` → alle Tests in allen drei Projekten PASS; danach `pgrep -f 'dist/cli.js ui'` leer (Review Focus 4). `pnpm vitest run --project node` findet keine Spec aus `test/browser/`.
- [x] **Step 5:** `mise run lint` → grün (Config und Specs unter `tsc` des Wurzelprojekts).
- [x] **Step 6: Commit** `test: Playwright-E2E gegen das gebaute backe ui` (Body: `@playwright/test` 1.65.1).

### Task 4: Restliche E2E aus ui.md §5 und CI-Job

**Files:**
- Create: `test/browser/board.spec.ts`, `test/browser/issue.spec.ts`, `test/browser/theme.spec.ts`
- Modify: `.github/workflows/ci.yml`

- [x] **Step 1:** Specs:
  - `board.spec.ts`: `moves a card by drag and drop` (Karte per `page.mouse` von `todo` nach `in_progress` derselben Bahn → Karte in der Zielzelle, CLI zeigt `in_progress`), `moves a card by keyboard` (Kartenlink fokussieren, `Alt+ArrowRight` → wie oben), `reorders within a cell by drag and drop` (dritte Karte über die erste → `cli ls` zeigt die neue Reihenfolge).
  - `issue.spec.ts`: `renders mermaid` (Issue mit ```` ```mermaid ```` -Block per `cli new -d` → `svg` im Diagramm-Block sichtbar, kein Fehlertext), `uploads an image attachment and shows it` (`setInputFiles` mit einer 1×1-PNG → Vorschau-`img` mit `naturalWidth > 0`; `cli(['attach', 'list', id, '--json'])` nennt den Anhang).
  - `theme.spec.ts`: `dark theme without a flash` (Init-Skript setzt `backe-ui-theme=dark` und protokolliert per `MutationObserver` jeden Wert von `data-theme` ab dem ersten Element; nach dem Laden ist das Protokoll `['dark']`), `switching the theme survives a reload without a flash` (Umschalter auf dunkel, Reload, Protokoll `['dark']`, `colorScheme: 'light'` emuliert).
- [x] **Step 2:** `mise run e2e` → PASS in allen drei Projekten (rot gewordene Tests nach `superpowers:systematic-debugging`, nie per Wartezeit).
- [x] **Step 3:** Job `e2e` nach den Festlegungen in `ci.yml`; `actionlint .github/workflows/*.yml` → keine Meldung.
- [x] **Step 4: Commit** `ci: Playwright-E2E in der CI, Board, Mermaid, Anhänge, Theme`

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

- [x] **Step 1: Failing test** `bench-backlog.test.ts`: `the state shares match the plan` (für n = 10 000 je State die Anteile aus den Festlegungen ± 1 Prozentpunkt), `done issues sit in closed sprints`, `dependencies point backwards` (jedes `depends_on`/`blocked_by` < i), `a small bench backlog loads without problems` (`writeBenchFiles` mit n = 60 in ein Temp-Verzeichnis samt `backlog.jsonc` und User → `loadSnapshot` liefert 60 Issues, `problems` leer).
- [x] **Step 2:** FAIL → **Step 3:** umsetzen → **Step 4:** PASS.
- [x] **Step 5:** `bench-ui.ts` mit den Messungen:
  - `GET /state`: erster Abruf (kalt, ohne Watcher) und Median von `--runs` warmen Abrufen, per `node:http` mit Cookie.
  - Tab Backlog: je Lauf neuer Browser-Kontext, `page.goto('/b/bench/backlog')`; ein Init-Skript nimmt `performance.now()` im ersten rAF, in dem die Liste Zeilen (`li[data-id]`) zeigt und kein Ladehinweis steht. Median ohne Drosselung und mit CDP-Drosselung 4×.
  - CLI-Write: drei Seiten (Backlog, Board mit Gruppierung `none`, Issue-Tab) auf ein Issue in `todo` mit kleinstem `rank`; 10 × `backe issue edit <id> --title "Bench <k>"`, je Write `t1 − t0` je Seite (Median, Maximum) und CLI-Laufzeit; die Writes verteilen sich über mehr als einen 10-s-Takt des Sicherheitsnetzes, die 20 Nachbarn sind beobachtet.
  - Board-Drag: Szenarien Default und `none`; Zug einer Karte von `todo` nach `in_progress` derselben Bahn per `page.mouse`; im Seitenkontext laufender rAF-Logger; Werte: größter rAF-Abstand beim Start (erste 300 ms nach dem Druck), beim Ziehen, und `pointerup` → erster rAF samt Prüfung, dass die Karte in diesem Frame in der Zielzelle steht. Je 5 Züge, Maximum.
  - Scrollen: Tab Backlog, rAF-Schleife setzt `scrollTop` der Liste je Frame um 48 px weiter, 4 s lang; Anzahl Frame-Drops, p95 und Maximum der Abstände; ohne Drosselung und mit 4×.
- [x] **Step 6:** `node scripts/bench-ui.ts` laufen lassen; Tabelle als »vorher« unter »Ergebnisse« eintragen. Ein verfehltes Ziel außer Board-Drag (Task 6) bekommt einen eigenen Task in diesem Plan, sofern es sich ohne Architekturänderung beheben lässt; sonst ist es ein Blocker mit Messung.
- [x] **Step 7: Commit** `test: Benchmark der UI gegen die Ziele aus ui.md §2.17` (Body: Kurzfassung der Messung).

### Task 6: Board-Drag im selben Frame

**Files:**
- Create: `web/src/components/board/card-drag.tsx`, `card-drag.test.tsx`, `board-virtual.tsx`, `web/src/views/BoardView.virtual.test.tsx`
- Modify: `web/src/components/board/board-dnd.ts`, `board-dnd.test.ts`, `BoardCard.tsx`, `BoardLane.tsx`, `use-board-move.tsx`, `web/src/views/BoardView.tsx`, `BoardView.moves.test.tsx`, `BoardView.renders.test.tsx`, `scripts/bench-ui.ts` (Profil per `--trace`, Auswahl per `--only`, Diagnose bei Fristablauf)

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

- Produces (`card-drag.tsx`): `CardDragSource({ press })` und `CellTarget({ data })` (im `DndContext`, ohne DOM), `CardPress` (Handler, den der Scrollbereich ruft), `pressedCard(root, target)`, `useCellDataOf()`/`CellDataContext`/`useCellData(lane, column)`.
- Produces (`board-virtual.tsx`): `VIRTUAL_FROM`, `CellCards` (jede Zelle, virtualisiert erst ab der Schwelle, dasselbe `<ul>`), `CardSlot`, `BOARD_SCROLLER`, `RevealCard`, `VirtualCells`/`VirtualCellsContext` (Hereinholen und Nachmessen); `useBoardMove(group, reveal?)`.
- `boardCollision` bleibt, vereinfacht: nur noch Zellen, `pointerWithin`, sonst `rectIntersection`.

- [x] **Step 1: Failing tests** in `board-dnd.test.ts`: `slotAt finds the first card below the centre` (Rechtecke 0/40, 50/40, 100/40: `y=10 → 0`, `y=30 → 1`, `y=95 → 2`, `y=500 → 3`, `count=0 → 0`, und `rectAt` wird bei 1 000 Karten höchstens 11-mal gerufen), `the slot comes from the card rects at the time of the event` (`dropFrom` mit einer `list`, deren Rechtecke sich zwischen zwei Aufrufen verschieben, liefert zwei verschiedene Anker), `dropping a card on its own slot is no move` (vor sich selbst und vor die nächste Karte → `undefined`), `a card the model no longer knows anchors nothing` (Slot-ID, die `cardsIn` nicht kennt → Zug ans Ende bzw. `undefined`, kein Fehler); die bestehenden Tests auf Zellen als Ziel umgestellt.
- [x] **Step 2:** `pnpm vitest run web/src/components/board` → FAIL.
- [x] **Step 3:** `slotAt`, `dropOf`, `dropFrom` umsetzen; `BoardCell` setzt `list` (Ref des `<ul>`) in seine `CellData` und ruft `useDroppable` in einer Hülle, deren Kinder die Kartenliste als stabiles Element sind (ein Zielwechsel rendert die Hülle, nicht die Karten).
- [x] **Step 4:** `CardDragSource`, `CellTarget` und `CardPress` nach den Festlegungen (Board neben dem `DndContext`); `BoardCard` ohne Hooks von dnd-kit (Ereignisse aus Portalen ignoriert wie bisher, Schreibrecht wie bisher); `DragOverlay` bleibt; Markierung (`markerOf`) unverändert aus dem `BoardDrop`. `BoardView.moves.test.tsx` auf die neue Quelle umstellen (Ereignisse an den Handlern des `DndContext` wie bisher, `active.data.current` ist die gedrückte Karte).
- [x] **Step 5:** Große Zellen virtualisieren (Festlegung »Rendern großer Zellen«), samt Fokus-Folgen in eine virtualisierte Zelle; Tests `a big cell renders only the cards in sight`, `a small cell renders every card`, `focus follows a card moved past the rendered cards of a big cell`.
- [x] **Step 6:** `pnpm vitest run --project web` → PASS; `mise run e2e` → Board-Specs PASS in allen drei Browsern.
- [x] **Step 7:** `node scripts/bench-ui.ts` → Board-Drag in beiden Szenarien: Start, Ziehen und Loslassen ohne rAF-Abstand > 25 ms, im ersten rAF nach `pointerup` die Karte in der Zielzelle (Global Constraints »Im selben Frame«). Bleibt ein Wert darüber: Profil (CDP `Profiler`) des Abschnitts, Ursache beheben (etwa `BoardModel` inkrementell rechnen), bis das Ziel steht. Werte als »nachher« eintragen.
- [x] **Step 8: Commit** `perf: Board-Drag im selben Frame auch mit einigen tausend Karten` (Body: vorher/nachher).

### Task 7: Docs

**Files:**
- Modify: `docs/proposals/ui.md` (Status-Kopf `gebaut`, §2.16 »Paket« samt Messung, §2.17 gemessene Werte als Gegenwart, §5 »E2E« Ort und Browser, §4.1-Zeile Hauptpaket mit Messwert), `docs/proposals/backe.md` (§2.17 `backe ui [-p|--port <n>] [--open]` in die Befehlsübersicht, §2.21 Job `e2e`, Pack-Smoke-Test mit Favicon und Anteilsmessung), `ROADMAP.md` (Eintrag abhaken; Zeile »Frontend im Hauptpaket oder eigenes Paket« mit Messergebnis), dieser Plan (Ergebnisse), Gesamtplan (U12 »Produziert«)

- [x] **Step 1:** Änderungen nach `project-harness-dev-docs` (Gegenwart, keine Historie in ui.md; Verweise mit Dokument und Abschnitt).
- [x] **Step 2:** `pnpm exec biome check .` → grün (Docs sind ausgenommen, `ROADMAP.md` nicht).
- [x] **Step 3: Commit** `docs: backe ui gebaut, Paket, CI und Performance in ui.md, backe.md, Roadmap`

---

## Ergebnisse

Paket (Task 2, `mise run smoke`, Version 0.4.0):

| Messgröße | nach Task 2 | Ende U12 | Grenze |
| --- | --- | --- | --- |
| Tarball gesamt | 2 310 132 B | 2 312 037 B | |
| Anteil `dist/ui` (gzip -9, Differenz zweier Packläufe) | 1 991 568 B | 1 993 369 B | 3 145 728 B (ui.md §4.1) |
| Initialer Chunk (Einstieg plus Modulepreloads, gzip -9) | 244 306 B | 244 310 B | 307 200 B |

Benchmark »vorher« (Task 5, `node scripts/bench-ui.ts`: 10 000 Issues, 20 Nachbarn, 5 Läufe je Messung; Laufzeit 241 s samt Aufbau). Rechner: AMD Ryzen 9 7900X3D, 24 Threads, 60 GB RAM, CachyOS (Linux 7.3.6-2-cachyos), Node 26.13.1, Chromium 159.0.8154.6 (`@playwright/test` 1.65.1, headless).

| Ziel | Messung | Wert | erreicht |
| --- | --- | --- | --- |
| `GET /state` ≤ 1 s | erster Abruf (kalt, ohne Watcher, 1,7 MB) | 800 ms | ja |
| `GET /state` ≤ 1 s | Median aus 5 warmen Abrufen | 669 ms | ja |
| Tab Backlog ≤ 1,5 s | erste Zeilen ohne Ladehinweis, ohne Drosselung, Median aus 5 | 792 ms | ja |
| Tab Backlog ≤ 1,5 s | dasselbe mit CPU 4× (CDP), Median aus 5 | 1 122 ms | ja |
| CLI-Write → sichtbar ≤ 300 ms | Backlog: Median / Max ab Prozessende; Max ab Ref-Ereignis | −4 / 4 ms; 46 ms | ja |
| CLI-Write → sichtbar ≤ 300 ms | Board (`none`, 7 600 Karten): dasselbe | 19 / 27 ms; 69 ms | ja |
| CLI-Write → sichtbar ≤ 300 ms | Issue-Tab: dasselbe | 3 / 28 ms; 72 ms | ja |
| (Schreibpfad BK) | Laufzeit des CLI-Prozesses `backe issue edit`: Median / Max | 3 518 / 3 591 ms | – |
| (Live-Kern) | Server-CPU im Leerlauf, 3 Abonnenten, 20 Nachbarn, je 10 s: Node / git | 20 / 100 ms | – |
| Board-Drag im selben Frame | Default (Sprint, Bahn `2026-w47`, 3 100 Karten): Start, größter rAF-Abstand | 340 ms | nein |
| Board-Drag im selben Frame | Default: Ziehen, größter rAF-Abstand | 133 ms | nein |
| Board-Drag im selben Frame | Default: `pointerup` → erster rAF; Karte dort in der Zielzelle | 133 ms; 5/5 | nein |
| Board-Drag im selben Frame | `none` (7 600 Karten): Start, größter rAF-Abstand | 787 ms | nein |
| Board-Drag im selben Frame | `none`: Ziehen, größter rAF-Abstand | 296 ms | nein |
| Board-Drag im selben Frame | `none`: `pointerup` → erster rAF; Karte dort in der Zielzelle | 296 ms; 5/5 | nein |
| Scrollen ohne Frame-Drops | Tab Backlog, 4 s, ohne Drosselung: Drops / p95 / Max | 0 von 240 / 17,2 / 18,5 ms | ja |
| Scrollen ohne Frame-Drops | dasselbe mit CPU 4× (CDP) | 0 von 239 / 19,2 / 24,7 ms | ja |

Zur Lesart:

- CLI-Write: `t0` ist das Ende des CLI-Prozesses. Der Ref steht schon rund 40 ms früher (danach kommen Ausgabe und Exit), darum liegen einzelne Werte unter null; die Angabe »ab Ref-Ereignis« misst ab dem `fs.watch`-Ereignis auf `refs/heads/main` der Arbeitskopie und ist die strengere Zahl. Die zehn Writes verteilen sich über rund 50 s, also über mehrere Takte des Sicherheitsnetzes.
- Board-Drag: Der lange Frame des Starts beginnt rund 50 ms nach dem Druck, bei der Aktivierung nach 5 px. Mit Gruppierung `none` folgen beim Ziehen Frames von gut 50 ms je Bewegung und 150–300 ms bei jedem Zellwechsel. Die Karte steht zwar im ersten Frame nach `pointerup` in der Zielzelle (5/5), dieser Frame kommt aber 133 bzw. 296 ms nach dem Loslassen. Behebt Task 6.
- Außer Board-Drag ist kein Ziel verfehlt, darum kein weiterer Task. Am knappsten ist `GET /state` (Reserve rund 20–30 %): Jeder Abruf lädt den Snapshot neu aus dem Arbeitsbaum (`openSnapshot` in `src/ui/state.ts:34`), und laut CPU-Profil des Servers (`--cpu-prof`) entfallen rund 85 % seiner CPU-Zeit auf `parseIssue`, überwiegend auf `parseFrontmatter` (`src/store/frontmatter.ts:91`, YAML-Parser und Composer je `issue.md`). Läuft für das Backlog ein Watcher, hält er denselben Stand schon als fortgeschriebenen Snapshot; `/state` könnte ihn nutzen, statt 10⁴ Dateien neu zu parsen.
- Live-Kern mit 20 Nachbarn: Im Leerlauf kostet er 20 ms Node-CPU und 100 ms in git-Kindprozessen je 10 s (Sicherheitsnetz: `git rev-parse` je Nachbar, `git status`, `HEAD`). Ein rekursiver `fs.watch` auf `issues/` mit 10⁴ Issues kostet im Leerlauf nichts Messbares (Einzelversuch: 0 ms CPU in 20 s).

Benchmark »nachher« (Task 6, gleicher Aufruf und Rechner; Laufzeit 207 s). Die Zeilen für Board-Drag gelten nach »Im selben Frame« aus den Global Constraints (erster rAF nach `pointerup` ohne Drop, Karte darin in der Zielzelle):

| Ziel | Messung | vorher | nachher | erreicht |
| --- | --- | --- | --- | --- |
| `GET /state` ≤ 1 s | erster Abruf (kalt) / Median aus 5 warmen | 800 / 669 ms | 779 / 656 ms | ja |
| Tab Backlog ≤ 1,5 s | Median ohne Drosselung / mit CPU 4× | 792 / 1 122 ms | 770 / 1 085 ms | ja |
| CLI-Write → sichtbar ≤ 300 ms | Max ab Prozessende; Max ab Ref (Backlog, Board `none`, Issue-Tab) | 28 ms; 72 ms | 6 ms; 44 ms | ja |
| (Schreibpfad BK) | Laufzeit `backe issue edit`, Median | 3 518 ms | 3 478 ms | – |
| (Live-Kern) | Server-CPU im Leerlauf je 10 s, Node / git | 20 / 100 ms | 25 / 90 ms | – |
| Board-Drag im selben Frame | Default (3 100 Karten): Start / Ziehen, größter rAF-Abstand | 340 / 133 ms | 17,0 / 16,9 ms | ja |
| Board-Drag im selben Frame | Default: `pointerup` → erster rAF; Karte im Frame | 133 ms; 5/5 | 16,3 ms; 5/5 | ja |
| Board-Drag im selben Frame | `none` (7 600 Karten): Start / Ziehen | 787 / 296 ms | 17,0 / 16,9 ms | ja |
| Board-Drag im selben Frame | `none`: `pointerup` → erster rAF; Karte im Frame | 296 ms; 5/5 | 16,4 ms; 5/5 | ja |
| Scrollen ohne Frame-Drops | Drops / Max, ohne Drosselung / mit CPU 4× | 0 / 18,5 ms; 0 / 24,7 ms | 0 / 18,5 ms; 0 / 23,4 ms | ja |

Zwischenstände Board-Drag (`none`, 7 600 Karten, `--only board`, Profil per `--trace`): nur Zellen als Ziel und eine Drag-Quelle: Start 66 ms, Ziehen 84 ms, Loslassen 71 ms (React lief bei jedem Kontextwechsel von dnd-kit über alle Karten, `propagateContextChanges`); Board neben dem `DndContext`: 25 / 48 / 35 ms (Rest: Layout, Hit-Testing und Abgleich der langen Kartenliste); dazu `content-visibility` je Karte: 21 / 32 / 27 ms (Relevanzprüfung je Karte 4–16 ms je Frame); mit virtualisierten großen Zellen statt dessen: 17 / 17 / 16 ms.

Live-Kern: Mit 20 Nachbarn kostet das Sicherheitsnetz im Leerlauf 25 ms Node und 90 ms git je 10 s, und ein CLI-Write erscheint höchstens 44 ms nach der Bewegung des Refs in allen drei Ansichten; kein Ziel aus §2.17 hängt daran, darum keine Änderung.

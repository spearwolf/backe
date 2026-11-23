# Zweisprachige CLI-Ausgabe — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle nutzersichtbaren Texte von `backe` gibt es englisch (Default) und deutsch (Locale `de`); der MCP-Modus ist immer englisch.

**Architecture:** Ein winziger i18n-Kern (`src/i18n/`) bestimmt die Locale einmal pro Prozess und liefert `catalog({ en, de })`, ein typisiertes Objekt, das bei jedem Zugriff den Text der aktuellen Locale holt. Jede Quelldatei mit Texten bekommt eine Geschwisterdatei `<name>.messages.ts`; der Code greift über `m.<key>` statt über Literale zu. Die deutschen Texte wandern **wörtlich** in die Kataloge — die Testsuite läuft mit `BACKE_LANG=de` und beweist so, dass beim Umzug nichts verrutscht ist; Englisch kommt als zweite Spalte dazu.

**Tech Stack:** TypeScript (Node ≥ 26, ESM, `.ts`-Imports), commander 15, zod 4 (`z.config(z.locales.de())`), vitest, biome.

**Spec:** `docs/proposals/backe.md` §2.18 (Spiegelstrich »Sprache«) und §2.19 (Tools: englische Beschreibungen). Ticket: backe `bck-ht2py`.

**Ansätze (entschieden):** Katalog je Quelldatei (gewählt: Vollständigkeit per Typ, parallel migrierbar ohne gemeinsame Riesendatei) · Inline-Paare `t({en, de})` an jeder Stelle (verworfen: ~700 doppelte Literale im Fließcode) · i18next o. ä. (verworfen: Abhängigkeit ohne Gegenwert).

## Global Constraints

- Locale: erster gesetzter, nicht leerer Wert aus `BACKE_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG`; beginnt er mit `de` (Regex `/^de(?:[_.@-]|$)/i`), gilt `de`, sonst `en`.
- Präfixe: `Error:`/`Fehler:`, `Hint:`/`Hinweis:`, `Warning:`/`Warnung:`, `unchanged:`/`unverändert:`.
- MCP-Modus immer `en`, auch Startfehler auf stderr.
- Unverändert und sprachunabhängig: Befehls-/Optionsnamen (lange und kurze Flags), JSON-Keys, Fehlercodes, Exit-Codes, Commit-Subjects und Trailer (`summarizeOp`/`summarizeBatch` sind sprachneutral und bleiben es), Golden-Formate.
- Deutsche Texte werden **zeichengenau** übernommen (gleiche Anführungszeichen `»…«`, gleiche Interpunktion). Kein Test mit deutscher Erwartung wird angepasst — außer dort, wo dieser Plan es ausdrücklich nennt.
- Englische Texte: Werte in einfachen geraden Anführungszeichen (`'${id}'`), Flag-Namen nie in Anführungszeichen, Satzanfang groß, kein Schlusspunkt bei einzeiligen Meldungen (wie im Deutschen). Glossar: Backlog → backlog · Issue → issue · Arbeitskopie → working copy · Handle → handle · Kurz-ID → short ID · Anhang → attachment · Kommentar → comment · Projekt → project · Sprint → sprint · Signatur → signature · Schlüssel → key · Zeile → line · Datei → file · Verzeichnis → directory · Übergang → transition · Abhängigkeit → dependency · Sub-Issue → sub-issue · Parent → parent · Belegung → assignment · Hinweis (im Satz) → hint · Vorbedingung → precondition.
- Argument-Platzhalter der Hilfe sind Katalogtexte (`<titel>` ↔ `<title>`); Optionsnamen nicht.
- Keine Audit-Kürzel und keine Ticket-ID in Code, Tests oder Kommentaren.
- Jede Task endet grün mit `pnpm lint && pnpm build && pnpm test`.

## Review Focus

1. **Leere oder exotische Locale** (`LANG=`, `LANG=C`, `LC_ALL=de_DE.UTF-8` neben `LANG=en_US`, `BACKE_LANG=DE`) — erwartet: Rangfolge und Groß-/Kleinschreibung wie oben; Test in Task 1.
2. **Text, der vor der Locale-Bestimmung entsteht** (Modul-Konstanten mit Texten, z. B. `QUICKSTART`, `INSTRUCTIONS`, Zod-Schemas mit `message`) — erwartet: Kataloge lösen erst beim Zugriff auf; Modul-Konstanten mit Text werden zu Funktionen oder Getter-Zugriffen. Test in Task 1 (Zugriff nach `setLocale` wechselt den Text).
3. **Fehler aus commander selbst** (`unknown option`, `too many arguments`, Optionswert fehlt) unter `de` — erwartet: deutsch, mit Vorschlag (`Did you mean …`) übersetzt; Test in Task 2.
4. **Zod-Standardmeldungen** unter `de` (heute englisch im Golden `config-get.txt`) — erwartet: deutsch; Golden-Update in Task 1.
5. **MCP-Prozess, gestartet mit `LANG=de_DE.UTF-8`** — erwartet: Tool-Beschreibungen, `message`, `hint`, Startfehler englisch; Test in Task 8.

---

### Task 1: i18n-Kern, Präfixe, Test-Pinning, Sprach-Wächter

**Files:**
- Create: `src/i18n/locale.ts`, `src/i18n/catalog.ts`, `src/i18n/i18n.test.ts`, `src/cli/output.messages.ts`, `test/setup-locale.ts`, `test/helpers/german-literals.ts`
- Modify: `src/cli/main.ts`, `src/cli/output.ts` (Präfixe, `unverändert:`), `src/cli/run.ts:215` (`Fehler:`), `src/cli/commands/batch.ts:57` (`unverändert: batch`), `vitest.config.ts` (`env.BACKE_LANG: 'de'`, `setupFiles`), `test/e2e/cli.ts` (`INHERITED` um `BACKE_LANG`), `test/conventions.test.ts`, `test/e2e/golden/config-get.txt`

**Interfaces:**
- Produces:
  - `type Locale = 'en' | 'de'`
  - `localeFromEnv(env: Env): Locale` (rein; `Env` aus `src/context/paths.ts`)
  - `setLocale(l: Locale): void` — setzt die Prozess-Locale und `z.config(z.locales[l]())`
  - `initLocale(env: Env = process.env): Locale` — `setLocale(localeFromEnv(env))`
  - `locale(): Locale` — initialisiert bei erstem Aufruf lazy per `initLocale()`
  - `catalog<T extends Record<string, string | ((...args: never[]) => string)>>(texts: { en: T; de: NoInfer<T> }): Readonly<T>` — Proxy, der bei jedem Property-Zugriff `texts[locale()][key]` liefert
  - Konvention: `src/x/y.ts` importiert `import { m } from './y.messages.ts'`; die Datei exportiert genau `export const m = catalog({ en: {…}, de: {…} })`
  - `findGermanLiterals(file: string, source: string): string[]` — Treffer als `datei:zeile: text`

- [ ] **Step 1: Failing tests in `src/i18n/i18n.test.ts`**

```ts
test.each([
  [{}, 'en'], [{ LANG: 'de_DE.UTF-8' }, 'de'], [{ LANG: 'de' }, 'de'], [{ LANG: 'C' }, 'en'],
  [{ LANG: '' }, 'en'], [{ LANG: 'en_US.UTF-8', LC_ALL: 'de_DE.UTF-8' }, 'de'],
  [{ LC_ALL: 'en_US.UTF-8', LANG: 'de_DE' }, 'en'], [{ LC_MESSAGES: 'de_AT', LANG: 'en' }, 'de'],
  [{ BACKE_LANG: 'en', LC_ALL: 'de_DE' }, 'en'], [{ BACKE_LANG: 'DE' }, 'de'], [{ LANG: 'dense' }, 'en'],
])('localeFromEnv(%o) → %s', (env, want) => expect(localeFromEnv(env)).toBe(want));

test('catalog resolves at access time', () => {
  const c = catalog({ en: { hi: 'hi', n: (k: string) => `n ${k}` }, de: { hi: 'hallo', n: (k: string) => `n »${k}«` } });
  setLocale('en'); expect(c.hi).toBe('hi'); expect(c.n('x')).toBe('n x');
  setLocale('de'); expect(c.hi).toBe('hallo'); expect(c.n('x')).toBe('n »x«');
});

test('zod default messages follow the locale', () => {
  setLocale('de'); expect(z.string().safeParse(1).error?.issues[0]?.message).toMatch(/Ungültige Eingabe/);
  setLocale('en'); expect(z.string().safeParse(1).error?.issues[0]?.message).toMatch(/Invalid input/);
});
```

Dazu in `src/cli/output.test.ts` je ein Fall für `renderError`, `renderNotices`, `renderOutcome` (ohne Commit) unter `setLocale('en')`: `Error: …\nHint: …\n`, `Hint: …`/`Warning: …`, `unchanged: …`; danach `setLocale('de')` zurück (`afterEach`). Den genauen Wortlaut der Zod-Meldung vorher per `node -e` prüfen und die Regex anpassen.

- [ ] **Step 2: `pnpm vitest run src/i18n src/cli/output.test.ts` — FAIL (Module fehlen)**

- [ ] **Step 3: Kern implementieren** — `src/i18n/locale.ts` und `catalog.ts` mit den Signaturen oben. `src/cli/main.ts` ruft `initLocale()` als Erstes, vor `checkNodeVersion`. Präfixe und `unchanged:` als Einträge in `src/cli/output.messages.ts` (`errorPrefix`, `hintPrefix`, `warningPrefix`, `unchanged`), genutzt von `output.ts`, `run.ts:215` und `commands/batch.ts:57`.

- [ ] **Step 4: Test-Pinning** — `vitest.config.ts`: `env.BACKE_LANG = 'de'`, `setupFiles: ['test/setup-locale.ts']` (ruft `initLocale()`); `test/e2e/cli.ts`: `'BACKE_LANG'` in `INHERITED`. `test/e2e/golden/config-get.txt`: die Zod-Meldung wird deutsch — Golden neu erzeugen und den Diff darauf prüfen, dass sich nur diese Zeile ändert.

- [ ] **Step 5: Sprach-Wächter** — `test/helpers/german-literals.ts`: Zeilen ohne Kommentare (`//`-Zeilen, `/* … */`-Blöcke, `// …`-Rest) auf Literale prüfen, die `[äöüÄÖÜß»«]` oder eines der Wörter `nicht|fehlt|keine?n?|ungültig|unbekannt|Datei|Zeile|gibt es|bereits|ohne|oder` (Wortgrenzen) enthalten. In `test/conventions.test.ts` ein Test `'user-facing literals live in *.messages.ts'` über alle `src/**/*.ts` außer `*.test.ts`, `*.messages.ts`, `src/i18n/**`, mit einer Liste `PENDING: string[]` von Pfadpräfixen, die noch nicht migriert sind — anfangs `['cli/', 'context/', 'core/', 'git/', 'mcp/', 'ops/', 'services/', 'store/']` — und `ALLOWED` für gewollte Ausnahmen samt Grund. Der bestehende Test `messages quote values with »…«` bleibt; er prüft auch die `*.messages.ts`.

- [ ] **Step 6: `pnpm lint && pnpm build && pnpm test` — PASS**

- [ ] **Step 7: Commit** `feat(i18n): Locale-Erkennung, Kataloge und zweisprachige Präfixe`

---

### Tasks 2–7: Migration je Bereich (unabhängig voneinander, parallel ausführbar)

Jede dieser Tasks folgt demselben Ablauf; sie unterscheiden sich nur in den Dateien. Sie berühren disjunkte Dateien bis auf die Zeile ihres Bereichs in `PENDING` (`test/conventions.test.ts`).

**Ablauf je Quelldatei mit Texten:**

- [ ] Literale finden: `node --input-type=module -e` mit `findGermanLiterals` oder `grep -nE "[äöüÄÖÜß»«]|Fehler|fehlt|nicht"` auf die Datei.
- [ ] `<name>.messages.ts` anlegen; Keys camelCase und sprechend (`issueNotFound`, nicht `err1`); Texte mit Platzhaltern werden Funktionen mit benannten Parametern. Deutsch zeichengenau übernehmen, Englisch nach Glossar.
- [ ] Literale im Code durch `m.<key>` ersetzen. Modul-Konstanten mit Text (Arrays, Objekte, `description`-Konstanten) werden zu Funktionen oder werden erst bei Verwendung gelesen, sonst friert die Locale beim Import ein.
- [ ] Je Bereich ein Englisch-Test `test/i18n/<bereich>.test.ts`: `setLocale('en')` in `beforeAll`, `setLocale('de')` in `afterAll`; zwei bis vier repräsentative Meldungen des Bereichs (ein Fehler mit `hint`, eine Notice oder Warnung, wo es sie gibt) über die öffentliche Funktion auslösen und auf den englischen Text prüfen.
- [ ] Bereich aus `PENDING` streichen; der Wächter ist für ihn grün (gewollte Reste in `ALLOWED` mit Grund).
- [ ] `pnpm lint && pnpm build && pnpm test` — PASS, ohne dass ein deutscher Test oder Golden geändert wurde (Ausnahmen nennt die Task).
- [ ] Commit `feat(i18n): <bereich> zweisprachig`

#### Task 2: CLI-Kern und Hilfe-Infrastruktur

**Files:** `src/cli/*.ts` ohne `commands/` — `run.ts` (Programmbeschreibung, `-V`/`-h`/`help`, `QUICKSTART` als Funktion, `fromCommander`), `options.ts` (globale Optionen), `output.ts` (Rest), `editor.ts`, `prompt.ts`, `render-issue.ts`, `node-version.ts`, `io.ts`. `PENDING`: `cli/` → `cli/commands/`.

Zusätzlich:
- **Abschnittstitel der Hilfe:** `program.configureHelp({ styleTitle })` vor dem ersten Befehl (wird vererbt), bildet unter `de` `Usage:` → `Aufruf:`, `Options:` → `Optionen:`, `Arguments:` → `Argumente:`, `Commands:` → `Befehle:`, `Global Options:` → `Globale Optionen:` ab; unter `en` unverändert. Tests mit `Usage:` in deutscher Erwartung werden angepasst (gewollte Änderung).
- **commander-Fehler:** `fromCommander` übersetzt `commander.unknownOption`, `commander.unknownCommand`, `commander.excessArguments`, `commander.optionMissingArgument`, `commander.conflictingOption` über Katalogtexte; die Namen holt eine Regex aus commanders Meldung (der Teil in `'…'`), der Vorschlag `(Did you mean …?)` wird mitübersetzt. Ohne Treffer bleibt die Originalmeldung. Flag-Namen stehen ohne Anführungszeichen (Konvention `flag names are not quoted`, gilt in Katalogen auch für `'--`). Test: `backe issue list --bogus` und `backe ls --stat` unter `de` → `Fehler: Unbekannte Option --bogus` bzw. mit Vorschlag; unter `en` → `Error: Unknown option --bogus`.

#### Task 3: CLI-Befehle

**Files:** `src/cli/commands/*.ts` — Beschreibungen, Optionstexte, Argument-Platzhalter (`<titel>` ↔ `<title>` usw.; der Optionsname bleibt), `addHelpText`-Blöcke (Editor-Hinweis von `issue edit`), Fehler, Hinweise, Text-Ausgaben. `commands/mcp.ts`: nur Beschreibung und `--allow-delete`-Text (das ist CLI-Hilfe, locale-abhängig). `PENDING`: `cli/commands/` streichen.

#### Task 4: Services — Issue-Domäne

**Files:** `src/services/` — `issues`, `issue-list`, `issue-show`, `write`, `batch`, `claim`, `next`, `comments`, `attachments`, `hand-edits`, `read`, `resolve`, `views`, `outcome`, `schedule`, `signals`, `env`, `projects`, `sprints`, `context-info`. `PENDING` bleibt unverändert; den Wächter für die eigenen Dateien prüft die Task per `findGermanLiterals` direkt.

#### Task 5: Services — Sync, Repos, Verwaltung

**Files:** `src/services/` — `sync`, `sync-state`, `background`, `hub`, `replay`, `manual-merge`, `quarantine`, `working-copy`, `lfs`, `verify`, `verify-state`, `resign`, `doctor`, `init`, `config`, `users`, `agent`, `repos`, `repo-check`, `repo-local`. `PENDING` bleibt unverändert wie in Task 4.

Merge-Hinweis für den Orchestrator: Sind Tasks 4 und 5 beide gemergt, streicht er `services/` aus `PENDING` in einem eigenen Commit.

#### Task 6: ops, core, store

**Files:** `src/ops/**`, `src/core/**` (inkl. `schemaError`-Wurzel `(Wurzel)` ↔ `(root)`, Zod-Schemas mit eigenen `message`-Texten — als Funktion `message: () => m.x` oder Zod-`error`-Callback, damit die Locale beim Parsen gilt), `src/store/**`. `summarizeOp`/`summarizeBatch` bleiben unangetastet. `PENDING`: `ops/`, `core/`, `store/` streichen.

#### Task 7: context, git

**Files:** `src/context/**`, `src/git/**`. `PENDING`: `context/`, `git/` streichen.

---

### Task 8: MCP immer englisch

**Files:**
- Modify: `src/cli/commands/mcp.ts` (`setLocale('en')` als erste Zeile der Action, vor `runStdio`), `src/mcp/*.ts` (Tool-Beschreibungen, `INSTRUCTIONS`, MCP-eigene Meldungen wie `Zeile <n>: »<op>« gibt es im MCP-Modus nicht` → **direkt englisch als Literal**, kein Katalog), `src/mcp/*.test.ts`, `test/mcp/*.test.ts`, `test/mcp/golden/*`, `test/e2e/mcp.test.ts`, `test/conventions.test.ts` (`mcp/` aus `PENDING`)

**Interfaces:** Consumes `setLocale` aus Task 1. Service-Meldungen kommen aus den Katalogen der Tasks 4–7; Task 8 hängt für grüne Englisch-Erwartungen in den MCP-Tests von ihnen ab und läuft deshalb **nach** 2–7.

- [ ] **Step 1: Failing test** in `test/mcp/stdio.test.ts`: Server mit `LANG=de_DE.UTF-8` (und ohne `BACKE_LANG`, also `BACKE_LANG` im Kind-Env explizit entfernen) starten; `tools/list` liefert englische Beschreibungen (keine Treffer von `findGermanLiterals` auf dem JSON), ein `issue_get` mit unbekannter ID liefert `message` und `hint` englisch; ein Start ohne Identität schreibt `Error: …` auf stderr.
- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implementieren.** In-Process-MCP-Tests (`src/mcp/*.test.ts`, `test/mcp/flow.test.ts`) setzen `setLocale('en')` in `beforeAll` und erwarten Englisch; die deutschen Erwartungen dort werden übersetzt. Golden `test/mcp/golden/*` neu erzeugen, Diff auf reine Textänderungen prüfen.
- [ ] **Step 4: `pnpm lint && pnpm build && pnpm test` — PASS**
- [ ] **Step 5: Commit** `feat(mcp): Ausgabe immer englisch`

---

### Task 9: Abschluss — Wächter scharf, Englisch-E2E, Spec, README

**Files:** `test/conventions.test.ts`, `test/e2e/i18n.test.ts` (neu), `docs/proposals/backe.md`, `README.md`

- [ ] **Step 1:** `PENDING` ist leer → Liste und ihre Logik entfernen; der Wächter prüft ganz `src/`.
- [ ] **Step 2: E2E** `test/e2e/i18n.test.ts`, Kind-Env ohne `BACKE_LANG`: (a) ohne Locale-Variablen → `backe --help` enthält `Quick start` und `Usage:`, `backe show bk-nope` → stderr beginnt mit `Error:` und Exit 3; (b) `LANG=de_DE.UTF-8` → `Schnellstart` und `Aufruf:`, `Fehler:`; (c) `BACKE_LANG=en` mit `LANG=de_DE.UTF-8` → Englisch. Prüfen, dass in (a) stdout+stderr keine Treffer von `findGermanLiterals` haben.
- [ ] **Step 3: Spec** — in `backe.md` §2.18 den Vermerk *(Soll, noch nicht gebaut …)* entfernen; alle wörtlich zitierten Meldungen (`grep -n '»' docs/proposals/backe.md` auf Meldungstexte filtern) durch die englische Fassung aus den Katalogen ersetzen, Präfixe in §2.18/§2.19 (`Fehler: …` → `Error: …` usw.) mit dem Zusatz der deutschen Entsprechung nur in der Sprach-Regel.
- [ ] **Step 4: README** — im Abschnitt zur Ausgabe ein Absatz »Language«: English by default, German when `BACKE_LANG`/`LC_ALL`/`LC_MESSAGES`/`LANG` starts with `de`; MCP always English.
- [ ] **Step 5: `pnpm lint && pnpm build && pnpm test` — PASS**
- [ ] **Step 6: Commit** `docs: Ausgabesprache in Spec und README` (Testdatei im selben Commit) und Ticket `bck-ht2py` nach `done` verschieben.

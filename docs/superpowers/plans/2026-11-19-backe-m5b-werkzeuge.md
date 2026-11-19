# backe M5b — Anhänge, Hand-Edits, Werkzeuge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die restlichen lokalen Befehle aus backe.md §2.17: `attach add|list|get|rm` samt Größenlimit und LFS, `backe commit` für Hand-Edits, `issue edit` per Editor, `batch`, `repo check|where|scan`, `doctor`, `config get|set|edit` — dazu die mit `M5b:` markierten offenen Punkte des Gesamtplans.

**Architecture:** Wie M5a: jeder Befehl ist ein Service in `src/services/`, die CLI in `src/cli/` ist ein dünner Adapter. Die Operationsschicht hat Anhänge (`attach.add`/`attach.rm`), Batch (`applyBatch`, `parseBatchInput`) und die Übersetzung von Hand-Edits (`translateEdits`) schon seit M2; M5b verdrahtet sie. Neu im Schreibpfad sind zwei Eingaben: `derive` darf mehrere Operationen liefern (dann Batch-Commit), und `edits` übersetzt unter dem Write-Lock alle Änderungen der Arbeitskopie gegen `HEAD` und committet sie als bis zu zwei signierte Commits (erst `manual`, dann die Operationen), die zusammen landen oder gar nicht. Netzwerk (`repo check --remote`) und Editor-Start hängen an injizierbaren Abhängigkeiten der Services bzw. an `CliIo`, damit Tests ohne Netz und ohne Terminal laufen.

**Tech Stack:** wie M5a. Keine neue Runtime-Abhängigkeit; HTTP über das eingebaute `fetch`.

**Spec:** `docs/proposals/backe.md` (§2.2, §2.8, §2.11, §2.13 »Hand-Edits«, §2.15.1, §2.16.1, §2.16.6, §2.17, §2.18, §2.20, §5), Gesamtplan `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`. Es gelten dessen Global Constraints, die `M5b:`-Zeilen in »Übernommen aus M1–M5a« (Zuordnung unten) und die Planentscheidungen.

## Global Constraints

Alle Global Constraints des Gesamtplans und von M5a (Schichten, Services als Eingabegrenze, Fehlercodes `usage`/`validation`, Meldungen mit `»…«`, stdout nur Ergebnis, JSON eine Zeile mit snake_case-Keys, kein Env-Schalter für Tests, E2E nur über `dist/cli.js`), dazu für M5b:

- Services lesen keine Dateien des Users und kein stdin: Anhangsinhalt, Batch-Text und Editor-Ergebnis reicht die CLI hinein. Ausnahme ist das Backlog selbst (Arbeitskopie, User-Config, `~/.backe/cache/`) und das Verzeichnis, das `repo scan` durchsucht.
- Netzwerk nur in `repo check --remote`. Kein anderer Befehl spricht mit einem Remote (backe.md §2.11: »Normale Writes prüfen nie remote«).
- Jeder Git-Aufruf mit einem Wert aus Nutzereingabe oder Backlog-Daten an positionaler Stelle setzt `--end-of-options` bzw. `--` davor.
- Tests drehen nie am Netz: GitHub-Abfragen laufen in Tests über injizierte Abhängigkeiten, `--remote` gegen lokale Bare-Repos (`file://`-URLs bzw. absolute Pfade). Der LFS-Pfad läuft nur, wenn `git lfs version` gelingt, sonst `test.skip` mit Meldung (backe.md §5).
- Der Editor läuft in E2E-Tests über `BACKE_EDITOR` mit einem nicht-interaktiven Kommando (`sed -i …` bzw. ein Skript unter `test/fixtures/editors/`); kein Test startet einen interaktiven Editor.
- Keine Laufzeitmessung in Tests. Das Batch-Tempo wird mit `scripts/bench-batch.ts` gemessen und im Commit festgehalten.
- Coverage-Gate `src/services/**` bleibt `lines: 90, branches: 90`; `src/cli/**` über E2E.

## Review Focus

1. **Hand-Edits mit Kanten** — eine im Editor mit CRLF und BOM gespeicherte Issue-Datei, eine von Hand gelöschte Datei, ein neues Issue im falschen Shard (`issues/zz/bk-7f3k2/issue.md`), eine nur umsortierte Liste, ein Edit, der nur Whitespace ändert: CRLF/BOM werden normalisiert und übersetzt, Löschen wird `issue.delete`, falscher Shard ist `validation` mit dem richtigen Pfad, Umsortieren und Whitespace erzeugen keinen Commit, und die Arbeitskopie ist danach sauber. → Task 5 `hand edits with crlf, bom, reorder and whitespace leave a clean working copy`, `an issue in the wrong shard is a validation error`.
2. **Editor in fremden Umgebungen** — `BACKE_EDITOR="code --wait"`-artig mit Argumenten, ein Editor, der mit Exit 1 endet, ein Agent ohne TTY mit gesetztem `EDITOR=vim`: Argumente werden von der Shell zerlegt, Exit ≠ 0 ändert nichts, ohne TTY und ohne `BACKE_EDITOR` startet nie ein Editor (sonst hinge der Agent) — `usage` mit Hinweis auf Flags. → Task 10 `an editor with arguments edits the issue`, `a failing editor changes nothing`, `without tty and BACKE_EDITOR no editor is started`.
3. **Anhang-Quellen aus dem echten Leben** — Quelldatei mit Leerzeichen und Großbuchstaben in der Endung (`Bericht Final.PDF`), Name mit und ohne Endung, leere Datei, Datei genau auf `max_bytes` und ein Byte darüber, ein Verzeichnis als Quelle, eine fehlende Datei, Binärinhalt über stdout zurück: Endung wird klein übernommen, Grenzwert ist erlaubt, ein Byte mehr ist `validation` mit LFS-Hinweis, Verzeichnis und fehlende Datei sind `validation` bzw. `not_found` vor dem Write, `attach get` liefert byte-identisch. → Task 6 `file names, limits and empty files`, Task 10 `attach get returns binary content unchanged`.
4. **Batch-Eingaben von Agents** — BOM am Anfang, CRLF-Zeilen, Leerzeilen am Ende, ein Platzhalter vor seiner Definition, eine Kurz-ID statt voller ID, 1001 Zeilen, ein Datei-Anhang: BOM und CRLF werden gelesen, jeder Fehler nennt seine Zeile (`details.line`), nichts wird geschrieben. → Task 7 `batch input from agents`.
5. **User-Config per `config set`** — Repo-Key mit Punkten (`repos.github.com/acme/webapp`), `~/…` als Wert, ungültiger Enum-Wert (`output.color bunt`), eine Config mit Kommentaren, `config edit` mit kaputtem Ergebnis: der Repo-Key wird als ein Key kanonisiert, `~` bleibt wörtlich stehen, ungültige Werte sind `validation` ohne Schreibzugriff, Kommentare überleben, ein kaputter Edit lässt das Original unberührt und nennt den Entwurf. → Task 9 `config set keeps comments, canonicalizes repo keys and refuses invalid values`, Task 11 `config edit with an invalid result keeps the original`.

## Festlegungen

Stellen, die Spec und Gesamtplan offenlassen und die dieser Plan festlegt. Nach Abnahme wandern sie in die Planentscheidungen des Gesamtplans (Task 11).

| Stelle | Festlegung |
| --- | --- |
| §2.13 `backe commit` Umfang | alle Pfade, die `git status --porcelain=v1 -z --untracked-files=all --no-renames` als geändert, neu (nicht ignoriert) oder gelöscht meldet — Index und Arbeitsbaum zusammen, verglichen mit `HEAD`. Nichts geändert → `Nichts zu committen`, Exit 0. |
| §2.13 Commit-Strategie bei gemischtem Ergebnis | erst ein `manual`-Commit mit allen Dateien ohne Operations-Entsprechung (Subject aus `-m`, sonst `manual: <n> Dateien`), dann die Operationen (eine → Trailer mit der Operation, mehrere → `Backe-Op: batch`). Die Operationen werden vorab gegen den Stand nach dem `manual`-Anteil geprüft; `HEAD` springt einmal vom alten Stand auf den letzten Commit. Scheitert etwas, landet keiner. `-m` ohne `manual`-Anteil → Warnung `-m gilt nur für manuelle Änderungen`. |
| §2.13 Arbeitskopie nach `backe commit` | Jeder bearbeitete Pfad trägt danach den committeten Inhalt, der Index dieser Pfade ist `HEAD`. Weicht der committete Inhalt vom kanonisch serialisierten Hand-Edit ab (etwa Listen-Reihenfolge nach einer Mengen-Operation) → Hinweis `<pfad>: kanonisch umgeschrieben`. Ein Pfad ohne wirksame Änderung (nur umsortiert, nur Formatierung) wird auf `HEAD` zurückgesetzt → Hinweis `<pfad>: keine wirksame Änderung`. |
| §2.13 Umhängen im Hand-Edit | `issue.edit`-Operationen mit geändertem `parent` stehen in der Reihenfolge des Nachher-Baums, Wurzeln zuerst; getauschte Parents zweier Issues gelingen so unabhängig von den IDs. Konflikte mit `done`-Parents bleiben Fehler; Hint `Änderung auf zwei backe commit aufteilen`. |
| §2.13 Issue-Datei am falschen Ort | `issue.md` unter `issues/<x>/<id>/`, bei dem `<x>` nicht `shardOf(id)` ist oder `<id>` keine gültige Issue-ID → `validation` `<pfad>: Issue gehört nach <issueFile(id)>` bzw. `<pfad>: kein gültiges Issue-Verzeichnis`. |
| §2.16.1 HEAD-Vorbedingung manueller Writes | `WriteInput` `manual` bekommt `expectHead?: string`; weicht `HEAD` unter dem Lock ab → `conflict` `Stand hat sich seit der Prüfung geändert`. `verify --accept/--revert` setzt es auf den Stand, gegen den es geprüft hat. `edits` braucht es nicht (rechnet unter dem Lock). |
| §2.17 `issue edit` per Editor | ohne Änderungs-Flags. Editor: `BACKE_EDITOR`; sonst `VISUAL`, dann `EDITOR`, aber nur, wenn stdin und stdout ein TTY sind; sonst `usage` `Nichts zu ändern`, Hint `Flags angeben oder BACKE_EDITOR setzen`. Aufruf `sh -c '<editor> "$1"' backe-editor <datei>`, Temp-Datei `<os.tmpdir()>/backe-<id>-<6 hex>.md` mit dem Dateiinhalt wie auf der Platte. Unverändert → `unverändert: issue edit <id>`, Exit 0. Editor-Exit ≠ 0 → `unexpected` `Editor endete mit Exit-Code <n>; nichts geändert`. Parse- oder Schemafehler → `validation` mit `datei:zeile`, die Temp-Datei bleibt, Hint nennt sie. Ergebnis ohne Operations-Entsprechung → `validation` `Diese Änderung lässt sich nicht als Operation ausdrücken`, Hint `Datei direkt bearbeiten und backe commit`. Mehrere Operationen (etwa `issue.edit` und `issue.move`) → ein Batch-Commit. Temp-Datei wird nach Erfolg gelöscht. |
| §2.17 `issue edit` mit wirkungslosen Flags | `unverändert: <summary>`, Exit 0 — wie `issue move` in den aktuellen State. Ersetzt die M5a-Festlegung »bleibt nichts → `usage` Nichts zu ändern«. |
| §2.16.6 Batch-Eingabe | Format des Trailers (§2.16.4) plus `ref`; volle IDs oder Platzhalter, keine Kurz-IDs, kein `me`. BOM am Anfang und CRLF werden gelesen. `attach.add` mit `file` (Inhalt passt nicht in JSONL) und `issue.claim` (synchron, M6) → `validation` mit Zeile. Quelle: `-f <pfad>` oder `-f -`/`-` für stdin; ohne Quelle `usage`. |
| §2.16.6 Batch-Ausgabe | Text: `summarizeBatch`, danach je Platzhalter `<ref>  <id>` in Vergabe-Reihenfolge. JSON: `{"commit":<sha\|null>,"refs":{…},"ops":<anzahl aufgezeichnet>,"notices"?:[…]}`. |
| §2.8 Dateiname eines Datei-Anhangs | Enthält `name` einen Punkt, ist er der Dateiname; sonst `name` + `extname(quelle)` kleingeschrieben. Passt das Ergebnis nicht zu `[a-z0-9][a-z0-9._-]{0,63}` → `validation`, Hint `--name <n>.<ext>`. Quelle muss eine reguläre Datei sein (Verzeichnis → `validation`, fehlt → `not_found`); leere Dateien sind erlaubt. |
| §2.8 JSON-Anhang | Dateiname `<name>.json`, außer `name` endet schon auf `.json`; Inhalt `JSON.stringify(JSON.parse(text), null, 2) + '\n'` — Key-Reihenfolge bleibt, Einrückung zwei Leerzeichen. Ungültiges JSON → `validation` mit der Meldung von `JSON.parse`. |
| §2.8 `attach get` | Text ohne `-o`: Dateibytes roh auf stdout; `-o <pfad>` schreibt die Datei (überschreibt) und druckt den Zielpfad; URL-Anhang: die URL. JSON: `{"name","file"?,"url"?,"size"?,"path"?}` (`path` = Ziel bzw. absoluter Pfad in der Arbeitskopie), nie der Inhalt. |
| §2.8 `attach add --json` | `attach add` trägt die globale Option `--json` nicht (`addGlobalOptions(cmd, ['json'])`); `--json <json\|->` ist die Inhaltsquelle, JSON-Ausgabe per `--format json`. |
| §2.8 LFS | Bei `attachments.lfs: true` ergänzt `attach.add` (Datei) im selben Commit die Zeile `issues/*/*/attachments/** filter=lfs diff=lfs merge=lfs -text` in `.gitattributes`, wenn sie fehlt (der Snapshot liest `.gitattributes` mit). `commitPaths` setzt dann für `git add` `-c filter.lfs.clean=git-lfs clean -- %f -c filter.lfs.smudge=git-lfs smudge -- %f -c filter.lfs.process=git-lfs filter-process -c filter.lfs.required=true`. Fehlt `git-lfs` → `validation` `attachments.lfs verlangt git-lfs`, Hint `backe doctor`. `max_bytes` gilt auch mit LFS. |
| §2.11 `repo check` lokal | je Repo: URL normalisierbar, kanonische URL eindeutig, Dateiname = gültiger Repo-Name, `default_ref` und die Refs aus Issues (`name@ref`) erfüllen `isGitRef`. Ohne Namen alle Repos. |
| §2.11 `repo check --remote` | `git ls-remote --end-of-options <url>` (Timeout 20 s): erreichbar; `default_ref` und Branch-/Tag-Refs aus Issues existieren; Refs, die wie ein Commit aussehen (`^[0-9a-f]{7,40}$`), sind per `ls-remote` nicht prüfbar → Hinweis. GitHub (kanonisch `github.com/<owner>/<repo>`): `gh api repos/<owner>/<repo>`, wenn `gh` im `PATH` liegt, sonst `GET https://api.github.com/repos/<owner>/<repo>` (mit `Authorization: Bearer $GITHUB_TOKEN`, falls gesetzt); gemeldet werden `visibility` und `archived` (archiviert = Warnung). |
| §2.11 Cache | `<BACKE_HOME>/cache/repo-check.json` = `{"version":1,"entries":{"<kanonisch>":{"checked":"<iso>","result":{…}}}}`; TTL 24 h (Planentscheidung M5b), `--fresh` umgeht ihn. Kaputter Cache wird verworfen, nicht gemeldet. |
| §2.11 Exit-Codes `repo check` | Bericht immer auf stdout; danach: ein lokaler oder Ref-Fehler → `validation` (2); nur Erreichbarkeitsfehler → `sync` (6); nur Warnungen und Hinweise → 0. |
| §2.11 `repo where` | Name → Registry → kanonische URL → `repos[<kanonisch>]` der User-Config, expandiert. Kein Eintrag → `not_found` `Kein lokaler Pfad für »<name>«`, `details: {url, canonical, default_ref?}`, Hint `backe repo scan <verzeichnis>` oder `backe config set repos.<kanonisch> <pfad>`. Eintrag existiert nicht auf der Platte → `not_found` `<pfad> existiert nicht`. Text: nur der Pfad. JSON: `{"name","url","canonical","default_ref"?,"path"}`. |
| §2.11 `repo scan` | rekursiv bis Tiefe 4 unter dem Verzeichnis; versteckte Verzeichnisse und `node_modules` übersprungen, Symlinks nicht verfolgt, in ein gefundenes Git-Repo wird nicht abgestiegen. Remotes → kanonisch → nur Repos, die im aktiven Backlog registriert sind. Pfade physisch (`realpath`). Kein Eintrag → setzen (`neu`); gleicher Pfad → `unverändert`; anderer Pfad → bleibt (`abweichend (<alt>)`), mit `--force` `überschrieben`. `--dry-run` schreibt nichts. Eine Config-Änderung je Lauf. Text: `<name>  <pfad>  <status>`. |
| §2.20 `doctor` | Prüfungen mit fester ID und Status `ok\|warn\|fail` (Liste in Task 8). Text: `<status>  <id>  <detail>`, danach je `warn`/`fail` mit Hint `  → <hint>`. JSON: `{"checks":[{id,status,detail,hint?}]}`. Ein `fail` → nach dem Bericht `validation` `doctor: <n> Prüfung(en) fehlgeschlagen` (Exit 2). `--fix` entfernt nur Temp-Reste: `tmp/clone-*` älter als 1 h und Lock-Temp-Dateien (`<lock>.<pid>.<hex>`) toter PIDs desselben Hosts. |
| §2.15.1 `config`-Pfade | `a.b.c`; unter `repos.` ist der ganze Rest ein Key und wird per `normalizeRepoUrl` kanonisiert. Gesetzt werden nur String-Blätter des Schemas (alle Werte der User-Config sind Strings); `--unset` entfernt. Werte bleiben wörtlich (`~` wird nicht expandiert). Unbekannter Pfad → `validation` mit den erlaubten Keys der Ebene. |
| §2.15.1 `config get` | ohne Key: Text = Datei wie auf der Platte (fehlt sie: nichts), JSON = geparste Config. Mit Key: Text = String roh, Objekt als JSON; fehlender Key → `not_found`. |
| §2.15.1 `config edit` | Temp-Kopie im Editor (Regeln wie `issue edit`), danach geprüft; unter `config.lock`: Original seit dem Start unverändert (sonst `conflict`), dann atomar geschrieben. Ungültig → `validation` mit `datei:zeile`, Original unberührt, Hint nennt den Entwurf. |
| M3 JSONC-Edit | Ergibt `modify`/`applyEdits` keinen parsebaren Text (Komma am Zeilenanfang o. ä.) → `unexpected` `Edit an <datei> konnte nicht angewendet werden; Datei unverändert`. |
| M1 URL-Kanonform | Pfad kleingeschrieben für `github.com`, `gitlab.com`, `codeberg.org`, `bitbucket.org`, sonst wie gegeben; `?` oder `#` in der URL → `validation`. `normalizeRepoUrl` ist auf der kanonischen Form idempotent (`host/pfad` mit Punkt im Host und `file:/abs` werden akzeptiert). |
| M1 Git-Refs | `isGitRef(s)` prüft rein nach `git check-ref-format --allow-onelevel`: kein Segment beginnt mit `.` oder endet auf `.lock`, kein `..`, kein `@{`, nicht `@`, keine Steuerzeichen, kein Leerzeichen, keins von `~^:?*[\`, nicht mit `/` beginnend oder endend, kein `//`, nicht auf `.` endend. Gilt für `ref` in `name@ref` (Issues, `issue link`) und `default_ref`. |
| M5a `project list` | zählt offene Issues rekursiv über Unterprojekte, wie `project show`. |
| M5a `safeText` | macht zusätzlich `\p{Cf}` sichtbar (`\u{XXXX}`), außer U+200C und U+200D (Emoji-Sequenzen). |
| M5a Fehler-`details` | snake_case nur für die festen Keys `exitCode`, `fromHash`, `reasonFile`; alle anderen Keys und alle Werte bleiben unverändert. |
| M5a Flag-Namen in Meldungen | Flags stehen nackt (`--reason`), Werte in `»…«`; `test/conventions.test.ts` verbietet `»--`. |
| Batch-Tempo | Ziel: 1 000 `issue.create` gegen 20 000 Issues unter 1 s auf dem Entwicklungsrechner, gemessen mit `scripts/bench-batch.ts`; kein Timing-Test, aber ein Gleichheitstest für das Ergebnis. |

### Übernommene Punkte — Zuordnung

| Herkunft | Punkt | Wo |
| --- | --- | --- |
| M1 | URL-Groß-/Kleinschreibung, Query/Fragment, Git-Argv mit `--`, Ref-Validierung, `listIssueIds`/`listComments`-Eingaben | Task 1 |
| M2 | Batch O(k·n), quadratisches `topoOrder` | Task 3 |
| M2 | `backe commit`-Strategie, kanonische Changes, getauschte Parents | Tasks 3, 4 |
| M2 | `user.rm` lässt `lead`/`assignee` hängen | Task 8 (`doctor`) |
| M3 | JSONC-Edit mit ungültigem Ergebnis; `normalizeRepoUrl` idempotent; `loadRepoRegistry` je Auflösung; Hint `backe backlog list` bei Pfad | Task 1 |
| M4 | HEAD-Vorbedingung manueller Writes | Task 4 |
| M4 | `doctor`: Git 2.38, Temp-Reste, Alternates, verwaiste Bindungen | Task 8 |
| M5a | `issue edit` unverändert | Task 5 |
| M5a | `issue link` mit `:` im Ref | Task 1 |
| M5a | Kind-Zeilen ohne Assignee, `widerrufen ?`, `project list` rekursiv, `safeText` mit `\p{Cf}`, `--purge` über alle Branches, snake_case-`details`, `readPublicKey`-Fehler, `revertBinding`/`wasRegistered`, `checkPropFilter` mit `raw`, Flag-Namen in `»…«` | Task 2 |

---

### Task 1: Altlasten in `core`, `store` und `context`

**Files:**
- Modify: `src/core/url.ts`, `src/core/names.ts`, `src/core/schemas.ts`, `src/store/snapshot.ts`, `src/context/user-config.ts`, `src/context/resolve.ts`, `src/services/issues.ts` (Zerlegung in `linkIssue`), `src/ops/props.ts`
- Test: `src/core/url.test.ts`, `src/core/names.test.ts`, `src/store/snapshot.test.ts`, `src/context/user-config.test.ts`, `src/context/resolve.test.ts`, `src/services/issues.test.ts`, `src/ops/props.test.ts`

**Interfaces:**
- Produces:
  - `normalizeRepoUrl(input)`: Festlegung »M1 URL-Kanonform«; `normalizeRepoUrl(normalizeRepoUrl(x)) === normalizeRepoUrl(x)` für jede gültige Eingabe.
  - `isGitRef(s: string): boolean` in `core/names.ts` (Festlegung »M1 Git-Refs«); `parseRepoRef` wirft `validation` `Ungültiger Ref »<ref>«` bei ungültigem Ref; `RepoSchema.default_ref` prüft `isGitRef`.
  - `linkIssue`: Ein Ziel, dessen Teil nach dem letzten `@` ein `:` enthält, ist nie Repo plus Ref (auch wenn ein Repo `git` registriert ist).
  - `listIssueIds(root, shard?)`: `shard` ohne `/^[0-9a-hjkmnp-tv-z]{2}$/` → `validation`; `listComments(root, id)`: `id` ohne `isIssueId` → `validation`.
  - `resolveContext` lädt `loadRepoRegistry` nur, wenn ein Repo-Wert zu prüfen ist (konfigurierter Repo-Name oder cwd in einem Git-Repo mit Remotes).
  - Ist `-B`/`BACKE_BACKLOG` ein Pfad ohne `.backe/backlog.jsonc`, lautet der Fehler `<pfad> ist keine Arbeitskopie eines Backlogs` ohne Hint `backe backlog list`.
  - `updateUserConfig`: nicht parsebares Edit-Ergebnis → Festlegung »M3 JSONC-Edit«.
  - `checkPropFilter`: Meldungen nennen `f.raw`.

- [ ] **Step 1: Failing Tests**

```ts
// url.test.ts
test.each([
  ['https://github.com/Acme/WebApp', 'github.com/acme/webapp'],
  ['git@gitlab.com:Group/Proj.git', 'gitlab.com/group/proj'],
  ['https://git.example.org/Team/Repo', 'git.example.org/Team/Repo'],
])('normalizeRepoUrl(%s) → %s', (input, out) => expect(normalizeRepoUrl(input)).toBe(out));
test('query and fragment are refused', () => {
  for (const u of ['https://github.com/a/b?x=1', 'https://github.com/a/b#readme']) {
    expect(catchErr(() => normalizeRepoUrl(u)).code).toBe('validation');
  }
});
test('normalizeRepoUrl is idempotent', () =>
  fc.assert(fc.property(repoUrlArb, (u) => normalizeRepoUrl(normalizeRepoUrl(u)) === normalizeRepoUrl(u))));
// names.test.ts
test.each(['main', 'feat/sso', 'v1.2', '4e1f9c2'])('isGitRef(%s) is true', (r) => expect(isGitRef(r)).toBe(true));
test.each(['a:b', 'a..b', '.hidden', 'x.lock', 'a b', '@', 'a@{1}', '/x', 'x/', 'a//b', 'x.', 'a~1', 'a^', 'a*', 'a[b'])(
  'isGitRef(%j) is false', (r) => expect(isGitRef(r)).toBe(false));
// issues.test.ts
test('a ref with a colon never makes a registered repo named git', async () => {
  // Repo »git« registriert; linkIssue(ctx, id, 'git@github.com:acme/api.git') → op mit url, ohne repo
});
// snapshot.test.ts
test('listIssueIds and listComments refuse malformed input', …); // '../x', 'bk-../../etc'
// resolve.test.ts
test('the repo registry is not loaded without a repo to match', async () => { /* vi.spyOn(snapshotModule, 'loadRepoRegistry'): cwd außerhalb von Git → 0 Aufrufe */ });
test('a backlog path without backlog config names the path, not backlog list', …);
// user-config.test.ts
test('an edit that yields unparsable jsonc is unexpected and leaves the file', async () => {
  // Datei mit Komma am Zeilenanfang (`{"a": 1\n, "user": "x"}`), updateUserConfig setzt project → unexpected, Datei byte-gleich
});
// props.test.ts
test('range filter messages quote the raw value', () => {
  expect(catchErr(() => checkPropFilter(parsePropFilter('level>=01'), cfgWithStringLevel)).message).toContain('level>=01');
});
```

- [ ] **Step 2: `pnpm vitest run src/core src/store src/context src/ops/props.test.ts src/services/issues.test.ts` → FAIL**
- [ ] **Step 3: Implementieren** — bestehende Golden-Files mit großgeschriebenen GitHub-Pfaden passen ihre Erwartung an.
- [ ] **Step 4: `mise run check` → PASS**
- [ ] **Step 5: Commit** — `fix(core): kanonische Repo-URLs idempotent und ohne Query, Git-Refs nach check-ref-format`

---

### Task 2: Altlasten aus M5a in `services` und `cli`

**Files:**
- Modify: `src/services/issue-show.ts`, `src/services/projects.ts`, `src/services/working-copy.ts`, `src/services/verify.ts`, `src/cli/commands/verify.ts`, `src/context/registry.ts`, `src/git/ssh.ts`, `src/cli/output.ts`, `src/cli/render-issue.ts`, `src/cli/commands/user.ts`, Meldungen in `src/cli/**`, `test/conventions.test.ts`
- Test: `src/services/issue-show.test.ts`, `src/services/projects.test.ts`, `src/services/working-copy.test.ts`, `src/context/registry.test.ts`, `src/git/ssh.test.ts`, `src/cli/output.test.ts`, `test/e2e/issue.test.ts`, `test/e2e/entities.test.ts`

**Interfaces:**
- Produces:
  - `IssueRefView` bekommt `assignee?: string`; die Kind-Zeilen in `issueDetailText` nutzen die Listenspalten von `issueLines`.
  - `user show`: Eintrag in `revoked_keys` ohne Zeitstempel → `widerrufen` ohne Klammer.
  - `listProjects`: `open` rekursiv (Festlegung).
  - `safeText`: Festlegung »M5a `safeText`«.
  - `removeBacklog` mit `--purge`: verweigert, wenn `git rev-list --branches --not --remotes` im verwalteten Clone nicht leer ist (alle lokalen Branches, nicht nur der Sync-Branch); Meldung nennt die Branches.
  - `renderError`: Festlegung »M5a Fehler-`details`«.
  - `readPublicKey`: `ssh-keygen` fehlt (ENOENT) → `unexpected` `ssh-keygen nicht gefunden`; stderr nennt eine Passphrase (`/passphrase/i`) → wie bisher `usage` »verschlüsselt«; sonst `validation` `Key »<pfad>« ist nicht lesbar: <erste stderr-Zeile>`.
  - `revertBinding(homes, name, handle, prev: { current?: string })`: setzt auch `current` zurück, wenn derselbe Aufruf es gesetzt hat; `cloneBacklog` liest `wasRegistered` unter `config.lock` (innerhalb von `updateUserConfig`).
  - Meldungen der CLI: Festlegung »M5a Flag-Namen«.
  - `verifyBacklog` liefert zusätzlich `unknownKeys: { path: string; keys: string[] }[]` aus dem Snapshot (backe.md §2.3: `verify` warnt wie `commit`); `verify` druckt je Datei `Warnung: <pfad>: unbekannte Keys a, b — eigene Daten gehören nach props`, JSON-Feld `unknown_keys`. Dafür trägt `StoredEntity.extra` schon die Keys; `loadSnapshot` bleibt unverändert.

- [ ] **Step 1: Failing Tests**

```ts
test('show children carry their assignee', …);                        // issue-show.test.ts
test('verifyBacklog lists files with unknown keys', …);                 // verify.test.ts, Fixture backlog-unknown-key
test('project list counts open issues of subprojects', …);            // projects.test.ts
test('purge refuses unpushed commits on any local branch', async () => {
  // verwalteter Clone, Branch »wip« mit eigenem Commit, Sync-Branch gepusht → conflict, Meldung nennt »wip«
});
test('revertBinding resets a current it set', …);                    // registry.test.ts
test('a broken key is not reported as encrypted', async () => {      // ssh.test.ts
  // Datei mit »-----BEGIN OPENSSH PRIVATE KEY-----\nmüll\n« → validation, message ohne »verschlüsselt«
});
test('safeText shows bidi controls but keeps emoji joiners', () => {
  expect(safeText('a‮b')).toBe('a\\u{202E}b');
  expect(safeText('👩‍💻')).toBe('👩‍💻');
});
test('error details keep user keys', () => {
  const err = new BackeError('validation', 'x', { details: { exitCode: 2, props: { estimate_h: 1, someKey: 2 } } });
  expect(JSON.parse(renderError(err, 'json')).error.details).toEqual({ exit_code: 2, props: { estimate_h: 1, someKey: 2 } });
});
// test/conventions.test.ts
test('flag names are not quoted', async () => { /* src/**/*.ts außer Tests: kein Treffer für »-- */ });
// e2e: Golden issue-show.txt (Kind-Zeilen mit Assignee), user-show.txt mit Hand-Edit ohne Zeitstempel
```

- [ ] **Step 2: `pnpm vitest run src test/conventions.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm build && pnpm vitest run test/e2e -u`, geänderte Golden-Files prüfen; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `fix(cli): Kind-Zeilen mit Assignee, sichtbare Bidi-Zeichen, Purge über alle Branches`

---

### Task 3: `ops` und `store` für Hand-Edits, LFS und Batch-Tempo

**Files:**
- Modify: `src/store/snapshot.ts`, `src/store/layout.ts`, `src/ops/translate.ts` (samt `topoOrder`), `src/ops/comment-ops.ts`, `src/ops/draft.ts`, `src/ops/verify-policy.ts` (nur falls `.gitattributes` bisher abgelehnt wird)
- Create: `scripts/bench-batch.ts`
- Test: `src/store/snapshot.test.ts`, `src/ops/translate.test.ts`, `src/ops/comment-ops.test.ts`, `src/ops/batch.test.ts`

**Interfaces:**
- Produces:
  - `BacklogSnapshot` bekommt `attributes: string | undefined` — Inhalt von `.gitattributes` (fehlt → `undefined`); `loadSnapshot` liest ihn mit.
  - `LFS_RULE = 'issues/*/*/attachments/** filter=lfs diff=lfs merge=lfs -text'` in `src/store/layout.ts`.
  - `attachAdd`: bei `config.attachments.lfs` und Datei-Anhang ergänzt der Draft `.gitattributes` um `LFS_RULE`, wenn keine Zeile exakt so lautet (angehängt mit `\n`, fehlender Schluss-Newline vorher ergänzt); der Snapshot des Drafts trägt den neuen Inhalt.
  - `snapshotAt(s: BacklogSnapshot, files: readonly { path: string; content: string | null }[]): BacklogSnapshot` in `src/store/snapshot.ts` — rein: ersetzt bzw. entfernt die Entitäten der genannten Pfade (Users, Projekte, Sprints, Repos, Issues; `.gitattributes` → `attributes`), parst wie `loadSnapshot`, Probleme dieser Pfade werden neu bestimmt; andere Pfade (Kommentare, Anhänge, Config, fremde Dateien) ändern nichts.
  - `translateEdits`: Festlegungen »Umhängen im Hand-Edit« und »Issue-Datei am falschen Ort«.
  - `topoOrder` in O(n + e) (Kahn mit Warteschlange); Reihenfolge bei Gleichstand wie bisher (nach ID).
  - `Draft`: `snapshot` materialisiert nicht mehr je Operation alle Maps neu; Ziel und Messung nach der Festlegung »Batch-Tempo«. `scripts/bench-batch.ts` erzeugt 20 000 Issues im Speicher und misst `applyBatch` mit 1 000 `issue.create`.

- [ ] **Step 1: Failing Tests**

```ts
// snapshot.test.ts
test('snapshotAt replaces, adds and removes entities by path', () => {
  const s0 = snap({ issues: [{ id: I(1), title: 'alt' }] });
  const s1 = snapshotAt(s0, [
    { path: issueFile(I(1)), content: issueText({ id: I(1), title: 'neu' }) },
    { path: issueFile(I(2)), content: issueText({ id: I(2) }) },
    { path: 'repos/webapp.md', content: null },
  ]);
  expect(s1.issues.get(I(1))?.data.title).toBe('neu');
  expect([...s1.issues.keys()]).toEqual([I(1), I(2)]);
  expect(s0.issues.get(I(1))?.data.title).toBe('alt');
});
test('snapshotAt turns a broken file into a problem', …);
test('loadSnapshot reads .gitattributes', …);
// comment-ops.test.ts
test('attach.add with lfs adds the rule to .gitattributes once', () => {
  // config lfs: true, attributes undefined → changes enthält .gitattributes mit LFS_RULE + '\n'
  // zweites attach.add im selben Draft → keine zweite Zeile
});
test('attach.add without lfs leaves .gitattributes alone', …);
// translate.test.ts
test('swapped parents translate in an order that applies', () => {
  // vorher: B.parent = A; nachher: A.parent = B, B ohne parent — für beide ID-Reihenfolgen
  // applyBatch(s, translateEdits(s, files, ctx).ops, ctx) wirft nicht
});
test('an issue in the wrong shard is a validation error', () => {
  const err = catchErr(() => translateEdits(s, [{ path: 'issues/zz/bk-7f3k2/issue.md', before: null, after: issueText({ id: 'bk-7f3k2' }) }], ctx));
  expect(err.code).toBe('validation');
  expect(err.message).toBe('issues/zz/bk-7f3k2/issue.md: Issue gehört nach issues/7f/bk-7f3k2/issue.md');
});
// batch.test.ts
test('a large batch yields the same result as before', () => {
  // 200 Issues, 50 Creates mit Platzhaltern, parent/depends_on auf Platzhalter:
  // recorded, refs und changes gleich einer fest eingecheckten Erwartung (Golden-JSON)
});
```

- [ ] **Step 2: `pnpm vitest run src/store src/ops` → FAIL**
- [ ] **Step 3: Implementieren** — Golden-JSON für den Batch-Gleichheitstest **vor** dem Umbau am alten Code erzeugen und einchecken.
- [ ] **Step 4: `pnpm vitest run src/store src/ops` → PASS; `node scripts/bench-batch.ts` ausführen, Zeit vorher/nachher in die Commit-Message**
- [ ] **Step 5: Commit** — `feat(ops): Snapshot an Pfaden fortschreiben, LFS-Regel mit dem ersten Anhang, Batch ohne quadratische Kosten`

---

### Task 4: Schreibpfad — mehrere abgeleitete Operationen, `edits`, `expectHead`, LFS

**Files:**
- Modify: `src/services/write.ts`, `src/git/commit.ts`, `src/services/quarantine.ts`, `src/services/outcome.ts`
- Create: `src/git/status.ts`
- Test: `src/services/write.test.ts`, `src/git/commit.test.ts`, `src/git/status.test.ts`, `src/services/quarantine.test.ts`

**Interfaces:**
- Consumes: `translateEdits`, `snapshotAt`, `applyBatch`, `readBlobs`.
- Produces:
  - `changedPaths(wc: string): Promise<string[]>` in `src/git/status.ts` — Festlegung »`backe commit` Umfang«, sortiert, ohne Pfade unter `.git/`.
  - `CommitInput` bekommt `updateRef?: { from: string | undefined } | false` (Default `{ from: parent }`; `false` = nur das Commit-Objekt, kein `update-ref`, kein Index-Reset) und `lfs?: boolean` (Festlegung »§2.8 LFS«, `-c`-Werte nur für `git add`).
  - `WriteInput`:
    - `derive` liefert `Operation | readonly Operation[]`; ein Array der Länge 1 ist ein Op-Commit, ab 2 ein Batch-Commit, leer ein No-op ohne Commit.
    - `manual` bekommt `expectHead?: string` (Festlegung »HEAD-Vorbedingung«).
    - neu `{ kind: 'edits'; subject?: string }` — unter dem Lock: `changedPaths`, `before` aus `HEAD`, `after` aus der Arbeitskopie, Basis `snapshotAt(loadSnapshot(wc), befores)`, `translateEdits`, dann `manual`-Anteil kanonisch (Entitätsdateien per `serializeEntityFile` samt `extra`, andere Dateien roh, Löschungen `null`), Operationen per `applyBatch` gegen `snapshotAt(basis, manualAfter)`. Die Prüfung ungesicherter Änderungen gilt nur für Pfade außerhalb von `changedPaths`. Commit-Kette nach der Festlegung »Commit-Strategie«; alle Pfade beider Commits stehen im Journal. Danach `git reset -q -- <alle bearbeiteten Pfade>` und die Festlegung »Arbeitskopie nach `backe commit`«.
  - `WriteResult` bekommt `chain: { commit: string; kind: 'manual' | 'op' | 'batch'; recorded: Operation[]; paths: string[] }[]` (nur bei `edits` mehr als ein Eintrag; `commit` ist der letzte), `warnings: { path: string; unknownKeys: string[] }[]` und `rewritten: { path: string; reason: 'canonical' | 'no_effect' }[]`.
  - Commits laufen mit `lfs: snapshot.config.attachments.lfs`; dann vor dem Schreiben `git lfs version` — scheitert es → Festlegung »§2.8 LFS«.
  - `quarantineCommit` übergibt `expectHead` = der Stand, gegen den es geprüft hat.
  - `writeOp` (outcome.ts): `derive` darf ein Array liefern; `WriteOutcome.op` wird dann `ops: Operation[]` — `WriteOutcome` bekommt `ops?: Operation[]` neben `op`.

- [ ] **Step 1: Failing Tests**

```ts
// status.test.ts
test('changedPaths lists modified, staged, untracked and deleted paths', …);
// commit.test.ts
test('updateRef false creates the commit without moving HEAD', …);
test('a chain moves HEAD once from the old head', …); // zwei commitPaths, zweiter mit updateRef {from: head}
// write.test.ts
test('derive with two operations writes one batch commit', …);
test('a manual write with a stale expectHead is a conflict', …);
test('edits: field changes become operations, unknown keys become manual first', async () => {
  // Issue A: title geändert; Issue B: unbekannter Key neu; users/x.md neu ohne Keys (manual), A.assignee = x
  // → chain [manual (B, users/x.md), op (issue.edit A mit set.title und set.assignee)]
  // git log: zwei Commits, beide signiert, Backe-Op manual bzw. Operation; Arbeitskopie sauber
});
test('edits: an invalid operation lands neither commit', async () => {
  // manual-Anteil plus depends_on-Zyklus → cycle, HEAD unverändert, Hand-Edits liegen noch in der Arbeitskopie
});
test('edits: a list reordered by hand is reset with a notice', …); // rewritten [{path, reason: 'no_effect'}]
test('edits: a set operation rewrites list order canonically with a notice', …); // reason 'canonical'
test('edits: a broken file names file and line', …);
test.runIf(hasLfs)('lfs: attachments are stored as lfs pointers', async () => {
  // config lfs: true, attach.add mit Datei → git cat-file -p HEAD:<pfad> beginnt mit »version https://git-lfs.github.com/spec/v1«
});
test('lfs without git-lfs on PATH is a validation error', async () => {
  // PATH ohne git-lfs (Verzeichnis mit Symlinks nur auf git, ssh-keygen, sh) → validation »attachments.lfs verlangt git-lfs«
});
// quarantine.test.ts
test('verify accept refuses when HEAD moved after the check', …); // Hook zwischen Prüfung und Write
```

- [ ] **Step 2: `pnpm vitest run src/git src/services/write.test.ts src/services/quarantine.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services src/git` → PASS**
- [ ] **Step 5: Commit** — `feat(services): Hand-Edits als manual- und Op-Commit, Batch aus derive, HEAD-Vorbedingung, LFS-Filter`

---

### Task 5: Services — `backe commit`, `issue edit` per Editor, `batch`

**Files:**
- Create: `src/services/commit.ts`, `src/services/batch.ts`
- Modify: `src/services/issues.ts`
- Test: `src/services/commit.test.ts`, `src/services/batch.test.ts`, `src/services/issues.test.ts`

**Interfaces:**
- Consumes: `executeWrite` (`edits`, `batch`, `derive` mit Array), `translateEdits`, `parseBatchInput`.
- Produces:
  - `type CommitOutcome = { commits: { commit: string; kind: 'manual' | 'op' | 'batch'; summary: string; recorded: Operation[]; paths: string[] }[]; warnings: { path: string; unknownKeys: string[] }[]; notices: string[] }` — `summary` = Subject des Commits; `notices` enthält die `rewritten`-Hinweise und den `-m`-Hinweis.
  - `commitEdits(ctx, input: { message?: string }, deps?: WriteDeps): Promise<CommitOutcome>` — leer → `commits: []`.
  - `readIssueFile(ctx, ref: string): Promise<{ id: string; path: string; text: string }>` — Datei wie auf der Platte.
  - `editIssueText(ctx, ref: string, before: string, after: string, deps?): Promise<WriteOutcome>` — `after === before` → No-op (`commit: undefined`, `op` = `{op:'issue.edit', id}`-Summary für `unverändert`); sonst `derive` mit `translateEdits(s, [{ path, before, after }], { actor })`; `manual` nicht leer → Festlegung »`issue edit` per Editor« (validation). Ein `before`, das nicht mehr dem Stand unter dem Lock entspricht, scheitert an den `from`-Vorbedingungen der Operationen (`conflict`).
  - `editIssue` (M5a): Werte gleich dem Ist-Stand → No-op statt `usage` (Festlegung »wirkungslose Flags«); ganz ohne Eingabe weiter `usage`.
  - `type BatchOutcome = { commit: string | undefined; refs: Record<string, string>; ops: Operation[]; notices: Notice[] }`.
  - `runBatch(ctx, text: string, deps?): Promise<BatchOutcome>` — BOM am Anfang entfernen, `parseBatchInput`, Festlegung »Batch-Eingabe« (verbotene Operationen mit `Zeile <n>: `), dann `executeWrite` `batch`. Kurz-IDs fallen an `IssueRef` des Schemas durch (`validation` mit Zeile).

- [ ] **Step 1: Failing Tests**

```ts
// commit.test.ts
test('hand edits with crlf, bom, reorder and whitespace leave a clean working copy', async () => {
  // A: Titel geändert, Datei mit BOM und CRLF gespeichert → issue.edit
  // B: nur projects umsortiert; C: nur Leerzeilen am Body-Ende ergänzt
  // → ein Commit (A), notices für B und C »keine wirksame Änderung«, statusShort(wc) leer
});
test('a deleted issue file becomes issue.delete', …);
test('a new comment file becomes comment.add', …);
test('unknown keys warn and go to the manual commit', …);
test('nothing to commit', async () => expect((await commitEdits(ctx, {})).commits).toEqual([]));
test('-m names the manual commit and is noted when unused', …);
// issues.test.ts
test('editIssueText turns a title and state change into one batch commit', …);
test('editIssueText with unchanged text writes nothing', …);
test('editIssueText refuses a change without operation', …); // unbekannter Key → validation
test('editIssueText after a concurrent change is a conflict', …); // before veraltet
test('edit flags equal to the current values are a no-op', …);
// batch.test.ts
test('batch input from agents', async () => {
  // BOM + CRLF + Leerzeilen am Ende → gelingt, refs {$f1: <id>}
  // Platzhalter vor Definition → Zeile 1, kein Commit
  // Kurz-ID '7f3' → validation, details.line 2
  // 1001 Zeilen → validation »höchstens 1000«
  // attach.add mit file → validation »Zeile 1: Datei-Anhänge gehen nicht per Batch«
  // issue.claim → validation »Zeile 1: issue.claim gibt es nicht im Batch«
});
test('batch commit carries the operations as body', …); // Backe-Op: batch, Body = encodeBatchBody(recorded)
```

- [ ] **Step 2: `pnpm vitest run src/services/commit.test.ts src/services/batch.test.ts src/services/issues.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): backe commit, issue edit aus dem Editor und batch`

---

### Task 6: Services — Anhänge

**Files:**
- Create: `src/services/attachments.ts`
- Test: `src/services/attachments.test.ts`

**Interfaces:**
- Consumes: `writeOp`, `resolveIssueRef`, `openSnapshot`, `attachmentsDir`.
- Produces:
  - `type AttachSource = { kind: 'file'; fileName: string; content: Uint8Array } | { kind: 'url'; url: string } | { kind: 'json'; text: string }` — `fileName` ist der Basename der Quelle.
  - `attachmentFileName(name: string, source: AttachSource): string` — Festlegungen »Dateiname« und »JSON-Anhang«.
  - `addAttachment(ctx, ref, input: { name: string; source: AttachSource }, deps?): Promise<WriteOutcome>` — `attach.add` mit `content`; JSON wird vorher formatiert; Größe prüft die Operation (`too_large`, Exit 2).
  - `listAttachments(ctx, ref): Promise<{ name: string; file?: string; url?: string; size?: number }[]>` — Reihenfolge wie im Frontmatter; `size` per `stat` in der Arbeitskopie.
  - `getAttachment(ctx, ref, name): Promise<{ name: string; url: string } | { name: string; file: string; path: string; size: number }>` — `path` absolut in der Arbeitskopie; fehlt der Anhang → `not_found` `<id>: Anhang »<name>« nicht gefunden`; Datei fehlt auf der Platte → `not_found` mit Pfad.
  - `removeAttachment(ctx, ref, name, deps?): Promise<WriteOutcome>`.

- [ ] **Step 1: Failing Tests**

```ts
test.each([
  ['trace', 'out.json', 'trace.json'],
  ['bericht', 'Bericht Final.PDF', 'bericht.pdf'],
  ['trace.v2', 'x.log', 'trace.v2'],
  ['dump', 'dump', 'dump'],
])('attachmentFileName(%s, %s) → %s', (name, src, out) =>
  expect(attachmentFileName(name, { kind: 'file', fileName: src, content: new Uint8Array() })).toBe(out));
test('a source extension that breaks the name rule is a validation error', …); // 'x', 'a.b c' → hint --name
test('file names, limits and empty files', async () => {
  // max_bytes 4: 4 Bytes → ok, 5 Bytes → validation mit Hint auf attachments.lfs; leere Datei → ok
});
test('json attachments are validated and formatted', async () => {
  // '{"b":1,"a":[1,2]}' → Datei data.json mit '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n'
  // '{' → validation
});
test('url attachments write no file', …);
test('list shows sizes, get returns the working copy path, rm removes file and entry', …);
test('a duplicate name is a conflict', …); // exists → Exit 4
```

- [ ] **Step 2: `pnpm vitest run src/services/attachments.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): Anhänge hinzufügen, auflisten, holen und entfernen`

---

### Task 7: Services — `repo check`, `repo where`, `repo scan`

**Files:**
- Create: `src/services/repo-check.ts`, `src/services/repo-local.ts`
- Test: `src/services/repo-check.test.ts`, `src/services/repo-local.test.ts`

**Interfaces:**
- Consumes: `normalizeRepoUrl`, `isGitRef`, `parseRepoRef`, `git`, `gitToplevel`, `gitRemotes`, `updateUserConfig`, `expandPath`, `physicalPath`.
- Produces:
  - `type RepoFinding = { level: 'error' | 'warning' | 'info'; kind: 'local' | 'ref' | 'network' | 'github'; message: string }`.
  - `type RepoCheck = { name: string; url: string; canonical?: string; findings: RepoFinding[]; github?: { visibility: string; archived: boolean }; cached?: string }` — `cached` = Zeitstempel, wenn das Remote-Ergebnis aus dem Cache kommt.
  - `type RepoCheckDeps = { now?: () => Date; github?: (owner: string, repo: string) => Promise<{ visibility: string; archived: boolean } | undefined>; lsRemote?: (url: string) => Promise<{ ok: true; refs: string[] } | { ok: false; message: string }> }` — Defaults: `gh`/`fetch` nach der Festlegung, `git ls-remote --end-of-options <url>` mit Timeout 20 s; `refs` ohne `refs/heads/`/`refs/tags/`-Präfix.
  - `checkRepos(ctx, input: { names?: string[]; remote?: boolean; fresh?: boolean }, deps?): Promise<RepoCheck[]>` — nach Name; unbekannter Name → `not_found`; Cache nach der Festlegung (nur Remote-Teil).
  - `repoCheckExit(checks: readonly RepoCheck[]): BackeError | undefined` — Festlegung »Exit-Codes `repo check`«; Meldung `repo check: <n> Fehler`.
  - `locateRepo(ctx, name: string): Promise<{ name: string; url: string; canonical: string; defaultRef?: string; path: string }>` — Festlegung »`repo where`«.
  - `type ScanEntry = { name: string; path: string; status: 'new' | 'unchanged' | 'differs' | 'overwritten'; previous?: string }`.
  - `scanRepos(ctx, dir: string, input: { force?: boolean; dryRun?: boolean }): Promise<ScanEntry[]>` — Festlegung »`repo scan`«; `dir` ist absolut (die CLI expandiert); nach Name, dann Pfad.

- [ ] **Step 1: Failing Tests**

```ts
// repo-check.test.ts — Fixture: Backlog mit Repos »webapp« (Bare-Repo im Temp-Verzeichnis, Branch main, Tag v1),
// »gone« (Pfad existiert nicht), »gh« (https://github.com/acme/tool); Issues mit webapp@feat/x, webapp@v1, webapp@4e1f9c2
test('local checks need no network', async () => {
  const checks = await checkRepos(ctx, {}, { lsRemote: neverCalled, github: neverCalled });
  expect(checks.map((c) => c.name)).toEqual(['gh', 'gone', 'webapp']);
});
test('a duplicate canonical url and an invalid default ref are local errors', …); // Hand-Edit zweier Repo-Dateien
test('remote: missing refs are errors, commit refs are info', async () => {
  // webapp: feat/x fehlt → error kind 'ref'; 4e1f9c2 → info »nicht per ls-remote prüfbar«; v1 ok
});
test('remote: unreachable repos are network errors and exit with 6', async () => {
  expect(repoCheckExit(await checkRepos(ctx, { names: ['gone'], remote: true }))?.code).toBe('sync');
});
test('remote: github visibility and archived come from the injected client', …); // archived → warning
test('remote results are cached for 24 h; fresh bypasses the cache', async () => {
  // now = t0 → lsRemote 1×; now = t0 + 23h → 0×; now = t0 + 25h → 1×; fresh → 1×
});
// repo-local.test.ts
test('where resolves name to the configured local path', …);
test('where without a local path names url and scan hint', async () => {
  const err = await catchErrAsync(() => locateRepo(ctx, 'webapp'));
  expect(err.code).toBe('not_found');
  expect(err.details).toMatchObject({ url: expect.any(String), canonical: expect.any(String) });
});
test('scan registers clones of registered repos and skips the rest', async () => {
  // dir/a (Remote = webapp), dir/b (fremdes Remote), dir/.hidden/c, dir/node_modules/d, dir/link → Symlink auf dir/a
  // → [{name: 'webapp', path: realpath(dir/a), status: 'new'}]
});
test('scan keeps a differing path unless forced; dry-run writes nothing', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/repo-check.test.ts src/services/repo-local.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): repo check mit Cache, repo where und repo scan`

---

### Task 8: Service — `doctor`

**Files:**
- Create: `src/services/doctor.ts`
- Test: `src/services/doctor.test.ts`

**Interfaces:**
- Consumes: `resolveContext`-Ergebnis, `readUserConfig`, `listBacklogs`, `managedClonePath`, `readPublicKey`, `activeFingerprints`, `loadSnapshot`, `headState`, `readLocalState`.
- Produces:
  - `type DoctorCheck = { id: string; status: 'ok' | 'warn' | 'fail'; detail: string; hint?: string }`.
  - `type DoctorDeps = { now?: () => Date; host?: string; run?: (cmd: string, args: string[]) => Promise<{ code: number; stdout: string } | 'missing'>; isAlive?: (pid: number) => boolean }`.
  - `runDoctor(input: { env: Env; cwd: string; ctx?: ResolvedContext; fix?: boolean }, deps?): Promise<DoctorCheck[]>` — läuft auch ohne auflösbaren Kontext (dann fehlen die Backlog-Prüfungen und `backlog` ist `warn` mit der Meldung der Auflösung). Prüfungen in dieser Reihenfolge:
    - `node`: `process.versions.node` ≥ 26, sonst `fail`.
    - `git`: vorhanden und ≥ 2.38 (`git --version`), sonst `fail`, Hint `Git ≥ 2.38 installieren`.
    - `ssh-keygen`: vorhanden, sonst `fail`.
    - `git-lfs`: vorhanden → `ok`; fehlt → `fail`, wenn der aktive Backlog `attachments.lfs` hat, sonst `warn` »optional«.
    - `gh`: vorhanden → `ok`, sonst `warn` »optional, für repo check --remote«.
    - `user-config`: lesbar und gültig, sonst `fail` mit der Schema-Meldung.
    - `backlog`: Kontext aufgelöst, Arbeitskopie vorhanden, Sync-Branch ausgecheckt, kein laufender Rebase, kein liegengebliebenes `write.journal`.
    - `identity`: Key lesbar und aktiver Key des Handles im Snapshot; `.git/backe/identity` passt zum Handle.
    - `lfs-rule`: bei `attachments.lfs` steht `LFS_RULE` in `.gitattributes` (sonst `warn`, Hint `kommt mit dem nächsten attach add`).
    - `bindings`: jeder Pfad in `backlogs.*.paths` existiert (sonst `warn` je Pfad, Hint `backe backlog remove <name>` oder `backe backlog add`).
    - `alternates`: jede Zeile in `.git/objects/info/alternates` verwalteter Clones zeigt auf ein existierendes Verzeichnis (sonst `fail`, Hint `git -C <clone> repack -a -d && rm <alternates>`).
    - `temp`: `<BACKE_HOME>/tmp/clone-*` älter als 1 h und Lock-Temp-Dateien toter PIDs desselben Hosts (`write.lock.*` in den Arbeitskopien, `config.lock.*`) → `warn` mit Anzahl; mit `fix` gelöscht → `ok` »<n> entfernt«.
    - `problems`: `snapshot.problems` → `warn` je Datei.
    - `references`: `assignee` von Issues und `lead` von Projekten, die keinen User mehr nennen → `warn` je Fundstelle (`<id> assignee <handle>`), Hint `backe issue assign <id> none` bzw. `backe project …`.
  - `doctorFailure(checks): BackeError | undefined` — Festlegung »`doctor`«.

- [ ] **Step 1: Failing Tests**

```ts
test('a healthy setup reports ok for every required check', …);
test('git older than 2.38 fails', async () => {
  const checks = await runDoctor(input, { run: fakeRun({ git: 'git version 2.37.1' }) });
  expect(checks.find((c) => c.id === 'git')).toMatchObject({ status: 'fail' });
});
test('missing git-lfs fails only when the backlog uses lfs', …);
test('leftover temp files are reported and removed with fix', async () => {
  // tmp/clone-abc mit mtime vor 2 h, tmp/clone-new jetzt, write.lock.99999.abcdef (isAlive → false)
  // ohne fix: warn »2 Temp-Reste«; mit fix: Dateien weg, clone-new bleibt
});
test('broken alternates fail', …);    // managed Clone per --reference, Referenz-Verzeichnis gelöscht
test('missing bound paths warn', …);
test('dangling assignee and lead warn after user rm', …); // users/x.md per Hand-Edit entfernt
test('doctor without a backlog still checks the environment', …);
test('doctorFailure counts fails', () => expect(doctorFailure([fail, warn, fail])?.message).toBe('doctor: 2 Prüfung(en) fehlgeschlagen'));
```

- [ ] **Step 2: `pnpm vitest run src/services/doctor.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): doctor prüft Umgebung, Arbeitskopien und Backlog`

---

### Task 9: Service — User-Config `get`, `set`, `edit`

**Files:**
- Create: `src/services/config.ts`
- Modify: `src/context/user-config.ts` (Export `parseUserConfigText(text, file): UserConfig`)
- Test: `src/services/config.test.ts`

**Interfaces:**
- Consumes: `readUserConfig`, `updateUserConfig`, `userConfigPath`, `withFileLock`, `configLockPath`, `UserConfigSchema`, `normalizeRepoUrl`.
- Produces:
  - `parseConfigKey(key: string): string[]` — Festlegung »`config`-Pfade«; prüft gegen die Struktur von `UserConfigSchema` (Records als beliebiger Key, Objekte mit festen Keys); kein String-Blatt → `validation` `»<key>« ist kein setzbarer Wert`, unbekannter Key → `validation` `Unbekannter Key »<seg>«; erlaubt: <keys>`.
  - `getConfig(homes: Homes, key?: string): Promise<{ text?: string; config: UserConfig; value?: unknown }>` — Festlegung »`config get`«.
  - `setConfig(homes, key: string, value: string | undefined): Promise<UserConfig>` — `undefined` = `--unset`; Schemafehler aus `updateUserConfig` bleiben `validation`; Entfernen eines fehlenden Keys ist ein No-op.
  - `editConfigText(homes, edit: (text: string) => Promise<string>): Promise<{ changed: boolean }>` — Festlegung »`config edit`«; der Entwurf eines ungültigen Ergebnisses liegt in `<BACKE_HOME>/config.jsonc.draft`, der Hint nennt den Pfad.

- [ ] **Step 1: Failing Tests**

```ts
test('config set keeps comments, canonicalizes repo keys and refuses invalid values', async () => {
  await writeFile(cfgPath, '{\n  // Standard\n  "user": "spw"\n}\n');
  await setConfig(homes, 'repos.https://github.com/Acme/WebApp.git', '~/code/webapp');
  const text = await readFile(cfgPath, 'utf8');
  expect(text).toContain('// Standard');
  expect(JSON.parse(stripComments(text)).repos).toEqual({ 'github.com/acme/webapp': '~/code/webapp' });
  expect((await catchErrAsync(() => setConfig(homes, 'output.color', 'bunt'))).code).toBe('validation');
  expect(await readFile(cfgPath, 'utf8')).toBe(text);
});
test.each([
  ['backlogs.acme.user', ['backlogs', 'acme', 'user']],
  ['identities.acme.claude-1.key', ['identities', 'acme', 'claude-1', 'key']],
  ['repos.gh:acme/api', ['repos', 'github.com/acme/api']],
])('parseConfigKey(%s)', (k, p) => expect(parseConfigKey(k)).toEqual(p));
test.each(['backlogs', 'output', 'nope', 'backlogs.acme.paths'])('parseConfigKey(%s) refuses', (k) =>
  expect(catchErr(() => parseConfigKey(k)).code).toBe('validation'));
test('get without key returns the file text, a missing key is not_found', …);
test('unset removes a key', …);
test('editConfigText writes a valid result and keeps a draft of an invalid one', …);
test('editConfigText refuses when the file changed meanwhile', …); // edit-Callback schreibt die Datei selbst um → conflict
```

- [ ] **Step 2: `pnpm vitest run src/services/config.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services src/context` → PASS**
- [ ] **Step 5: Commit** — `feat(services): User-Config lesen, setzen und im Editor bearbeiten`

---

### Task 10: CLI — `attach`, `commit`, `issue edit` per Editor, `batch`

**Files:**
- Create: `src/cli/commands/attach.ts`, `src/cli/commands/commit.ts`, `src/cli/commands/batch.ts`, `src/cli/editor.ts`, `test/fixtures/editors/` (kleine `sh`-Skripte)
- Modify: `src/cli/io.ts`, `src/cli/run.ts`, `src/cli/commands/issue.ts`, `src/cli/output.ts`
- Test: `test/e2e/attach.test.ts`, `test/e2e/handedit.test.ts`, `test/e2e/golden/`

**Interfaces:**
- Consumes: Tasks 5, 6.
- Produces:
  - `CliIo` bekommt `stdoutBytes(b: Uint8Array): void`, `stdinIsTTY: boolean` und `runEditor(command: string, file: string): Promise<number>` (`nodeIo`: `spawn('sh', ['-c', `${command} "$1"`, 'backe-editor', file], { stdio: 'inherit' })`, liefert den Exit-Code).
  - `editor.ts`:
    - `editorCommand(io: CliIo): string | undefined` — Festlegung »`issue edit` per Editor« (`BACKE_EDITOR` immer; `VISUAL`/`EDITOR` nur bei `stdinIsTTY && isTTY`).
    - `editText(io, label: string, text: string): Promise<{ text: string; file: string }>` — Temp-Datei anlegen (`0o600`), Editor starten, Exit ≠ 0 → `unexpected` nach der Festlegung, Ergebnis lesen. Die Temp-Datei löscht der Aufrufer nach Erfolg.
  - Befehle:
    - `attach add <id> --name <n> (<datei> | --url <u> | --json <json|->)` — genau eine Quelle, sonst `usage`; Datei über `absPath`, `stat` (Verzeichnis → `validation` `<pfad> ist keine Datei`, fehlt → `not_found`), Inhalt als Bytes; ohne globales `--json` (Festlegung). Ausgabe wie jeder Write.
    - `attach list <id>` — Text `<name>  <file|url>  <größe in Bytes oder ->` über `columns`; JSON Liste.
    - `attach get <id> <name> [-o <pfad>]` — Festlegung »`attach get`«; Bytes per `stdoutBytes`.
    - `attach rm <id> <name>`.
    - `commit [-m <msg>]` — Text: je Commit eine Zeile `summary`, Hinweise und Warnungen (`Warnung: <pfad>: unbekannte Keys a, b — eigene Daten gehören nach props`) auf stderr, leer → `Nichts zu committen`; JSON `{"commits":[{commit,kind,summary,ops,paths}],"warnings"?,"notices"?}` (`ops` = aufgezeichnete Operationen).
    - `issue edit <id>` ohne Änderungs-Flags → `readIssueFile`, `editText`, `editIssueText`; ohne Editor → `usage` nach der Festlegung. Ausgabe: wie `issue edit` mit Flags; ein Batch-Commit druckt `summarizeBatch`.
    - `batch [-f <pfad|->] [-]` — Festlegungen »Batch-Eingabe« und »Batch-Ausgabe«.

- [ ] **Step 1: Failing E2E-Tests**

```ts
// test/e2e/attach.test.ts
test('attach add from file, json and url; list; rm', …);         // Golden attach-list.txt, attach-list.json
test('attach get returns binary content unchanged', async () => {
  const bytes = randomBytes(4096);
  // attach add … bin.dat; attach get … → stdout als Buffer (cli-Helfer mit encoding: 'buffer') gleich bytes
});
test('attach get -o writes the file and prints the path', …);
test('attach add --json - reads stdin; --format json prints the outcome', …);
test('attach add over max_bytes exits 2 with lfs hint', …);
test('attach add with a directory or a missing file', …);         // 2 bzw. 3
// test/e2e/handedit.test.ts
test('commit translates hand edits and prints one line per commit', …); // Golden commit.txt, commit.json
test('commit with nothing changed', …);
test('an editor with arguments edits the issue', async () => {
  // BACKE_EDITOR="sh test/fixtures/editors/retitle.sh --title Neu" → issue show zeigt »Neu«
});
test('a failing editor changes nothing', …);                       // Exit 1, git log unverändert
test('without tty and BACKE_EDITOR no editor is started', async () => {
  const r = await cli(['issue', 'edit', id], { ...e, env: { ...e.env, EDITOR: 'false-editor-that-would-hang' } });
  expect(r.code).toBe(2);
  expect(r.stderr).toContain('BACKE_EDITOR');
});
test('editor output with unknown keys is refused with a commit hint', …);
test('batch from stdin and file prints placeholders', …);          // Golden batch.txt, batch.json
test('batch errors name the line', …);                             // JSON-Fehler mit details.line
```

- [ ] **Step 2: `pnpm build && pnpm vitest run test/e2e/attach.test.ts test/e2e/handedit.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm build && pnpm vitest run test/e2e -u`, Golden-Files gegen die Festlegungen prüfen; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `feat(cli): attach, commit, batch und issue edit im Editor`

---

### Task 11: CLI — `repo check|where|scan`, `doctor`, `config`; Abnahme

**Files:**
- Create: `src/cli/commands/doctor.ts`, `src/cli/commands/config.ts`
- Modify: `src/cli/commands/repo.ts`, `src/cli/run.ts`, `README.md`, `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`
- Test: `test/e2e/tools.test.ts`, `test/e2e/golden/`

**Interfaces:**
- Consumes: Tasks 7, 8, 9, `editor.ts`.
- Produces:
  - `repo check [name…] [--remote] [--fresh]` — Text: je Repo `<name>  <ok|fehler|warnung>  <url>`, darunter je Befund `  <level>: <message>`, bei GitHub `  github: <visibility>[, archiviert]`, aus dem Cache `  (Cache vom <ts>)`; danach `repoCheckExit`. JSON: `{"repos":[…]}`.
  - `repo where <name>` — Festlegung »`repo where`«.
  - `repo scan <verzeichnis> [--force] [--dry-run]` — Verzeichnis über `absPath`; Text-Zeilen nach der Festlegung, JSON `{"entries":[…]}`.
  - `doctor [--fix]` — Kontext wird versucht; scheitert die Auflösung, läuft `runDoctor` ohne `ctx`. Ausgabe und Exit nach der Festlegung.
  - `config get [key]`, `config set <key> <wert>`, `config set --unset <key>` (Wert und `--unset` zusammen → `usage`), `config edit` — ohne Editor → `usage` wie `issue edit`. `config set` druckt nichts (Exit 0), `config edit` druckt `unverändert` oder nichts.
  - README: Warnhinweis auf den Stand nach M5b (»attachments, hand-edit commits, batch, doctor and config work; sync, claim and the MCP server are not built yet«).
  - Gesamtplan: M5b-Zeile der Meilenstein-Tabelle auf diesen Plan verlinken; in »Übernommen aus M1–M5a« die M5b-Punkte abhaken (`✓ … → M5b, Task n`); die Festlegungen dieses Plans als Zeilen der Planentscheidungen mit Meilenstein `M5b`; die M5a-Zeile »§2.17 `issue edit` … bleibt nichts → `usage`« auf die neue Festlegung verweisen lassen; Abschnitt M5b mit »Abgenommen am …« erst nach dem Abschluss-Review.

- [ ] **Step 1: Failing E2E-Tests (`test/e2e/tools.test.ts`)**

```ts
test('repo check local and remote against a bare repo', …);  // Golden repo-check.txt, repo-check.json; fehlender Ref → Exit 2
test('repo check on an unreachable repo exits 6', …);
test('repo where prints the path; without path exits 3 with hint', …);
test('repo scan registers a clone and repo where finds it', …); // Golden repo-scan.txt
test('doctor reports and exits 0 on a healthy setup', …);    // Golden doctor.txt nach Normalisierung der Versionen
test('doctor --json lists checks', …);
test('config set, get and unset', …);                         // Golden config-get.txt
test('config edit with an invalid result keeps the original', async () => {
  // BACKE_EDITOR schreibt »{ kaputt« → Exit 2, stderr nennt config.jsonc.draft, config.jsonc unverändert
});
test('config set with a value and --unset is a usage error', …);
```

- [ ] **Step 2: `pnpm build && pnpm vitest run test/e2e/tools.test.ts` → FAIL**
- [ ] **Step 3: Implementieren, README und Gesamtplan aktualisieren**
- [ ] **Step 4: `mise run check` → PASS; Coverage-Gate `src/services/**` ≥ 90 % Lines und Branches im Report**
- [ ] **Step 5: Commit** — `feat(cli): repo check, where und scan, doctor und config; Gesamtplan nach M5b`

---

## Abnahme M5b

- `mise run check` grün, CI grün auf `ubuntu-latest` und `macos-latest`.
- E2E gegen `dist/cli.js` mit Golden-Files für Text und JSON der neuen Befehlsgruppen (`attach`, `commit`, `batch`, `repo check|where|scan`, `doctor`, `config`); `issue edit` per Editor über `BACKE_EDITOR`.
- Exit-Code `6` mindestens einmal geprüft (`repo check --remote` auf ein unerreichbares Repo).
- Coverage-Gate `src/services/**` eingehalten.
- Gesamtplan zeigt die M5b-Punkte als eingelöst und M6 als nächsten Meilenstein.

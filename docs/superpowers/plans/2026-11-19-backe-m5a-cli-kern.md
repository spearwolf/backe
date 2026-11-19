# backe M5a — CLI-Kern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backe` ist als CLI benutzbar: Issues, Kommentare, Projekte, Sprints, Repos, Users und Backlogs anlegen, lesen, ändern und löschen, `next` ohne Claim, `context`, `init`, `verify` — mit Ausgabeformaten `text|json|md`, `--fields`, Kontext-Kopfzeile, Fehler-JSON und Exit-Codes nach Vertrag.

**Architecture:** Jeder Befehl ist ein Service in `src/services/` (ein Service-Layer für CLI und später MCP, backe.md §3.7): Services nehmen Roh-Eingaben (Kurz-IDs, `me`, `in-progress`), normalisieren sie, lesen über `loadSnapshot` und schreiben über `executeWrite`. Schreibende Services bauen ihre Operation unter dem Write-Lock gegen den gesperrten Snapshot (`WriteInput` `kind: 'derive'`), damit Vorbedingungen (`from`) den Stand treffen, gegen den committet wird. `src/cli/` ist ein dünner commander-Adapter: Flags → Service-Eingabe, Ergebnis → Text/JSON/Markdown, `BackeError` → stderr und Exit-Code. `run(argv, io)` ist in-process aufrufbar; abgenommen wird über `dist/cli.js` mit Golden-Files.

**Tech Stack:** wie M4; `commander` 15 für die CLI. Keine neue Runtime-Abhängigkeit.

**Spec:** `docs/proposals/backe.md` (§2.4–2.7, §2.9–2.12, §2.14, §2.17, §2.18, §2.22–2.24, §5), Gesamtplan `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`. Es gelten dessen Global Constraints, die M5-Zeilen in »Übernommen aus M1–M4«, soweit dieser Plan sie M5a zuordnet (Tabelle unten), und die Planentscheidungen.

## Global Constraints

Alle Global Constraints des Gesamtplans und von M1–M4, dazu für M5a:

- Schichten: `src/cli/**` importiert `services`, `context`, `core`, `ops` (nur Typen und reine Helfer wie `parsePropAssignment`, `summarizeOp`), nie `git` oder `store` direkt. `src/services/**` importiert nie `cli`.
- Services sind die Eingabegrenze: Sie akzeptieren, was ein Mensch oder Agent tippt (Kurz-ID, `me`, `none`, `kebab-case`-States, `--prop`-Ausdrücke) und liefern strukturierte Ergebnisse ohne Formatierung. Ausgabe, Farben, Exit-Codes und das Lesen von stdin oder Dateien gehören der CLI.
- Jeder schreibende Service geht über `executeWrite`; Operationen mit Vorbedingung baut er per `kind: 'derive'` unter dem Lock.
- Exit-Codes nur aus `EXIT_CODES` (`0` ok · `1` unerwartet · `2` usage/validation/ambiguous · `3` not_found · `4` conflict · `5` verify · `6` sync). Auch commander-Fehler (unbekannte Option, fehlendes Argument) enden mit `2`, `--help` und `--version` mit `0`.
- Fehlercodes: `usage` = der Aufruf passt nicht (fehlende oder sich ausschließende Angaben, keine Identität, stdin doppelt verlangt); `validation` = ein angegebener Wert oder Dateiinhalt verletzt eine Regel (ungültiger State, Slug, Handle, Präfix, zu kurze Kurz-ID). Beide enden mit `2`; unterscheidbar sind sie im Fehler-JSON.
- Meldungen setzen Werte in `»…«`, nie in `"…"` (JSON-Ausgabe ohne Escapes, ein Stil für Golden-Files).
- Ausgabe: stdout trägt nur das Ergebnis, stderr Fehler, Hinweise (`Hinweis: …`) und Warnungen (`Warnung: …`). JSON ist eine Zeile, ohne Einrückung, nur gesetzte Felder, abschließender `\n`.
- Farben nur, wenn stdout ein TTY ist, `NO_COLOR` nicht gesetzt ist und `output.color` nicht `never` ist; `always` erzwingt sie.
- Kein Env-Schalter für Tests im ausgelieferten Code; Determinismus in E2E-Tests über Normalisierung der Ausgabe (Task 12).
- Tests: Services gegen echte Backlogs aus `testBacklog()` (`test/helpers/git.ts`), CLI nur über `dist/cli.js` als Subprozess. `pnpm vitest run test/e2e` braucht vorher `pnpm build`; `mise run check` baut vor den Tests.
- Coverage-Gate `src/services/**` bleibt `lines: 90, branches: 90`; `src/cli/**` ist ausgenommen und wird über E2E abgedeckt.

## Review Focus

1. **Texteingaben, die wie Optionen oder Sonderzeichen aussehen** — Titel `-x`, `--title=-x`, Titel mit `: ` oder führendem `#`, mehrzeiliger Body über `-d -`, leeres stdin bei `--reason -`: Titel landen unverändert im Issue, leeres stdin ist `validation` »Begründung ist leer«, zwei stdin-Verbraucher in einem Aufruf sind `usage`. → Task 13 `titles that look like options or YAML survive`, `stdin is read once`.
2. **Kurz-IDs in der Praxis** — Großbuchstaben (`7F3`), mit Präfix (`bk-7f3`), ein exakter 5-Zeichen-Treffer neben einer 6-stelligen ID mit gleichem Anfang, die ID eines kaputten Issues: exakter Treffer gewinnt, Großschreibung egal, Mehrdeutigkeit nennt die Kandidaten, kaputtes Issue meldet sein Problem statt »nicht gefunden«. → Task 1, Task 5 `a broken issue is reported, not missing`.
3. **Ausgabe in Pipes und für Agents** — kein ANSI-Code ohne TTY oder mit `NO_COLOR`; im JSON-Modus ist stdout bei Fehlern leer und stderr genau ein JSON-Objekt; eine unbekannte Option endet mit `2`, nicht mit commanders `1`. → Task 12 `errors in json mode`, `usage errors exit with 2`, `no color in pipes`.
4. **Relative und `~`-Pfade** — `backe init ./acme`, `backe init ~/acme`, `backe backlog add acme ../acme`: die CLI expandiert gegen `cwd` bzw. `HOME`, der Service bekommt einen absoluten Pfad. → Task 12 `init and backlog add expand relative and ~ paths`.
5. **Kein Kontext** — `backe ls` ohne Config, ohne Backlog-Repo und ohne `.backlog.jsonc`: Exit `2` mit Hinweis auf `backe backlog use`/`backe init`, kein Stacktrace; ein Handle ohne Key darf lesen, ein Write nennt den fehlenden Key. → Task 12 `no backlog resolves to a usage error with hint`, Task 13 `a handle without key reads but cannot write`.

## Festlegungen

Stellen, die Spec und Gesamtplan offenlassen und die dieser Plan festlegt. Nach Abnahme wandern sie in die Planentscheidungen des Gesamtplans (Task 14).

| Stelle | Festlegung |
| --- | --- |
| Schnitt M5 | M5a: Gerüst, Ausgabe, alle Befehle außer den M5b-Gruppen. M5b: `attach *` samt Größenlimit und LFS, `repo check\|where\|scan`, `commit` und `issue edit` per `$EDITOR`, `batch`, `doctor`, `config get\|set\|edit`. |
| Spec-Frage `parent`/`depends_on` über Kreuz | `depends_on` zwischen Vorfahre und Nachfahre ist ein Zyklus (`cycle`, Exit 2) — beim Setzen der Abhängigkeit wie beim Umhängen, das eine solche Beziehung erzeugt. |
| Spec-Frage offenes Kind unter `done`-Parent | Anlegen, Umhängen, `move`/`resume`/`reopen` eines Kindes in einen offenen State unter einem `done`-Parent → `settled_parent` (`conflict`, Exit 4), Hint `backe issue reopen <parent>`. `move --force` übergeht es wie bei der `done`-Sperre. |
| §2.18 `issue list` Default | ohne `--state` nur offene Issues (nicht `done`, `cancelled`, `rejected`); `--state all` zeigt alle. |
| §2.18 mehrfache Filter | Werte innerhalb eines Flags oder einer Komma-Liste sind ODER, verschiedene Flags UND; `-p` filtert rekursiv, `--exact` nur genau. |
| §2.14 Kopfzeile | genau die Filter, deren Wert aus dem Kontext stammt (nicht aus einem expliziten Flag), plus `backlog`; ohne solche Filter keine Kopfzeile. Text: `backlog=acme project=web/auth repo=webapp`. JSON: Feld `context` mit denselben Keys, sonst fehlt es. |
| §2.18 Text-Liste | `<id>  <state, 11 breit>  <assignee oder ->  <titel>`; IDs und Assignees auf die breiteste Zeile gepolstert (Codepoints); `⧗ ` vor dem Titel bei offenen `depends_on`; `--tree` rückt den Titel um zwei Leerzeichen je Ebene ein. |
| §2.18 `--fields` | nur mit `--format json` (sonst `usage`); wirkt auf die Issue-Objekte von `issue list`, `issue show`, `next`; unbekanntes Feld → `usage` mit der Liste der erlaubten. |
| §2.18 `--format md` | nur `issue show` (Datei wie auf der Platte plus angeforderte Kommentare); andere Befehle → `usage`. |
| Write-Ausgabe | Text: `issue create` druckt nur die neue ID; sonst `summarizeOp(op)`; ohne Änderung `unverändert: <summary>`, Exit 0. JSON: `{"commit":<sha\|null>,"op":<aufgezeichnet>,"id"?:…,"notices"?:[…]}`. Hinweise der Operation nach stderr als `Hinweis: …`. |
| Fehler-Ausgabe | Text: `Fehler: <message>` und optional `Hinweis: <hint>`. JSON: `{"error":{"code","message","hint"?,"details"?}}` — `details` mit Kandidaten, Zyklus-IDs, Zeile. |
| `issue create` Vorbelegung | ohne `--parent`: `projects`/`sprints`/`repos` aus dem Kontext, sofern kein Flag; mit `--parent` erbt die Operation vom Parent (M2), der Kontext füllt nichts. |
| Kommentar-Referenz | `comment edit\|delete <id> <kommentar>`: voller Dateiname oder 1-basierter Index aus `comment list`. |
| `issue link <ziel>` | passt `ziel` auf `<repo-name>[@<ref>]` und ist der Name registriert → Repo; sonst URL: steht nach dem letzten `@` kein `:` und ist der Teil davor eine normalisierbare URL ungleich `git`, ist der Rest der Ref. |
| `init`-Identität | Handle aus `--as` → `BACKE_USER` → `user` der User-Config, sonst `usage`; Key aus `--key` → `~/.ssh/id_ed25519.pub`, falls vorhanden, sonst `usage`. |
| Hints mit CLI-Flags in `ops`/`context` | bleiben; M7 entscheidet die Übersetzung für MCP. |
| Clone eines neueren Formats | erlaubt (Lesen geht), `CloneResult.notices` meldet `Backlog-Format <v> ist neuer als dieses backe (<max>); nur lesen`. |

### Übernommene Punkte — Zuordnung

| Herkunft | Punkt | Wo |
| --- | --- | --- |
| M1 | `resolveShortId` exakter Treffer, Groß-/Kleinschreibung, volle ID; `usage` vs. `validation` | Task 1 |
| M1 | URL-Groß-/Kleinschreibung, Query/Fragment, Git-Argv mit `--`, Ref-Validierung, `listIssueIds`/`listComments`-Eingaben | M5b (Repo-Registry) |
| M2 | Spec-Frage `next`; `project.mv` mit kaputter Unterprojekt-Datei; Enum `"01"`; `-0`; `reason_file` ohne `reason`; Rank-Anker kaputt; `issue.link` mit URL | Task 2 |
| M2 | Batch O(k·n), `topoOrder`, `backe commit`-Strategie, `user.rm`-Hinweis | M5b |
| M3 | `findProjectConfig` deterministisch; rohe Node-Fehler; `gitToplevel` doppelt; Anführungszeichen; `schemaError` | Task 1 |
| M3 | JSONC-Edit mit ungültigem Ergebnis; `normalizeRepoUrl` idempotent; `loadRepoRegistry` je Auflösung | M5b |
| M4 | relative Pfade in `init`/`backlog add`; leerer Quarantäne-Grund | Task 12 |
| M4 | Dirty-Hinweis; `landedCommit` mit Akteur; verschlüsselter Key ohne `.pub` | Task 3 |
| M4 | Formatversion beim Clone; Registrierung nach gescheitertem Move; Reihenfolge in `addBacklog` | Task 4 |
| M4 | HEAD-Vorbedingung manueller Writes; `doctor`-Prüfungen | M5b |

---

### Task 1: Altlasten in `core` und `context`

**Files:**
- Modify: `src/core/ids.ts`, `src/core/errors.ts`, `src/context/project-config.ts`, `src/context/paths.ts`, `src/context/resolve.ts`, `src/context/user-config.ts`, `src/services/verify-state.ts`, `src/services/init.ts`, Meldungen in `src/**`
- Create: `test/conventions.test.ts`
- Test: `src/core/ids.test.ts`, `src/core/errors.test.ts`, `src/context/project-config.test.ts`, `src/context/paths.test.ts`, `src/context/resolve.test.ts`, `src/services/init.test.ts`

**Interfaces:**
- Produces:
  - `resolveShortId(input, ids)`: vergleicht kleingeschrieben. Volle ID → genau diese oder `not_found` `Issue »<id>« nicht gefunden`. Eingabe mit Präfix und Bindestrich, aber keine volle ID (`bk-7f3`) → Präfix abschneiden, weiter als Kurzform. Kurzform < 3 Zeichen → `validation`. Ein Kandidat, dessen Zufallsteil gleich der Eingabe ist, gewinnt vor jeder Mehrdeutigkeit. Mehrdeutig → `ambiguous` `ID-Kurzform »<in>« ist mehrdeutig: <bis zu 10 IDs>[, …]`, `details.candidates` vollständig.
  - `core/errors.ts`: Doc-Kommentar mit der Abgrenzung `usage`/`validation` aus den Global Constraints; `schemaError(file: string, error: ZodError, hint?: string): BackeError` zieht aus `context/user-config.ts` hierher (alle Importe umstellen). Die gleichnamige Funktion in `verify-state.ts` heißt danach `zodMessage(error): string`.
  - `initBacklog`: ungültiger Name, Präfix, Handle → `validation` (statt `usage`).
  - `findProjectConfig(cwd)`: liest `.backlog.jsonc` vor `.backlog.local.jsonc`, nacheinander; ist eine kaputt, meldet der Fehler immer zuerst `.backlog.jsonc`.
  - `context/paths.ts`: `exists(path)` (neu exportiert, ersetzt die lokalen Kopien in `context` und `services`) liefert `false` nur bei `ENOENT`/`ENOTDIR`; jeder andere Fehler → `BackeError('unexpected', '<pfad>: <code>')`. `physicalPath` behandelt `ENOTDIR` wie `ENOENT`. `readBacklogName`, `readdir` in `resolve.ts` und `ownerOf` werfen bei anderen Codes ebenso `unexpected` mit Pfad.
  - `resolveContext` ruft `gitToplevel(cwd)` höchstens einmal je Aufruf.
  - Meldungen in `src/**`: Werte in `»…«`.

- [ ] **Step 1: Failing Tests**

```ts
// ids.test.ts
const ids = ['bk-7f3k2', 'bk-7f3k2a', 'bk-7f3aa', 'bk-a91c0'];
test.each([
  ['7f3k2', 'bk-7f3k2'],      // exakt vor der 6-stelligen
  ['7F3K2', 'bk-7f3k2'],
  ['BK-A91C0', 'bk-a91c0'],
  ['bk-a91', 'bk-a91c0'],
])('resolveShortId(%s) → %s', (input, id) => expect(resolveShortId(input, ids)).toBe(id));
test('ambiguous short ids name their candidates', () => {
  const err = catchErr(() => resolveShortId('7f3', ids));
  expect(err.code).toBe('ambiguous');
  expect(err.message).toBe('ID-Kurzform »7f3« ist mehrdeutig: bk-7f3k2, bk-7f3k2a, bk-7f3aa');
  expect(err.details).toEqual({ candidates: ['bk-7f3k2', 'bk-7f3k2a', 'bk-7f3aa'] });
});
test('a too short id is a validation error', () =>
  expect(catchErr(() => resolveShortId('7f', ids)).code).toBe('validation'));
// project-config.test.ts
test('two broken project configs report .backlog.jsonc first', async () => { /* beide kaputt → message beginnt mit dem Pfad von .backlog.jsonc, 20× wiederholt gleich */ });
// paths.test.ts
test('exists throws on EACCES instead of reporting false', async () => { /* Verzeichnis 0o000, Datei darin; als root skip */ });
test('physicalPath treats ENOTDIR like a missing path', async () => { /* <datei>/x */ });
// resolve.test.ts
test('resolveContext asks git for the toplevel once', async () => { /* vi.spyOn auf das query-Modul, Aufrufe für cwd === 1 */ });
// init.test.ts
test('an invalid prefix is a validation error', async () => { /* prefix 'B' → validation */ });
// test/conventions.test.ts
test('messages quote values with »…«, not "…"', async () => {
  // alle src/**/*.ts außer *.test.ts; Treffer von /"\$\{[^}]+\}"/ außerhalb einer kurzen Allowlist
  // (Dateien, die JSON oder Git-Argumente zusammensetzen) → Liste der Fundstellen ist leer
});
```

- [ ] **Step 2: `pnpm vitest run src/core src/context src/services/init.test.ts test/conventions.test.ts` → FAIL**
- [ ] **Step 3: Implementieren** — bestehende Tests, die alte Meldungen oder `usage` erwarten, passen ihre Erwartung an.
- [ ] **Step 4: `mise run check` → PASS**
- [ ] **Step 5: Commit** — `fix(core): Kurz-IDs ohne Groß-/Kleinschreibung, exakter Treffer zuerst, einheitliche Fehlercodes und Anführungszeichen`

---

### Task 2: Altlasten in `ops` und die Spec-Fragen zu `next`

**Files:**
- Modify: `src/ops/invariants.ts`, `src/ops/issue-ops.ts`, `src/ops/state-ops.ts`, `src/ops/entity-ops.ts`, `src/ops/props.ts`, `src/ops/operation.ts`, `src/ops/rank.ts`, `src/core/schemas.ts`
- Test: `src/ops/issue-ops.test.ts`, `src/ops/state-ops.test.ts`, `src/ops/entity-ops.test.ts`, `src/ops/props.test.ts`, `src/ops/operation.test.ts`, `src/ops/rank.test.ts`, `src/ops/graph.test.ts`

**Interfaces:**
- Produces:
  - `Violation` bekommt `'settled_parent'` (in `CONFLICTS`).
  - `checkIssueInvariants`:
    - Eine neue `depends_on`-Kante `a → b`, bei der `b` Vorfahre oder Nachfahre von `a` ist → `cycle` `Zyklus über parent und depends_on: <a> -> <b>`, `ids: [a, b]`.
    - Eine neue `parent`-Kante macht jeden Knoten im Teilbaum von `a` zum Nachfahren der neuen Vorfahren; besteht zwischen einem davon und einem neuen Vorfahren eine `depends_on`-Kante (beide Richtungen) → derselbe Fehler mit diesen beiden IDs.
    - `after` ist offen und sein Parent `done`, und `before` war geschlossen oder hatte einen anderen Parent oder fehlt → `settled_parent` `<id>: Parent <p> ist done`, hint `backe issue reopen <p>`. `issue.move` mit `force: true` übergeht die Prüfung.
  - `project.mv`: Liegt im verschobenen Teilbaum eine Projektdatei mit Problem (`snapshot.problems`, `kind: 'project'`), → `violation('schema', 'Projekt <pfad> ist nicht lesbar: <message>')`, nichts wird verschoben.
  - `PropFilter` `ge`/`le` bekommt `raw: string`; `propMatches` vergleicht für deklarierte geordnete Enums über `raw` (Position in `values`), sonst wie bisher.
  - `PropValue`-Schema lehnt `-0` ab (`Object.is(v, -0)` → `-0 ist kein gültiger Wert`), damit auch `decodeOp`.
  - `issue.move`, `issue.resume`, `issue.reopen`: `reason_file` ohne `reason` → Schemafehler `"reason_file" nur zusammen mit "reason"`.
  - `rankPlacement`/`issue.rank`: Ist der Anker (`before`/`after`) ein Issue mit Problem → `schema` `Anker <id> ist nicht lesbar: <message>` statt `missing_ref`. `issue.link` mit `url`, deren kanonische Form zu einer kaputten Repo-Datei gehört → `schema` wie `repo.add`.

- [ ] **Step 1: Failing Tests**

```ts
// issue-ops.test.ts
test('depends_on from a child to its ancestor is a cycle', () => {
  const s = snap({ issues: [{ id: I(1) }, { id: I(2), parent: I(1) }, { id: I(3), parent: I(2) }] });
  const err = catchErr(() => apply(s, { op: 'issue.edit', id: I(3), add: { depends_on: [I(1)] } }));
  expect(err.details).toMatchObject({ reason: 'cycle', ids: [I(3), I(1)] });
});
test('depends_on from a parent to its descendant is a cycle', …);
test('reparenting under an issue the subtree depends on is a cycle', () => {
  // I(2).depends_on [I(1)], I(3).parent I(2); edit I(1) set.parent → I(3)… bzw. I(2) unter I(1) hängen
});
test('an open child under a done parent is refused', () => {
  // create mit parent done → settled_parent; edit set.parent → done-Parent; reopen eines Kindes; move eines Kindes aus done nach todo
});
test('move --force may reopen a child of a done parent', …);
// entity-ops.test.ts
test('project.mv refuses a broken subproject file', …);
// props.test.ts
test('ordered enum values that look like numbers compare by position', () => {
  const config = cfg({ props: { level: { type: 'enum', values: ['03', '02', '01'], ordered: true, description: 'x' } } });
  expect(propMatches(issueWith({ level: '02' }), parsePropFilter('level>=01'), config)).toBe(true);
});
// operation.test.ts
test('decodeOp rejects -0 in props', …);
test('reason_file without reason is rejected', …);
// rank.test.ts
test('a broken anchor is a schema error', …);
```

- [ ] **Step 2: `pnpm vitest run src/ops src/core` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/ops src/core` → PASS**
- [ ] **Step 5: Commit** — `feat(ops): Abhängigkeit über die Hierarchie ist ein Zyklus, kein offenes Kind unter done-Parent`

---

### Task 3: Schreibpfad — `derive` und Altlasten aus M4

**Files:**
- Modify: `src/services/write.ts`, `src/git/ssh.ts`
- Test: `src/services/write.test.ts`, `src/git/ssh.test.ts`

**Interfaces:**
- Produces:
  - `WriteInput` bekommt `{ kind: 'derive'; derive: (snapshot: BacklogSnapshot, actor: string) => Operation }`. `executeWrite` ruft `derive` nach `loadSnapshot` und `assertActorIsUser` unter dem Lock auf; danach wie `kind: 'op'`. Wirft `derive`, wird nichts geschrieben.
  - Dirty-Hinweis: `backe commit, oder git -C <wc> restore --staged --worktree -- <pfade>`.
  - `landedCommit` gilt nur, wenn der neue HEAD zusätzlich den Trailer `Backe-Actor: <handle>` und das erwartete Subject trägt.
  - `readPublicKey(keyPath)`: Liegt keine `.pub` daneben, beginnt die Datei mit `-----BEGIN OPENSSH PRIVATE KEY-----` und scheitert `ssh-keygen -y` → `BackeError('usage', 'Key »<pfad>« ist verschlüsselt und hat keine ».pub« daneben', {hint: 'ssh-keygen -y -f <pfad> > <pfad>.pub'})`.

- [ ] **Step 1: Failing Tests**

```ts
test('derive builds the operation against the locked snapshot', async () => {
  const b = await testBacklog();
  const r = await executeWrite(await b.context(), {
    kind: 'derive',
    derive: (s, actor) => ({ op: 'issue.create', title: `von ${actor} bei ${s.issues.size}` }),
  });
  expect(r.recorded[0]).toMatchObject({ op: 'issue.create', title: 'von spw bei 0' });
});
test('a throwing derive writes nothing', …);
test('the dirty hint restores staged and worktree', …);
test('a foreign commit with the same tree is not taken as landed', …);
// ssh.test.ts
test('an encrypted private key without .pub is a usage error with hint', async () => {
  // ssh-keygen -q -t ed25519 -N secret -f <p>; rm <p>.pub
});
```

- [ ] **Step 2: `pnpm vitest run src/services/write.test.ts src/git/ssh.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services src/git` → PASS**
- [ ] **Step 5: Commit** — `feat(services): Operationen unter dem Write-Lock ableiten, Hinweise und Key-Fehler präzisiert`

---

### Task 4: Arbeitskopien — Altlasten aus M4

**Files:**
- Modify: `src/services/working-copy.ts`
- Test: `src/services/working-copy.test.ts`

**Interfaces:**
- Produces:
  - `cloneBacklog`: Formatversion des geklonten Backlogs > `BACKLOG_FORMAT_VERSION` → Clone gelingt, `notices` enthält `Backlog-Format <v> ist neuer als dieses backe (<max>); nur lesen`. Scheitert der finale Move, entfernt `cloneBacklog` eine Registrierung, die derselbe Aufruf angelegt hat.
  - `addBacklog`: Reihenfolge Prüfen (Toplevel, Name, Identität frei) → `verify` → Registrierung → `identity` und `anchor` schreiben. Scheitert ein Schritt nach der Registrierung, wird sie zurückgenommen; vor dem `verify` ist nichts geschrieben.

- [ ] **Step 1: Failing Tests**

```ts
test('cloning a newer format succeeds with a read-only notice', …);
test('a failed final move leaves no registration behind', async () => { /* CloneHooks.beforeFinish legt das Ziel als Datei an */ });
test('addBacklog writes nothing when verify fails', async () => {
  // Arbeitskopie mit ungültigem Commit (rawCommit fremd signiert): danach weder Registrierung noch .git/backe/identity
});
```

- [ ] **Step 2: `pnpm vitest run src/services/working-copy.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `fix(services): Clone meldet neueres Format, add schreibt erst nach verify`

---

### Task 5: Lese-Grundlagen der Services

**Files:**
- Create: `src/services/read.ts`, `src/services/outcome.ts`
- Test: `src/services/read.test.ts`, `src/services/outcome.test.ts`

**Interfaces:**
- Consumes: `resolveContext`, `loadSnapshot`, `resolveShortId`, `executeWrite` (`derive`).
- Produces:
  - `read.ts`:
    - `openSnapshot(ctx: ResolvedContext): Promise<{ root: string; snapshot: BacklogSnapshot }>` — `ctx.backlog.root` fehlt → `not_found` `Keine Arbeitskopie von »<backlog>« vorhanden`, hint `backe backlog clone <remote>` (Remote aus der User-Config) bzw. ohne Remote `backe backlog add <name> <pfad>`.
    - `resolveIssueRef(s: BacklogSnapshot, input: string): string` — Kandidaten sind die geladenen Issues **und** die Keys der Issue-Probleme; trifft die Eingabe ein kaputtes Issue → `validation` `<pfad>: <message>`.
    - `resolveHandle(ctx: ResolvedContext, input: string): string` — `me` → `ctx.user.value` (fehlt → `usage` `»me« braucht eine Identität`), sonst der Handle nach `isHandle` (sonst `validation`).
    - `normalizeStates(input: readonly string[]): State[] | 'all'` — Komma-getrennte Werte, `kebab-case` erlaubt, `all` allein.
    - `type FilterSource = 'context' | 'flag'`; `effectiveFilter(ctx, explicit: { project?: string[]; sprint?: string[]; repo?: string[] }, all: boolean): { project?: string[]; sprint?: string[]; repo?: string[]; header: Record<string, string> }` — explizit gesetzte Werte ersetzen den Kontextwert; `all` verwirft die Kontextwerte; `header` enthält `backlog` und jeden Wert aus dem Kontext, sonst ist es `{}`. `ctx.repo.value === null` ist kein Filter.
  - `outcome.ts`:
    - `type WriteOutcome = { commit: string | undefined; op: Operation; id?: string; notices: Notice[]; warnings: string[] }`.
    - `writeOp(ctx, derive: (s: BacklogSnapshot, actor: string) => Operation, deps?: WriteDeps): Promise<WriteOutcome>` — `executeWrite` mit `kind: 'derive'`; `op` = `recorded[0]`; `id` = `op.id`, wenn die Operation genau ein Issue betrifft; `warnings` = `verifyNotices`.

- [ ] **Step 1: Failing Tests**

```ts
test('openSnapshot without working copy names the clone command', …);
test('a broken issue is reported, not missing', async () => {
  // issue.md mit kaputtem YAML einschmuggeln; resolveIssueRef(s, '7f3') → validation mit Pfad
});
test('me resolves to the context user', …);
test.each([
  [['in-progress,todo'], ['in_progress', 'todo']],
  [['all'], 'all'],
])('normalizeStates(%j)', (input, out) => expect(normalizeStates(input)).toEqual(out));
test('explicit filters replace context values and leave the header', async () => {
  // ctx mit project web/auth (BACKE_PROJECT), sprint aus Flag nicht gesetzt
  expect(effectiveFilter(ctx, { project: ['api'] }, false)).toEqual({ project: ['api'], header: {} });
  expect(effectiveFilter(ctx, {}, false)).toEqual({ project: ['web/auth'], header: { backlog: 'acme', project: 'web/auth' } });
  expect(effectiveFilter(ctx, {}, true)).toEqual({ header: {} });
});
test('writeOp reports the issue id and the recorded operation', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/read.test.ts src/services/outcome.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): Snapshot öffnen, Referenzen auflösen, Kontextfilter und Write-Ergebnis`

---

### Task 6: `issue list`

**Files:**
- Create: `src/services/issue-list.ts`
- Test: `src/services/issue-list.test.ts`

**Interfaces:**
- Consumes: Task 5, `matchesContext`, `compareIssues`, `isReady`, `isUnblockable`, `parsePropFilter`, `checkPropFilter`, `propMatches`, `graphOf`.
- Produces:
  - `type IssueListQuery = { states?: string[]; projects?: string[]; exact?: boolean; sprints?: string[]; repos?: string[]; assignee?: string; creator?: string; mode?: 'blocked' | 'unblockable' | 'ready'; parent?: string; topLevel?: boolean; props?: string[]; hasProps?: string[]; text?: string; tree?: boolean; sort?: 'rank' | 'created'; all?: boolean; limit?: number }`.
  - `type IssueListItem = { issue: Issue; depth?: number; openDeps: boolean }`.
  - `listIssues(ctx, q): Promise<{ header: Record<string, string>; items: IssueListItem[]; truncated: boolean; problems: Problem[] }>`.
  - Regeln: Default-States = offen (Festlegung); `assignee`: `me`, `none` (kein Assignee) oder Handle; `parent` per `resolveIssueRef`, nur direkte Sub-Issues; `parent` und `topLevel` zusammen → `usage`; `text` sucht ohne Groß-/Kleinschreibung in Titel und Body; `sort: 'created'` sortiert nach `created`, dann ID; `tree` ordnet Wurzeln (Parent nicht in der Ergebnismenge) und darunter Kinder rekursiv, je Ebene nach Sortierung, `depth` ab 0; `limit` wirkt nach Sortierung bzw. Baum, `truncated` sagt, ob abgeschnitten wurde; `limit < 1` → `validation`. `problems` sind nur die Issue-Probleme.

- [ ] **Step 1: Failing Tests**

```ts
// Fixture: ein Backlog per Services mit 6 Issues in zwei Projekten, Sprints, Parent/Kind, depends_on
test('the default hides settled issues', …);
test('values within a flag are or, flags are and', …);
test('--project is recursive, --exact is not', …);
test('context filters apply and land in the header; -A drops them', …);
test('assignee me and none', …);
test('ready, blocked and unblockable', …);
test('--prop and --has-prop filter, an invalid range filter is a validation error', …);
test('text search covers title and body, case-insensitive', …);
test('tree orders children under parents with depth', () => {
  expect(r.items.map((i) => [i.issue.id, i.depth])).toEqual([[P, 0], [C1, 1], [C2, 1], [X, 0]]);
});
test('limit truncates after sorting', …);
test('openDeps marks unsettled dependencies', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/issue-list.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): issue list mit Kontextfiltern, Properties, Baum und Limit`

---

### Task 7: `issue show`, `next`, `context`

**Files:**
- Create: `src/services/issue-show.ts`, `src/services/next.ts`, `src/services/context-info.ts`
- Test: `src/services/issue-show.test.ts`, `src/services/next.test.ts`, `src/services/context-info.test.ts`

**Interfaces:**
- Consumes: Task 5, `listComments`, `graphOf`, `ancestors`, `isUnblockable`, `selectNext`, `serializeEntityFile`.
- Produces:
  - `type IssueRefView = { id: string; state: State; title: string }`.
  - `type CommentView = { file: string; author: string; created: string; kind?: 'transition'; from?: State; to?: State; body: string }`.
  - `type IssueDetail = { issue: Issue; body: string; raw: string; parents: IssueRefView[]; dependsOn: IssueRefView[]; dependents: IssueRefView[]; children: IssueRefView[]; progress?: { settled: number; total: number }; commentsCount: number; lastReason?: CommentView; comments: CommentView[]; rawComments: string[]; notices: Notice[] }` — `parents` vom direkten Parent bis zur Wurzel; `dependents`/`children` nach `compareIssues`; `lastReason` = jüngster Kommentar mit `kind: transition`, dessen `to` der aktuelle State ist; `raw` = Dateiinhalt wie auf der Platte; Hinweise `settled_dependency` für `cancelled`/`rejected`-Abhängigkeiten und `unblockable`.
  - `showIssue(ctx, ref: string, opts?: { comments?: number | 'all' }): Promise<IssueDetail>` — `comments` Default `0`, `n` = die jüngsten `n` chronologisch; negative Zahl → `validation`.
  - `type NextOutcome = { header: Record<string, string>; issue: Issue; resumed: boolean; notices: Notice[] }`.
  - `nextIssue(ctx, q: { level?: 'leaf' | 'top'; project?: string; sprint?: string; repo?: string; all?: boolean }): Promise<NextOutcome>` — ohne Akteur → `usage`. Kein Kandidat → `not_found` mit `details: { reason, waiting? }` und Meldung je Grund:
    - `waiting`: `Nichts bereit: alles wartet auf Abhängigkeiten (<ids>)`
    - `all_assigned`: `Nichts frei: alle bereiten Issues sind vergeben`
    - `all_blocked`: `Nichts bereit: alles ist blockiert`
    - `nothing_open`: `Nichts offen`
  - `type ContextInfo = { backlog: Resolved<string> & { root?: string }; user: Resolved<string | undefined> & { key?: string; canWrite: boolean }; project: Resolved<string | undefined>; sprint: Resolved<string | undefined>; repo: Resolved<string | null | undefined>; props?: BacklogConfig['props'] }`.
  - `contextInfo(ctx, opts?: { props?: boolean }): Promise<ContextInfo>` — `props` liest die Deklarationen aus dem Snapshot; ohne Arbeitskopie → `not_found` wie `openSnapshot`, nur wenn `props` verlangt ist.

- [ ] **Step 1: Failing Tests**

```ts
test('show lists parents to the root, dependencies with state, dependents and children', …);
test('show reports progress of sub-issues', () => expect(d.progress).toEqual({ settled: 3, total: 5 }));
test('show carries the latest transition reason of the current state', …);
test('comments: 0 by default, n the latest, all everything', …);
test('raw is the file as on disk', …);
test('next resumes own in_progress work first', …);
test('next without candidate names the waiting ids and exits not_found', async () => {
  const err = await catchErrAsync(() => nextIssue(ctx, {}));
  expect(err.code).toBe('not_found');
  expect(err.details).toEqual({ reason: 'waiting', waiting: [A] });
});
test('next --level top picks a parent with open sub-issues', …);
test('context shows every value with its source and props on demand', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/issue-show.test.ts src/services/next.test.ts src/services/context-info.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): issue show, next ohne Claim und context`

---

### Task 8: Issues anlegen und bearbeiten

**Files:**
- Create: `src/services/issues.ts`
- Test: `src/services/issues.test.ts`

**Interfaces:**
- Consumes: `writeOp`, `resolveIssueRef`, `resolveHandle`, `normalizeStateInput`, `parsePropAssignment`, `bodyHash`.
- Produces:
  - `type IssueCreateInput = { title: string; body?: string; state?: string; projects?: string[]; sprints?: string[]; repos?: string[]; assignee?: string; deps?: string[]; parent?: string; props?: string[] }`.
  - `createIssue(ctx, input, deps?: WriteDeps): Promise<WriteOutcome>` — Vorbelegung aus dem Kontext nach der Festlegung; IDs in `deps`/`parent` per `resolveIssueRef` im gesperrten Snapshot; `props`-Ausdrücke per `parsePropAssignment` (doppelter Key → `usage`).
  - `type IssueEditInput = { title?: string; addProjects?: string[]; rmProjects?: string[]; addSprints?: string[]; rmSprints?: string[]; addDeps?: string[]; rmDeps?: string[]; parent?: string | null; props?: string[]; unsetProps?: string[]; body?: string }`.
  - `editIssue(ctx, ref: string, input, deps?): Promise<WriteOutcome>` — baut ein `issue.edit` mit `from` aus dem gesperrten Snapshot (`set.title`, `set.parent`, `props.<k>`, `body.from_hash`); gleiche Werte fallen weg; bleibt nichts → `usage` `Nichts zu ändern`. Ein Key in `props` und `unsetProps` zugleich → `usage`.

- [ ] **Step 1: Failing Tests**

```ts
test('create takes project, sprint and repo from the context', …);
test('create with parent inherits from the parent, not from the context', …);
test('create resolves short ids for parent and deps', …);
test('create parses --prop and --prop :=', () => expect(issue.props).toEqual({ estimate_h: 4, ref: 'x' }));
test('edit records from values of the locked state', …);
test('edit with nothing to change is a usage error', …);
test('edit sets the body with the hash of the old body', …);
test('editing a broken issue is a validation error naming the file', …);
test('the same key in props and unsetProps is a usage error', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/issues.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): Issues anlegen und bearbeiten`

---

### Task 9: Issue-Zustand, Zuweisung, Rang, Repos, Löschen

**Files:**
- Modify: `src/services/issues.ts`
- Test: `src/services/issues.test.ts`

**Interfaces:**
- Produces (alle `(ctx, ref: string, …, deps?: WriteDeps) => Promise<WriteOutcome>`):
  - `moveIssue(ctx, ref, input: { to: string; reason?: string; blockedBy?: string[]; force?: boolean })` — `from` = aktueller State; `to` gleich → No-op, `commit: undefined`. `reason` leer oder nur Whitespace → `validation` `Begründung ist leer`.
  - `resumeIssue(ctx, ref, input: { reason?: string })`, `reopenIssue(ctx, ref, input: { to?: string; reason?: string })`.
  - `assignIssue(ctx, ref, who: string)` — `me`, `none` (entfernt) oder Handle; `issue.edit` mit `set.assignee`.
  - `rankIssue(ctx, ref, pos: { top: true } | { bottom: true } | { before: string } | { after: string } | { value: number })` — `from` = aktueller Rank oder `null`; Anker per `resolveIssueRef`.
  - `linkIssue(ctx, ref, target: string)` — Zerlegung nach der Festlegung; `unlinkIssue(ctx, ref, repo: string)`.
  - `deleteIssue(ctx, ref, input: { force?: boolean; children?: 'orphan' | 'recursive' })`.

- [ ] **Step 1: Failing Tests**

```ts
test('move records from and writes the reason as transition comment', …);
test('move to the current state is a no-op without commit', …);
test('an empty reason is a validation error', …);
test('move to blocked needs blockers', …);
test('resume and reopen', …);
test('assign me, a handle and none', …);
test('rank before an anchor given as short id', …);
test.each([
  ['webapp', { repo: 'webapp' }],
  ['webapp@feat/sso', { repo: 'webapp', ref: 'feat/sso' }],
  ['git@github.com:acme/api.git', { url: 'git@github.com:acme/api.git' }],
  ['git@github.com:acme/api.git@v1.2', { url: 'git@github.com:acme/api.git', ref: 'v1.2' }],
  ['https://github.com/acme/api@feat/x', { url: 'https://github.com/acme/api', ref: 'feat/x' }],
])('link %s', async (target, expected) => expect(outcome.op).toMatchObject(expected));
test('delete with children needs orphan or recursive', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/issues.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): Issue-Zustand, Zuweisung, Rang, Repo-Verknüpfung und Löschen`

---

### Task 10: Kommentare, Projekte, Sprints

**Files:**
- Create: `src/services/comments.ts`, `src/services/projects.ts`, `src/services/sprints.ts`
- Test: `src/services/comments.test.ts`, `src/services/projects.test.ts`, `src/services/sprints.test.ts`

**Interfaces:**
- Produces:
  - `comments.ts`:
    - `addComment(ctx, ref, body: string, deps?)` — leerer Body → `validation` `Kommentar ist leer`.
    - `listIssueComments(ctx, ref, opts?: { limit?: number }): Promise<CommentView[]>` — chronologisch; `limit` = die jüngsten.
    - `resolveCommentRef(comments: readonly CommentView[], ref: string): string` — Dateiname oder 1-basierter Index; sonst `not_found`.
    - `editComment(ctx, ref, comment: string, body: string, deps?)` (`from_hash` aus dem gesperrten Stand), `deleteComment(ctx, ref, comment: string, deps?)`.
  - `projects.ts`:
    - `createProject(ctx, input: { path: string; title: string; lead?: string; body?: string }, deps?)` — `lead` darf `me` sein.
    - `listProjects(ctx): Promise<{ path: string; title: string; lead?: string; open: number }[]>` — nach Pfad; `open` = offene Issues, die das Projekt direkt führen.
    - `showProject(ctx, path): Promise<{ path: string; project: Project; body: string; subprojects: string[]; counts: Partial<Record<State, number>> }>` — `counts` rekursiv über Unterprojekte.
    - `moveProject(ctx, from, to, deps?)`, `removeProject(ctx, path, input: { reassign?: string; detach?: boolean }, deps?)`.
  - `sprints.ts`:
    - `createSprint(ctx, input: { slug: string; title: string; start?: string; end?: string; body?: string }, deps?)`.
    - `listSprints(ctx): Promise<{ slug: string; title: string; start?: string; end?: string; closed: boolean; open: number }[]>` — offene Sprints vor geschlossenen, je nach `start` (ohne zuletzt), dann Slug.
    - `showSprint(ctx, slug, q?: { projects?: string[]; repos?: string[]; all?: boolean; sort?: 'rank' | 'created' }): Promise<{ header: Record<string, string>; sprint: Sprint; body: string; groups: { state: State; items: IssueListItem[] }[] }>` — Kontextfilter `project`/`repo` wie `issue list`; Gruppenfolge `backlog, todo, in_progress, review, done, blocked, on_hold, cancelled, rejected`, leere Gruppen fehlen.
    - `closeSprint(ctx, slug, input: { carryOver?: string }, deps?)`.

- [ ] **Step 1: Failing Tests**

```ts
test('comments are listed chronologically and addressed by index or file', …);
test('editing a foreign comment is refused by the operation', …);
test('project show counts issues of subprojects', …);
test('project mv rewrites issues in one commit', …);
test('sprint show groups by state in model order and filters by context project', …);
test('sprint close --carry-over adds open issues to the successor', …);
test('sprints list open ones first', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/comments.test.ts src/services/projects.test.ts src/services/sprints.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): Kommentare, Projekte und Sprints`

---

### Task 11: Repos und Users

**Files:**
- Create: `src/services/repos.ts`, `src/services/users.ts`
- Test: `src/services/repos.test.ts`, `src/services/users.test.ts`

**Interfaces:**
- Produces:
  - `repos.ts`: `addRepo(ctx, input: { url: string; name?: string; defaultRef?: string; body?: string }, deps?)`, `listRepos(ctx): Promise<{ name: string; url: string; canonical: string; defaultRef?: string; issues: number }[]>` (nach Name; `issues` = Issues, die den Repo führen), `removeRepo(ctx, name, deps?)`.
  - `users.ts`:
    - `addUser(ctx, input: { handle: string; keyFile: string; name?: string; agent?: boolean; operator?: string }, deps?)` — Key per `readPublicKey`; `name` Default = Handle; `agent` ohne `operator` → `operator` = Akteur; `operator` ohne `agent` → `usage`.
    - `listUsers(ctx): Promise<{ handle: string; name: string; kind: 'human' | 'agent'; operator?: string; admin: boolean }[]>`.
    - `showUser(ctx, who: string): Promise<{ handle: string; user: User; body: string; admin: boolean; fingerprints: string[]; revoked: { fingerprint: string; revoked?: string }[] }>` — `who` darf `me` sein.
    - `revokeKey(ctx, who: string, fingerprint: string, deps?)` — Vergleich gegen `sshFingerprint` der aktiven Keys, mit oder ohne `SHA256:`, eindeutiger Präfix ab 8 Zeichen; kein Treffer → `not_found`, mehrere → `ambiguous`.
    - `removeUser(ctx, handle, deps?)`.
    - `createAgent` bleibt in `agent.ts` (M4).

- [ ] **Step 1: Failing Tests**

```ts
test('repo add derives the name, list counts linking issues', …);
test('user add reads the key file and defaults name to the handle', …);
test('an agent without operator gets the actor as operator', …);
test('revoke-key matches a fingerprint prefix', …);
test('user show me lists fingerprints and revoked keys', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/repos.test.ts src/services/users.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm vitest run src/services` → PASS**
- [ ] **Step 5: Commit** — `feat(services): Repos und Users`

---

### Task 12: CLI-Gerüst, Ausgabe, Fehler — `context`, `init`, `backlog`, `verify`

**Files:**
- Modify: `src/cli/main.ts`, `src/services/verify.ts`
- Create: `src/cli/run.ts`, `src/cli/io.ts`, `src/cli/output.ts`, `src/cli/options.ts`, `src/cli/commands/context.ts`, `src/cli/commands/init.ts`, `src/cli/commands/backlog.ts`, `src/cli/commands/verify.ts`
- Create: `test/e2e/cli.ts`, `test/e2e/core.test.ts`, `test/e2e/golden/`
- Test: `src/services/verify.test.ts`

**Interfaces:**
- Consumes: alle Services; `resolveContext`, `resolveHomes`, `readUserConfig`, `expandPath`.
- Produces:
  - `io.ts`: `type CliIo = { argv: string[]; env: Env; cwd: string; stdout(s: string): void; stderr(s: string): void; readStdin(): Promise<string>; isTTY: boolean }`; `nodeIo(): CliIo`.
  - `run.ts`: `run(io: CliIo): Promise<number>` — baut das Programm, fängt jeden Fehler, liefert den Exit-Code. `main.ts`: `process.exitCode = await run(nodeIo())`.
  - Globale Optionen am Programm: `-B, --backlog <name|pfad>`, `--as <handle>`, `--format <text|json|md>`, `--json`, `--fields <liste>`. `program.exitOverride()` und `configureOutput`: commander-Fehler → `BackeError('usage', <commander-Meldung ohne "error: ">)`; Hilfe und Version → 0.
  - `options.ts`:
    - `type CommandEnv = { io: CliIo; format: Format; fields?: string[]; color: boolean; context(flags?: Partial<ContextFlags>): Promise<ResolvedContext> }` — `context` löst einmal je Aufruf auf (`cwd`, `env`, `-B`, `--as` plus übergebene Flags).
    - `collect(value, prev: string[] = []): string[]` für wiederholbare Optionen; `text(value: string, io, stdin: StdinGuard): Promise<string>` liest `-` von stdin (zweiter Zugriff → `usage` `stdin ist schon vergeben`), `fileText(path)` liest `-F`.
    - `absPath(p, io)` = `expandPath(p, { home: HOME, base: cwd })`.
  - `output.ts`:
    - `type Format = 'text' | 'json' | 'md'`; `resolveFormat(opts, env, cfg)`: `--json` > `--format` > `BACKE_FORMAT` > `output.format` > `text`; ungültig → `usage`.
    - `useColor(io, cfg): boolean` nach den Global Constraints.
    - `json(value): string` — `JSON.stringify` ohne `undefined`-Felder plus `\n`.
    - `pickFields(obj, fields, allowed: readonly string[])`.
    - `headerLine(header): string | undefined` — `key=value` durch Leerzeichen, Reihenfolge `backlog, project, sprint, repo`.
    - `renderError(err: unknown, format): string` — Festlegung »Fehler-Ausgabe«; Nicht-`BackeError` → Code `unexpected`, Meldung `Unerwarteter Fehler: <message>`, kein Stack.
    - `renderOutcome(o: WriteOutcome, format, kind: 'create' | 'other')` und `renderNotices(notices, warnings): string` nach der Festlegung »Write-Ausgabe«.
  - Befehle:
    - `context [--project p] [--sprint s] [--props]` — Text: je Zeile `<name>  <wert oder ->  (<quelle>[: detail])`, dazu `key` und `schreiben: ja|nein`; `--props` hängt die Deklarationen an (`<key>  <type>[ (values)]  <description>`). JSON: `ContextInfo`.
    - `init [pfad] --name <n> --prefix <p> [--remote <url>] [--key <pfad>] [--user-name <name>]` — Identität nach der Festlegung; Pfad über `absPath`. Ausgabe: Pfad der Arbeitskopie.
    - `backlog list` (`* ` vor `current`, dann Name und Remote), `backlog use <name>`, `backlog clone <url> [--name n]`, `backlog add <name> <pfad>`, `backlog remove <name> [--purge]`, `backlog show [name]` — Handle für `clone`/`add` aus `--as` → `BACKE_USER` → `user` der User-Config.
    - Service `verifyBacklog(ctx, opts: VerifyOptions): Promise<VerifyReport & { propNotices: string[] }>` in `src/services/verify.ts` — `verifyRange` auf `ctx.backlog.root`, danach `propViolations(loadSnapshot(root))` als `<id> <key>: <message>` (backe.md §2.24: verschärfte Deklaration ist Hinweis, kein Fehler). Test `verifyBacklog reports values that no longer fit a tightened declaration` in `src/services/verify.test.ts`.
    - `verify [--since <rev>] [--accept <sha> | --revert <sha>] [--reason <text>]` — `--accept`/`--revert` ohne nicht-leeres `--reason` → `usage` vor dem Service; Bericht über `verifyBacklog`, `propNotices` als `Hinweis:` auf stderr; `geprüft: <n> Commits seit <anker kurz>`, je ungültigem Commit `<kurz> <subject>: <gründe; …>`, je Quarantäne `<kurz> <decision>: <note>`, Hinweise; ungültige Commits → Exit 5 über `assertVerified`.
  - `test/e2e/cli.ts`:
    - `cli(args: string[], opts: { env: Env; cwd: string; input?: string }): Promise<{ stdout: string; stderr: string; code: number }>` — `node dist/cli.js` per `execFile`, Env aus `opts.env` plus `PATH`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_NOSYSTEM`, `XDG_CONFIG_HOME` aus `process.env`, ohne `NO_COLOR`-Zwang (Tests setzen es selbst).
    - `normalize(text: string, names: Record<string, string>): string` — ersetzt jede Zeichenkette aus `names` (IDs, Shas, Pfade) durch ihren Platzhalter (`<A>`, `<sha1>`, `<root>`), dazu Zeitstempel `\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ` → `<ts>` und 40-Hex → `<sha>`.
    - Golden-Files über `expect(normalize(…)).toMatchFileSnapshot('golden/<name>.txt')` bzw. `.json`.

- [ ] **Step 1: Failing E2E-Tests (`test/e2e/core.test.ts`)**

```ts
test('usage errors exit with 2', async () => {
  const r = await cli(['--frobnicate'], env);
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/^Fehler: unknown option '--frobnicate'/);
});
test('errors in json mode', async () => {
  const r = await cli(['--json', 'context', '--props'], noBacklog);
  expect(r.stdout).toBe('');
  expect(JSON.parse(r.stderr)).toEqual({ error: { code: 'usage', message: expect.any(String), hint: expect.stringContaining('backe backlog use') } });
});
test('no backlog resolves to a usage error with hint', …); // Text, Exit 2, kein "at " im stderr
test('no color in pipes', async () => { /* output.color auto, kein TTY → kein \x1b */ });
test('init and backlog add expand relative and ~ paths', …);
test('context text and json', …);           // Golden context.txt, context.json
test('backlog list, use, show', …);         // Golden backlog-list.txt
test('verify reports a clean history', …);  // Golden verify.txt
test('verify --accept without reason is a usage error', …);
test('--help and --version exit 0', …);
```

- [ ] **Step 2: `pnpm build && pnpm vitest run test/e2e` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm build && pnpm vitest run test/e2e -u`, Golden-Files lesen und prüfen, ob sie den Festlegungen entsprechen; danach `mise run check` → PASS**
- [ ] **Step 5: Commit** — `feat(cli): Gerüst mit Ausgabeformaten, Fehler-JSON und Exit-Codes; context, init, backlog, verify`

---

### Task 13: CLI — Issues, `next`, Kommentare

**Files:**
- Create: `src/cli/commands/issue.ts`, `src/cli/commands/next.ts`, `src/cli/commands/comment.ts`, `src/cli/render-issue.ts`
- Modify: `src/cli/run.ts`
- Test: `test/e2e/issue.test.ts`, `test/e2e/golden/`

**Interfaces:**
- Consumes: Tasks 6–10, `output.ts`, `options.ts`.
- Produces:
  - `render-issue.ts`:
    - `issueLines(items: IssueListItem[], color: boolean): string[]` — Festlegung »Text-Liste«; State-Farben: `done` grün, `in_progress`/`review` cyan, `blocked` rot, `on_hold` gelb, `cancelled`/`rejected` gedimmt.
    - `issueDetailText(d: IssueDetail, color): string` — Kopf `<id>  <titel>`, dann Labels auf 12 Zeichen gepolstert, nur gesetzte: `state` (mit `(aus <paused_from>)` und `blockiert von <id> [<state>], …`), `reason` (erste Zeile, `— <author>, <created>`), `assignee`, `creator`, `created`, `parent` (`<id> › <id> › …`), `depends_on` und `dependents` (`<id> [<state>]`), `children` (`<settled>/<total> erledigt`, darunter je Kind eine Listenzeile, eingerückt auf Spalte 13), `rank`, `projects`, `sprints`, `repos`, `attachments` (`<name> (<file|url>)`), `props` (`<key>: <json>` je Zeile), `comments` (Anzahl); Leerzeile, Body; je angefordertem Kommentar Leerzeile, `--- <file> (<author>, <created>[, <from> → <to>])`, Body.
    - `issueDetailJson(d): object` — Issue-Felder, `body`, `parents`, `depends_on` als `IssueRefView[]`, `dependents`, `children`, `progress`, `comments_count`, `last_reason`, `comments`, `notices`; leere Listen fehlen.
    - `issueDetailMd(d): string` — `raw`, je Kommentar `\n<!-- comments/<file> -->\n` und dessen Dateitext.
  - Befehle und Aliase (Signaturen nach backe.md §2.17; `-A, --all` an `list`/`next`):
    - `issue create` (`new`): `-t, --title`, `-d, --description <md|->`, `-F, --file <pfad>`, `-p, --project` (wdh.), `-s, --sprint` (wdh.), `-a, --assignee`, `--repo` (wdh.), `--dep` (wdh.), `--parent`, `--prop` (wdh.), `--state`. `-d` und `-F` zusammen → `usage`.
    - `issue list` (`ls`): Flags aus §2.17; `--state` nimmt Komma-Listen und `all`; `-a none`.
    - `issue show <id>` (`show`): `--comments <n|all>`.
    - `issue edit <id>`: Flags aus §2.17 plus `--body-file <pfad|->`; ohne Flags → `usage` `Nichts zu ändern` (M5b öffnet hier `$EDITOR`).
    - `issue move <id> <state>` (`mv`): `--reason <md|->`, `--reason-file <pfad>`, `--blocked-by` (wdh.), `--force`; höchstens eines der drei Reason-Flags.
    - `issue resume <id>`, `issue reopen <id> [--to <state>]` mit den Reason-Flags; `issue assign <id> <user|me|none>`; `issue rank <id> (--top | --bottom | --before <id> | --after <id> | <zahl>)` — genau eine Position, sonst `usage`; `issue link <id> <ziel>`, `issue unlink <id> <repo>`; `issue delete <id> [--force] [--orphan | --recursive]`.
    - `next [-p <projekt>] [-s <sprint>] [--repo <name>] [--level leaf|top]` — Text: Kopfzeile, Listenzeile, bei `resumed` angehängt `  (läuft schon)`; JSON: `{"context"?, "issue", "resumed", "notices"?}`, `--fields` wirkt auf `issue`.
    - `comment add <id> (-m <md|-> | -F <pfad>)`, `comment list <id> [--limit n]` (Text: `<n>  <file>  <author>  <erste Zeile>`), `comment edit <id> <kommentar> (-m | -F)`, `comment delete <id> <kommentar>`.
  - `issue claim` und `next --claim` sind nicht registriert (M6).

- [ ] **Step 1: Failing E2E-Tests (`test/e2e/issue.test.ts`)**

```ts
// Setup je Datei: testBacklog() plus per Services Projekte web, web/auth, Sprint 2026-w47, Repo webapp
test('create, list, show in text and json', …);   // Golden issue-list.txt, issue-list.json, issue-show.txt, issue-show.json
test('show --format md is the file plus comments', …);  // Golden issue-show.md
test('list header shows context filters, -A drops them', …);
test('--fields reduces json and is refused with text', …);
test('titles that look like options or YAML survive', async () => {
  for (const title of ['-x', 'key: value', '# kein Heading', '[a, b]']) {
    const r = await cli(['new', `--title=${title}`], e);
    expect((await cli(['show', r.stdout.trim(), '--json', '--fields', 'title'], e)).stdout).toBe(`${JSON.stringify({ title })}\n`);
  }
});
test('stdin is read once', async () => {
  const r = await cli(['new', '-t', 'x', '-d', '-', '--prop', 'a=b'], { ...e, input: 'Zeile 1\nZeile 2\n' });
  expect(r.code).toBe(0);
  // move mit --reason - und leerem stdin → Exit 2, "Begründung ist leer"
});
test('move, resume, reopen with reasons; no-op prints unverändert', …);
test('rank, link, unlink, assign, delete', …);
test('ambiguous short id lists candidates with exit 2', …);
test('next picks, resumes and explains an empty result with exit 3', …);
test('comment add, list, edit, delete', …);       // Golden comment-list.txt
test('a handle without key reads but cannot write', async () => {
  // --as bob (User ohne identities-Eintrag): ls → 0, new → 2 mit "kein Signing-Key"
});
test('exit codes: not found 3, precondition 4', …);
```

- [ ] **Step 2: `pnpm build && pnpm vitest run test/e2e/issue.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: `pnpm build && pnpm vitest run test/e2e -u`, Golden-Files gegen `render-issue.ts` prüfen; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `feat(cli): Issue-Befehle, next und Kommentare mit Aliasen`

---

### Task 14: CLI — Projekte, Sprints, Repos, Users; Abnahme

**Files:**
- Create: `src/cli/commands/project.ts`, `src/cli/commands/sprint.ts`, `src/cli/commands/repo.ts`, `src/cli/commands/user.ts`
- Modify: `src/cli/run.ts`, `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`
- Test: `test/e2e/entities.test.ts`, `test/e2e/golden/`

**Interfaces:**
- Consumes: Tasks 10, 11, `createAgent`.
- Produces:
  - `project create <pfad> -t <titel> [--lead <user|me>] [-d <md|-> | -F <pfad>]`, `project list` (`<pfad>  <offen>  <titel>`), `project show <pfad>`, `project mv <alt> <neu>`, `project rm <pfad> [--reassign <pfad> | --detach]`.
  - `sprint create <slug> -t <titel> [--start <datum>] [--end <datum>] [-d | -F]`, `sprint list` (`<slug>  <start>–<end>  <offen>  <titel>`, geschlossene mit `(geschlossen)`), `sprint show <slug> [-p …] [--repo …] [-A] [--sort rank|created]` (Kopfzeile, je Gruppe `<state> (<n>)` und Listenzeilen, Gruppen durch Leerzeile getrennt), `sprint close <slug> [--carry-over <slug>]`.
  - `repo add <url> [--name n] [--ref <default_ref>] [-d]`, `repo list` (`<name>  <url>  <default_ref oder ->  <issues>`), `repo rm <name>`. `check|where|scan` kommen mit M5b.
  - `user add <handle> --key <pubfile> [--name n] [--agent [--operator <handle>]]`, `user create-agent <handle> [--name n]` (Ausgabe: Key-Pfad), `user list` (`<handle>  <kind>  <name>[  (admin)][  operator=<h>]`), `user show <handle|me>`, `user revoke-key <handle|me> <fingerprint>`, `user rm <handle>`.
  - Gesamtplan: Meilenstein-Tabelle M5 → zwei Zeilen M5a (dieser Plan) und M5b (»entsteht nach M5a«) mit dem Umfang aus der Festlegung »Schnitt M5«; in »Übernommen aus M1–M4« die M5a zugeordneten Punkte abhaken (`✓ … → M5a, Task n`), die M5b zugeordneten mit `M5b:` markieren; die Festlegungen dieses Plans als Zeilen der Planentscheidungen mit Meilenstein `M5a`.

- [ ] **Step 1: Failing E2E-Tests (`test/e2e/entities.test.ts`)**

```ts
test('project create, list, show, mv, rm', …);        // Golden project-list.txt, project-show.txt
test('sprint create, list, show grouped, close --carry-over', …);  // Golden sprint-show.txt, sprint-show.json
test('repo add, list, rm', …);                          // Golden repo-list.txt
test('user add, list, show, revoke-key, rm', …);       // Golden user-list.txt, user-show.txt
test('user create-agent prints the key path and the agent can write', …);
test('aliases new, ls, show, mv match their long forms', …);
```

- [ ] **Step 2: `pnpm build && pnpm vitest run test/e2e/entities.test.ts` → FAIL**
- [ ] **Step 3: Implementieren und Gesamtplan aktualisieren**
- [ ] **Step 4: `mise run check` → PASS; Coverage-Gate `src/services/**` ≥ 90 % Lines und Branches im Report**
- [ ] **Step 5: Commit** — `feat(cli): Projekte, Sprints, Repos und Users; Gesamtplan auf M5a/M5b umgestellt`

---

## Abnahme M5a

- `mise run check` grün, CI grün auf `ubuntu-latest` und `macos-latest`.
- E2E gegen `dist/cli.js` mit Golden-Files für Text und JSON jeder Befehlsgruppe (Tasks 12–14); Exit-Codes `0`, `2`, `3`, `4`, `5` je mindestens einmal geprüft.
- Coverage-Gate `src/services/**` eingehalten.
- Gesamtplan zeigt M5a als abgenommen und M5b als nächsten Meilenstein.

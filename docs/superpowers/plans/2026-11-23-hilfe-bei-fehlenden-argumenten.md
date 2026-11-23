# Hilfe bei fehlenden Argumenten — Umsetzungsplan

**Spec:** `docs/proposals/backe.md` (Status: gebaut; verbindlich). Betroffen: §2.18 Ausgabe und Agent-Ergonomie (Fehler, Exit-Codes).

**Ticket:** `bck-ejn2j` — »`backe` (ohne Args) oder `backe <cmd>` (ohne Args) soll automatisch die Hilfe ausgeben, wenn der Befehl Argumente braucht.«

**Branch:** `feat/help-bei-fehlenden-argumenten`, Basis `99ea565`.

**User-Entscheidung:** Hilfe auf **stderr**, Exit-Code bleibt **2** (`usage`, Vertrag aus §2.18 unverändert).

## Global Constraints

- Alle nutzersichtbaren Texte deutsch, wie im restlichen CLI.
- Prüfen vor dem Commit: `pnpm lint` (Biome + `tsc --noEmit`) und `pnpm test`. Die e2e-Tests unter `test/e2e/` laufen gegen `dist/cli.js` — vorher `pnpm build`.
- Commit-Messages: Conventional Commits mit deutschem Text; jede endet mit genau diesen zwei Zeilen:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01AJSmGhS6YdAguXYjbB4CCX
  ```
- Keine Ticket-IDs (`bck-…`) und keine Audit-Kürzel in Code, Kommentaren, Tests oder Commit-Messages.
- Code verweist auf Spec-Stellen als `backe.md §N.M`.
- Proposal-Änderungen als Gegenwart, nie als Historie.
- Exit-Codes sind stabiler Vertrag (§2.18): alle hier betroffenen Fälle bleiben `usage`, Exit-Code 2.

## Task 1: Hilfe nach dem Fehler, wenn Befehl, Unterbefehl, Pflichtargument oder Pflichtoption fehlt

**Ist (geprüft mit `node dist/cli.js`):**
- `backe` → stderr `Fehler: Befehl fehlt` / `Hinweis: backe --help`, Exit 2.
- `backe issue` → `Fehler: Unterbefehl fehlt` / `Hinweis: backe issue --help`, Exit 2.
- `backe issue show` → `Fehler: missing required argument 'id'` (englisch, ohne Hinweis), Exit 2.
- Entsprechend vermutlich `backe issue create` ohne `-t` → englische commander-Meldung zur fehlenden Pflichtoption.
- Behandelt in `fromCommander` in `src/cli/run.ts` (~Zeile 105–117); Gruppe ohne Unterbefehl wird über `commander.help` + `lastDispatched`/`trackDispatch` (`src/cli/options.ts`) erkannt.

**Soll:**
1. **Auslöser** (genau diese vier, sonst nichts): fehlender Befehl (`backe`), fehlender Unterbefehl einer Gruppe (`backe issue`), fehlendes Pflichtargument (commander `commander.missingArgument`), fehlende Pflichtoption (commander `commander.missingMandatoryOptionValue`). Andere `usage`-Fehler (unbekannte Option, überzählige Argumente, sich ausschließende Flags …) bleiben, wie sie sind.
2. **Text-Modus:** stderr enthält zuerst `Fehler: <meldung>`, dann eine Leerzeile, dann die vollständige Hilfe des **betroffenen** Befehls — bei `backe` die Root-Hilfe (inkl. Schnellstart), bei `backe issue` die Hilfe von `issue`, bei `backe issue show` die Hilfe von `issue show`. Die Zeile `Hinweis: … --help` entfällt in diesen Fällen, weil die Hilfe selbst folgt. stdout bleibt leer. Exit-Code 2.
3. **Deutsche Meldungen** statt der englischen commander-Texte: fehlendes Argument → `Argument »<name>« fehlt` (z. B. `Argument »id« fehlt`); fehlende Pflichtoption → `Option »<flags>« fehlt` (z. B. `Option »-t, --title <titel>« fehlt`). `Befehl fehlt` und `Unterbefehl fehlt` bleiben wörtlich.
4. **JSON-Modus** (`--json`, `--format json`, `BACKE_FORMAT=json`, Config): keine Hilfe; nur das Fehlerobjekt wie heute (`code: "usage"`), mit der deutschen Meldung aus Punkt 3 und `hint: "<befehlspfad> --help"` (bei fehlendem Argument/Option ebenfalls, z. B. `backe issue show --help`). Exit-Code 2.
5. **Steuerzeichen-Entschärfung** (§2.18) gilt für den Text-Modus wie für jede stderr-Ausgabe; die Hilfe enthält ohnehin nur eigene Texte.
6. MCP ist nicht betroffen (keine commander-Pfade).

**Umsetzungshinweise:** Die Hilfe des betroffenen Befehls liefert commander per `cmd.helpInformation()`; den Befehl liefert bei fehlendem Unterbefehl `lastDispatched(program)`. Für fehlende Argumente/Optionen ermitteln, an welchem `Command` commander gescheitert ist (etwa über dieselbe Dispatch-Verfolgung oder einen `preAction`/`exitOverride`-Hook am Unterbefehl) — die bestehenden Mechanismen in `src/cli/options.ts` und `src/cli/run.ts` zuerst lesen und wiederverwenden. Wie die Hilfe an `renderError` bzw. die Fehlerausgabe gelangt (z. B. als Feld am `BackeError` oder als eigener Ausgabeschritt in `run`), entscheidet der Implementer nach dem bestehenden Muster; nicht in `details` des JSON-Fehlers schreiben.

**Dateien (erwartet):**
- `src/cli/run.ts` — `fromCommander` und die Fehlerausgabe.
- ggf. `src/cli/options.ts` (Dispatch-Verfolgung), `src/cli/output.ts` (Fehler-Rendering).
- `test/e2e/core.test.ts` — bestehende Erwartung `Fehler: Unterbefehl fehlt\nHinweis: backe backlog --help\n` (Zeile ~79) anpassen; neue Tests:
  - `backe` (Text): stderr beginnt mit `Fehler: Befehl fehlt\n\n`, enthält `Usage: backe` und `Schnellstart:`, stdout leer, Exit 2.
  - `backe issue` (Text): Hilfe von `issue`, Exit 2.
  - `backe issue show` (Text): `Fehler: Argument »id« fehlt`, gefolgt von `Usage: backe issue show`, Exit 2.
  - `backe issue create` ohne `-t` (Text): `Fehler: Option »-t, --title <titel>« fehlt` + Hilfe von `issue create`, Exit 2.
  - `backe issue show --json`: genau ein JSON-Fehlerobjekt mit `code: "usage"`, deutscher Meldung, `hint: "backe issue show --help"`, keine Hilfe, Exit 2.
  - Ein anderer `usage`-Fehler (z. B. unbekannte Option) bekommt **keine** Hilfe.
- `docs/proposals/backe.md` §2.18, im Bullet **Fehler** ergänzen: »Fehlt ein Befehl, ein Unterbefehl, ein Pflichtargument oder eine Pflichtoption, folgt im Text-Modus der Fehlermeldung nach einer Leerzeile die Hilfe des betroffenen Befehls (statt `Hinweis: … --help`); im JSON-Modus trägt das Fehlerobjekt stattdessen `hint: "<befehl> --help"`. Der Exit-Code bleibt 2.«

**Akzeptanz:**
- Die sechs Testfälle oben sind grün; alle bisherigen Tests (2734) bleiben grün, nur die eine Erwartung in `core.test.ts` ändert sich.
- `pnpm lint` grün.

**Commit:** `feat(cli): Hilfe bei fehlendem Befehl, Argument oder Pflichtoption`

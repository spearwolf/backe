# backe M8 — Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `backe` veröffentlichungsreif nach backe.md §2.21: Pack-Smoke-Test samt Skript-E2E in `ci.yml`, `release.yml` mit release-please und npm Trusted Publishing, Renovate, ein README für Nutzer — und vorher die mit `M8` markierten offenen Punkte aus M1–M7 abgearbeitet oder begründet auf die Roadmap (§4.2) gesetzt.

**Architecture:** Kein neuer Code-Pfad im Produkt außer der Node-Versionsprüfung beim Start. Der Release-Teil besteht aus einem Shell-Skript (`scripts/pack-smoke.sh`), das einen fertigen Tarball wie ein Nutzer installiert und den Kernablauf gegen ein Bare-Remote fährt, und zwei Workflows, die dasselbe Skript aufrufen — CI auf jedem Push, Release nur beim von release-please erzeugten Tag. Der Aufräum-Teil folgt den Schichten: Git-Schicht, Sync/Verify, Services und Adapter, reines Aufräumen, Tests, Doku.

**Tech Stack:** wie M7; dazu GitHub Actions `googleapis/release-please-action`, Renovate (GitHub-App), npm-CLI ≥ 11.5.1 für Trusted Publishing (lokal geprüft: Node 26.13.1 bringt npm 11.20.0 mit).

**Spec:** `docs/proposals/backe.md` (§2.20, §2.21, §4.2, §5), Gesamtplan `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md` — dessen Global Constraints, alle Zeilen `M8` in »Übernommen aus M1« bis »Übernommen aus M7« und die Abschnitte »Doku nach Abnahme« unter M2 und M4.

## Global Constraints

Alle Global Constraints des Gesamtplans und von M5a–M7. Dazu für M8:

- **Nach außen gerichtete Schritte nur mit Freigabe des Users:** Merge des Release-PRs, `npm publish`, Einrichten des Trusted Publishers auf npmjs.com, Installation der Renovate-App, Anlegen von Repo-Secrets. Der Plan bereitet sie vor; ausgeführt werden sie in Task 11 erst nach ausdrücklichem »ja«.
- **Kein Verhaltenswechsel ohne Test.** Jeder Punkt aus den Übernommen-Listen, der Verhalten ändert, bekommt einen Test, der vorher scheitert. Reines Aufräumen (Task 8) ändert keine Golden-Files.
- **Bestand vor Änderung prüfen.** Die Übernommen-Listen stammen aus Reviews von M1–M7; manches ist inzwischen erledigt (Beispiel: `isMissing` liegt nur noch in `src/context/paths.ts`, `byCodeUnit` und `STATE_ORDER` gibt es nicht mehr). Jeder Punkt wird erst per `grep`/Lesen geprüft; ist er schon erledigt, steht das als Zeile im Commit-Body (`erledigt vorab: …`), sonst nirgends.
- **Verschieben statt liegen lassen.** Punkte, die dieser Plan nicht baut, stehen in der Tabelle »Auf die Roadmap« und landen in Task 10 in backe.md §4.2 — keiner verschwindet still.
- Workflows: Actions mit Major-Tag gepinnt wie im Bestand (`actions/checkout@v7`, `jdx/mise-action@v5`); für neue Actions den aktuellen Major per `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name` nachschlagen, nicht raten. Jeder Workflow und jeder Job hat ein explizites `permissions:`.

## Review Focus

1. **Installation mit zu altem Node** — `npm i -g backe` unter Node 22 warnt nur (`engines` ist nicht bindend), danach scheitert `backe` mit einem kryptischen Fehler. Erwartet: `Fehler: backe braucht Node.js ≥ 26 (gefunden 22.x)`, Exit 1. → Task 1 `checkNodeVersion rejects older majors`.
2. **Veralteter oder unvollständiger Tarball** — `dist/` stammt von einem älteren Build, ein Import zeigt auf eine Dev-Abhängigkeit, eine Datei fehlt im Paket. Erwartet: CI scheitert vor jedem Publish. → Task 2: `prepack` baut, das Skript installiert nur Prod-Abhängigkeiten aus dem Tarball und prüft die Dateiliste exakt.
3. **Wiederholter Release-Lauf** — der Publish gelang, der Upload ans GitHub-Release scheiterte; jemand startet den Job neu. Erwartet: der Neustart überspringt den Publish (Version liegt schon auf npm) und lädt den Tarball hoch, grün. → Task 3, Schritt »Publish idempotent«, lokal geprüft per `npm view backe@0.0.0-nie version` (Exit ≠ 0) gegen `npm view yaml@2.9.1 version` (Exit 0).
4. **Publish ohne grüne Prüfung** — ein Tag entsteht auf einem Stand, dessen Tests rot sind. Erwartet: `release.yml` führt `mise run check` und den Pack-Smoke-Test selbst aus und publisht nur danach. → Task 3.
5. **Quickstart des README funktioniert nicht wörtlich** — ein Nutzer kopiert die Befehle und bleibt am Handle, am Key oder am Remote hängen. Erwartet: die Befehle laufen in einer frischen Umgebung durch. → Task 4, Schritt »Quickstart wörtlich ausführen«; die Befehle sind dieselben wie im Smoke-Skript.

---

## Festlegungen

| Stelle | Festlegung |
| --- | --- |
| §2.21 Pack-Smoke-Test | `scripts/pack-smoke.sh <tarball>` (bash, `set -euo pipefail`): installiert den Tarball per `npm install --prefix <tmp>/inst --no-audit --no-fund <tarball>` (zieht nur Prod-Abhängigkeiten), prüft `backe --version` gegen `version` aus `package.json` und fährt `init → new → issue claim → mv review → sync → verify` gegen ein Bare-Remote in `mktemp -d`. Isolation wie in den Tests: eigenes `HOME`/`BACKE_HOME`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `XDG_CONFIG_HOME=/dev/null/xdg`, `BACKE_USER=smoke`, `NO_COLOR=1`; Key per `ssh-keygen -t ed25519 -N ''`. Nach `init` `config set backlogs.smoke.sync.mode manual`, damit kein Hintergrund-Prozess das Temp-Verzeichnis überlebt (der Claim synchronisiert trotzdem selbst). Lokal geprüft am 2026-11-20 gegen den M7-Build. |
| `prepack` | `"prepack": "pnpm run build"` — kein Tarball ohne frischen Build. `prepare` bleibt (Hooks im Entwicklungs-Checkout; npm führt es bei Installation aus der Registry nicht aus). |
| Paketinhalt | Genau `LICENSE`, `README.md`, `dist/cli.js`, `package.json` (heute schon so, `pnpm pack --dry-run`). `schemas/` bleibt draußen: kein Code verweist auf eine ausgelieferte Schema-Datei. |
| `package.json` | Neu: `"packageManager": "pnpm@12.21.0"` (gleich `mise.toml`), `repository` (`git+https://github.com/spearwolf/backe.git`), `homepage`, `bugs`, `author`, `keywords` (`backlog`, `issues`, `git`, `cli`, `mcp`, `agents`), `"publishConfig": { "access": "public", "provenance": true }`. |
| Node-Version beim Start | `checkNodeVersion(version: string): string \| undefined` in `src/cli/node-version.ts` (rein; Meldung bei Major < 26), erster Aufruf in `src/cli/main.ts`; Meldung auf stderr, Exit 1. Grenze: ein Node, das schon beim Laden des Bundles scheitert, sieht die Meldung nicht — das deckt `engines` plus README ab. |
| `ci.yml` | Top-Level `permissions: contents: read`. Nach `mise run check`: `pnpm pack --pack-destination "$RUNNER_TEMP/pack"` und `bash scripts/pack-smoke.sh "$RUNNER_TEMP"/pack/backe-*.tgz` — in beiden Matrix-Zeilen. |
| §2.21 Versionierung | release-please im Manifest-Modus: `release-please-config.json` mit `"release-type": "node"`, `"bump-minor-pre-major": true`, `"include-component-in-tag": false`, `"bootstrap-sha"` = SHA des Abnahme-Commits von M8 (sonst wird der erste Changelog aus Hunderten Entwicklungs-Commits gebaut), `"release-as": "0.1.0"` nur für den ersten Release; `.release-please-manifest.json` `{".": "0.0.0"}`. Changelog-Abschnitte deutsch wie die Commits: `feat` → »Neu«, `fix` → »Behoben«, `perf` → »Schneller«, `docs`/`refactor`/`test`/`chore`/`ci` versteckt. Nach dem ersten Release entfernt ein Commit `release-as`. |
| `release.yml` | Trigger `push` auf `main`, `permissions: {}` oben. Job `release-please` (`contents: write`, `pull-requests: write`) mit Outputs `release_created`, `tag_name`, `version`. Job `publish` nur bei `release_created`, `runs-on: ubuntu-latest`, `environment: npm`, `permissions: contents: write, id-token: write`: Checkout des Tags, mise, `pnpm install --frozen-lockfile`, `mise run check`, `pnpm pack`, Pack-Smoke-Test, dann **Publish idempotent**: `npm view "backe@$VERSION" version` gelingt → Publish überspringen, sonst `npm publish <tarball> --provenance --access public`; zuletzt `gh release upload "$TAG" <tarball> --clobber`. Der Paketname wird aus `package.json` gelesen, nicht hart kodiert (Ausweichname). |
| Erste Veröffentlichung | npm erlaubt keinen Trusted Publisher für ein Paket, das es noch nicht gibt ([docs.npmjs.com/trusted-publishers](https://docs.npmjs.com/trusted-publishers)). Daher einmalig: Der User legt einen granularen npm-Token (nur Publish, Ablauf 1 Tag) als Secret `NPM_TOKEN` im Environment `npm` an; der Publish-Schritt schreibt `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` nach `~/.npmrc`, **nur wenn** das Secret gesetzt ist. Nach dem ersten Publish richtet der User den Trusted Publisher ein (Repo `spearwolf/backe`, Workflow `release.yml`, Environment `npm`) und löscht das Secret; ab 0.1.1 läuft OIDC. Weicht von §2.21 »kein Token-Secret« für genau einen Lauf ab — braucht die Freigabe des Users. |
| Ausweichname | Lehnt npm den Namen `backe` ab, wird `name` zu `@spearwolf/backe`; `bin` bleibt `backe`, README-Installationszeile und `release.yml` (liest den Namen aus `package.json`) folgen. Nur nach Rückfrage. |
| Renovate | `renovate.json`: `"extends": ["config:recommended", ":semanticCommits"]`, `"rangeStrategy": "bump"`, `"lockFileMaintenance": { "enabled": true }`, Gruppen `vitest` (`vitest`, `@vitest/*`) und `mcp-sdk` (`@modelcontextprotocol/*`), `"schedule": ["before 6am on monday"]`, `"timezone": "Europe/Berlin"`. Renovate statt Dependabot, weil es neben npm und Actions auch die Versionen in `mise.toml` pflegt (Manager `mise`). Die App installiert der User. |
| Hooks bei `update-ref` | Kein Eingriff: `update-ref` ruft nur den `reference-transaction`-Hook, der in einer verwalteten Arbeitskopie nicht vorkommt; ein Satz dazu in §2.16.1. |
| `verify` und `reverted` | `verify` prüft nicht nach, ob ein Quarantäne-Eintrag `reverted` die Änderungen wirklich umkehrt — die Quarantäne ändern nur Admins, und Admins sind vertraut (§3.10). Wird in §2.13 so festgehalten, nicht gebaut. |

### Auf die Roadmap (backe.md §4.2, Task 10)

| Punkt | Grund |
| --- | --- |
| Hub auf ein später ergänztes echtes Remote umhängen | Funktion, kein Fehler; heute dokumentiert manuell per `git remote set-url`. |
| Journal trägt Vorher-Bytes base64 | Nur groß bei großen Anhängen; Messung erst im Realbetrieb. |
| LFS-Idempotenz nur über `filter.lfs.process` | Korrekt, nur nicht robust gegen exotische LFS-Konfigurationen. |
| Graph-Patch baut betroffene Listen je Operation neu; `headState` startet etwa 12 Prozesse | Performance, Bedingung wie beim Volltext-Index: messbar langsam bei 10⁴ Issues. |
| Gescheiterte GitHub-Abfragen werden nicht gecacht | Nur Latenz bei `repo check --remote` ohne Netz. |

Entfällt ersatzlos: »Backlogs, die vor dem LFS-Fix roh committete Anhänge hatten, heilt nichts« — vor dem ersten Release gibt es solche Backlogs nicht.

---

### Task 1: Paketmetadaten, Node-Prüfung, CI-Härtung

**Files:**
- Create: `src/cli/node-version.ts`, `src/cli/node-version.test.ts`
- Modify: `package.json`, `src/cli/main.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `checkNodeVersion(version: string, min = 26): string | undefined` — `undefined` wenn Major ≥ `min`, sonst `backe braucht Node.js ≥ 26 (gefunden <version>)`.

- [ ] **Step 1: Write the failing test** in `src/cli/node-version.test.ts`

```ts
test('checkNodeVersion rejects older majors', () => {
  expect(checkNodeVersion('26.13.1')).toBeUndefined();
  expect(checkNodeVersion('27.0.0')).toBeUndefined();
  expect(checkNodeVersion('22.11.0')).toBe('backe braucht Node.js ≥ 26 (gefunden 22.11.0)');
  expect(checkNodeVersion('kaputt')).toBe('backe braucht Node.js ≥ 26 (gefunden kaputt)');
});
```

- [ ] **Step 2: Run** `pnpm vitest run src/cli/node-version.test.ts` — FAIL (Modul fehlt).
- [ ] **Step 3: Implement** `checkNodeVersion`; in `src/cli/main.ts` vor allem anderen `const bad = checkNodeVersion(process.versions.node); if (bad) { process.stderr.write(\`Fehler: ${bad}\n\`); process.exit(1); }`. `package.json` laut Festlegung (`packageManager`, `repository`, `homepage`, `bugs`, `author`, `keywords`, `publishConfig`, `prepack`). `ci.yml`: `permissions: contents: read` auf oberster Ebene.
- [ ] **Step 4: Run** `pnpm vitest run src/cli/node-version.test.ts` — PASS; `pnpm pack --dry-run` listet genau die vier Dateien aus der Festlegung und baut vorher (`prepack` in der Ausgabe).
- [ ] **Step 5: Commit** `feat(cli): Node-Version beim Start prüfen, Paketmetadaten für den Release`

### Task 2: Pack-Smoke-Test

**Files:**
- Create: `scripts/pack-smoke.sh`
- Modify: `mise.toml` (Task `smoke`), `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `bash scripts/pack-smoke.sh <tarball>` — Exit 0 bei Erfolg, sonst ≠ 0 mit `pack-smoke: <was>` auf stderr. mise-Task `smoke`: `pnpm pack --pack-destination <tmp>` und das Skript auf den Tarball. Task 3 ruft das Skript genauso auf.

- [ ] **Step 1: Write the script** laut Festlegung »Pack-Smoke-Test«. Prüfungen, jede mit eigener `pack-smoke:`-Meldung:
  - `tar -tzf <tarball> | sort` ist genau `package/LICENSE`, `package/README.md`, `package/dist/cli.js`, `package/package.json`;
  - `backe --version` = `node -p "require('<inst>/node_modules/backe/package.json').version"`;
  - Ablauf (lokal so verifiziert):

```bash
"$BACKE" init "$T/wc" --name smoke --prefix sm --remote "$T/remote.git" --key "$T/key.pub" --user-name Smoke
"$BACKE" config set backlogs.smoke.sync.mode manual
ID=$("$BACKE" new -t "Smoke-Test")
"$BACKE" issue claim "$ID"
"$BACKE" mv "$ID" review --reason "Smoke"
"$BACKE" sync
"$BACKE" verify
```

  - `"$BACKE" show "$ID" --json --fields state,assignee` = `{"state":"review","assignee":"smoke"}`;
  - `git -C "$T/remote.git" log --format=%s main` = vier Zeilen `issue move <id> review`, `issue claim <id>`, `issue create <id>`, `init smoke`.
  Der Paketname für den `node_modules`-Pfad kommt aus `tar -xOf <tarball> package/package.json` (Ausweichname). `trap` räumt `$T` auf.
- [ ] **Step 2: Gegenprobe** — `mise run smoke` gegen einen absichtlich kaputten Stand (temporär `--fields state` statt `state,assignee` im Vergleich) scheitert mit `pack-smoke: …`, Exit ≠ 0; zurücksetzen.
- [ ] **Step 3: Run** `mise run smoke` — Exit 0, letzte Zeile `pack-smoke: ok <version>`.
- [ ] **Step 4:** `ci.yml` um die beiden Schritte aus der Festlegung ergänzen; Push auf einen Branch, `gh run watch` — grün auf `ubuntu-latest` und `macos-latest`.
- [ ] **Step 5: Commit** `ci: Pack-Smoke-Test mit Skript-E2E gegen ein Bare-Remote`

### Task 3: `release.yml`, release-please, Renovate

**Files:**
- Create: `.github/workflows/release.yml`, `release-please-config.json`, `.release-please-manifest.json`, `renovate.json`
- Modify: `package.json` (`version` → `0.0.0`, release-please setzt `0.1.0`)

**Interfaces:**
- Consumes: `scripts/pack-smoke.sh <tarball>` (Task 2).

- [ ] **Step 1:** Aktuellen Major von `googleapis/release-please-action` nachschlagen (Global Constraints); `release.yml`, `release-please-config.json`, `.release-please-manifest.json` laut Festlegungen. `bootstrap-sha` bleibt hier ein Platzhalter `"BOOTSTRAP"` — Task 11 setzt den echten SHA.
- [ ] **Step 2:** `renovate.json` laut Festlegung; prüfen mit `pnpm dlx --package renovate renovate-config-validator renovate.json` — Ausgabe `Config validated successfully`.
- [ ] **Step 3: Publish idempotent lokal prüfen** — die Abfrage aus dem Workflow-Schritt als Einzeiler gegen `yaml@2.9.1` (Exit 0 → »überspringen«) und `backe@0.0.0-nie` (Exit ≠ 0 → »publishen«); beide Zweige geben ihre Entscheidung aus.
- [ ] **Step 4:** Beide Workflows gegen das Schema prüfen: `pnpm dlx @action-validator/cli .github/workflows/release.yml` und dasselbe für `ci.yml` — ohne Fehler. (Ist das Paket nicht verfügbar: `gh workflow view` nach dem Push; dann im Commit-Body vermerken.)
- [ ] **Step 5: Commit** `ci: Release mit release-please und npm Trusted Publishing, Renovate`

### Task 4: README für Nutzer

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** README (englisch, wie bisher) umbauen:
  - Warnkasten ersetzen durch einen Hinweis »early release (0.x): formats and commands may still change; the on-disk format is versioned (§2.15.3)«;
  - neuer Abschnitt **Install**: `npm install -g backe`, Voraussetzungen Node.js ≥ 26, Git ≥ 2.38 mit SSH-Signing, `ssh-keygen`, optional `git-lfs` und `gh`, `backe doctor` prüft sie;
  - **Quickstart** mit den Befehlen aus `scripts/pack-smoke.sh` (eigener Key-Pfad statt Temp-Pfaden, `BACKE_USER` bzw. `--as`), danach `next --claim` für Agents;
  - neuer Abschnitt **For agents: MCP** mit `backe mcp` und einem Client-Eintrag `{"command": "backe", "args": ["mcp"]}`, Verweis auf §2.19 für die Tools;
  - Status-Tabelle: M7 `done`, M8 `done`; den veralteten Satz »works locally today, except `--claim`, which arrives with sync« streichen;
  - Abschnitt **Releases**: Conventional Commits → release-please → npm mit Provenance.
- [ ] **Step 2: Quickstart wörtlich ausführen** — in einem Scratch-Verzeichnis mit isoliertem `HOME`/`BACKE_HOME` (wie im Smoke-Skript) und `node dist/cli.js` als `backe`; jeder Befehl Exit 0.
- [ ] **Step 3: Commit** `docs: README für den ersten Release`

### Task 5: Git-Schicht — Robustheit

**Files:**
- Modify: `src/git/exec.ts`, `src/git/repo.ts`, `src/git/query.ts`, `src/git/ssh.ts`, `src/git/local-state.ts`, `src/store/files.ts`, `src/context/paths.ts` und deren Tests; Aufrufer von `exists`/`isMissing`/`fsFailure`

**Interfaces:**
- Produces: `exists`, `isMissing`, `fsFailure` in `src/store/files.ts` (store liegt unter `context` und `git`); `src/context/paths.ts`, `src/git/repo.ts`, `src/git/ssh.ts` importieren sie, keine eigenen Kopien mehr. `forChunks<T>(items: readonly T[], size: number, fn: (chunk: T[]) => Promise<void>): Promise<void>` in `src/git/exec.ts`.

Punkte (aus »Übernommen aus M4/M5b/M6«), jeder mit Test:

- **ARG_MAX:** `dirtyPaths`/`rollbackPaths` und jeder andere Aufruf mit einer Pfadliste übergeben die Pfade in Blöcken zu 1 000 per `forChunks`. Test `rollbackPaths handles 5000 paths` (5 000 Dateien in einem Temp-Repo, alle zurückgesetzt).
- **Timeout beendet die Prozessgruppe:** Aufrufe mit `timeoutMs` starten mit `detached: true`; bei Zeitüberschreitung `process.kill(-child.pid, 'SIGKILL')`; offene Gruppen werden bei `process.on('exit')` ebenso beendet. Test `timeout kills grandchildren`: ein Fake-Binary (Shell-Skript in `test/fixtures/bin/`) startet `sleep 30 &`, schreibt die PID nach stdout und wartet; `timeoutMs: 200` → `BackeError` mit `Zeitüberschreitung`, danach wirft `process.kill(pid, 0)` `ESRCH`.
- **`GIT_OPTIONAL_LOCKS=0`** im Env jedes lesenden Aufrufs ohne Index-Schreibwunsch (`status`, `diff`, `ls-files`): als Default in `git()`, überschreibbar. Test: `git(['status'])` sieht die Variable (Fake-Binary gibt `env` aus).
- **`%(refname:lstrip=2)`** statt `:short` in `branchesWithUnpushed`. Test: Branch `x` und Tag `x` → Ergebnis `['x']`, nicht `heads/x`.
- **`unpushedCount`** ohne Produktions-Aufrufer → löschen samt Test.
- **`readPublicKey`** mit leerem stderr → Meldung `… nicht lesbar (ssh-keygen ohne Ausgabe, Exit <n>)`. Test über ein Fake-`ssh-keygen`.
- **`stateDir()`** darf `.git/backe` nicht anlegen, wenn nur gelesen wird (`doctor`): Parameter `{ create: boolean }`, lesende Aufrufer `false`. Test: `doctor` auf einer Arbeitskopie ohne `.git/backe` lässt sie ohne.
- **Mode-Bits bei der Umkehr** (Quarantäne `revert`): die Umkehr stellt den Modus des Parents wieder her. Test: Commit ändert `100644` → `100755`, `--revert` ergibt wieder `100644`.
- **Cache-Version für `allowed_signers`:** Dateiname trägt eine Formatversion (`allowed_signers.v1`); alte Datei wird ignoriert und neu gebaut. Test: vorhandene Datei im alten Namen ohne Wirkung.
- **`foreignHost()`** aus dem Lock-Code als benannte Funktion herausziehen; Test `foreignHost` für gleichen/fremden Host und Lock ohne Host-Zeile; dazu der fehlende Test der Boot-Toleranz (Lock-Zeitstempel kurz vor Boot ± Toleranz).

- [ ] **Step 1: Write the failing tests** (Liste oben) neben den betroffenen Modulen.
- [ ] **Step 2: Run** `pnpm vitest run src/git src/store src/context` — die neuen Tests FAIL.
- [ ] **Step 3: Implement** die Punkte.
- [ ] **Step 4: Run** `mise run check` — grün.
- [ ] **Step 5: Commit** `fix(git): Pfadlisten in Blöcken, Timeout beendet die Prozessgruppe, lesende Aufrufe ohne Index-Lock`

### Task 6: Sync, Replay, Verify

**Files:**
- Modify: `src/services/sync.ts`, `src/services/claim.ts`, `src/services/replay.ts`, `src/services/write.ts`, `src/services/commit.ts`, `src/ops/replay.ts`, `src/services/verify.ts`, `src/git/local-state.ts`, `src/cli/commands/verify.ts` (JSON-Ausgabe) und Tests

Punkte (aus »Übernommen aus M5b/M6«), jeder mit Test:

- **`upstream` vor `tip`:** Bricht der Sync im lokalen Abschnitt ab (Replay-Fehler, `verify`-Fehler), bleibt `upstream` auf dem alten Stand; gesetzt wird er erst nach dem erfolgreichen lokalen Abschnitt. Test `aborted local phase keeps upstream` über `SyncHooks` (Fehler nach dem Fetch einspeisen).
- **`ClaimOutcome.commit`** ist `undefined`, wenn der Claim im Replay ohne Wirkung entfällt; nie ein SHA, der nicht in `HEAD` liegt. Test: Claim, paralleler identischer Claim gewinnt → `commit` ist Vorfahre von `HEAD` oder `undefined`.
- **Modus `warn` wiederholt Warnungen:** Die Warnungen zu einem ungültigen eingehenden Commit erscheinen einmal je SHA; gemerkt in der lokalen Sync-State-Datei. Test: zwei Runden → Warnung nur in der ersten.
- **`taintKeys`** nennt alle Subjekte: `project.mv` belastet `from` und `to`, `project.rm` mit `reassign` auch das Ziel; `repo.add` ohne Name belastet `repo:<abgeleiteter Name>`. Test je Fall in `src/ops/replay.test.ts`, dazu »Taint über erzeugte IDs«.
- **`verify` und unbekannte Keys in Kommentaren:** Kommentar-Frontmatter wird wie Issue-Frontmatter auf unbekannte Keys geprüft und unter `unknown_keys` gemeldet. Test mit Hand-Edit eines Kommentars.
- **JSON von `verify`:** leere Listen werden einheitlich weggelassen — `prop_notices` wie `unknown_keys`. Golden-File anpassen (bewusste Änderung, im Commit-Body nennen).
- **Journal-Recovery einer gelandeten `edits`-Kette** setzt auch `no_effect`-Pfade zurück. Test: Kette mit einem wirkungslosen Edit, Abbruch nach `update-ref`, Recovery → Arbeitskopie sauber.
- **`unsettled.paths`** nennt nur die Pfade, die tatsächlich abweichen. Test mit zwei Pfaden, einer davon unverändert.

- [ ] **Step 1: Write the failing tests** (Liste oben).
- [ ] **Step 2: Run** `pnpm vitest run src/services src/ops` — die neuen Tests FAIL.
- [ ] **Step 3: Implement** die Punkte.
- [ ] **Step 4: Run** `pnpm build && mise run check` — grün; geänderte Golden-Files nur die von `verify --json`.
- [ ] **Step 5: Commit** `fix(sync): upstream erst nach dem lokalen Abschnitt, Warnungen einmal je Commit, vollständige Taint-Keys`

### Task 7: Services und Adapter — Verhalten

**Files:**
- Modify: `src/services/attachments.ts`, `src/cli/commands/attach.ts`, `src/mcp/write-tools.ts`, `src/mcp/read-tools.ts` (samt Resource), `src/mcp/tool.ts`, `src/mcp/sync-tools.ts`, `src/mcp/stdio.ts`, `src/services/doctor.ts`, `src/services/config.ts`, `src/services/repos.ts`, `src/core/url.ts`, `src/services/batch.ts`, `src/services/working-copy.ts` und Tests

**Interfaces:**
- Produces: `loadAttachmentSource(input: { path?: string; url?: string; json?: string; text?: string; name: string }, opts: { base: string; home: string; maxBytes: number }): Promise<AttachmentSource>` in `src/services/attachments.ts` — einziger Lader für CLI (`sourceOf`) und MCP (`attachSource`); begrenzt `path` auf `base` (Regel aus `attachment_add`), TOCTOU-fest: `realpath` + Begrenzungsprüfung, dann `stat` des realen Pfads, dann `open`, dann `fstat` am File-Handle — weichen `dev`/`ino` ab, `validation`; Größe und Inhalt kommen nur über das Handle; `EACCES`/`ELOOP` → `validation` mit Pfad. Größe vor dem Lesen: über `maxBytes` → `validation` ohne die Datei zu lesen.

Punkte:

- **Anhänge** (M5b, M7): gemeinsamer Lader wie oben; `addAttachment` wird `async`, `entry.url as string` entfällt durch Typ-Verengung. Tests: Datei über dem Limit wird nicht gelesen (Spy auf `readFile` bleibt ungerufen), Symlink aus `base` heraus → `validation`, Datei ohne Leserecht → `validation` mit Pfad, Austausch der Datei zwischen Prüfung und Lesen (Test-Hook im Lader) → `validation`.
- **MCP:** lesende Tools prüfen `fields` vor dem Planen des Read-Syncs; die Resource plant den Read-Sync über denselben Weg wie `defineTool`; `issue_get` nutzt eine Ansicht `issueShowJson` in `views.ts`; `DEFAULT_PULL_INTERVAL` entfällt, der Default kommt aus dem Schema der Backlog-Config; `toolResult(undefined)` → `{content:[{type:'text',text:'null'}]}`; Fehler aus `handle.close()`/`mcp.close()` nach stdin-Ende gehen nach stderr (`backe mcp: …`), Exit bleibt 0. Tests je Punkt in `src/mcp/*.test.ts`.
- **`doctor`:** ein execFile-Timeout zählt als `fail` mit »Zeitüberschreitung«, nicht als »fehlt«; ein lokales `git` im cwd überschattet nicht (`PATH`-Auflösung ohne `.`). Tests über Fake-Binaries.
- **`config`:** Schema-Drift (Nicht-String-Blatt) → `validation` mit Pfad statt rohem Fehler; ein unverändert gespeicherter Entwurf wird gelöscht; `getConfig` liest einmal. Tests in `src/services/config.test.ts`.
- **URLs und Repos:** `github.com/a/b.git` ohne Schema verliert `.git` wie mit Schema; ein relativer Pfad `a/b` ist keine Repo-URL (`validation`, Hint `./a/b` oder absolut); `repo scan` ohne `--force` wendet »first-by-path« an; ein ungültiger Issue-Ref auf ein nicht registriertes Repo wird gemeldet (`notices`), nicht still verworfen. Tabellentests in `src/core/url.test.ts`, Rest in `src/services/repos.test.ts`.
- **Batch:** Fehler werden in Zeilenreihenfolge gemeldet — ein Schemafehler in Zeile 5 kommt nach einer verbotenen Operation in Zeile 2. Test mit genau diesen zwei Zeilen.
- **`working-copy.ts`:** beide `ENOENT`-Prüfungen nutzen `isMissing` (deckt `ENOTDIR`). Test mit einer Datei an Stelle eines Verzeichnisses.

- [ ] **Step 1: Write the failing tests** (Liste oben).
- [ ] **Step 2: Run** `pnpm vitest run src/services src/mcp src/core` — die neuen Tests FAIL.
- [ ] **Step 3: Implement** die Punkte.
- [ ] **Step 4: Run** `pnpm build && mise run check` — grün; geänderte Golden-Files nur, wo ein Punkt die Ausgabe ändert, im Commit-Body genannt.
- [ ] **Step 5: Commit** `fix(services): ein Lader für Anhänge, MCP-Kleinigkeiten, doctor, config und Repo-URLs`

### Task 8: Aufräumen ohne Verhaltensänderung

**Files:** nach Fundort der Punkte; keine Golden-Files.

Punkte (aus »Übernommen aus M4/M5a/M5b«):

- Doppelte Helfer: Code-Unit-Comparatoren in Services auf einen `compareCodeUnits` in `src/core/` ziehen; Notice-Helfer von `ops/next.ts` nach `ops/notice.ts`; `listSort` aus `src/cli/commands/issue.ts` in die Service-Schicht neben `compareIssues`; doppelte Test-Helfer zusammenlegen; Admin-Prädikat einmal (`isAdmin(snapshot, handle)` in `src/ops/`).
- Pfadmuster `issues/<x>/<id>/issue.md` an einer Stelle zerlegen (`parseIssuePath` in `src/store/layout.ts`).
- Tote Zweige: redundantes `from ?? null` und `not_found`-Zweig in `issues.ts`; `FilterSource` ohne Konsument; toter `revoked`-Zweig ohne Zeitstempel in `user show`; `readText` doppelt in `src/services/config.ts`.
- `landedCommit` vergleicht zusätzlich `Backe-Op` (dekodiert, nicht Bytes) — bei bislang gleichem Ergebnis kein Verhaltenswechsel, Test ergänzen.
- CLI-Interna: `fromCommander`-Hint fällt nicht mehr auf `backe` zurück (Gruppe ohne `subcommand()` → vollständiger Befehlspfad); `parentFlags` in `defineEdit` je Programminstanz; `sprint show` in eine Service-Funktion plus Rendern zerlegen; `ensureLfsRule` liest nicht `d.snapshot`.
- `showBacklog` vergleicht Pfade per `samePath` und gibt nur Handles aus.
- Doc-Kommentar in `src/core/errors.ts` um »stdin doppelt verlangt«; `test/conventions.test.ts` mit Scope-Kommentar (prüft nur einzeilige `"${…}"`); der Zweig `allowSettledParent` — ist er über echte Operationen nicht erreichbar, wird er entfernt, sonst bekommt er einen Test, der den Bypass zeigt.

- [ ] **Step 1:** Je Punkt prüfen, ob noch offen (Global Constraints), dann umsetzen.
- [ ] **Step 2: Run** `pnpm build && mise run check` — grün; `git status test/e2e/golden test/mcp/golden` leer.
- [ ] **Step 3: Commit** `refactor: doppelte Helfer, tote Zweige und CLI-Interna aufgeräumt`

### Task 9: Testlücken und Testhygiene

**Files:** Tests nach Fundort; `test/conventions.test.ts`; `src/context/resolve.test.ts`; `src/mcp/stdio.test.ts` → `test/mcp/stdio.test.ts`

Punkte (aus »Übernommen aus M3–M7«), je ein Test oder eine Korrektur:

- Biome: die 9 `noNonNullAssertion` in `resolve.test.ts` (`s.env.HOME!` → `s.at('home/…')`); danach `pnpm exec biome ci .` ohne Warnung.
- Lücken M4: Status `B`, Key im selben Commit, Gruppierung.
- Lücken M5a: Reparent mit Enkel; `derive` mit No-op und Hinweisen; vorhandener Anker überlebt gescheitertes `verify`; `assign` mit fremdem Handle und ohne Änderung; `reopen --to done`; `ambiguous`-Zweig in `revokeKey`; Rethrow-Zweig in `readPublicKey` (PEM); `--comments <n>`-Kürzung im Golden.
- Lücken M5b: Identity-`fail` bei kaputter `.git/config`; `doctor --fix` per E2E; Golden für `repo scan` `differs`/`überschrieben`; Temp-Datei des Editors nach Erfolg weg und Modus `0o600`; Text-Ausgabe von `attach add --json`; `attach get -o` auf vorhandene Datei und auf Verzeichnis; vakuöse Zeilen in `tools.test.ts` entfernen.
- Lücken M6: Push-Timeout; LFS-Fehlerpfade; Signal-Aufschub im Sync; `scheduleDeferred`-Guard; LFS-Pull-Fehler nach Clone; Pointer-Präfix-Test mit `lfs: on`; Widerruf im Parent-Stand bei `readUnits`.
- Lücken M7: stdout-E2E mit Kindprozess (Backlog ohne Remote); `issue_rank` mit `top: false` allein; Sortier-Test prüft die ganze Reihenfolge; der `build`-Test zeigt zwei unabhängige Instanzen; »sync neben der Warteschlange« prüft Ergebnisse, nicht nur Enqueues; Spawn-Zählung nach wirkungslosem `issue_move` wartet auf ein Ereignis statt eines Microtasks; die Gegenproben für Zwei-Takt-Sync und stdio-Ende scheitern an einer Assertion, nicht per Timeout.
- Härte: `as never` → typisierte `Operation[]` (M5a-Tests, `read-tools.test.ts`); feste Zeitstempel im `sort created`-Test; `userWithTwoKeys` baut den zweiten Key echt; der Kommentar-Konflikttest hängt nicht an der Aufrufreihenfolge von `deps.now`; der E2E liest `_process` von `StdioClientTransport` nur mit Guard (`'_process' in t`) und scheitert sonst mit klarer Meldung; der `onerror`-Test prüft den Fehlercode statt des SDK-Wortlauts; überflüssiger `&&`-Guard im `nextJson`-Test.
- Konventionstest stdout fängt auch `import { stdout } from 'node:process'`, `console.dir` und `console.table`; `stdio.test.ts` zieht nach `test/mcp/`.

- [ ] **Step 1:** Je Punkt prüfen, ob noch offen; Tests schreiben bzw. härten. Ein neuer Test, der auf Anhieb grün ist, ist hier richtig (Lückenschluss); ein neuer Test, der rot ist, zeigt einen Fehler — der wird im selben Commit behoben und im Commit-Body genannt.
- [ ] **Step 2: Run** `mise run check` — grün, Coverage nicht unter dem M7-Stand (98,99 % Lines / 93,38 % Branches).
- [ ] **Step 3: Commit** `test: Lücken aus M3 bis M7 geschlossen, Tests gehärtet`

### Task 10: Spec-Doku nachziehen

**Files:**
- Modify: `docs/proposals/backe.md`, `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`

- [ ] **Step 1:** backe.md nach den Abschnitten »Doku nach Abnahme« unter M2 und M4 im Gesamtplan: §2.16.4 (Beispiele `issue.body`, `issue.rank` ohne `from`, `comment.add` ohne `body`), §2.24 (`issue.prop`), §2.13 (Hand-Edits nennen `issue.body`; Identitätsregeln; Verify-Regeln; Format von `.backe/quarantine.jsonc`; `verify` vertraut einem Admin-Eintrag `reverted`), §2.12 (`keys` darf fehlen), §2.7 (Kommentare derselben Sekunde ordnet der Dateiname), §2.18 (Fehlercodes `usage`/`validation`, Hinweise und Warnungen im JSON-Modus nur im Objekt), §2.20 (Git-Mindestversion 2.38). Vorher je Punkt prüfen, ob er schon drinsteht (`grep`).
- [ ] **Step 2:** §2.19 »Ende«: der Server endet auch, wenn der Transport sich selbst schließt (etwa nach einem stdout-Fehler). §2.16.1: ein Satz zu Hooks bei `update-ref` (Festlegung).
- [ ] **Step 3:** §2.21 um die Festlegungen dieses Plans (Pack-Smoke-Test, Versionierung, Publish idempotent, Erstveröffentlichung, Renovate) als Aussage über das, was gilt; §4.2 um die Tabelle »Auf die Roadmap«; §6 als erledigt kennzeichnen (Verweis auf den Gesamtplan).
- [ ] **Step 4:** Planentscheidungen des Gesamtplans, die noch nicht in backe.md stehen, als Präzisierung übernehmen (Spalte Meilenstein ≤ M7; je Zeile prüfen).
- [ ] **Step 5: Commit** `docs: backe.md auf den Stand des ersten Release gebracht`

### Task 11: Abnahme und erste Veröffentlichung

**Files:**
- Modify: `release-please-config.json` (`bootstrap-sha`), `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`, `README.md` (Status)

- [ ] **Step 1:** Abschluss-Review über den ganzen Meilenstein (superpowers:requesting-code-review); Befunde beheben oder als »Übernommen aus M8« mit Ziel »nach 0.1.0« eintragen.
- [ ] **Step 2:** Gesamtplan: M8 »Abgenommen am …« (Tests, Coverage, CI), alle `M8`-Zeilen der Übernommen-Listen abgehakt (✓ mit Task-Verweis oder »→ §4.2«), Festlegungen als Zeilen »M8« in die Planentscheidungen.
- [ ] **Step 3:** `bootstrap-sha` auf den SHA von `HEAD` setzen, `mise run check` und `mise run smoke` grün, Commit `docs: M8 im Gesamtplan abgenommen`, Push; CI grün auf beiden Plattformen (`gh run watch`).
- [ ] **Step 4: Halt — Freigabe des Users einholen** für die folgenden Schritte, mit Liste: Renovate-App installieren, Environment `npm` und Secret `NPM_TOKEN` (granular, nur Publish, 1 Tag) anlegen, Release-PR von release-please mergen.
- [ ] **Step 5:** Nach Freigabe und Merge: `release.yml` beobachten (`gh run watch`); `npm view backe version` = `0.1.0`; GitHub-Release `v0.1.0` trägt den Tarball. Scheitert der Publish am Namen: Halt, Rückfrage zum Ausweichnamen (Festlegung).
- [ ] **Step 6:** User richtet den Trusted Publisher ein und löscht `NPM_TOKEN`; Commit `chore: release-as nach dem ersten Release entfernt`.

## Abnahme M8

- `mise run check` grün, CI grün auf `ubuntu-latest` und `macos-latest` inklusive Pack-Smoke-Test.
- `release.yml` hat einen Release gebaut; `backe@0.1.0` (bzw. `@spearwolf/backe@0.1.0`) liegt auf npm mit Provenance; `npm install -g backe && backe --version` auf einer frischen Maschine ergibt `0.1.0`.
- Jede `M8`-Zeile der Übernommen-Listen ist erledigt oder steht in backe.md §4.2.
- Abschluss-Review über den ganzen Meilenstein; seine Befunde behoben oder als »Übernommen aus M8« eingetragen.

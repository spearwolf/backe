# backe — Gesamtplan der Umsetzung

> **For agentic workers:** Dieser Gesamtplan schneidet `docs/proposals/backe.md` in Meilensteine und legt die Schnittstellen zwischen ihnen fest. Umgesetzt wird nie direkt aus diesem Dokument, sondern aus dem Detailplan des jeweiligen Meilensteins (REQUIRED SUB-SKILL: superpowers:subagent-driven-development oder superpowers:executing-plans). Der Detailplan eines Meilensteins entsteht erst, wenn sein Vorgänger abgenommen ist — so plant er gegen gebauten Code statt gegen Annahmen.

**Goal:** `backe` vollständig nach `docs/proposals/backe.md` bauen — CLI, Git-Schicht mit SSH-Signaturen, Sync mit semantischem Replay, MCP-Modus, Release über npm.

**Architecture:** Schichten nach `backe.md` §2.20 (`core` → `store` → `context`/`git` → `ops` → `services` → `cli`/`mcp`), Abhängigkeiten nur nach unten. Die Meilensteine bauen von innen nach außen; jeder endet mit grünem `mise run check` und einem abnehmbaren Stand.

**Tech Stack:** Node.js ≥ 26, TypeScript strict (ESM, `nodenext`), pnpm, Biome, Vitest + v8-Coverage + fast-check, tsdown; Runtime: `commander`, `zod`, `yaml`, `jsonc-parser`, `@modelcontextprotocol/server`; System-`git`, `ssh-keygen`.

**Spec:** `docs/proposals/backe.md` (Status `spezifiziert`). Abschnittsverweise hier meinen diese Datei.

## Global Constraints

Gelten für jeden Meilenstein und jeden Task.

- `engines.node: ">=26"`; TypeScript strict, ESM only, `module: nodenext` (§2.20).
- Runtime-Abhängigkeiten ausschließlich `commander`, `zod`, `yaml`, `jsonc-parser`, `@modelcontextprotocol/server` (§2.20; MCP-SDK v2, `@modelcontextprotocol/core` transitiv). Jede weitere Runtime-Abhängigkeit braucht Freigabe des Users.
- Git nur über das System-`git` per `child_process`, kein isomorphic-git (§2.20). Die globale Git-Config wird nie verändert; Signier-Settings nur per `-c` pro Aufruf (§2.13).
- Schichtregel: `core` ohne I/O; Abhängigkeiten nur nach unten (§2.20).
- Dateien: LF, UTF-8, abschließender Newline (§2.3). Kanonischer Roundtrip byte-identisch (§2.3).
- Exit-Codes sind Vertrag: `0` ok · `1` unerwartet · `2` Usage/Validierung/mehrdeutige ID · `3` nicht gefunden · `4` Konflikt · `5` Verifikation · `6` Sync/Netzwerk (§2.18).
- Tests isoliert: eigenes `BACKE_HOME` im Temp-Verzeichnis, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, Test-Keys einmal pro Suite per `ssh-keygen` (§5).
- Keine Tests über Last oder Timing: Nebenläufigkeit wird über Test-Hooks und Fake Timers gesteuert (§5), nie über Busy-Loops oder CPU-Last.
- Coverage-Gate: ≥ 90 % Lines und Branches für `core`, `store`, `ops`, `services`, `context`; ≥ 85 % gesamt (§5). Der Threshold eines Verzeichnisses kommt mit dem Meilenstein, der es anlegt.
- Plattformen Linux und macOS; CI-Matrix `ubuntu-latest` + `macos-latest` (§2.20, §2.21).
- Code, Tests und Commit-Messages nennen die Spec als `backe.md`, nie als Kürzel. Commit-Messages als Conventional Commits (release-please, §2.21).
- Lizenz MIT; Paket- und Binary-Name `backe` (§2.20).

## Review Focus

Eingaben, die der Spec impliziert, aber keine seiner Testlisten (§5) abdeckt. Jede Zeile bekommt einen Test im genannten Meilenstein.

1. **Strings, die YAML als anderen Typ läse** — `true`, `null`, `~`, `0x1f`, `1e3`, `.inf`, eine Zahl als String-Prop (`"4"`), Titel mit `: ` oder führendem `[`, `-`, `*`, `&`, `!`, `#`: Der Roundtrip behält String und Typ. → M1, Task 6.
2. **Hand-editierte Dateien mit Kanten** — CRLF, BOM, fehlender Schluss-Newline, `---` als Trennlinie im Body, leerer Body: werden gelesen, der Body bleibt inhaltlich gleich, normalisiert wird beim nächsten Write. → M1, Task 6.
3. **Kommentare oder unbekannte Keys im Frontmatter** nach einem Hand-Edit — nie still verworfen: Kommentar → Fehler mit `datei:zeile`, unbekannter Key → bleibt erhalten und warnt. → M1, Tasks 6 und 7.
4. **Abbruch mitten im Write** (Fehler oder SIGINT zwischen Dateischreiben und Commit) — danach ist die Arbeitskopie sauber, kein halb geschriebenes Issue, der nächste Write läuft. → M4, Schreibpfad.
5. **Symlinks und `~` in Pfaden** — macOS `/tmp` → `/private/tmp`, relatives oder `~`-haltiges `BACKE_HOME`, ein Code-Repo hinter einem Symlink: Kontext-Auflösung und Repo-Zuordnung finden dasselbe Repo wie ohne Symlink. → M3, Kontext-Auflösung.

---

## Abweichungen von `backe.md` §6

§6 ist als *(Plan)* markiert; dieser Gesamtplan ersetzt ihn mit zwei Umstellungen:

- **Kontext vor CLI.** §6 baut die CLI-Grundbefehle (Schritt 4) vor dem Kontext (Schritt 5). Jeder Write braucht aber Backlog und Identität samt Key (§2.14, §2.16.1) — ohne Kontext gibt es keinen signierten Commit. Hier: M3 Kontext, M4 Git, M5a/M5b CLI.
- **Operationen als eigener Meilenstein vor dem ersten Write.** Jeder Commit trägt seine Operation im Trailer `Backe-Op` (§2.13), und das Replay (§2.16.4) setzt voraus, dass schon die ersten Writes Operationen sind. Die Operationsschicht samt Graph-Logik ist rein und ohne Git testbar: M2.

## Meilensteine

| | Meilenstein | Spec | Detailplan |
| --- | --- | --- | --- |
| M1 | Gerüst, `core`, `store` | §2.1–2.6, §2.9–2.12 (Formate), §2.20, §2.21 (`ci.yml`) | [`2026-11-18-backe-m1-kern.md`](./2026-11-18-backe-m1-kern.md) |
| M2 | Operationen und Graph (`ops`) | §2.6, §2.16.4, §2.16.6, §2.22–2.24 | [`2026-11-18-backe-m2-ops.md`](./2026-11-18-backe-m2-ops.md) |
| M3 | Configs und Kontext (`context`, `git/exec`) | §2.14, §2.15 | [`2026-11-18-backe-m3-kontext.md`](./2026-11-18-backe-m3-kontext.md) |
| M4 | Git-Schicht und Schreibpfad (`git`, `services`) | §2.12, §2.13, §2.16.1 | [`2026-11-19-backe-m4-git.md`](./2026-11-19-backe-m4-git.md) |
| M5a | CLI-Kern (`services`, `cli`): Gerüst, Ausgabe, alle Befehle außer den M5b-Gruppen | §2.4–2.7, §2.9–2.12, §2.14, §2.17, §2.18, §2.22–2.24 | [`2026-11-19-backe-m5a-cli-kern.md`](./2026-11-19-backe-m5a-cli-kern.md) |
| M5b | `attach *` samt Größenlimit und LFS, `repo check\|where\|scan`, `commit` und `issue edit` per `$EDITOR`, `batch`, `doctor`, `config get\|set\|edit` | §2.8, §2.11, §2.13 (Hand-Edits), §2.15.1, §2.16.6 | [`2026-11-19-backe-m5b-werkzeuge.md`](./2026-11-19-backe-m5b-werkzeuge.md) |
| M6 | Sync, Replay, Claim | §2.16.2–2.16.5 | [`2026-11-19-backe-m6-sync.md`](./2026-11-19-backe-m6-sync.md) |
| M7 | MCP-Modus (`mcp`) | §2.19 | [`2026-11-20-backe-m7-mcp.md`](./2026-11-20-backe-m7-mcp.md) |
| M8 | Release | §2.21, README | [`2026-11-20-backe-m8-release.md`](./2026-11-20-backe-m8-release.md) |

### M1 — Gerüst, `core`, `store`

**Liefert:** lauffähiges Projekt (`backe --version`), CI-Workflow, Domain-Typen und zod-Schemas, Zustandsmodell als reine Funktion, IDs samt Kurzform und Sharding, URL-Normalisierung, Namensregeln, YAML-Subset-Parser und kanonischer Serializer, Layout, Laden eines Backlogs von der Platte, JSON Schemas der Configs.

**Produziert für spätere Meilensteine** (Signaturen im Detailplan):
`BackeError`/`ErrorCode`/`EXIT_CODES` · `generateIssueId`, `shardOf`, `resolveShortId` · `planTransition`, `isSettled`, `normalizeStateInput` · `normalizeRepoUrl`, `deriveRepoName` · Schemas `IssueSchema`, `CommentSchema`, `UserSchema`, `ProjectSchema`, `SprintSchema`, `RepoSchema`, `BacklogConfigSchema`, `UserConfigSchema`, `ProjectConfigSchema` · `parseEntityFile`, `serializeEntityFile` · Layout-Funktionen · `loadSnapshot` → `BacklogSnapshot` · `FileChange` + `applyFileChanges`.

**Abnahme:** `mise run check` grün; Coverage-Gate für `src/core/**` und `src/store/**`; CI grün auf beiden Plattformen.

### M2 — Operationen und Graph (`ops`)

**Liefert:** den Typ `Operation` für jede Mutation aus §2.17 (eine Operation je Befehl, als Absicht — §2.16.4), Vorbedingungen und Invarianten, `applyOperation` gegen einen `BacklogSnapshot` (rein: Ergebnis sind `FileChange[]` und der neue Snapshot), Batch mit Platzhaltern und Alles-oder-nichts (§2.16.6), Kodierung für den Trailer `Backe-Op`, Übersetzung von Hand-Edits in Operationen (§2.13), deklarierte Properties (§2.24), Graph-Logik: Zyklen, `dependents`/`children`, bereit, claimbar, Belegung, Auswahl von `next` für `leaf` und `top` (§2.22, §2.23), `rank`-Arithmetik mit Neunummerierung.

**Produziert:** `Operation`, `encodeOp`/`decodeOp`, `parseOpTrailer`, `summarizeOp`/`summarizeBatch`, `substituteIds`/`referencedIds`, `applyOperation(snapshot, op, ctx: ApplyContext): ApplyResult`, `commentsNeeded`, `applyBatch(snapshot, ops, ctx): BatchResult`, `parseBatchInput`, `translateEdits(snapshot, files: EditedFile[], ctx): TranslateResult`, `selectNext(snapshot, query): NextResult`, `matchesContext`, `compareIssues`, `graphOf`, `isReady`, `isUnblockable`, `isClaimable`, `occupyingAncestor`, `rankPlacement`, Property-Funktionen (`checkProps`, `parsePropAssignment`, `parsePropFilter`, `propMatches`, `propViolations`), `checkUserChange` (für `verify`, M4).

**Abnahme:** Unit-Tests aus §5 für Zustandsmodell (Teil `done`-Sperre), `rank`, Batch, Properties, Sub-Issues, Abhängigkeitsgraph und Replay-Vorbedingungen (»Vorbedingung erfüllt, verletzt, kommutativ«) — alle ohne Git. Coverage-Gate für `src/ops/**`.

### M3 — Configs und Kontext (`context`, `git/exec`)

**Liefert:** dünnen Git-Wrapper (`git(args, opts)`, Fehler als `BackeError`), Lesen und kommentarerhaltendes Schreiben der User-Config, Suche von `.backlog.jsonc`/`.backlog.local.jsonc` aufwärts, Kontext-Auflösung mit Quellenangabe für backlog, user, project, sprint, repo nach der Rangfolge von §2.14, Identität → Key über `identities`, Pfad-Expansion (`~`, `BACKE_HOME`) mit `realpath`-Vergleich (Review Focus 5), Backlog-Registry-Funktionen.

**Produziert:** `git(...)`, `gitToplevel`, `gitRemotes`, `resolveContext(input: {cwd, env, flags}): Promise<ResolvedContext>` (jeder Wert mit `source`), `requireWriter`, `readUserConfig`/`updateUserConfig`, `expandPath`, `resolveHomes`, `physicalPath`/`samePath`, `withFileLock` (für `write.lock`, M4), Registry (`listBacklogs`, `findBacklogByRemote`, `registerBacklog`, `useBacklog`, `unregisterBacklog`, `setIdentity`, `workingCopyPath`, `managedClonePath`), `loadRepoRegistry`.

**Abnahme:** Fixture-Verzeichnisbäume für jede Stufe der Rangfolge (§5); Symlink-Fälle aus Review Focus 5. Coverage-Gate für `src/context/**`.

### M4 — Git-Schicht und Schreibpfad (`git`)

**Liefert:** Write-Lock mit Übernahme verwaister Locks (§2.16.1), Prüfung von Branch und Rebase-Zustand, signierter Commit mit `Backe-Actor`/`Backe-Op`, eine Arbeitskopie je Identität (verwaltete Clones per `--reference`, `.git/backe/identity`), `init` samt Vertrauensanker, `backlog clone|add|remove|use|list|show`, `user create-agent` mit `ssh-keygen`, `verify` vollständig (Signatur, Key im Users-Stand des Parents, Actor, Identitätsschutz, Merge-Commits, Anker und Force-Push, Widerruf topologisch, Quarantäne `accept`/`revert`). Der Schreibpfad setzt bei jedem Fehler zwischen Dateischreiben und Commit die betroffenen Pfade zurück (Review Focus 4).

**Produziert:** `executeWrite(ctx, input: WriteInput): Promise<WriteResult>` als einzige Stelle, die Dateien schreibt und committet; `verifyRange(wc, opts)`: `VerifyReport`, `assertVerified`; `ensureWorkingCopy(ctx, handle)`; `initBacklog`, `cloneBacklog`, `addBacklog`, `removeBacklog`, `showBacklog`, `createAgent`, `quarantineCommit` (alle in `src/services/`); Git-Bausteine in `src/git/` (`commitPaths`, `rollbackPaths`, `headState`, Historie, SSH-Keys).

**Abnahme:** Integrationstests aus §5 zu `init`, `clone`, Signaturen, `verify`, Identität je Arbeitskopie (ohne Replay) gegen Bare-Remotes im Temp-Verzeichnis.

### M5a — CLI-Kern

**Liefert:** die Use-Cases als Services (ein Service-Layer für CLI und MCP, §3.7) und die CLI dazu: `context`, `init`, `verify`, `backlog *`, `issue *` ohne `claim`, `next` ohne `--claim`, `comment *`, `project *`, `sprint *`, `repo add|list|rm`, `user *` samt Aliasen (§2.17); Ausgabeformate `text|json|md`, `--fields`, Kopfzeile bei Kontextfiltern, Fehler-JSON, Exit-Codes (§2.18).

**Abnahme:** `mise run check` grün, CI grün auf beiden Plattformen; E2E gegen `dist/cli.js` mit Golden-Files für Text und JSON jeder Befehlsgruppe, Exit-Codes `0`, `2`, `3`, `4`, `5` je mindestens einmal geprüft; Coverage-Gate für `src/services/**`.

**Abgenommen** am 2026-11-19: Abschluss-Review über den ganzen Meilenstein ohne offene Befunde; 1943 Tests grün, Coverage 99,06 % Lines / 94,33 % Branches; CI grün auf `ubuntu-latest` und `macos-latest`. Offene Kleinbefunde stehen unter »Übernommen aus M5a«.

### M5b — Anhänge, Hand-Edits, Werkzeuge

**Liefert:** Anhänge inkl. Größenlimit und LFS-Pflege (§2.8); `repo check [--remote]|where|scan` (§2.11); `backe commit` und `issue edit` per `$EDITOR` (§2.13, Hand-Edits); `batch` (§2.16.6); `doctor`; `config get|set|edit`; die mit `M5b:` markierten übernommenen Punkte.

**Abnahme:** E2E gegen `dist/cli.js` mit Golden-Files für Text und JSON der neuen Befehlsgruppen; Coverage-Gate für `src/services/**`.

**Abgenommen** am 2026-11-19: Abschluss-Review über den ganzen Meilenstein, seine Befunde (ein kritischer, vier wichtige) in einer Fix-Welle behoben und nachgeprüft; 2223 Tests grün, Coverage 98,96 % Lines / 93,64 % Branches; CI grün auf `ubuntu-latest` und `macos-latest`. Offene Kleinbefunde stehen unter »Übernommen aus M5b«.

### M6 — Sync, Replay, Claim

**Liefert:** Sync-Runde (fetch, verify, Fast-Forward oder Replay, push mit bis zu 5 Runden Backoff), Hintergrund-Sync als detached Prozess mit Debounce und Dirty-Flag, Replay mit Konfliktablage und Folgeoperationen, ID-Kollision samt Umschreiben, `manual`-Commits per Cherry-Pick, `sync status|resolve|--interactive`, Frische beim Lesen, synchroner Claim, `next --claim`, `commit --resign`.

**Planentscheidung:** Die Reihenfolge paralleler Pushes steuert ein injizierbares `SyncHooks`-Interface der Services; Integrationstests fahren zwei Service-Instanzen in einem Prozess. Kein Env-Schalter im ausgelieferten Code.

**Abnahme:** Integrationstests aus §5 zu parallelen Änderungen, Zyklen aus zwei sauberen Änderungen, `project.mv` im Replay, Re-Signatur, `manual`-Konflikt, parallelem Claim mit genau einem Gewinner, Debounce, `pull_interval` mit Fake Timers.

**Abgenommen** am 2026-11-20: Abschluss-Review über den ganzen Meilenstein, seine Befunde (ein kritischer, zwei wichtige, dazu die LFS-Timeouts) in einer Fix-Welle behoben und nachgeprüft; 2513 Tests grün, Coverage 98,97 % Lines / 93,23 % Branches. Offene Kleinbefunde stehen unter »Übernommen aus M6«.

### M7 — MCP-Modus

**Liefert:** `backe mcp` über stdio mit den Tools und der Resource aus §2.19, `--allow-delete`, periodischen Sync, Start nur mit auflösbarer Identität.

**Abnahme:** SDK-Client über In-Memory-Transport; Snapshot der Tool-Schemas; Flow create → next → claim → comment → move → review (§5).

**Abgenommen** am 2026-11-20: Abschluss-Review über den ganzen Meilenstein, seine Befunde (ein kritischer, vier wichtige) in einer Fix-Welle behoben und nachgeprüft; 2620 Tests grün, Coverage 98,99 % Lines / 93,38 % Branches; CI grün auf `ubuntu-latest` und `macos-latest`. Offene Kleinbefunde stehen unter »Übernommen aus M7«.

### M8 — Release

**Liefert:** Pack-Smoke-Test und Skript-E2E (init → create → claim → move → verify gegen lokales Bare-Remote) in `ci.yml`, `release.yml` mit release-please und npm Trusted Publishing, Renovate- oder Dependabot-Config, README.

**Abnahme:** CI grün inklusive Pack-Smoke-Test. Der erste `npm publish` ist nach außen gerichtet und läuft erst nach Freigabe durch den User; scheitert der unscoped Name, greift `@spearwolf/backe` (§2.20).

## Übernommen aus M1

Ergebnisse der M1-Reviews, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- ✓ **M2 — vor dem ersten Code gegen `applyOperation`:** Issue-Löschung als reine Operation entscheiden (Snapshot kennt Kommentare/Anhänge nicht, `applyFileChanges` löscht keine Verzeichnisse; Vorschlag: `FileChange`-Variante `recursive`, nur für `issueDir(id)`). → M2, Task 1 und 10
- ✓ **M2:** Snapshot-Ladezeit (gemessen 914 ms für 5 000 Issues, hochgerechnet ~9 s bei 50 000): YAML nur einmal parsen, `readdir` je Issue sparen, paralleles Lesen; Teil-Snapshot/Cache abwägen. → M2, Task 2
- ✓ **M2:** Write-Pfade serialisieren immer validierte Daten **mit** `StoredEntity.extra`, sonst gehen unbekannte Keys verloren. → M2, Task 8 (`Draft.finish`)
- ✓ **M2:** Blocker ersetzen ist eine Edit-Operation (`planTransition` liefert `blocked → blocked` als No-op); `generateIssueId` mit Retry-Grenze und Längenprüfung der Byte-Quelle; `__proto__` in verschachtelten props ablehnen statt still verwerfen; `isPlainObject` im Serializer auf Plain-Objects begrenzen. → M2, Task 1 und 8
- ✓ **M2:** `.git`-Segment-Check in `assertRelative` case-insensitiv (macOS/APFS), NTFS-Aliase für später notieren. → M2, Task 1
- ✓ **M3:** JSON Schemas tragen die `.refine`-Prüfungen nicht (als `.regex()` nachziehen), eigenes Schema für `.backlog.local.jsonc`; `UserConfig.current`, `ProjectConfig.backlog`, `backlogs.*.remote` beschränken; ProjectConfig-Werte formal prüfen (`isProjectPath` usw.). → M3, Task 1
- ✓ **M4:** Symlinks schreib- und leseseitig; `rm(tmp)` im Fehlerpfad darf den Originalfehler nicht maskieren; Major-`version` der Backlog-Config → Writes verweigern (§2.15.3). → M4, Task 1 und 8
- ✓ **M5a:** `resolveShortId` — exakter Suffix-Treffer vor Mehrdeutigkeit, Groß-/Kleinschreibung ignorieren, volle ID ohne Treffer sauber melden; Fehlercodes `usage` vs. `validation` vereinheitlichen. → M5a, Task 1
- ✓ **M5b:** Groß-/Kleinschreibung im URL-Pfad (`github.com/Acme/WebApp`) entscheiden; Git-Argv immer mit `--`; Query/Fragment in Repo-URLs; `listIssueIds`/`listComments` Eingabeform prüfen; Ref-Validierung nach `git check-ref-format`. → M5b, Task 1
- **M8:** `ci.yml` mit `permissions: contents: read`; `packageManager`-Feld.

## Übernommen aus M2

Offene Punkte aus den Reviews von M2, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- ✓ **Spec-Fragen (vor M4):** Handle-Wiederverwendung nach `user.rm` — ein neuer User erbt die Autorschaft alter Kommentare (§2.13 Punkt 4); Keys sind nicht eindeutig über Users; ein User kann per `entity.edit` einen eigenen Key aus `revoked_keys` zurückholen; ein Operator kann seinen Agent ohne Zustimmung weitergeben; ein Admin kann »Operator ist Mensch« über einen `kind`-Wechsel des Operators umgehen. → M4, Abschnitt »Spec-Fragen aus M2«, Task 6
- ✓ **Spec-Frage (vor M5, `next`):** `parent` und `depends_on` über Kreuz zwischen Vorfahre und Nachfahre ergeben einen Stillstand ohne `cycle`-Fehler; §2.23 erlaubt beides ausdrücklich. Vorschlag: `depends_on` zwischen Vorfahre und Nachfahre als `cycle` ablehnen. Ebenso: »kein `done`-Parent mit offenen Sub-Issues« wird nur beim Übergang geprüft, nicht beim Anlegen, Umhängen oder Wiedereröffnen eines Kindes. → M5a, Task 2
- ✓ **M4:** `verify` nutzt `checkUserChange` (Admin-Rechte nur für existierende menschliche User; Nicht-Admins legen keine Handles aus `config.admins` an — seit M2 umgesetzt) mit dem Stand nach der Änderung und ruft es für jede Änderung an `users/<handle>.md` auf, auch für Body und unbekannte Keys; Trailer-Bytes nie vergleichen, nur dekodierte Operationen (`decodeOp` akzeptiert nicht-kanonisches JSON); `issue.md` als Symlink wird seit M2 gelesen statt übersprungen; `mapPool` in `loadSnapshot` liest nach einem Fehler weiter. → M4, Task 1, 9 und 10
- ✓ **M5a:** `project.mv` lässt eine kaputte Unterprojekt-Datei am alten Pfad zurück; geordnetes Enum mit zahlenartigen Werten (`"01"`) fällt bei `>=`/`<=` durch; `-0` gelangt über `decodeOp` in `props` (im PropValue-Schema ablehnen); `reason_file` ohne `reason` bleibt in `recorded` (im Schema verbieten); ein rank-Anker auf einer kaputten Datei meldet `missing_ref` statt `schema`, `issue.link` mit URL weicht dabei von `repo.add` ab. → M5a, Task 2
- ✓ **M5a:** CLI-Flags stehen in Hints der `ops`-Schicht. → M5a, Festlegung »Hints mit CLI-Flags in `ops`/`context`« (bleiben; die Übersetzung für MCP entscheidet M7)
- ✓ **M5b:** Batch-Laufzeit wächst mit O(k·n) (jede Operation materialisiert `d.snapshot`; 1 000 Creates auf 20 000 Issues ≈ 2,5 s), dazu quadratisches `topoOrder` in `translate`; `backe commit` ersetzt die Arbeitskopie durch die kanonischen Changes (Mengen-Differenz ändert Listen-Reihenfolge) und legt die Commit-Strategie für gemischte Ergebnisse (`ops` + `manual`) fest — Ops, die auf `manual`-Dateien verweisen, scheitern sonst mit `missing_ref`; getauschte Parents zweier Issues in einem Hand-Edit scheitern ID-abhängig an `cycle`; `user.rm` lässt `lead`/`assignee` hängen (Hinweis in `doctor`). → M5b, Task 3, 4, 8
- **M6:** `commentsNeeded` deckt vorgegebene Kommentarnamen (`comment.add.file`, `reason_file`, `blocker_comments`) nicht ab — beim Replay würde ein vorhandener Kommentar still überschrieben; `issue.resume` kennt kein »Ziel erreicht → No-op« (Scheinkonflikt bei zwei parallelen Resumes, Vorschlag: `to*` aufzeichnen); ein `move` nach `blocked` über eine bestehende Blockade verwirft neue Blocker still; `issue.link` mit `url` zeichnet den abgeleiteten Repo-Namen nicht auf; `substituteIds`/`referencedIds` schreiben nach Feldnamen um (Test über alle Varianten); Replay-Tests sollen `decodeOp(encodeOp(recorded))` anwenden statt der Operation im Speicher.
- **Doku nach Abnahme:** `backe.md` §2.16.4 (Beispiele `issue.body`, `issue.rank` ohne `from`, `comment.add` ohne `body`), §2.24 (`issue.prop`) und §2.13 (Hand-Edits nennen `issue.body`) an den Operationskatalog angleichen; die M2-Planentscheidungen als Präzisierung übernehmen.

## Übernommen aus M3

Offene Punkte aus den Reviews von M3, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- ✓ **M4 — vor `write.lock`:** `withFileLock` übernimmt verwaiste Locks nur per PID — über PID-Namespaces und Hosts hinweg (geteiltes `~/.backe` mit Devcontainer, NFS-Home) gilt ein lebender fremder Halter als tot, nach einem Reboot mit wiederverwendeter PID bleibt ein Lock gehalten. Vorschlag: Hostname als dritte Zeile, automatische Übernahme nur bei gleichem Host, Lock mit Zeitstempel vor dem Boot ist verwaist, fremder Host → `conflict` mit Hint. Restgrenzen des mtime-Leases auf `<lock>.reap` dokumentieren (Reaper > 10 s angehalten, stat-then-unlink bei drei Konkurrenten, unbedingte Freigabe), `ORPHANED_REAP_MS` (10 s) > `timeoutMs` (5 s), Temp-Dateien nach Absturz, `link` ohne Hardlink-Support (EPERM/ENOTSUP → `BackeError` mit Hint), Lock ohne lesbare PID → Hint »falls kein backe-Prozess läuft: <pfad> löschen«. Lock-Reihenfolge festlegen (`write.lock` vor `config.lock`); `withFileLock` ist nicht reentrant — Sync innerhalb von `executeWrite` darf denselben Lock nicht erneut holen. → M4, Task 2 (Temp-Dateien nach Absturz räumt `doctor`, M5b)
- ✓ **M4 — Identität je Arbeitskopie:** `requireWriter` lehnt seit M3 eine gebundene Arbeitskopie ab, die laut User-Config einem anderen Handle gehört; `.git/backe/identity` schon bei Clone und `backlog add` setzen und beim Write prüfen (§2.16.1). `registerBacklog` überschreibt bei gleichem Handle einen anderen Pfad still — für `backlog add` `conflict` oder ausdrückliches Umbinden entscheiden. `--purge` löscht außerhalb des Config-Locks (Race mit parallelem Clone). → M4, Task 8, 11 und 12
- ✓ **M4 — Git:** `gitToplevel` macht aus jedem Exit 128 »kein Repo«, auch aus »dubious ownership« (`safe.directory`) — nur bei `not a git repository` `undefined`, sonst werfen. `git()` nimmt `HOME`/`SSH_AUTH_SOCK` aus `process.env`; die Signing-Umgebung legt M4 fest. `writeFileAtomic` ersetzt eine per Symlink eingebundene `config.jsonc` durch eine reguläre Datei und setzt den Modus zurück (gehört zu »Symlinks schreib- und leseseitig«). → M4, Task 1 und 5
- ✓ **M5a:** `findProjectConfig` liest beide Dateien per `Promise.all` — Fehlerreihenfolge nichtdeterministisch (Golden Files); rohe Node-Fehler statt `BackeError` (`physicalPath` mit ENOTDIR, `exists()` schluckt EACCES, `readBacklogName`/`readdir`, `ownerOf` bei kaputten fremden `paths`); `gitToplevel(cwd)` zweimal; Anführungszeichen uneinheitlich (`»…«` vs. `"…"`); `schemaError` gehört nicht nach `user-config.ts`. → M5a, Task 1
- ✓ **M5a:** Meldungen der `context`-Schicht nennen CLI-Flags (`--path`, `--user`). → M5a, Festlegung »Hints mit CLI-Flags in `ops`/`context`« (bleiben; die Übersetzung für MCP entscheidet M7)
- ✓ **M5b:** JSONC-Edit, dessen Ergebnis ungültig ist (Komma am Zeilenanfang), als `unexpected` »Edit konnte nicht angewendet werden« melden statt die Datei zu beschuldigen (`config set`); `normalizeRepoUrl` ist auf der kanonischen Form nicht idempotent (Falle für `repo where`/`scan`); `loadRepoRegistry` läuft bei jeder Auflösung; der Hint `backe backlog list` erscheint auch bei einem Pfad. → M5b, Task 1
- **M8:** Biome meldet 9 `noNonNullAssertion`-Warnungen in `resolve.test.ts` (`s.env.HOME!`) — durch `s.at('home/…')` ersetzen.

## Übernommen aus M4

Offene Punkte aus den Reviews von M4, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- **M6 — vor dem ersten Sync (Pflicht):**
  - ✓ **Folge-Commits auf verseuchten Pfaden.** Solange `verify` den Stand einfriert (ein ungültiger Commit ist offen), gilt ein späterer Commit noch als gültig, wenn er auf einem Pfad aufbaut, den der ungültige Commit verändert hat. Beispiel: B setzt `operator: eve` beim Agent von spw, C trägt Eves Key beim Agent ein. Die Rechte werden aus Cs echtem Parent B gelesen. Lösung: Ist der Stand eingefroren, ist eine Änderung an einem Pfad, dessen Inhalt im Parent vom eingefrorenen Stand abweicht, selbst ein Grund (»baut auf ungültigem Commit <kurz> auf«). → M6, Task 1
  - ✓ `trustedMode` beim Clone liest den Verify-Modus im Parent des ersten *verbliebenen* ungültigen Commits statt aus dem eingefrorenen Stand. Lösung: denselben Gang wie in `verify` nutzen. → M6, Task 1
  - ✓ `checkSigningKey` in `executeWrite` prüft gegen HEAD, `verify` gegen den eingefrorenen Stand. Ist ein ungültiger Commit offen, erzeugen neue User und rotierte Keys lokal angenommene, aber von `verify` abgelehnte Commits. → M6, Task 2
- **M6 — Sync:**
  - ✓ Arbeitskopien eines Backlogs ohne Remote: `origin` zeigt auf eine nicht-bare Geschwister-Arbeitskopie, ein Push dorthin wird abgelehnt. → M6, Task 6
  - ✓ Ein Agent, dessen `user.add` noch nicht gepusht ist, kann in einem frischen Clone nicht schreiben. Sync oder Hinweis nötig. → M6, Task 6
  - ✓ Die Abstammungsprüfung beim Clone gegen `verified` einer vertrauten Arbeitskopie schlägt fehl, sobald `verified` auf ungepushte lokale Commits zeigen kann. → M6, Task 1
  - ✓ Die Signal-Verzögerung in `executeWrite` hält nur das erste Signal zurück und verträgt keine eigenen `SIGINT`-Listener von CLI oder MCP. Beides muss mit diesem Mechanismus zusammenarbeiten. → M6, Task 2
- **M5a — CLI und Services:**
  - ✓ `init` und `backlog add` verlangen absolute Pfade. Die CLI expandiert `~` und relative Pfade gegen das cwd. → M5a, Task 12
  - ✓ Die Formatversion wird beim Clone nicht geprüft. → M5a, Task 4
  - ✓ Nach einem gescheiterten finalen Move bleibt die Registrierung stehen. → M5a, Task 4
  - ✓ `addBacklog` schreibt Identität und Anker vor `verify` und Registrierung. → M5a, Task 4
  - ✓ Ein verschlüsselter Private Key ohne `.pub` daneben ergibt `unexpected` statt `usage` mit Hinweis. → M5a, Task 3
  - ✓ Nach einem gescheiterten Index-Abgleich ist der Dirty-Hinweis irreführend. Richtig wäre `reset -q -- <pfade>` bzw. `restore --staged --worktree`. → M5a, Task 3
  - ✓ `landedCommit` sollte zusätzlich `Backe-Actor` oder die Message vergleichen. → M5a, Task 3
  - ✓ Ein leerer Quarantäne-Grund kommt bisher aus dem Service; die CLI soll ihn vorab prüfen. → M5a, Task 12
- **M5b — Hand-Edits:**
  - ✓ Manuelle Writes haben keine HEAD-Vorbedingung, damit sind Lost Updates möglich. Festlegen zusammen mit `backe commit`. → M5b, Task 4
- **M5b — `doctor`:**
  - ✓ Mindestversion Git 2.38, wegen `cat-file -Z`; die Spec nennt 2.34 »ungeprüft«. → M5b, Task 8
  - ✓ Liegengebliebene `tmp/clone-*` und Lock-Temp-Dateien abgestürzter Prozesse. → M5b, Task 8
  - ✓ Kaputte Alternates von Clones, die mit `--reference` angelegt wurden. → M5b, Task 8
  - ✓ Gebundene Pfade, die nicht mehr existieren. → M5b, Task 8
- **M8:** Biome meldet weiter 9 `noNonNullAssertion` in `resolve.test.ts`. Offene Kleinigkeiten aus den Task-Reviews:
  - `foreignHost()` herausziehen;
  - Test für die Boot-Toleranz;
  - `headState` startet etwa 12 Prozesse;
  - `GIT_OPTIONAL_LOCKS=0`;
  - Hooks bei `update-ref`;
  - doppelte Test-Helfer;
  - Cache-Version für `allowed_signers`;
  - Mode-Bits bei der Umkehr;
  - Admin-Prädikat mehrfach;
  - `showBacklog` per `samePath` und nur Handles;
  - Testlücken (Status `B`, Key im selben Commit, Gruppierung).
- **Doku nach Abnahme:**
  - `backe.md` §2.12 und §2.13 um die Identitätsregeln ergänzen:
    - Handle-Wiederverwendung nur durch Admins;
    - Keys eindeutig;
    - Widerruf endgültig und nur für eigene Keys;
    - `operator` ändern nur Admins;
    - ein Operator bleibt Mensch.
  - Dazu die Verify-Regeln:
    - eingefrorener Stand nach einem ungültigen Commit;
    - maßgebliche Quarantäne;
    - nur SSH-Signaturen, an den Prinzipal gebunden;
    - Symlinks und Submodule ungültig;
    - Groß-/Kleinschreibungs-Varianten ungültig;
    - Kommentar-`author` passt zum Dateinamen und ist unveränderlich.
  - Format von `.backe/quarantine.jsonc` festhalten. Git-Mindestversion 2.38 eintragen.
  - Aus M5a: §2.12 (`keys` darf fehlen — kein aktiver Key, der User kann nicht signieren), §2.7 (Kommentare derselben Sekunde ordnet der Dateiname), §2.18 (Fehlercodes `usage`/`validation`, Hinweise und Warnungen im JSON-Modus nur im Objekt); dazu die M5a-Zeilen der Planentscheidungen als Präzisierung.

## Übernommen aus M5a

Offene Punkte aus den Reviews von M5a, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- **M5b — Verhalten:**
  - ✓ `issue edit` mit lauter unveränderten Werten ist `usage` »Nichts zu ändern«, `issue move` in den aktuellen State dagegen `unverändert`/Exit 0. Zusammen mit `issue edit` per `$EDITOR` entscheiden; vermutlich richtig: ohne Flags `usage`, mit wirkungslosen Flags idempotent `unverändert`. → M5b, Task 5
  - ✓ `issue link`: Ein registriertes Repo namens `git` macht `git@host:pfad` zu Repo plus Ref. Ein Ref mit `:` ist laut `git check-ref-format` ungültig; der Repo-Zweig soll `:` im Ref ausschließen. → M5b, Task 1
  - ✓ `issue show`: Kind-Zeilen ohne Assignee-Spalte (`IssueRefView` trägt keinen Assignee). → M5b, Task 2
  - ✓ `user show` druckt `widerrufen ?`, wenn ein Eintrag in `revoked_keys` keinen Zeitstempel hat (Hand-Edit) — Klammer weglassen. → M5b, Task 2
  - ✓ `project list` zählt offene Issues direkt, `project show` rekursiv; die Spalte benennen oder in der Doku erklären. → M5b, Task 2
  - ✓ `safeText` lässt Format- und Bidi-Zeichen (`\p{Cf}`, etwa U+202E) durch. → M5b, Task 2
  - ✓ `backlog remove --purge` prüft nur den Sync-Branch; ungepushte Arbeit auf anderen lokalen Branches ist nicht geschützt. → M5b, Task 2
  - ✓ Die rekursive snake_case-Umwandlung von Fehler-`details` würde künftige Maps mit Nutzer-Keys (etwa Property-Keys) umbenennen. → M5b, Task 2
  - ✓ `readPublicKey` meldet jedes Scheitern von `ssh-keygen -y` an einem OpenSSH-Key als »verschlüsselt«, auch einen kaputten Key oder ein fehlendes Binary. → M5b, Task 2
  - ✓ `revertBinding` setzt ein von `registerBacklog` gesetztes `current` nicht zurück; `wasRegistered` in `cloneBacklog` wird außerhalb des Config-Locks gelesen. → M5b, Task 2
  - ✓ `checkPropFilter` nennt in Meldungen `f.value` statt `f.raw` (`level>=1` statt `level>=01`). → M5b, Task 2
  - ✓ Fehlermeldungen der CLI setzen Flag-Namen uneinheitlich in `»…«`. → M5b, Task 2
- **M8 — Aufräumen und Testlücken:**
  - Doppelte Helfer: `isMissing` in `store/snapshot.ts` und `context/project-config.ts`; eigenes `exists` in `git/repo.ts` und `git/ssh.ts` (Schichtgrenze); Code-Unit-Comparatoren in mehreren Services statt `byCodeUnit`; Notice-Helfer liegen in `ops/next.ts` statt `ops/notice.ts`; `listSort` und `STATE_ORDER` an neutralere Orte.
  - `working-copy.ts` prüft an zwei Stellen nur `ENOENT`, `ENOTDIR` kommt roh durch.
  - Doc-Kommentar in `core/errors.ts` ohne »stdin doppelt verlangt«; `test/conventions.test.ts` prüft nur einzeilige `"${…}"` (Scope-Kommentar fehlt).
  - Der Zweig `allowSettledParent` ist über echte Operationen nicht erreichbar, sein Test beweist den Bypass nicht.
  - Testlücken: Reparent mit Enkel; `derive` mit No-op und Hinweisen; vorhandener Anker überlebt gescheitertes `verify`; `assign` mit fremdem Handle und ohne Änderung; `reopen --to done`; der `ambiguous`-Zweig in `revokeKey`; Rethrow-Zweig in `readPublicKey` (PEM); `--comments <n>`-Kürzung im Golden.
  - Testhygiene: `as never` statt typisierter `Operation[]` in mehreren Tests; feste Zeitstempel neben Echtzeit im `sort created`-Test; `userWithTwoKeys` baut den zweiten Key per String-Ersetzung; der Kommentar-Konflikttest hängt an der Aufrufreihenfolge von `deps.now` in `plan()`.
  - Kleinigkeiten: redundantes `from ?? null` und toter `not_found`-Zweig in `issues.ts`; `FilterSource` ohne Konsument; `landedCommit` vergleicht `Backe-Op` nicht; `fromCommander`-Hint fällt auf `backe` zurück, wenn eine Gruppe ohne `subcommand()` entsteht; `parentFlags` in `defineEdit` wird je Programminstanz nicht zurückgesetzt; `sprint show` ist eine lange Aktion.

## Übernommen aus M5b

Offene Punkte aus den Reviews von M5b, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- **M6 — Schreibpfad und LFS:**
  - ✓ Renormalisierte Anhänge (Umstieg auf LFS) stehen nicht im Write-Journal; stirbt der Prozess zwischen `update-ref` und Index-Abgleich, bleiben sie staged. → M6, Task 2
  - ✓ `landedChain` erkennt einen gelandeten Commit mit LFS-Anhang nie (geplante Bytes gegen Pointer-Blob). → M6, Task 2
  - ✓ `attach get` liefert in einer Arbeitskopie ohne `git lfs pull` den Pointer-Text; nach Clone/Sync Objekte holen oder den Pointer erkennen. → M6, Task 10
  - ✓ Fallback `git lfs install --local --skip-repo` (fremder Hook) installiert keinen pre-push-Hook; der Sync muss LFS-Objekte selbst pushen. → M6, Task 6
  - ✓ Hand-Edits werden gegen `HEAD` auf Policy geprüft, `verify` gegen seinen ggf. eingefrorenen Stand; beide können dann abweichen. → M6, Task 2
  - ✓ `checkFormatVersion` liest bei `edits` die Config der Arbeitskopie statt der aus `HEAD`. → M6, Task 2
- **M8 — Aufräumen und Testlücken:**
  - `%(refname:short)` beim Purge kann bei gleichnamigem Tag `heads/<b>` liefern (`%(refname:lstrip=2)`); `unpushedCount` ohne Produktions-Aufrufer; toter Zweig für `revoked` ohne Zeitstempel in `user show`.
  - `readPublicKey` mit leerem stderr endet auf »nicht lesbar: «; `verify` prüft unbekannte Keys nicht in Kommentaren; JSON von `verify` lässt `unknown_keys` leer weg, `prop_notices` nicht.
  - Pfadmuster `issues/<x>/<id>/issue.md` an drei Stellen zerlegt; Graph-Patch baut betroffene Listen je Operation neu; `ensureLfsRule` liest `d.snapshot`.
  - Journal-Recovery einer gelandeten `edits`-Kette setzt `no_effect`-Pfade nicht zurück; Journal trägt Vorher-Bytes base64 (groß bei Anhängen); LFS-Idempotenz nur über `filter.lfs.process`; `unsettled.paths` nennt alle Pfade.
  - `dirtyPaths`/`rollbackPaths` übergeben Pfade als argv (ARG_MAX bei sehr vielen Anhängen); `attach add` liest die ganze Quelle vor der Größenprüfung und kopiert sie.
  - `addAttachment` nicht `async`; `entry.url as string`; Batch meldet einen Schemafehler einer späten Zeile vor einer verbotenen Operation einer früheren.
  - `git()`-Timeout beendet nur das direkte Kind; gescheiterte GitHub-Abfragen werden nicht gecacht; `repo scan` ohne `--force` wendet »first-by-path« nicht an; ungültiger Issue-Ref auf ein nicht registriertes Repo fällt still weg.
  - `doctor`: `stateDir()` kann `.git/backe` anlegen; execFile-Timeout zählt als »fehlt«; lokales `git` überschattet den Import.
  - `config`: Schema-Drift (Nicht-String-Blatt) wirft einen rohen Fehler; alter Entwurf bleibt nach unverändertem Edit liegen; `readText` doppelt; `getConfig` liest zweimal.
  - URL ohne Schema mit `.git` (`github.com/a/b.git`) behält `.git`; relativer Pfad `a/b` gilt als Repo-URL; Backlogs, die vor dem LFS-Fix schon roh committete Anhänge unter der Regel hatten, heilt nichts.
  - Testlücken: Identity-`fail` bei kaputter `.git/config`, `doctor --fix` per E2E, Golden für `repo scan` `differs`/`überschrieben`, Temp-Datei des Editors nach Erfolg und Modus `0o600`, Text-Ausgabe von `attach add --json`, `attach get -o` auf vorhandene Datei/Verzeichnis, vakuöse Zeilen in `tools.test.ts`.

## Übernommen aus M6

Offene Punkte aus den Reviews von M6, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- **M7 — MCP-Modus:**
  - ✓ `notices` hat im JSON zwei Formen (Strings bei `sync`, Objekte sonst); der MCP-Adapter braucht eine. → M7, Festlegung »`notices` (M6)«
- **M8 — Aufräumen, Tests, Robustheit:**
  - ✓ Resign verwirft eine reine Claim-Einheit still (`claim_lost` wird ignoriert); `assertClaimed` sollte an `round.claimSha === undefined` hängen. → M6, Abschluss-Review
  - `taintKeys` nennt nur das primäre Subjekt (`project.mv.to`, `project.rm.reassign`; Projektlisten sind nicht belastet); `repo.add` ohne Name belastet `repo:<url>`.
  - Hub auf ein später ergänztes echtes Remote umhängen (Roadmap-Punkt aus dem Detailplan; bisher hängt `backe` nichts automatisch um).
  - `verify` prüft nicht, ob ein Quarantäne-Eintrag `reverted` die Änderungen tatsächlich umgekehrt hat (bestehende Lücke).
  - Im Modus `warn` mit ungültigem eingehendem Commit prüft jede Runde erneut und wiederholt die Warnungen.
  - ✓ `git lfs push` läuft ohne Timeout; `setUpLfs` im LFS-Pull läuft außerhalb des Write-Locks. → M6, Abschluss-Review
  - Bricht der Sync im lokalen Abschnitt ab (auch mit `verify`), steht `upstream` schon auf `tip`.
  - `ClaimOutcome.commit` kann auf einen weggefallenen Commit zeigen, wenn ein Claim im Replay ohne Wirkung entfällt.
  - Testlücken: Push-Timeout, LFS-Fehlerpfade, Signal-Aufschub im Sync, `scheduleDeferred`-Guard, LFS-Pull-Fehler nach Clone, Pointer-Präfix-Test mit `lfs: on`, Taint über erzeugte IDs, Widerruf im Parent-Stand bei `readUnits`.

## Übernommen aus M7

Offene Punkte aus den Reviews von M7, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- **M8 — Doku:**
  - `backe.md` §2.19 »Ende« und die Planentscheidung dazu nennen nur das Ende von stdin; der Server endet auch, wenn der Transport sich selbst schließt (etwa nach einem stdout-Fehler).
- **M8 — Aufräumen, Tests, Robustheit:**
  - Lesende Tools planen den Hintergrund-Sync vor der Prüfung von `fields`; die CLI prüft `--fields` vorher. Harmlos (kein Write), aber uneinheitlich.
  - `attachment_add`: kleines TOCTOU-Fenster zwischen Pfadprüfung und `readFile`; `EACCES`/`ELOOP` aus `physicalPath` enden als `unexpected` statt mit Meldung. `attachSource` dupliziert etwa 15 Zeilen von `sourceOf` der CLI — beide in einen gemeinsamen Lader in `services/attachments.ts` ziehen, samt Pfadbegrenzung.
  - Resource `backe://issue/{id}` plant den Read-Sync selbst statt über `defineTool`; `issue show` ruft `pickFields(…, SHOW_FIELDS)` inline statt einer Ansicht `issueShowJson`.
  - `DEFAULT_PULL_INTERVAL` in `src/mcp/sync-tools.ts` dupliziert den Schema-Default; `toolResult(undefined)` ergäbe einen Content-Block ohne `text` (kein Tool liefert `undefined`).
  - Fehler aus `handle.close()`/`mcp.close()` nach dem Ende von stdin sind weder getestet noch dokumentiert.
  - Testlücken und -härte: der stdout-E2E fährt keinen Pfad mit Kindprozess (Backlog ohne Remote); der E2E liest das private Feld `_process` von `StdioClientTransport` ohne Guard; der `onerror`-Test hängt am Wortlaut einer SDK-Meldung; die Gegenproben für den Zwei-Takt-Sync und das stdio-Ende scheitern nur per Timeout; die Spawn-Zählung nach einem wirkungslosen `issue_move` ist nur einen Microtask stark; der Test »sync neben der Warteschlange« zählt nur Enqueues; der `build`-Test zeigt nicht, dass zwei Instanzen unabhängig arbeiten; der Sortier-Test prüft nur das erste Issue; `issue_rank` mit `top: false` allein ist ungetestet; `as never` in `read-tools.test.ts`; überflüssiger `&&`-Guard im `nextJson`-Test.
  - Der Konventionstest für stdout fängt `import { stdout } from 'node:process'` und `console.dir`/`console.table` nicht; `stdio.test.ts` liegt unter `src/mcp/` statt unter `test/`.

## Planentscheidungen

Stellen, die der Spec offenlässt und die dieser Plan festlegt. Nach Abnahme des jeweiligen Meilensteins wandern sie als Präzisierung in `backe.md`.

| Stelle | Festlegung | Meilenstein |
| --- | --- | --- |
| §2.3 YAML-Subset | Kommentare im Frontmatter sind kein Teil des Subsets → Fehler mit `datei:zeile` | M1 |
| §2.3 Flow-Sequenz »passt in eine Zeile« | Zeile `key: [a, b]` ≤ 100 Zeichen | M1 |
| §2.3 Key-Reihenfolge | bekannte Keys (Schema-Reihenfolge) → unbekannte Keys (Originalreihenfolge) → `props` | M1 |
| §2.3 vs. §2.4 Body | Beim Write normalisiert `backe` Zeilenenden und Schluss-Newline auch im Body; sonst bleibt er unberührt | M1 |
| §2.4 `title` 1–200 Zeichen | gezählt in Unicode-Codepoints, keine Zeilenumbrüche | M1 |
| §2.6 `workflow.strict` aus `blocked`/`on_hold` | Nachbarschaft gemessen an `paused_from` | M1 |
| §2.6 Move in den aktuellen State | No-op ohne Commit, Exit-Code 0 | M1/M5a |
| §2.10, §2.11 Slugs | Sprint-Slug `[a-z0-9][a-z0-9-]{0,63}`; Repo-Name `[a-z0-9][a-z0-9._-]{0,63}` | M1 |
| `loadSnapshot` mit kaputter Datei | Entität wird übersprungen und als Problem gemeldet; Writes auf sie scheitern mit Exit-Code 2 | M1 |
| §2.11 Cache-TTL für `repo check` | 24 h | M5b |
| §2.13, §2.16.4, §2.24 Operationsnamen | `issue.prop` und `issue.body` sind die Abschnitte `props` und `body` von `issue.edit` — sonst wäre `issue edit` mit mehreren Flags mehr als eine Operation; `issue assign` ist `issue.edit` mit `set.assignee`, `user create-agent` ist `user.add` | M2 |
| §2.16.4 Inhalt einer Operation | Operationen tragen ihre Nutzlast selbst (Issue-Body, Kommentartext); erzeugte Werte (Issue-ID, `created`, Kommentar-Dateinamen, Repo-Name) stehen in der aufgezeichneten Operation. Anhangsinhalte nicht — die liest das Replay aus dem Ursprungs-Commit | M2/M6 |
| §2.13 Trailer ohne Operation | `init` (Vertrauensanker, wird nie replayt) trägt `Backe-Op: init`, Quarantäne-Commits von `verify` tragen `manual` | M2/M4 |
| §2.16.4 Vorbedingung | Zielwert schon erreicht → No-op; sonst Ist-Wert ≠ `from` → Konflikt | M2 |
| §2.16.4 Invarianten | geprüft wird nur, was die Operation neu einführt: neue Referenzen auf Issues, Projekte, Sprints, Repos und Users, neue Kanten (Zyklen), geänderte Properties | M2 |
| §2.18 Exit-Codes der Operationen | verletzte Vorbedingung, `done`-Sperre, fehlendes `--force`/`--orphan`/`--recursive`, Belegung, nicht claimbar, existiert schon, Admin entfernen → 4; fehlende Referenz → 3; Zyklus, Policy, Schema, Property, Übergang, Größe → 2 | M2 |
| §2.4 `repos` | höchstens ein Eintrag je Repo-Name; `issue link` ersetzt den Ref | M2 |
| §2.17 `issue create` | ohne `--state` → `backlog`; `projects`/`sprints`/`repos` ohne Angabe erben vom Parent, `[]` heißt leer — auch im Batch | M2 |
| §2.22 `rank` | `--top` = kleinster Rank − 1000, `--bottom` = größter + 1000, ohne gerankte Issues 1000; Anker ohne `rank` → Exit-Code 2; Neunummerierung nach dem Fensterverfahren (M2-Detailplan, Task 5) | M2 |
| §2.23 Belegung | nur durch einen Vorfahren in `in_progress`/`review` mit **gesetztem** Assignee ≠ ich | M2 |
| §2.16.5 Claim | bereit nach den Regeln von `--level top`: offene Sub-Issues schließen den Claim nicht aus | M2 |
| §2.22 `next` | eigenes `in_progress` nur im Kontext; »Topologie« = Zahl offener transitiver `dependents`; Grund ohne Kandidat in der Rangfolge wartend → alles vergeben → alles blockiert → nichts offen | M2 |
| §2.9, §2.11, §2.12 Entfernen | `project rm` mit Unterprojekten, `repo rm` mit referenzierenden Issues, `user rm` eines Admins → Exit-Code 4 | M2 |
| §2.13 Hand-Edits | eine Datei wird ganz übersetzt oder ganz `manual`; `manual` sind Anhänge, neue oder geänderte unbekannte Keys, `.backe/**` und Dateien außerhalb des Layouts; reines Umsortieren einer Liste ist keine Änderung | M2 |
| Snapshot-Cache | keiner; Wiedervorlage, wenn `loadSnapshot` nach M2 bei 10 000 Issues über 1 s liegt | M2 |
| §2.14 Projekt-Config-Suche | aufwärts ab dem physischen Pfad (`realpath` von `cwd`), wie Git — ein Symlink führt nicht zu einer anderen Config | M3 |
| §2.14 Leere Werte | leere Umgebungsvariable = nicht gesetzt; leerer Flag-Wert → Exit-Code 2 | M3 |
| §2.14 Backlog-Wert | Name (`BACKLOG_NAME_RE`) → Pfad (`/`, `./`, `../`, `~`; nur Flag und Env) → Repo-URL; Pfad und Backlog-Repo binden die Arbeitskopie ohne Registrierung; unbekannter Name → 3, unregistrierte URL → 3 mit `backe backlog clone`-Hint, kein Backlog → 2 | M3 |
| §2.14 Backlog-Repo als Quelle | aus `.backe/backlog.jsonc` wird nur `name` gelesen, damit ein Backlog neuerer Formatversion lesbar bleibt | M3 |
| §2.14 Repo über Remotes | `origin` zuerst, dann nach Remote-Name; der erste Remote mit registrierter kanonischer URL gewinnt | M3 |
| §2.15.1 Felder | `project` und `sprint` global und je `backlogs.*` (§2.14 nennt beide Stufen); relative Pfade in der User-Config gelten relativ zu `BACKE_HOME`, `~name` wird nicht unterstützt; relatives `BACKE_HOME` relativ zu `cwd` | M3 |
| §2.15.1 Schreiben | kommentarerhaltend per `jsonc-parser`, serialisiert über `<BACKE_HOME>/config.lock` (verwaiste Locks toter PIDs werden übernommen, sonst nach 5 s Exit-Code 4); die erste Registrierung setzt `current` | M3 |
| §2.16.1 Lese-Wurzel | eigene Arbeitskopie, sonst eine andere vorhandene Arbeitskopie desselben Backlogs; geschrieben wird nur in die eigene | M3 |
| §2.14 Projekt-Config eines anderen Backlogs | Nennt eine Projekt-Config-Ebene (`.local` über geteilt gemergt) per Name oder kanonischer URL einen anderen als den aufgelösten Backlog, zählt sie für user, project, sprint und repo nicht; eine Ebene ohne `backlog` gilt für jeden | M3 |
| §2.16.1 Fremde Arbeitskopie | Gehört die gebundene Arbeitskopie (Pfad-Flag/Env oder Backlog-Repo) laut User-Config einem anderen Handle, lehnt der Schreibpfad mit Exit-Code 2 und dem Pfad der eigenen Arbeitskopie ab — schon vor dem ersten Write | M3 |
| §2.15.1 `~name` | `~name/…` in Pfaden der User-Config ist ein Schemafehler mit Key-Pfad; nur `~` und `~/…` werden expandiert | M3 |
| Git-Umgebung | `git()` erbt keine repo-lokalen Git-Variablen (Liste aus `git rev-parse --local-env-vars`, etwa `GIT_DIR` in Hooks) und läuft mit `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`; explizit übergebene Werte gelten weiter | M3 |
| §2.20 Schichten | `executeWrite`, `verify` und die Backlog-Verwaltung liegen in `src/services/` (sie brauchen `ops`); `src/git/` hält nur Git-Bausteine ohne Fachlogik | M4 |
| §2.16.1 Commit | über einen temporären Index, `commit-tree -S` und `update-ref` mit Vorwert: genau die betroffenen Pfade, vom User vorgemerkte Änderungen bleiben unberührt, keine Hooks; Autor = `name` des Users, E-Mail `<handle>@backe.invalid` | M4 |
| §2.16.1 Abbruch | Journal `.git/backe/write.journal`; Fehler rollt sofort zurück, nach einem Absturz der nächste Write; SIGINT/SIGTERM werden bis nach Commit oder Rollback aufgeschoben | M4 |
| §2.16.1 Hand-Edits | ungesicherte Änderungen an einem Pfad, den die Operation berührt → Exit-Code 4 statt Mitcommitten | M4 |
| §2.16.1 Identität | `.git/backe/identity` setzen `init`, `clone`, `backlog add` und der erste Write; ein zweiter Pfad für denselben Handle → Exit-Code 4 | M4 |
| §2.16.1 Lock | dritte Zeile Hostname; übernommen wird nur ein Lock desselben Hosts, dessen PID tot ist oder der vor dem Boot entstand | M4 |
| §2.16.1 Arbeitskopie ohne Remote | eine neue Identität klont aus einer vorhandenen Arbeitskopie (`origin` = deren Pfad); wie der Sync zwischen solchen Kopien läuft, entscheidet M6 | M4 |
| §2.13 Anker | der Anker wird gegen den eigenen Baum geprüft (`Backe-Op: init`, Akteur Admin); `clone`/`add` übernehmen den Anker einer vorhandenen Arbeitskopie, sonst die einzige Wurzel | M4 |
| §2.13 `verify` | Symlinks und Submodule sind ungültig; neue Kommentare nur mit Akteur als `author`; eine nicht parsebare Users-, Issue- oder Kommentar-Datei ist »nicht prüfbar« und ungültig; fehlendes `Backe-Op` ist ein Hinweis, kein Verstoß | M4 |
| §2.13 Quarantäne | `.backe/quarantine.jsonc` = `{"entries": [{sha, decision, reason}]}`; maßgeblich ist der Stand aus dem letzten selbst gültigen Commit, der die Datei ändert; `revert` nur, wenn die Pfade seit dem Commit unverändert sind | M4 |
| §2.12, §2.13 Identitätsschutz | Handle-Wiederverwendung nur durch Admins; Keys eindeutig über alle Users; Widerruf endgültig; `operator` ändern nur Admins; ein Operator von Agents bleibt Mensch | M4 |
| §2.14 `backlog clone --name` | muss dem Namen im Backlog entsprechen; lokale Aliasnamen gibt es in v1 nicht | M4 |
| §2.13 Ungültiger Commit in der Historie | Ab dem ersten ungültigen Commit prüft `verify` alle folgenden gegen den eingefrorenen Stand davor (Keys, Admin-Status, Policy), bis ein gültiger Quarantäne-Commit alle offenen deckt; so verleiht ein ungültiger Commit keine Rechte | M4 |
| §2.13 Maßgebliche Quarantäne | `.backe/quarantine.jsonc` aus dem letzten Commit, der die Datei ändert und selbst gültig ist; `verify --accept/--revert` baut darauf auf und prüft eine Umkehr vorab mit derselben Policy | M4 |
| §2.12 Widerruf | Widerrufen werden nur eigene Keys (ein neuer Eintrag in `revoked_keys` stand vorher in `keys` desselben Users) | M4 |
| §2.16.1 Signier-Key | `executeWrite` lehnt einen Key ab, der kein aktiver Key des Schreibenden ist (Exit-Code 2); `git add -f` für die betroffenen Pfade, damit Ignore-Regeln keinen Write blockieren | M4 |
| §2.20 Git-Version | Mindestens Git 2.38 (`cat-file -Z`), nicht 2.34 | M4 |
| Schnitt M5 | M5a: Gerüst, Ausgabe, alle Befehle außer den M5b-Gruppen. M5b: `attach *` samt Größenlimit und LFS, `repo check\|where\|scan`, `commit` und `issue edit` per `$EDITOR`, `batch`, `doctor`, `config get\|set\|edit`. | M5a |
| Spec-Frage `parent`/`depends_on` über Kreuz | `depends_on` zwischen Vorfahre und Nachfahre ist ein Zyklus (`cycle`, Exit 2) — beim Setzen der Abhängigkeit wie beim Umhängen, das eine solche Beziehung erzeugt. | M5a |
| Spec-Frage offenes Kind unter `done`-Parent | Anlegen, Umhängen, `move`/`resume`/`reopen` eines Kindes in einen offenen State unter einem `done`-Parent → `settled_parent` (`conflict`, Exit 4), Hint `backe issue reopen <parent>`. `move --force` übergeht es wie bei der `done`-Sperre. | M5a |
| §2.18 `issue list` Default | ohne `--state` nur offene Issues (nicht `done`, `cancelled`, `rejected`); `--state all` zeigt alle. | M5a |
| §2.18 mehrfache Filter | Werte innerhalb eines Flags oder einer Komma-Liste sind ODER, verschiedene Flags UND; `-p` filtert rekursiv, `--exact` nur genau. | M5a |
| §2.14 Kopfzeile | genau die Filter, deren Wert aus dem Kontext stammt (nicht aus einem expliziten Flag), plus `backlog`; ohne solche Filter keine Kopfzeile. Text: `backlog=acme project=web/auth repo=webapp`. JSON: Feld `context` mit denselben Keys, sonst fehlt es. | M5a |
| §2.18 Text-Liste | `<id>  <state, 11 breit>  <assignee oder ->  <titel>`; IDs und Assignees auf die breiteste Zeile gepolstert (Codepoints); `⧗ ` vor dem Titel bei offenen `depends_on`; `--tree` rückt den Titel um zwei Leerzeichen je Ebene ein. | M5a |
| §2.18 `--fields` | nur mit `--format json` (sonst `usage`); wirkt auf die Issue-Objekte von `issue list`, `issue show`, `next`; unbekanntes Feld → `usage` mit der Liste der erlaubten. | M5a |
| §2.18 `--format md` | nur `issue show` (Datei wie auf der Platte plus angeforderte Kommentare); andere Befehle → `usage`. | M5a |
| Write-Ausgabe | Text: `issue create` druckt nur die neue ID; sonst `summarizeOp(op)`; ohne Änderung `unverändert: <summary>`, Exit 0. JSON: `{"commit":<sha\|null>,"op":<aufgezeichnet>,"id"?:…,"notices"?:[…]}`. Hinweise der Operation nach stderr als `Hinweis: …`. | M5a |
| Fehler-Ausgabe | Text: `Fehler: <message>` und optional `Hinweis: <hint>`. JSON: `{"error":{"code","message","hint"?,"details"?}}` — `details` mit Kandidaten, Zyklus-IDs, Zeile. | M5a |
| `issue create` Vorbelegung | ohne `--parent`: `projects`/`sprints`/`repos` aus dem Kontext, sofern kein Flag; mit `--parent` erbt die Operation vom Parent (M2), der Kontext füllt nichts. | M5a |
| Kommentar-Referenz | `comment edit\|delete <id> <kommentar>`: voller Dateiname oder 1-basierter Index aus `comment list`. | M5a |
| `issue link <ziel>` | passt `ziel` auf `<repo-name>[@<ref>]` und ist der Name registriert → Repo; sonst URL: steht nach dem letzten `@` kein `:` und ist der Teil davor eine normalisierbare URL ungleich `git`, ist der Rest der Ref. | M5a |
| `init`-Identität | Handle aus `--as` → `BACKE_USER` → `user` der User-Config, sonst `usage`; Key aus `--key` → `~/.ssh/id_ed25519.pub`, falls vorhanden, sonst `usage`. | M5a |
| Hints mit CLI-Flags in `ops`/`context` | bleiben; M7: wörtlich, erklärt in `instructions` des MCP-Servers (keine Übersetzungstabelle). | M5a |
| §2.18 Steuerzeichen in der Text-Ausgabe | Text aus Issues, Kommentaren, Configs und Git geht vor der Ausgabe durch `safeText`: Steuerzeichen (C0, DEL, C1) außer `\n` und `\t` werden sichtbar, `ESC` als `␛`, alle anderen als `\u{XX}`. Gilt für stdout und stderr im Text-Modus; JSON und `--format md` bleiben roh. | M5a |
| §2.18 JSON-Keys | Keys der CLI-JSON-Ausgabe sind snake_case (`can_write`, `working_copies`, `prop_notices`, in Fehler-Details `exit_code`); die CLI bildet die TS-Namen der Services explizit ab. `test/conventions.test.ts` prüft alle JSON-Golden-Files. | M5a |
| §2.14 `backlog remove --purge` | verweigert ohne `--force` jeden verwalteten Clone ohne Remote oder mit Commits auf dem Sync-Branch, die in keinem Remote-Tracking-Ref stehen (`conflict`, Exit 4, Hint `--purge --force`); geprüft wird vor dem Deregistrieren, eine Verweigerung lässt die Registrierung stehen. `--force` ohne `--purge` ist `usage`. | M5a |
| §2.5 Kurz-ID mit Präfix | ein Präfix wird nur abgeschnitten, wenn er der Präfix der IDs im Backlog ist; ein fremder Präfix (`ac-7f3` in einem `bk`-Backlog) ist `not_found` »Keine Issue-ID passt zu »ac-7f3««. | M5a |
| Clone eines neueren Formats | erlaubt (Lesen geht), `CloneResult.notices` meldet `Backlog-Format <v> ist neuer als dieses backe (<max>); nur lesen`. | M5a |
| §2.12 User ohne aktiven Key | `keys` darf fehlen (kein aktiver Key, User kann nicht signieren); der letzte Key ist widerrufbar; `user add` verlangt weiter ≥ 1 Key; ein neu von Hand angelegter User ohne Keys ist `manual` | M5a |
| §2.12 Key von Hand entfernen | erlaubt ohne `revoked_keys`-Eintrag; der Key ist ab dem Commit ungültig (verify liest Keys aus dem Parent-Stand), keine Anmaßung möglich (§3.10) | M5a |
| §2.18 Fehlercodes | fehlender Pflichtwert und sich ausschließende Angaben = `usage`; gelieferter, aber leerer Wert (auch leeres stdin), ungültiger State, ungültiger Bereichsfilter, zu kurze Kurz-ID = `validation` | M5a |
| §2.18 JSON-Modus | Hinweise und Warnungen eines Writes stehen nur im JSON-Objekt (`notices`, `warnings`); Text-Modus: `Hinweis:`/`Warnung:` auf stderr. Ein Format-Default aus `BACKE_FORMAT`/`output.format`, den ein Befehl nicht kann, fällt auf Text zurück; nur ein explizites `--format`/`--json` ist `usage` | M5a |
| §2.14 `-A` | verwirft nur Werte aus dem Kontext; explizite Filter-Flags filtern weiter | M5a |
| §2.5 Kurzform | Vergleich ohne Groß-/Kleinschreibung, Präfix `bk-` erlaubt, exakter Treffer des Zufallsteils gewinnt vor Mehrdeutigkeit, Kurzform < 3 Zeichen = `validation` | M5a |
| §2.17 `issue edit` | gleicher Wert in `--add-x` und `--rm-x` sowie in `--prop` und `--unset-prop` = `usage`; `--parent` mit `--no-parent` = `usage`; Werte gleich dem Ist-Stand fallen weg, bleibt nichts → `usage` »Nichts zu ändern« (seit M5b ersetzt: Planentscheidung »§2.17 `issue edit` mit wirkungslosen Flags«, jetzt `unverändert`, Exit 0) | M5a |
| §2.17 Beschreibung aus stdin | leeres stdin bei `-d -`/`--body-file -` = `validation` »Beschreibung ist leer«; `-d ''` oder eine leere Datei leeren den Body bewusst | M5a |
| §2.17 `issue list --blocked` | heißt State `blocked` | M5a |
| §2.7 Kommentar-Reihenfolge | nach Dateiname; Kommentare derselben Sekunde ordnet das Zufallssuffix (deterministisch für gegebene Dateien) | M5a |
| §2.6 Begründung in `issue show` | `lastReason` = jüngster Transition-Kommentar, dessen `to` der aktuelle State ist | M5a |
| §2.13 Kommentar ändern/löschen | Kommentar-Ref und `from_hash` werden vor dem Write-Lock gelesen; `ops` prüft den Hash unter dem Lock, eine zwischenzeitliche Änderung ist `conflict` | M5a |
| §2.14 `backlog add` | Anker wird vor `verify` geschrieben (verify liest ihn) und bei Fehlschlag entfernt; Registrierung und Identität erst nach `verify`; ein Fehler danach nimmt genau die eigene Bindung zurück | M5a |
| §2.13 `backe commit` Umfang | alle Pfade, die `git status --porcelain=v1 -z --untracked-files=all --no-renames` als geändert, neu (nicht ignoriert) oder gelöscht meldet — Index und Arbeitsbaum zusammen, verglichen mit `HEAD`. Nichts geändert → `Nichts zu committen`, Exit 0. Ein Symlink oder sonst keine reguläre Datei darunter → `validation` `<pfad> ist keine reguläre Datei`, bevor etwas gelesen wird. | M5b |
| §2.13 Editor- und Systemdateien | `backe init` committet eine `.gitignore` mit `.*.swp`, `.*.swo`, `*~`, `\#*#` (`#` maskiert, sonst Kommentar), `.DS_Store`. `backe commit` lehnt neue, ungetrackte Dateien ab, deren Dateiname darauf passt — auch ohne `.gitignore`: `validation` `Editor- oder Systemdateien: <pfade>`, Hint `löschen oder in .gitignore aufnehmen`, nichts committet. Andere Dateien außerhalb des Layouts bleiben `manual`. | M5b |
| §2.13 Identitätsschutz bei Hand-Edits | Jeder Commit der Kette (`manual`-Anteil und Operationen) wird vor dem Schreiben mit `checkCommitPolicy` geprüft, gegen den Stand von `HEAD` bzw. nach dem vorigen Schritt. Gründe → `validation` `verify würde den Commit ablehnen: <gründe>` (`details.reasons`), nichts committet, Hand-Edits bleiben. `kind: 'manual'` (Quarantäne) prüft weiter selbst gegen den maßgeblichen `verify`-Stand, nicht doppelt gegen `HEAD`. | M5b |
| §2.13 Commit-Strategie bei gemischtem Ergebnis | erst ein `manual`-Commit mit allen Dateien ohne Operations-Entsprechung (Subject aus `-m`, sonst `manual: <n> Dateien`), dann die Operationen (eine → Trailer mit der Operation, mehrere → `Backe-Op: batch`). Die Operationen werden vorab gegen den Stand nach dem `manual`-Anteil geprüft; `HEAD` springt einmal vom alten Stand auf den letzten Commit. Scheitert etwas, landet keiner. `-m` ohne `manual`-Anteil → Warnung `-m gilt nur für manuelle Änderungen`. | M5b |
| §2.13 Arbeitskopie nach `backe commit` | Jeder bearbeitete Pfad trägt danach den committeten Inhalt, der Index dieser Pfade ist `HEAD`. Weicht der committete Inhalt vom kanonisch serialisierten Hand-Edit ab (etwa Listen-Reihenfolge nach einer Mengen-Operation) → Hinweis `<pfad>: kanonisch umgeschrieben`. Ein Pfad ohne wirksame Änderung (nur umsortiert, nur Formatierung) wird auf `HEAD` zurückgesetzt → Hinweis `<pfad>: keine wirksame Änderung`. | M5b |
| §2.13 `backe commit` Ausgabe | Text: je Commit sein Subject auf stdout; stderr `Warnung: <pfad>: unbekannte Keys …`, `Hinweis: …` je Op-Notice und umgeschriebenem Pfad, `Warnung: …` je Warnung. JSON: `{"commits":[{commit,kind,summary,ops,paths}],"notices"?:[{code,message,ids}],"rewritten"?:[{path,reason}],"warnings"?:[…],"unknown_keys"?:[{path,keys}]}` — `notices` nur Op-Notices, `warnings` = `-m gilt nur für manuelle Änderungen`, nicht angeglichene Arbeitskopie, Verify-Gründe eines frischen Klons; `unknown_keys` wie bei `verify`. | M5b |
| §2.13 Umhängen im Hand-Edit | `issue.edit`-Operationen mit geändertem `parent` stehen in der Reihenfolge des Nachher-Baums, Wurzeln zuerst; getauschte Parents zweier Issues gelingen so unabhängig von den IDs. Konflikte mit `done`-Parents bleiben Fehler; Hint `Änderung auf zwei backe commit aufteilen`. | M5b |
| §2.13 Issue-Datei am falschen Ort | `issue.md` unter `issues/<x>/<id>/`, bei dem `<x>` nicht `shardOf(id)` ist oder `<id>` keine gültige Issue-ID → `validation` `<pfad>: Issue gehört nach <issueFile(id)>` bzw. `<pfad>: kein gültiges Issue-Verzeichnis`. | M5b |
| §2.16.1 HEAD-Vorbedingung manueller Writes | `WriteInput` `manual` bekommt `expectHead?: string`; weicht `HEAD` unter dem Lock ab → `conflict` `Stand hat sich seit der Prüfung geändert`. `verify --accept/--revert` setzt es auf den Stand, gegen den es geprüft hat. `edits` braucht es nicht (rechnet unter dem Lock). | M5b |
| §2.17 `issue edit` per Editor | ohne Änderungs-Flags. Editor: `BACKE_EDITOR`; sonst `VISUAL`, dann `EDITOR`, aber nur, wenn stdin und stdout ein TTY sind; sonst `usage` `Nichts zu ändern`, Hint `Flags angeben oder BACKE_EDITOR setzen`. Aufruf `sh -c '<editor> "$1"' backe-editor <datei>`, Temp-Datei `<os.tmpdir()>/backe-<id>-<6 hex>.md` mit dem Dateiinhalt wie auf der Platte. Unverändert → `unverändert: issue edit <id>`, Exit 0. Editor-Exit ≠ 0 → `unexpected` `Editor endete mit Exit-Code <n>; nichts geändert`. Parse- oder Schemafehler → `validation` mit `datei:zeile`, die Temp-Datei bleibt, Hint nennt sie. Ergebnis ohne Operations-Entsprechung → `validation` `Diese Änderung lässt sich nicht als Operation ausdrücken`, Hint `Datei direkt bearbeiten und backe commit`. Mehrere Operationen (etwa `issue.edit` und `issue.move`) → ein Batch-Commit. Temp-Datei wird nach Erfolg gelöscht. | M5b |
| §2.17 `issue edit` mit wirkungslosen Flags | `unverändert: <summary>`, Exit 0 — wie `issue move` in den aktuellen State. Ersetzt die M5a-Festlegung »bleibt nichts → `usage` Nichts zu ändern«. | M5b |
| §2.16.6 Batch-Eingabe | Format des Trailers (§2.16.4) plus `ref`; volle IDs oder Platzhalter, keine Kurz-IDs, kein `me`. BOM am Anfang und CRLF werden gelesen. `attach.add` mit `file` (Inhalt passt nicht in JSONL) und `issue.claim` (synchron, M6) → `validation` mit Zeile. Quelle: `-f <pfad>` oder `-f -`/`-` für stdin; ohne Quelle `usage`. | M5b |
| §2.16.6 Batch-Ausgabe | Text: `summarizeBatch`, danach je Platzhalter `<ref>  <id>` in Vergabe-Reihenfolge. JSON: `{"commit":<sha\|null>,"refs":{…},"ops":<anzahl aufgezeichnet>,"notices"?:[…],"warnings"?:[…]}`; `warnings` = Verify-Gründe eines frischen Klons wie bei allen Writes. | M5b |
| §2.8 Dateiname eines Datei-Anhangs | Enthält `name` einen Punkt, ist er der Dateiname; sonst `name` + `extname(quelle)` kleingeschrieben. Passt das Ergebnis nicht zu `[a-z0-9][a-z0-9._-]{0,63}` → `validation`, Hint `--name <n>.<ext>`. Quelle muss eine reguläre Datei sein (Verzeichnis → `validation`, fehlt → `not_found`); leere Dateien sind erlaubt. | M5b |
| §2.8 JSON-Anhang | Dateiname `<name>.json`, außer `name` endet schon auf `.json`; Inhalt `JSON.stringify(JSON.parse(text), null, 2) + '\n'` — Key-Reihenfolge bleibt, Einrückung zwei Leerzeichen. Ungültiges JSON → `validation` mit der Meldung von `JSON.parse`. | M5b |
| §2.8 `attach get` | Text ohne `-o`: Dateibytes roh auf stdout; `-o <pfad>` schreibt die Datei (überschreibt) und druckt den Zielpfad; URL-Anhang: die URL. JSON: `{"name","file"?,"url"?,"size"?,"path"?}` (`path` = Ziel bzw. absoluter Pfad in der Arbeitskopie), nie der Inhalt. | M5b |
| §2.8 `attach add --json` | `attach add` trägt die globale Option `--json` nicht (`addGlobalOptions(cmd, ['json'])`); `--json <json\|->` ist die Inhaltsquelle, JSON-Ausgabe per `--format json`. | M5b |
| §2.8 LFS | Statt `-c`-Filterwerten pro Aufruf richtet `executeWrite` bei `attachments.lfs` die Arbeitskopie mit `git lfs install --local` ein (Filter-Config und LFS-Hooks nur in deren `.git/config`; bei fremdem Hook Fallback `--skip-repo`); die globale Config bleibt unberührt. `doctor` prüft `filter.lfs.process` in der lokalen Config. Die LFS-Regel gilt als vorhanden, wenn eine Zeile ohne Leerraum am Rand genau so lautet (`attach.add` und `doctor` gleich). Der Commit, der die Regel einführt, nimmt alle schon roh committeten Anhänge in seine Pfade auf; sie landen als Pointer (Renormalisierung), der Op-Trailer bleibt unverändert. | M5b |
| §2.8 Größenlimit | `max_bytes` gilt auch mit LFS. `too_large`-Hint ohne LFS: `Grenze attachments.max_bytes anheben; für große Dateien attachments.lfs aktivieren (backe.md §2.8).`; mit LFS: `Grenze attachments.max_bytes anheben (backe.md §2.8).` | M5b |
| §2.11 `repo check` lokal | je Repo: URL normalisierbar, kanonische URL eindeutig, Dateiname = gültiger Repo-Name, `default_ref` und die Refs aus Issues (`name@ref`) erfüllen `isGitRef`. Ohne Namen alle Repos. | M5b |
| §2.11 `repo check --remote` | `git ls-remote --end-of-options <url>` (Timeout 20 s): erreichbar; `default_ref` und Branch-/Tag-Refs aus Issues existieren; Refs, die wie ein Commit aussehen (`^[0-9a-f]{7,40}$`), sind per `ls-remote` nicht prüfbar → Hinweis. GitHub (kanonisch `github.com/<owner>/<repo>`): `gh api repos/<owner>/<repo>`, wenn `gh` im `PATH` liegt, sonst `GET https://api.github.com/repos/<owner>/<repo>` (mit `Authorization: Bearer $GITHUB_TOKEN`, falls gesetzt); gemeldet werden `visibility` und `archived` (archiviert = Warnung). | M5b |
| §2.11 Cache | `<BACKE_HOME>/cache/repo-check.json` = `{"version":1,"entries":{"<kanonisch>":{"checked":"<iso>","result":{…}}}}`; TTL 24 h (Planentscheidung M5b), `--fresh` umgeht ihn. Kaputter Cache wird verworfen, nicht gemeldet. Ein fehlender Ref aus dem Cache trägt `(Cache vom <ts>; --fresh prüft neu)`. | M5b |
| §2.11 Exit-Codes `repo check` | Bericht immer auf stdout; danach: ein lokaler oder Ref-Fehler → `validation` (2); nur Erreichbarkeitsfehler → `sync` (6); nur Warnungen und Hinweise → 0. | M5b |
| §2.11 `repo where` | Name → Registry → kanonische URL → `repos[<kanonisch>]` der User-Config, expandiert. Kein Eintrag → `not_found` `Kein lokaler Pfad für »<name>«`, `details: {url, canonical, default_ref?}`, Hint `backe repo scan <verzeichnis>` oder `backe config set repos.<kanonisch> <pfad>`. Eintrag existiert nicht auf der Platte → `not_found` `<pfad> existiert nicht`. Text: nur der Pfad. JSON: `{"name","url","canonical","default_ref"?,"path"}`. | M5b |
| §2.11 `repo scan` | rekursiv bis Tiefe 4 unter dem Verzeichnis; versteckte Verzeichnisse und `node_modules` übersprungen, Symlinks nicht verfolgt, in ein gefundenes Git-Repo wird nicht abgestiegen. Remotes → kanonisch → nur Repos, die im aktiven Backlog registriert sind. Pfade physisch (`realpath`). Kein Eintrag → setzen (`neu`); gleicher Pfad → `unverändert`; anderer Pfad → bleibt (`abweichend (<alt>)`), mit `--force` `überschrieben`. `--dry-run` schreibt nichts. Eine Config-Änderung je Lauf. Text: `<name>  <pfad>  <status>`. | M5b |
| §2.20 `doctor` | Prüfungen mit fester ID und Status `ok\|warn\|fail` (Liste in Task 8). Text: `<status>  <id>  <detail>`, bei `warn`/`fail` mit Hint direkt darunter `  → <hint>`; `user-config` bei `fail` mit Hint `backe config edit`. Relative Alternates gelten relativ zu `objects/`. JSON: `{"checks":[{id,status,detail,hint?}]}`. Ein `fail` → nach dem Bericht `validation` `doctor: <n> Prüfung(en) fehlgeschlagen` (Exit 2). `--fix` entfernt nur Temp-Reste: `tmp/clone-*` älter als 1 h und Lock-Temp-Dateien (`<lock>.<pid>.<hex>`) toter PIDs desselben Hosts. | M5b |
| §2.15.1 `config`-Pfade | `a.b.c`; unter `repos.` ist der ganze Rest ein Key und wird per `normalizeRepoUrl` kanonisiert. Gesetzt werden nur String-Blätter des Schemas (alle Werte der User-Config sind Strings); `--unset` entfernt. Werte bleiben wörtlich (`~` wird nicht expandiert). Unbekannter Pfad → `validation` mit den erlaubten Keys der Ebene. | M5b |
| §2.15.1 `config get` | ohne Key: Text = Datei wie auf der Platte (fehlt sie: nichts), JSON = geparste Config. Mit Key: Text = String roh, Objekt als JSON; fehlender Key → `not_found`. Eine ungültige Config bricht nicht schon beim Start ab (wie `doctor`); `config get` meldet sie selbst mit `datei:zeile`. | M5b |
| §2.15.1 `config edit` | Temp-Kopie im Editor (Regeln wie `issue edit`), danach geprüft; unter `config.lock`: Original seit dem Start unverändert (sonst `conflict`), dann atomar geschrieben. Ungültig → `validation` mit `datei:zeile` des Entwurfs (`config.jsonc.draft:<zeile>`), Original unberührt, Hint nennt den Entwurf. Startet auch mit ungültiger Config (Reparaturweg). Ohne Editor → `usage` `Kein Editor verfügbar`, Hint `BACKE_EDITOR setzen`. | M5b |
| M3 JSONC-Edit | Ergibt `modify`/`applyEdits` keinen parsebaren Text (Komma am Zeilenanfang o. ä.) → `unexpected` `Edit an <datei> konnte nicht angewendet werden; Datei unverändert`. | M5b |
| M1 URL-Kanonform | Pfad kleingeschrieben für `github.com`, `gitlab.com`, `codeberg.org`, `bitbucket.org`, sonst wie gegeben; `?` oder `#` in der URL → `validation`. `normalizeRepoUrl` ist auf der kanonischen Form idempotent (`host/pfad` und `file:/abs` werden akzeptiert). Die kanonische Form `host/pfad` gilt auch ohne Punkt im Host (Host `[a-z0-9-]+`, ≥ 1 Pfadsegment), damit `localhost`- und Intranet-URLs idempotent bleiben; ein relativer Pfad `a/b` gilt dadurch als Repo-URL mit Host `a`. | M5b |
| M1 Git-Refs | `isGitRef(s)` prüft rein nach `git check-ref-format --allow-onelevel`: kein Segment beginnt mit `.` oder endet auf `.lock`, kein `..`, kein `@{`, nicht `@`, keine Steuerzeichen, kein Leerzeichen, keins von `~^:?*[\`, nicht mit `/` beginnend oder endend, kein `//`, nicht auf `.` endend. Gilt für `ref` in `name@ref` (Issues, `issue link`) und `default_ref`. | M5b |
| M5a `project list` | zählt offene Issues rekursiv über Unterprojekte, wie `project show`. | M5b |
| M5a `safeText` | macht zusätzlich `\p{Cf}` sichtbar (`\u{XXXX}`), außer U+200C und U+200D (Emoji-Sequenzen). | M5b |
| M5a Fehler-`details` | snake_case nur für die festen Keys `exitCode`, `fromHash`, `reasonFile`; alle anderen Keys und alle Werte bleiben unverändert. | M5b |
| M5a Flag-Namen in Meldungen | Flags stehen nackt (`--reason`), Werte in `»…«`; `test/conventions.test.ts` verbietet `»--`. | M5b |
| Batch-Tempo | Ziel: 1 000 `issue.create` gegen 20 000 Issues unter 1 s auf dem Entwicklungsrechner, gemessen mit `scripts/bench-batch.ts`; kein Timing-Test, aber ein Gleichheitstest für das Ergebnis. | M5b |
| §2.13 Scheitern von `backe commit` | Scheitert der Write, stellt der Rollback die Hand-Edits wieder her (Bytes vor dem Write, auch über das Journal nach einem Absturz), nicht den Stand von `HEAD`. | M5b |
| §2.13 HEAD-Basis für Hand-Edits | Basis = `snapshotAt(Arbeitskopie, Vorher-Inhalte der geänderten Pfade + aktuelle Inhalte von orphanedProjectPaths)`, damit ein von Hand gelöschtes Elternprojekt seine Unterprojekte nicht verdeckt. Fehler aus den Operationen eines Hand-Edits tragen kein `Zeile <n>:`-Präfix, aber den Hint `Änderung auf zwei backe commit aufteilen`. `sync.branch` und `attachments.lfs` kommen dabei aus der Config in `HEAD`. | M5b |
| §2.11 Cache `repo check` | Ein Fehler beim Schreiben des Caches bleibt still und nicht fatal (der Cache ist reine Optimierung). | M5b |
| §2.13 Body bei Hand-Edits | Angehängte Leerzeilen am Body-Ende sind eine echte Body-Änderung; nur Zeilenenden und der Schluss-Newline werden normalisiert. | M5b |
| `topoOrder` | Min-Heap, O(e + n log n): Gleichstand nach ID bleibt Vertrag (ersetzt »O(n + e)« der Festlegung »Batch-Tempo«). Gemessen: 1 000 Creates gegen 20 000 Issues 58 ms statt 2 415 ms. | M5b |
| §2.12 Golden `user-show` ohne Zeitstempel | entfällt: `revoked_keys[].revoked` ist Schema-Pflicht, ein Eintrag ohne Zeitstempel ist nicht ladbar. | M5b |
| §2.16.1 Backlog ohne Remote | Lokaler Hub `<BACKE_HOME>/backlogs/<name>/hub.git` (bare). Angelegt von `ensureWorkingCopy`, sobald für einen Backlog ohne `remote` in der User-Config eine weitere Arbeitskopie geklont wird: `git clone --bare -q` der Quell-Arbeitskopie in ein Temp-Verzeichnis, unter dem Config-Lock per `rename` an seinen Platz (existiert er schon, gilt der vorhandene). Die Quell-Arbeitskopie bekommt dann den Git-Remote `sync.remote` → Hub (ein vorhandener Remote dieses Namens, der auf ein nicht-bares Verzeichnis zeigt, wird umgehängt; einer auf ein bares Repo oder eine URL bleibt) und ein `fetch`. Die neue Arbeitskopie klont vom Hub, mit `--reference` auf die Quelle. Hinweis im Ergebnis: `Lokaler Hub <pfad> angelegt; <quelle> synct jetzt darüber`. Ein Backlog mit genau einer Arbeitskopie hat keinen Hub; Sync ist dort »kein Remote« (no-op). Ein später ergänztes echtes Remote hängt M6 nicht automatisch um (Roadmap-Punkt). | M6 |
| §2.16.2 Remote einer Arbeitskopie | Der Git-Remote `sync.remote` der Arbeitskopie (Default `origin`), Branch `sync.branch`. Fehlt der Git-Remote → Status `kein Remote`, `syncNow` liefert `{ skipped: 'no_remote' }`, Exit 0. | M6 |
| §2.16.2 Modus | wirksam = `backlogs.<name>.sync.mode` der User-Config, sonst `sync.mode` aus `.backe/backlog.jsonc` im `HEAD` der Arbeitskopie. `manual` heißt: kein automatischer Start nach Writes und Reads; `backe sync` läuft trotzdem; der Claim im Modus `manual` ist nur lokal (ersetzt: Planentscheidung »§2.16.5 Claim im Modus `manual`«). | M6 |
| §2.16.2 Ablauf der Runde | 1. `git fetch -q --no-tags <remote> +refs/heads/<branch>:refs/remotes/<remote>/<branch>` ohne Lock, Timeout 60 s, Scheitern → `sync` `Fetch von <remote> fehlgeschlagen: <erste stderr-Zeile>`. 2. Eingehendes prüfen (Zeile »Verify beim Sync«). 3. Unter dem Write-Lock: lokale Einheiten = `git rev-list --reverse <HEAD> --not <tip>`; keine → `reset --keep <tip>` (Fast-Forward), fertig ohne Push; `tip` Vorfahre von HEAD → kein Replay; sonst Replay auf `tip` und `reset --keep <neu>`. 4. Ohne Lock `git push -q <remote> <sha>:refs/heads/<branch>` (nie `--force`). Abgelehnt (non-fast-forward oder fetch first) → Backoff `200 ms · 2^(runde-1)`, zurück zu 1, höchstens 5 Runden; danach `sync` `Push nach 5 Runden abgelehnt`. Ein leerer Remote-Branch (frischer Hub, frisches Remote) heißt: kein `tip`, lokale Einheiten = alles, gepusht wird HEAD. (Leerer Remote-Branch seit M6 ersetzt: Planentscheidung »Leerer Remote-Branch«: lokale Einheiten sind die Commits nach `upstream`, sonst nach `verified`.) | M6 |
| §2.13 Verify beim Sync | `verifyRange(wc, { to: tip, ancestor: upstream })` prüft ab dem Anker; die Abstammungsprüfung läuft gegen den neuen lokalen Zustand `upstream` (zuletzt verifizierter Remote-Stand), nicht gegen `verified`, das auf ungepushte lokale Commits zeigen darf. Ungültige Commits: Modus aus dem Stand vor dem ersten davon (`trustedMode`, Task 1). `strict` → `verify` (Exit 5), nichts übernommen; `warn` → Gründe als Hinweise, weiter; `off` → still weiter. Nach bestandener Prüfung `upstream` = `tip`, nach erfolgreichem Push `upstream` = gepushter Commit. (Aufzeichnen von `verified` und `clean` sowie `upstream` seit M6 ersetzt: Planentscheidung »Verify beim Sync, Aufzeichnen«; Abstammung ohne `upstream` ersetzt: Planentscheidung »Abstammung beim Sync ohne `upstream`«.) | M6 |
| §2.13 Fremde lokale Commits | Ein lokaler Commit ohne gültige backe-Signatur des eigenen Handles oder ohne lesbaren `Backe-Op` (etwa nacktes `git commit`) blockiert den Sync in jedem Modus: `verify` `Lokaler Commit <kurz> ist nicht von backe signiert`, Hint `backe commit --resign`. | M6 |
| §2.16.4 Einheiten | Je lokalem Commit eine Einheit: `Backe-Op: <op>` → `op`, `batch` → `batch` (Ops aus dem Body), `manual` → `manual`. `init` lokal ist nur als Wurzel eines frischen Hubs möglich und wird nie replayt. | M6 |
| §2.16.4 Replay je Einheit | `op`/`batch`: vorab Kollisionen umschreiben (Zeile »ID-Kollision«), dann `applyOperation` bzw. `applyBatch` gegen den Stand nach den bisherigen Einheiten. Gelingt es → Commit mit derselben Subject-Logik wie `executeWrite` (`opMessage`), eigener Akteur, eigener Key. Ohne Änderung (alles schon erreicht) → kein Commit. Scheitert es an einer Verletzung (jeder `BackeError` mit `details.reason`) → Einheit in die Konfliktablage. Andere Fehler brechen die Runde ab. | M6 |
| §2.16.4 Folgeoperationen | Eine abgelegte Einheit macht ihre Schlüssel »belastet«: alle Issue-IDs aus `referencedIds` ihrer Ops und die IDs, die ihre `issue.create` vergeben haben, dazu je Nicht-Issue-Op `<kind>:<subjekt>` (`project:web/auth`, `sprint:2026-w47`, `repo:api`, `user:claude-1`). Eine spätere Einheit, die einen belasteten Schlüssel nennt, geht ohne eigenen Versuch in denselben Konflikt-Eintrag (`followers`) und belastet ihre Schlüssel mit. | M6 |
| §2.16.4 ID-Kollision | Vor dem Anwenden einer Einheit: jede `issue.create` mit `id`, die im aktuellen Stand schon existiert, bekommt eine frische ID (`generateIssueId` gegen den aktuellen Stand); die Zuordnung alt → neu gilt per `substituteIds` für den Rest der Einheit und alle späteren Einheiten. Hinweis `ID-Kollision: <alt> heißt jetzt <neu>` (Code `id_rewritten`, `ids: [alt, neu]`). Anhänge und Kommentare folgen, weil ihre Pfade aus der Op-ID entstehen. | M6 |
| §2.8 Anhänge im Replay | `attach.add` mit Datei bekommt `content` aus dem Ursprungs-Commit (`<sha>:<pfad aus der ursprünglichen ID>`), als Blob unverändert übernommen, auch als LFS-Pointer. Führt die Einheit die LFS-Regel ein, übernimmt der neue Commit für jeden Anhang, den der Ursprungs-Commit über seine Ops hinaus renormalisiert hat, den Pointer-Blob aus dem Ursprungs-Commit, sofern der Blob in der neuen Basis gleich dem im Parent des Ursprungs-Commits ist; sonst bleibt er, wie er ist. | M6 |
| §2.16.2 `manual`-Einheit | Je Pfad, den der Commit gegenüber seinem Parent ändert: `basis` = Parent, `lokal` = Ursprungs-Commit, `aktuell` = Stand nach den bisherigen Einheiten. `aktuell == basis` → `lokal`; `lokal == basis` oder `lokal == aktuell` → nichts; beide Seiten Text und vorhanden → `git merge-file -p`, sauber → Ergebnis; sonst (Konfliktmarker, Binär, Löschen gegen Ändern) → Runde abbrechen mit `conflict` `Textkonflikt in manual-Commit <kurz>: <pfade>`. Neu signiert mit Subject und `Backe-Op: manual` des Ursprungs-Commits und eigenem `Backe-Actor`. | M6 |
| §2.16.4 Konfliktablage | `.git/backe/conflicts/<YYYYMMDDTHHMMSSZ>-<6 hex>.json` = `{"version":1,"id":"<stem>","created":"<iso>","onto":"<tip>","reason":{"code","message","reason"?,"ids"?},"units":[{"sha","subject","kind","ops"}]}`; `units[0]` ist die gescheiterte Einheit, danach die Folgeeinheiten in Reihenfolge. Atomar geschrieben. Ein abgelegter Claim (Planentscheidung »§2.16.5 Claim«) landet nicht hier. | M6 |
| §2.16.4 `sync resolve` | `sync resolve` ohne Argument = Liste wie in `sync status`. `sync resolve <id> --drop` löscht den Eintrag. `sync resolve <id> --apply` setzt die Vorbedingungen aller Ops auf den aktuellen Stand (`rebaseOp`: `set.*.from`, `from` von `issue.move`, `from_hash` von `issue.edit`-Body und Kommentaren werden die Ist-Werte) und schreibt alle Einheiten als **einen** Batch-Write mit voller Prüfung der Invarianten; Erfolg löscht den Eintrag, Scheitern lässt ihn stehen (Fehler wie beim Write). Genau eins von `--drop`/`--apply`, sonst `usage`; unbekannte ID → `not_found`. | M6 |
| §2.16.2 `sync --interactive` | Vordergrund-Runde; bei einem `manual`-Textkonflikt fragt sie je Commit `[e]ditieren, [l]okal nehmen, [r]emote behalten, [a]bbrechen`: `e` schreibt je Konfliktpfad den Text mit Markern (`<<<<<<< remote` / `>>>>>>> lokal`) in eine Temp-Datei, öffnet den Editor (Regeln wie `issue edit` per Editor) und verlangt danach eine Datei ohne Zeilen, die mit `<<<<<<< `, `=======` oder `>>>>>>> ` beginnen (sonst erneut fragen); `l` nimmt `lokal`; `r` behält den Remote-Stand (ersetzt: Planentscheidung »§2.16.2 `sync --interactive`, `r`«: verwirft den ganzen lokalen Commit); `a` bricht ab wie die Hintergrund-Runde. Danach läuft die Runde weiter. Ohne TTY auf stdin und stdout → `usage` `--interactive braucht ein Terminal`. | M6 |
| §2.16.2 Zustand | `.git/backe/sync.json` = `{"version":1,"last_attempt":"<iso>","last_success"?:"<iso>","last_error"?:{"code","message","at","paths"?,"commit"?}}`, nach jeder Runde atomar geschrieben; Erfolg löscht `last_error`. Ein kaputtes `sync.json` gilt als leer. Lokaler Zustand `upstream` in `.git/backe/upstream` (wie `anchor`). | M6 |
| §2.16.2 Hintergrund-Prozess | `spawn(process.execPath, [...process.execArgv, process.argv[1], 'sync', '--background', '--backlog', <name>, '--as', <handle>], { cwd: <wc>, detached: true, stdio: ['ignore', log, log], env })` + `unref()`. Log `.git/backe/sync.log` im Append-Modus; ist es beim Start größer als 1 MiB, wird es nach `sync.log.1` verschoben. | M6 |
| §2.16.2 Debounce | `sync --background` versucht `sync.lock` einmal (`timeoutMs: 0`). Gehalten → `sync.dirty` anlegen, Exit 0. Sonst Schleife: `sync.dirty` löschen, Runde, solange `sync.dirty` danach existiert. Fehler einer Runde landen in `sync.json` und im Log, der Prozess endet mit 0. Vordergrund-`backe sync` wartet auf `sync.lock` (Wartezeit ersetzt: Planentscheidung »Warten auf `sync.lock`«) und dreht genau eine Runde (mit ihren bis zu 5 Push-Versuchen). Das Nachprüfen von `sync.dirty` nach der Freigabe ist ersetzt: Planentscheidung »§2.16.2 Debounce nach dem Dirty-Flag«. | M6 |
| §2.16.1 Start nach Writes | Der CLI-Adapter ruft nach jedem erfolgreichen Write mit Commit `scheduleSync(ctx, 'write')`: Modus `auto` und Git-Remote vorhanden → Hintergrund-Prozess. Kein Remote oder `manual` → nichts. | M6 |
| §2.16.3 Frische beim Lesen | Lesende Befehle rufen vor dem Lesen `freshen(ctx, { force })`. `--sync` → blockierende Runde (`syncNow`); ein Fehler darin bricht den Befehl ab. Sonst bei `auto`, vorhandenem Remote und `now − last_attempt ≥ pull_interval` (fehlt `last_attempt`: immer) → Hintergrund-Prozess, das Lesen läuft sofort weiter. `pull_interval: 0` heißt: bei jedem Read. | M6 |
| §2.16.2 Kopfzeile | Im Text-Modus schreibt jeder Befehl mit aufgelöster Arbeitskopie nach seiner Ausgabe eine Zeile auf stderr, sobald etwas offen ist: `Sync: ` + Teile mit ` · ` getrennt: `<n> ungepusht` (nur wenn `n > 0` und die letzte Runde fehlschlug oder der Modus `manual` ist), `<n> Konflikt(e)` (bei `n > 0`), `letzter Sync fehlgeschlagen: <message>` (bei `last_error`); dahinter `Hinweis: backe sync status`. Nichts offen → keine Zeile. JSON-Modus nie. Ohne Remote zählt `ungepusht` nicht. | M6 |
| §2.16.5 Claim | `claimIssue`: 1. `syncNow` (blockierend, mit Replay); 2. Write `issue.claim` mit `derive` (prüft claimbar, Exit 4 bei `occupied`/`not_claimable`; schon `in_progress` mit mir → `unverändert`, ohne Push); 3. Push mit dem Claim als letztem Commit; abgelehnt → Runde wiederholen, wobei die Claim-Einheit im Replay **nicht** in die Konfliktablage geht, sondern als `claimLost` endet → Exit 4 `<id> wurde inzwischen von <assignee> übernommen` (bzw. die Meldung der Verletzung). Die übrigen lokalen Einheiten bleiben und gehen beim nächsten Sync raus. Ohne Remote oder bei `manual`: nur Schritt 2, Hinweis `Claim nur lokal: kein Remote` bzw. `Claim nur lokal: sync.mode manual`. (Ablauf seit M6 ergänzt: Planentscheidungen »Claim unter `sync.lock`« und »Claims nie in der Konfliktablage«.) | M6 |
| §2.16.5 `next --claim` | Auswahl wie `next`; geht der Claim verloren, wählt `next` nach der Runde neu, ohne die verlorenen Kandidaten, höchstens 5 Versuche. Exit 4 erst, wenn alle Versuche verloren gehen (`Claim fünfmal verloren: <ids>`); kein Kandidat → `not_found` wie `next`. | M6 |
| §2.13 `commit --resign` | Lokale Commits = `upstream..HEAD` (ohne `upstream`: `verified..HEAD`). Gültige backe-Commits des eigenen Handles bleiben Einheiten wie im Replay; jeder andere wird übersetzt: `translateEdits` gegen den Snapshot seines Parents, `manual`-Anteil zuerst, dann die Ops (Strategie wie `backe commit`). Neu gebaut auf der Basis `upstream` (bzw. `verified`) und mit einem `reset --keep` übernommen. Nichts Fremdes → `Nichts neu zu signieren`, Exit 0. Mit Hand-Edits im Arbeitsbaum zusammen → `usage` `--resign geht nicht zusammen mit Hand-Edits`, Hint `erst backe commit`. (Basis seit M6 ersetzt: Planentscheidung »`commit --resign`, Basis«.) | M6 |
| §2.16.1 Signale | Ein gemeinsamer, verschachtelbarer Aufschub für SIGINT/SIGTERM (`withDeferredSignals`): Im äußersten Abschnitt werden fremde Listener abgehängt und eigene installiert; jedes Signal wird gemerkt (das erste zählt); am Ende des äußersten Abschnitts kommen die fremden Listener zurück, dann wird das gemerkte Signal einmal neu ausgelöst. Schreibpfad und Sync (der `reset --keep` samt Zustand) nutzen ihn. | M6 |
| M4 Verseuchte Pfade | Ist der Stand eingefroren, ist jede Änderung an einem Pfad, dessen Inhalt im Parent vom Inhalt im eingefrorenen Stand abweicht, selbst ein Grund `baut auf ungültigem Commit <kurz> auf` (`<kurz>` = erster offener ungültiger Commit). Verglichen wird über die Blob-IDs der beiden Bäume. (Ausnahmen für die Quarantäne seit M6 ergänzt: Planentscheidung »M4 Verseuchte Pfade, Quarantäne«.) | M6 |
| M4 Abstammung beim Clone | `cloneInto` prüft gegen `upstream` der vertrauten Arbeitskopie, sonst gegen `git merge-base <verified> refs/remotes/<remote>/<branch>` darin, sonst gegen `verified`. | M6 |
| M4 Agent ohne gepushten User | Fehlt `users/<handle>.md` im frischen Clone, liegt aber in der Quell-Arbeitskopie: `sync` `User <handle> ist noch nicht gepusht`, Hint `backe sync --as <identität der quelle>`, Clone verworfen. | M6 |
| M5b `attach get` mit Pointer | Beginnt der Inhalt mit `version https://git-lfs.github.com/spec/v1` und ist `attachments.lfs` an → `sync` `Anhang <name> ist nicht geladen (LFS)`, Hint `git -C <wc> lfs pull`. Nach jedem Sync, der den Baum ändert, und nach einem Clone führt `backe` bei `attachments.lfs` `git lfs pull` aus, wenn `git lfs version` gelingt; scheitert es, ein Hinweis, kein Fehler. | M6 |
| M5b LFS-Push | Bei `attachments.lfs` läuft vor jedem `git push` `git lfs push <remote> <sha>`; fehlt git-lfs → `validation` `attachments.lfs verlangt git-lfs` wie beim Write. (Timeout seit M6 ergänzt: Planentscheidung »LFS-Timeouts«.) | M6 |
| Ausgabe `backe sync` | Text: `aktuell` oder Zeilen `fetch: <n> neue Commits`, `replay: <n> Einheiten neu signiert`, `konflikt: <id>  <subject>` je Eintrag, `push: <sha7>`; `kein Remote` bei Skip. JSON: `{"fetched":<n>,"replayed":<n>,"conflicts":[<id>…],"pushed":<sha\|null>,"rounds":<n>,"skipped"?:"no_remote","notices"?:[…]}`. Exit: Verify 5, Netz/Push 6, `manual`-Konflikt oder blockierende Hand-Edits 4. | M6 |
| Ausgabe `sync status` | Text: Zeilen `remote  <url\|kein Remote>`, `modus  <auto\|manual>`, `ungepusht  <n>`, `letzter Sync  <iso\|nie>`, `fehler  <message>` (falls), `läuft  ja` (falls `sync.lock` gehalten), dann je Konflikt `<id>  <subject>  <reason.message>`. JSON: `{"remote","mode","unpushed","last_attempt"?,"last_success"?,"last_error"?,"running","conflicts":[{id,created,subject,reason}]}`. Exit 0. | M6 |
| M4 Verseuchte Pfade, Quarantäne | Den Pfad `.backe/quarantine.jsonc` selbst vergleicht die Regel nie. Ein Commit, der die Quarantäne ändert und damit alle offenen ungültigen Commits deckt (auftaut), ist ganz ausgenommen; einer, der nicht auftaut, darf Pfade nur auf den Blob im eingefrorenen Stand, in einem offenen ungültigen Commit `o` oder in `o^` zurücksetzen. Schreibpfad und `verify` nutzen dieselbe Regel (`pathTaintReasons`). | M6 |
| Lokaler Zustand `clean` | `.git/backe/clean` = zuletzt von `verify` ohne offenen ungültigen Commit aufgezeichneter Stand (Gang ab Anker oder ab `clean`); `init` setzt ihn auf den Anker, der Clone setzt ihn nie vorab. Der Schreibpfad geht ab `clean`, wenn es Vorfahre von HEAD ist, sonst ab dem Anker; `verified` taugt dafür nicht, weil der Clone es als Abstammungsbasis setzt. | M6 |
| `upstream` bei `init` und `backlog add` | `init` mit Remote setzt `upstream` nach erfolgreichem erstem Push; `backlog add` setzt `upstream` = `merge-base(HEAD, refs/remotes/<sync.remote>/<sync.branch>)`, wenn der Tracking-Ref existiert und `verify` bestand. | M6 |
| Schreibpfad bei eingefrorenem Stand | Solange ein ungültiger Commit offen ist, prüft `executeWrite` jeden Commit (auch reine Operationen) mit der Identitätsschutz-Policy und der Regel für verseuchte Pfade gegen den eingefrorenen Stand; ein Grund → `validation` `verify würde den Commit ablehnen: …`. Die Abstammungsprüfung gegen `verified` gilt für Writes nicht. | M6 |
| Verify beim Sync, Aufzeichnen | Eingehendes wird ohne Aufzeichnen geprüft; `verified` und `clean` rücken erst nach dem gelungenen `reset --keep` unter dem Write-Lock vor, und nur wenn HEAD danach `tip` enthält. `upstream` = `tip` nach bestandener Prüfung, nach dem Push der gepushte Commit. | M6 |
| Leerer Remote-Branch | Ohne `tip` gelten als lokale Einheiten die Commits nach `upstream`, sonst nach `verified` — nie ab der Wurzel; so lässt sich eine Historie mehrerer Identitäten auf ein frisches Remote pushen. | M6 |
| §2.16.2 Debounce nach dem Dirty-Flag | Nach dem Anlegen von `sync.dirty` versucht der zurückgestellte Prozess den Lock noch einmal (`timeoutMs: 0`); erst wenn auch das scheitert, endet er — der Halter prüft das Flag dann nachweislich danach. Vordergrund-Sync und Claim starten nach der Freigabe von `sync.lock` einen Hintergrund-Sync, wenn `sync.dirty` liegt. | M6 |
| §2.16.5 Claim im Modus `manual` | nur lokal (backe.md §2.16.5); ersetzt den Halbsatz »der Claim-Sync läuft trotzdem« der Festlegung »§2.16.2 Modus«. | M6 |
| §2.16.5 Claim unter `sync.lock` | Der Claim hält `sync.lock` über blockierende Runde, Claim-Write und Push-Runde; ergibt die Runde weder `claimLost` noch einen Push — oder hat das Replay den Claim ohne Wirkung fallen lassen —, prüft er im Stand `upstream`, dass das Issue `in_progress` mit ihm ist, sonst `conflict`. | M6 |
| Claims nie in der Konfliktablage | Eine Replay-Einheit, die nur aus `issue.claim` besteht und scheitert, wird verworfen (kein Commit, kein Eintrag) mit Hinweis `Claim <id> verloren: <grund>`; sie ist nie Folgeeinheit. | M6 |
| Konfliktablage, Anhangsquelle | Jede abgelegte Einheit trägt `sources` (Op-Index → `<sha>:<pfad>` des ursprünglichen Anhangsinhalts aus der ursprünglichen ID), damit `sync resolve --apply` den Inhalt nach einer ID-Umschreibung wiederherstellt; ein fehlender Blob → `validation`. | M6 |
| §2.16.2 `sync --interactive`, `r` | `r` verwirft den ganzen lokalen Commit. Ein Konfliktmarker ist eine Zeile, die mit `<<<<<<< ` oder `>>>>>>> ` beginnt, oder genau `=======`; eine Setext-Unterstreichung `========` zählt nicht. | M6 |
| `commit --resign`, Basis | `merge-base(upstream, HEAD)` (ohne `upstream`: `verified`); kein gemeinsamer Vorfahr → `verify`. | M6 |
| `sync status` ohne Arbeitskopie | `not_found` (Exit 3) wie jeder lesende Befehl über `requireRoot`. | M6 |
| Hub-Hinweis | Notice `hub_created` (`Hinweis:` im Text, `notices` im JSON), keine Warnung. | M6 |
| Kopfzeile | nur im Text-Modus (`--format text`), nur nach erfolgreichen Befehlen; `next --claim --sync` → `usage`. | M6 |
| Replay und Resign vorab geprüft | Die neuen Commits eines Replays (Sync) und von `commit --resign` werden vor dem `reset --keep` beurteilt wie im Schreibpfad: Der Signier-Key ist ein aktiver Key der eigenen Identität im Stand, gegen den `verify` den nächsten Commit beurteilt (eingefroren, solange ungültige Commits offen sind), und die neuen Commits bestehen — im Gang ab `clean`, sonst ab dem Anker — Signatur, Identitätsschutz-Policy und die Regel für verseuchte Pfade. Ein Grund → im Sync `verify` `verify würde die neu signierten Commits ablehnen: …` mit Hint auf `identities.<backlog>.<handle>.key` und `users/<handle>.md`, bei `--resign` `validation` wie bisher; HEAD, Konfliktablage und Remote bleiben unverändert, `last_error` hält den Fehler. | M6 |
| Journal-Recovery im Sync | Jeder Abschnitt unter dem Write-Lock, der HEAD oder den Arbeitsbaum bewegt (Sync-Runde, `commit --resign`, LFS-Checkout), stellt zuerst ein liegengebliebenes `write.journal` wieder her (`recoverJournal`), wie der Schreibpfad. | M6 |
| Warten auf `sync.lock` | Vordergrund-Sync, `--sync`, `issue claim` und `next --claim` warten bis zu 300 s auf `sync.lock`; tote Halter werden wie bisher übernommen. Der Hintergrund-Lauf bleibt bei `timeoutMs: 0`. Ersetzt den Default-Timeout in der Festlegung »§2.16.2 Debounce«. | M6 |
| Abstammung beim Sync ohne `upstream` | Ohne `upstream` prüft der Sync Eingehendes gegen dieselbe Basis wie der Clone: `merge-base(verified, refs/remotes/<remote>/<branch>)` mit dem Tracking-Ref vor dem Fetch, sonst `verified`, ohne beides den Anker. | M6 |
| LFS-Timeouts | `git lfs fetch` und `git lfs push` laufen mit 300 s Timeout; ein gescheiterter oder abgelaufener `git lfs push` → `sync`, ein `git lfs fetch` bleibt ein Hinweis wie jeder LFS-Pull-Fehler. `setUpLfs` und `git lfs checkout` laufen im Sync unter dem Write-Lock. | M6 |
| §2.19, §2.20 MCP-SDK | v2 (`@modelcontextprotocol/server`, Start über `serveStdio`) statt v1 (`@modelcontextprotocol/sdk`): v1 bekommt Fixes nur mindestens sechs Monate nach dem v2-Release vom 2026-07-27, und die Protokollrevision 2026-07-28 gibt es nur in v2. Vom User freigegeben am 2026-11-20. | M7 |
| §2.19 Tool-Ergebnis | Erfolg: ein Text-Content mit kompaktem JSON, kein `structuredContent`/`outputSchema`. Fehler: `isError: true` mit `{"error":{code,message,hint?,details?}}` wie `errorJson`. Schemaverletzungen vor dem Handler (auch unbekannte Parameter, alle Schemas sind strikt) kommen als Fehler-Ergebnis mit dem Klartext des SDK (`Input validation error: …`); eigene Prüfungen (genau eins von, leer, widersprüchlich) als `usage`/`validation`. | M7 |
| §2.19 `notices` | Im MCP-Ergebnis ist jeder Eintrag `{code?, message, ids?}` (`noticeJson`), auch die String-Hinweise von `sync_now`; die CLI behält ihre Form. | M7 |
| §2.14 Kontext im MCP | Start: `resolveContext` und `requireWriter` mit `cwd`, Env und `-B`/`--as`; scheitert eins, startet der Server nicht (stderr `Fehler:`/`Hinweis:`, Exit 2). Jeder Tool-Aufruf löst neu auf. `-B`/`--as` stehen vor oder nach `mcp`. | M7 |
| §2.19 Nebenläufigkeit | Lokale Writes nacheinander über eine Warteschlange; `issue_claim`, `issue_next` mit `claim` und `sync_now` synchron mit dem Remote daneben, warten auf `sync.lock`. `issue_next` mit `claim` startet wie `next --claim` vorher keinen Hintergrund-Sync. Lesende Tools ohne Warteschlange. | M7 |
| §2.16.2 Hintergrund-Sync im MCP | Nach jedem lokalen Write mit Commit `scheduleSync(…, 'write')` (nicht nach `issue_claim`, `issue_next` mit `claim`, `sync_now`), vor lesenden Tools `'read'`, periodisch alle `pull_interval` Sekunden (Timer `unref()`, `0` = kein Timer). `pull_interval` aus `.backe/backlog.jsonc` in `HEAD` der Arbeitskopie beim Start; ungültige Config: Server startet nicht; Arbeitskopie fehlt: 60 s. | M7 |
| §2.19 Ende | Der Server endet, wenn stdin endet, mit Exit 0; vorher warten Warteschlange, die von ihr angestoßenen Hintergrund-Syncs und laufende synchrone Aufrufe (`issue_claim`, `sync_now`, `issue_next` mit `claim`). | M7 |
| §2.19 Tool-Umfang | Genau die Tools der Tabelle in §2.19 plus `issue_delete` mit `--allow-delete`; alle übrigen Befehle bleiben CLI-only (Liste in backe.md §4.2). | M7 |
| §2.19 `issue_update` und Assignee | `issue_update` nimmt `assignee` (Handle, `me`, `null` = entfernen) über dieselbe Operation `issue.edit` mit `set.assignee` wie `issue assign`; `IssueEditInput` hat dafür `assignee?: string \| null`. | M7 |
| §2.19 `props` als Objekt | `props` in `issue_create`/`issue_update` ist ein Objekt; jeder Wert wird zu `<key>:=<JSON.stringify(wert)>` (`parsePropAssignment`), die Keys prüft die Key-Grammatik aus §2.24 (`validation` `Ungültiger Property-Key »<key>«`). `null` in `issue_update` entfernt die Property, in `issue_create` ist es `validation`. | M7 |
| §2.19 `issue_get.comments` | `none` (Default) → keine, `last` → `comments: 1`, `all` → `'all'`. | M7 |
| §2.19 `attachment_add` | Genau eins von `path` (relativ zum Arbeitsverzeichnis des Servers, `~` expandiert), `url`, `json`, `text`; sonst `usage` `Genau eins von path, url, json, text angeben`. | M7 |
| §2.19 `attachment_get` | Ergebnis wie `attach get --json`, dazu `text`, wenn die Datei ≤ 262 144 Bytes und gültiges UTF-8 ist. LFS-Pointer bleibt der `sync`-Fehler aus M5b. | M7 |
| §2.19 `batch` | `ops` ist ein Array von Objekten; der Adapter macht daraus JSONL für `runBatch`. Leeres Array → `usage` `batch braucht mindestens eine Operation`. | M7 |
| §2.19 Resource | `backe://issue/{id}` als `ResourceTemplate` ohne `list`; `{id}` darf eine Kurz-ID sein; Ergebnis `text/markdown` mit der vollen ID im URI; unbekannte ID → MCP-Fehler mit der Meldung des `BackeError`. | M7 |
| §2.19 Server und Protokoll | `McpServer({name: 'backe', version}, {instructions})`; gestartet über `serveStdio` mit `legacy: 'serve'` (beide Protokoll-Generationen); die Factory ist billig und ohne Nebenwirkung, Warteschlange und Timer leben einmal je Prozess. | M7 |
| §2.19 `batch`, erlaubte Operationen | Der MCP-Adapter prüft jede Operation mit String-`op` vor `runBatch` gegen eine feste Liste: `issue.create`, `issue.edit`, `issue.move`, `issue.resume`, `issue.reopen`, `issue.rank`, `comment.add`, `attach.add`, dazu `issue.delete` nur mit `--allow-delete`. Alles andere → `validation` `Zeile <n>: »<op>« gibt es im MCP-Modus nicht` (`details.line`, ab 1 wie bei `runBatch`), ohne Commit. Einträge ohne String-`op` meldet `runBatch` selbst. | M7 |
| §2.16.2 Periodischer Sync im MCP | Der Timer ruft `scheduleSync(…, 'periodic')`: Modus `auto`, Arbeitskopie und Git-Remote wie bei `'read'`, aber ohne `pullDue` gegen `last_attempt` — der gestartete Prozess schreibt `last_attempt` kurz nach dem Tick, ein Takt genau `pull_interval` später hielte ihn sonst für zu frisch. Das Debounce über `sync.lock` bleibt. | M7 |
| §2.19 `attachment_add.path` | `path` wird gegen `cwd` aufgelöst (`~` expandiert) und physisch aufgelöst (`physicalPath`); es muss `realpath(cwd)` sein oder darunter liegen, verglichen je Pfadsegment (`relative`, nicht String-Präfix), Symlinks nach außen eingeschlossen. Sonst `validation` `Datei »<path>« liegt außerhalb des Arbeitsverzeichnisses`, Hint `Inhalt per text oder json übergeben`; eine fehlende Datei im Arbeitsverzeichnis bleibt `not_found`. | M7 |

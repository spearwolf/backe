# backe — Gesamtplan der Umsetzung

> **For agentic workers:** Dieser Gesamtplan schneidet `docs/proposals/backe.md` in Meilensteine und legt die Schnittstellen zwischen ihnen fest. Umgesetzt wird nie direkt aus diesem Dokument, sondern aus dem Detailplan des jeweiligen Meilensteins (REQUIRED SUB-SKILL: superpowers:subagent-driven-development oder superpowers:executing-plans). Der Detailplan eines Meilensteins entsteht erst, wenn sein Vorgänger abgenommen ist — so plant er gegen gebauten Code statt gegen Annahmen.

**Goal:** `backe` vollständig nach `docs/proposals/backe.md` bauen — CLI, Git-Schicht mit SSH-Signaturen, Sync mit semantischem Replay, MCP-Modus, Release über npm.

**Architecture:** Schichten nach `backe.md` §2.20 (`core` → `store` → `context`/`git` → `ops` → `services` → `cli`/`mcp`), Abhängigkeiten nur nach unten. Die Meilensteine bauen von innen nach außen; jeder endet mit grünem `mise run check` und einem abnehmbaren Stand.

**Tech Stack:** Node.js ≥ 26, TypeScript strict (ESM, `nodenext`), pnpm, Biome, Vitest + v8-Coverage + fast-check, tsdown; Runtime: `commander`, `zod`, `yaml`, `jsonc-parser`, `@modelcontextprotocol/sdk`; System-`git`, `ssh-keygen`.

**Spec:** `docs/proposals/backe.md` (Status `spezifiziert`). Abschnittsverweise hier meinen diese Datei.

## Global Constraints

Gelten für jeden Meilenstein und jeden Task.

- `engines.node: ">=26"`; TypeScript strict, ESM only, `module: nodenext` (§2.20).
- Runtime-Abhängigkeiten ausschließlich `commander`, `zod`, `yaml`, `jsonc-parser`, `@modelcontextprotocol/sdk` (§2.20). Jede weitere Runtime-Abhängigkeit braucht Freigabe des Users.
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

- **Kontext vor CLI.** §6 baut die CLI-Grundbefehle (Schritt 4) vor dem Kontext (Schritt 5). Jeder Write braucht aber Backlog und Identität samt Key (§2.14, §2.16.1) — ohne Kontext gibt es keinen signierten Commit. Hier: M3 Kontext, M4 Git, M5 CLI.
- **Operationen als eigener Meilenstein vor dem ersten Write.** Jeder Commit trägt seine Operation im Trailer `Backe-Op` (§2.13), und das Replay (§2.16.4) setzt voraus, dass schon die ersten Writes Operationen sind. Die Operationsschicht samt Graph-Logik ist rein und ohne Git testbar: M2.

## Meilensteine

| | Meilenstein | Spec | Detailplan |
| --- | --- | --- | --- |
| M1 | Gerüst, `core`, `store` | §2.1–2.6, §2.9–2.12 (Formate), §2.20, §2.21 (`ci.yml`) | [`2026-11-18-backe-m1-kern.md`](./2026-11-18-backe-m1-kern.md) |
| M2 | Operationen und Graph (`ops`) | §2.6, §2.16.4, §2.16.6, §2.22–2.24 | [`2026-11-18-backe-m2-ops.md`](./2026-11-18-backe-m2-ops.md) |
| M3 | Configs und Kontext (`context`, `git/exec`) | §2.14, §2.15 | [`2026-11-18-backe-m3-kontext.md`](./2026-11-18-backe-m3-kontext.md) |
| M4 | Git-Schicht und Schreibpfad (`git`, `services`) | §2.12, §2.13, §2.16.1 | [`2026-11-19-backe-m4-git.md`](./2026-11-19-backe-m4-git.md) |
| M5a | CLI-Kern (`services`, `cli`): Gerüst, Ausgabe, alle Befehle außer den M5b-Gruppen | §2.4–2.7, §2.9–2.12, §2.14, §2.17, §2.18, §2.22–2.24 | [`2026-11-19-backe-m5a-cli-kern.md`](./2026-11-19-backe-m5a-cli-kern.md) |
| M5b | `attach *` samt Größenlimit und LFS, `repo check\|where\|scan`, `commit` und `issue edit` per `$EDITOR`, `batch`, `doctor`, `config get\|set\|edit` | §2.8, §2.11, §2.13 (Hand-Edits), §2.15.1, §2.16.6 | entsteht nach M5a |
| M6 | Sync, Replay, Claim | §2.16.2–2.16.5 | entsteht nach M5b |
| M7 | MCP-Modus (`mcp`) | §2.19 | entsteht nach M6 |
| M8 | Release | §2.21, README | entsteht nach M7 |

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

### M5b — Anhänge, Hand-Edits, Werkzeuge

**Liefert:** Anhänge inkl. Größenlimit und LFS-Pflege (§2.8); `repo check [--remote]|where|scan` (§2.11); `backe commit` und `issue edit` per `$EDITOR` (§2.13, Hand-Edits); `batch` (§2.16.6); `doctor`; `config get|set|edit`; die mit `M5b:` markierten übernommenen Punkte.

**Abnahme:** E2E gegen `dist/cli.js` mit Golden-Files für Text und JSON der neuen Befehlsgruppen; Coverage-Gate für `src/services/**`.

### M6 — Sync, Replay, Claim

**Liefert:** Sync-Runde (fetch, verify, Fast-Forward oder Replay, push mit bis zu 5 Runden Backoff), Hintergrund-Sync als detached Prozess mit Debounce und Dirty-Flag, Replay mit Konfliktablage und Folgeoperationen, ID-Kollision samt Umschreiben, `manual`-Commits per Cherry-Pick, `sync status|resolve|--interactive`, Frische beim Lesen, synchroner Claim, `next --claim`, `commit --resign`.

**Planentscheidung:** Die Reihenfolge paralleler Pushes steuert ein injizierbares `SyncHooks`-Interface der Services; Integrationstests fahren zwei Service-Instanzen in einem Prozess. Kein Env-Schalter im ausgelieferten Code.

**Abnahme:** Integrationstests aus §5 zu parallelen Änderungen, Zyklen aus zwei sauberen Änderungen, `project.mv` im Replay, Re-Signatur, `manual`-Konflikt, parallelem Claim mit genau einem Gewinner, Debounce, `pull_interval` mit Fake Timers.

### M7 — MCP-Modus

**Liefert:** `backe mcp` über stdio mit den Tools und der Resource aus §2.19, `--allow-delete`, periodischen Sync, Start nur mit auflösbarer Identität.

**Abnahme:** SDK-Client über In-Memory-Transport; Snapshot der Tool-Schemas; Flow create → next → claim → comment → move → review (§5).

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
- ✓ **M5:** `resolveShortId` — exakter Suffix-Treffer vor Mehrdeutigkeit, Groß-/Kleinschreibung ignorieren, volle ID ohne Treffer sauber melden; Fehlercodes `usage` vs. `validation` vereinheitlichen. → M5a, Task 1
- **M5b:** Groß-/Kleinschreibung im URL-Pfad (`github.com/Acme/WebApp`) entscheiden; Git-Argv immer mit `--`; Query/Fragment in Repo-URLs; `listIssueIds`/`listComments` Eingabeform prüfen; Ref-Validierung nach `git check-ref-format`.
- **M8:** `ci.yml` mit `permissions: contents: read`; `packageManager`-Feld.

## Übernommen aus M2

Offene Punkte aus den Reviews von M2, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- ✓ **Spec-Fragen (vor M4):** Handle-Wiederverwendung nach `user.rm` — ein neuer User erbt die Autorschaft alter Kommentare (§2.13 Punkt 4); Keys sind nicht eindeutig über Users; ein User kann per `entity.edit` einen eigenen Key aus `revoked_keys` zurückholen; ein Operator kann seinen Agent ohne Zustimmung weitergeben; ein Admin kann »Operator ist Mensch« über einen `kind`-Wechsel des Operators umgehen. → M4, Abschnitt »Spec-Fragen aus M2«, Task 6
- ✓ **Spec-Frage (vor M5, `next`):** `parent` und `depends_on` über Kreuz zwischen Vorfahre und Nachfahre ergeben einen Stillstand ohne `cycle`-Fehler; §2.23 erlaubt beides ausdrücklich. Vorschlag: `depends_on` zwischen Vorfahre und Nachfahre als `cycle` ablehnen. Ebenso: »kein `done`-Parent mit offenen Sub-Issues« wird nur beim Übergang geprüft, nicht beim Anlegen, Umhängen oder Wiedereröffnen eines Kindes. → M5a, Task 2
- ✓ **M4:** `verify` nutzt `checkUserChange` (Admin-Rechte nur für existierende menschliche User; Nicht-Admins legen keine Handles aus `config.admins` an — seit M2 umgesetzt) mit dem Stand nach der Änderung und ruft es für jede Änderung an `users/<handle>.md` auf, auch für Body und unbekannte Keys; Trailer-Bytes nie vergleichen, nur dekodierte Operationen (`decodeOp` akzeptiert nicht-kanonisches JSON); `issue.md` als Symlink wird seit M2 gelesen statt übersprungen; `mapPool` in `loadSnapshot` liest nach einem Fehler weiter. → M4, Task 1, 9 und 10
- ✓ **M5:** `project.mv` lässt eine kaputte Unterprojekt-Datei am alten Pfad zurück; geordnetes Enum mit zahlenartigen Werten (`"01"`) fällt bei `>=`/`<=` durch; `-0` gelangt über `decodeOp` in `props` (im PropValue-Schema ablehnen); `reason_file` ohne `reason` bleibt in `recorded` (im Schema verbieten); ein rank-Anker auf einer kaputten Datei meldet `missing_ref` statt `schema`, `issue.link` mit URL weicht dabei von `repo.add` ab. → M5a, Task 2
- ✓ **M5:** CLI-Flags stehen in Hints der `ops`-Schicht. → M5a, Festlegung »Hints mit CLI-Flags in `ops`/`context`« (bleiben; die Übersetzung für MCP entscheidet M7)
- **M5b:** Batch-Laufzeit wächst mit O(k·n) (jede Operation materialisiert `d.snapshot`; 1 000 Creates auf 20 000 Issues ≈ 2,5 s), dazu quadratisches `topoOrder` in `translate`; `backe commit` ersetzt die Arbeitskopie durch die kanonischen Changes (Mengen-Differenz ändert Listen-Reihenfolge) und legt die Commit-Strategie für gemischte Ergebnisse (`ops` + `manual`) fest — Ops, die auf `manual`-Dateien verweisen, scheitern sonst mit `missing_ref`; getauschte Parents zweier Issues in einem Hand-Edit scheitern ID-abhängig an `cycle`; `user.rm` lässt `lead`/`assignee` hängen (Hinweis in `doctor`).
- **M6:** `commentsNeeded` deckt vorgegebene Kommentarnamen (`comment.add.file`, `reason_file`, `blocker_comments`) nicht ab — beim Replay würde ein vorhandener Kommentar still überschrieben; `issue.resume` kennt kein »Ziel erreicht → No-op« (Scheinkonflikt bei zwei parallelen Resumes, Vorschlag: `to*` aufzeichnen); ein `move` nach `blocked` über eine bestehende Blockade verwirft neue Blocker still; `issue.link` mit `url` zeichnet den abgeleiteten Repo-Namen nicht auf; `substituteIds`/`referencedIds` schreiben nach Feldnamen um (Test über alle Varianten); Replay-Tests sollen `decodeOp(encodeOp(recorded))` anwenden statt der Operation im Speicher.
- **Doku nach Abnahme:** `backe.md` §2.16.4 (Beispiele `issue.body`, `issue.rank` ohne `from`, `comment.add` ohne `body`), §2.24 (`issue.prop`) und §2.13 (Hand-Edits nennen `issue.body`) an den Operationskatalog angleichen; die M2-Planentscheidungen als Präzisierung übernehmen.

## Übernommen aus M3

Offene Punkte aus den Reviews von M3, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- ✓ **M4 — vor `write.lock`:** `withFileLock` übernimmt verwaiste Locks nur per PID — über PID-Namespaces und Hosts hinweg (geteiltes `~/.backe` mit Devcontainer, NFS-Home) gilt ein lebender fremder Halter als tot, nach einem Reboot mit wiederverwendeter PID bleibt ein Lock gehalten. Vorschlag: Hostname als dritte Zeile, automatische Übernahme nur bei gleichem Host, Lock mit Zeitstempel vor dem Boot ist verwaist, fremder Host → `conflict` mit Hint. Restgrenzen des mtime-Leases auf `<lock>.reap` dokumentieren (Reaper > 10 s angehalten, stat-then-unlink bei drei Konkurrenten, unbedingte Freigabe), `ORPHANED_REAP_MS` (10 s) > `timeoutMs` (5 s), Temp-Dateien nach Absturz, `link` ohne Hardlink-Support (EPERM/ENOTSUP → `BackeError` mit Hint), Lock ohne lesbare PID → Hint »falls kein backe-Prozess läuft: <pfad> löschen«. Lock-Reihenfolge festlegen (`write.lock` vor `config.lock`); `withFileLock` ist nicht reentrant — Sync innerhalb von `executeWrite` darf denselben Lock nicht erneut holen. → M4, Task 2 (Temp-Dateien nach Absturz räumt `doctor`, M5)
- ✓ **M4 — Identität je Arbeitskopie:** `requireWriter` lehnt seit M3 eine gebundene Arbeitskopie ab, die laut User-Config einem anderen Handle gehört; `.git/backe/identity` schon bei Clone und `backlog add` setzen und beim Write prüfen (§2.16.1). `registerBacklog` überschreibt bei gleichem Handle einen anderen Pfad still — für `backlog add` `conflict` oder ausdrückliches Umbinden entscheiden. `--purge` löscht außerhalb des Config-Locks (Race mit parallelem Clone). → M4, Task 8, 11 und 12
- ✓ **M4 — Git:** `gitToplevel` macht aus jedem Exit 128 »kein Repo«, auch aus »dubious ownership« (`safe.directory`) — nur bei `not a git repository` `undefined`, sonst werfen. `git()` nimmt `HOME`/`SSH_AUTH_SOCK` aus `process.env`; die Signing-Umgebung legt M4 fest. `writeFileAtomic` ersetzt eine per Symlink eingebundene `config.jsonc` durch eine reguläre Datei und setzt den Modus zurück (gehört zu »Symlinks schreib- und leseseitig«). → M4, Task 1 und 5
- ✓ **M5:** `findProjectConfig` liest beide Dateien per `Promise.all` — Fehlerreihenfolge nichtdeterministisch (Golden Files); rohe Node-Fehler statt `BackeError` (`physicalPath` mit ENOTDIR, `exists()` schluckt EACCES, `readBacklogName`/`readdir`, `ownerOf` bei kaputten fremden `paths`); `gitToplevel(cwd)` zweimal; Anführungszeichen uneinheitlich (`»…«` vs. `"…"`); `schemaError` gehört nicht nach `user-config.ts`. → M5a, Task 1
- ✓ **M5:** Meldungen der `context`-Schicht nennen CLI-Flags (`--path`, `--user`). → M5a, Festlegung »Hints mit CLI-Flags in `ops`/`context`« (bleiben; die Übersetzung für MCP entscheidet M7)
- **M5b:** JSONC-Edit, dessen Ergebnis ungültig ist (Komma am Zeilenanfang), als `unexpected` »Edit konnte nicht angewendet werden« melden statt die Datei zu beschuldigen (`config set`); `normalizeRepoUrl` ist auf der kanonischen Form nicht idempotent (Falle für `repo where`/`scan`); `loadRepoRegistry` läuft bei jeder Auflösung; der Hint `backe backlog list` erscheint auch bei einem Pfad.
- **M8:** Biome meldet 9 `noNonNullAssertion`-Warnungen in `resolve.test.ts` (`s.env.HOME!`) — durch `s.at('home/…')` ersetzen.

## Übernommen aus M4

Offene Punkte aus den Reviews von M4, die ein späterer Detailplan einlösen muss. Abgehakt wird hier, sobald der jeweilige Detailplan sie aufgenommen hat.

- **M6 — vor dem ersten Sync (Pflicht):**
  - **Folge-Commits auf verseuchten Pfaden.** Solange `verify` den Stand einfriert (ein ungültiger Commit ist offen), gilt ein späterer Commit noch als gültig, wenn er auf einem Pfad aufbaut, den der ungültige Commit verändert hat. Beispiel: B setzt `operator: eve` beim Agent von spw, C trägt Eves Key beim Agent ein. Die Rechte werden aus Cs echtem Parent B gelesen. Lösung: Ist der Stand eingefroren, ist eine Änderung an einem Pfad, dessen Inhalt im Parent vom eingefrorenen Stand abweicht, selbst ein Grund (»baut auf ungültigem Commit <kurz> auf«).
  - `trustedMode` beim Clone liest den Verify-Modus im Parent des ersten *verbliebenen* ungültigen Commits statt aus dem eingefrorenen Stand. Lösung: denselben Gang wie in `verify` nutzen.
  - `checkSigningKey` in `executeWrite` prüft gegen HEAD, `verify` gegen den eingefrorenen Stand. Ist ein ungültiger Commit offen, erzeugen neue User und rotierte Keys lokal angenommene, aber von `verify` abgelehnte Commits.
- **M6 — Sync:**
  - Arbeitskopien eines Backlogs ohne Remote: `origin` zeigt auf eine nicht-bare Geschwister-Arbeitskopie, ein Push dorthin wird abgelehnt.
  - Ein Agent, dessen `user.add` noch nicht gepusht ist, kann in einem frischen Clone nicht schreiben. Sync oder Hinweis nötig.
  - Die Abstammungsprüfung beim Clone gegen `verified` einer vertrauten Arbeitskopie schlägt fehl, sobald `verified` auf ungepushte lokale Commits zeigen kann.
  - Die Signal-Verzögerung in `executeWrite` hält nur das erste Signal zurück und verträgt keine eigenen `SIGINT`-Listener von CLI oder MCP. Beides muss mit diesem Mechanismus zusammenarbeiten.
- **M5 — CLI und Services:**
  - ✓ `init` und `backlog add` verlangen absolute Pfade. Die CLI expandiert `~` und relative Pfade gegen das cwd. → M5a, Task 12
  - M5b: Manuelle Writes haben keine HEAD-Vorbedingung, damit sind Lost Updates möglich. Festlegen zusammen mit `backe commit`.
  - ✓ Die Formatversion wird beim Clone nicht geprüft. → M5a, Task 4
  - ✓ Nach einem gescheiterten finalen Move bleibt die Registrierung stehen. → M5a, Task 4
  - ✓ `addBacklog` schreibt Identität und Anker vor `verify` und Registrierung. → M5a, Task 4
  - ✓ Ein verschlüsselter Private Key ohne `.pub` daneben ergibt `unexpected` statt `usage` mit Hinweis. → M5a, Task 3
  - ✓ Nach einem gescheiterten Index-Abgleich ist der Dirty-Hinweis irreführend. Richtig wäre `reset -q -- <pfade>` bzw. `restore --staged --worktree`. → M5a, Task 3
  - ✓ `landedCommit` sollte zusätzlich `Backe-Actor` oder die Message vergleichen. → M5a, Task 3
  - ✓ Ein leerer Quarantäne-Grund kommt bisher aus dem Service; die CLI soll ihn vorab prüfen. → M5a, Task 12
- **M5b — `doctor`:**
  - Mindestversion Git 2.38, wegen `cat-file -Z`; die Spec nennt 2.34 »ungeprüft«.
  - Liegengebliebene `tmp/clone-*` und Lock-Temp-Dateien abgestürzter Prozesse.
  - Kaputte Alternates von Clones, die mit `--reference` angelegt wurden.
  - Gebundene Pfade, die nicht mehr existieren.
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
| §2.6 Move in den aktuellen State | No-op ohne Commit, Exit-Code 0 | M1/M5 |
| §2.10, §2.11 Slugs | Sprint-Slug `[a-z0-9][a-z0-9-]{0,63}`; Repo-Name `[a-z0-9][a-z0-9._-]{0,63}` | M1 |
| `loadSnapshot` mit kaputter Datei | Entität wird übersprungen und als Problem gemeldet; Writes auf sie scheitern mit Exit-Code 2 | M1 |
| §2.11 Cache-TTL für `repo check` | 24 h | M5 |
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
| Hints mit CLI-Flags in `ops`/`context` | bleiben; M7 entscheidet die Übersetzung für MCP. | M5a |
| Clone eines neueren Formats | erlaubt (Lesen geht), `CloneResult.notices` meldet `Backlog-Format <v> ist neuer als dieses backe (<max>); nur lesen`. | M5a |
| §2.12 User ohne aktiven Key | `keys` darf fehlen (kein aktiver Key, User kann nicht signieren); der letzte Key ist widerrufbar; `user add` verlangt weiter ≥ 1 Key; ein neu von Hand angelegter User ohne Keys ist `manual` | M5a |
| §2.12 Key von Hand entfernen | erlaubt ohne `revoked_keys`-Eintrag; der Key ist ab dem Commit ungültig (verify liest Keys aus dem Parent-Stand), keine Anmaßung möglich (§3.10) | M5a |
| §2.18 Fehlercodes | fehlender Pflichtwert und sich ausschließende Angaben = `usage`; gelieferter, aber leerer Wert (auch leeres stdin), ungültiger State, ungültiger Bereichsfilter, zu kurze Kurz-ID = `validation` | M5a |
| §2.18 JSON-Modus | Hinweise und Warnungen eines Writes stehen nur im JSON-Objekt (`notices`, `warnings`); Text-Modus: `Hinweis:`/`Warnung:` auf stderr. Ein Format-Default aus `BACKE_FORMAT`/`output.format`, den ein Befehl nicht kann, fällt auf Text zurück; nur ein explizites `--format`/`--json` ist `usage` | M5a |
| §2.14 `-A` | verwirft nur Werte aus dem Kontext; explizite Filter-Flags filtern weiter | M5a |
| §2.5 Kurzform | Vergleich ohne Groß-/Kleinschreibung, Präfix `bk-` erlaubt, exakter Treffer des Zufallsteils gewinnt vor Mehrdeutigkeit, Kurzform < 3 Zeichen = `validation` | M5a |
| §2.17 `issue edit` | gleicher Wert in `--add-x` und `--rm-x` sowie in `--prop` und `--unset-prop` = `usage`; `--parent` mit `--no-parent` = `usage`; Werte gleich dem Ist-Stand fallen weg, bleibt nichts → `usage` »Nichts zu ändern« | M5a |
| §2.17 Beschreibung aus stdin | leeres stdin bei `-d -`/`--body-file -` = `validation` »Beschreibung ist leer«; `-d ''` oder eine leere Datei leeren den Body bewusst | M5a |
| §2.17 `issue list --blocked` | heißt State `blocked` | M5a |
| §2.7 Kommentar-Reihenfolge | nach Dateiname; Kommentare derselben Sekunde ordnet das Zufallssuffix (deterministisch für gegebene Dateien) | M5a |
| §2.6 Begründung in `issue show` | `lastReason` = jüngster Transition-Kommentar, dessen `to` der aktuelle State ist | M5a |
| §2.13 Kommentar ändern/löschen | Kommentar-Ref und `from_hash` werden vor dem Write-Lock gelesen; `ops` prüft den Hash unter dem Lock, eine zwischenzeitliche Änderung ist `conflict` | M5a |
| §2.14 `backlog add` | Anker wird vor `verify` geschrieben (verify liest ihn) und bei Fehlschlag entfernt; Registrierung und Identität erst nach `verify`; ein Fehler danach nimmt genau die eigene Bindung zurück | M5a |

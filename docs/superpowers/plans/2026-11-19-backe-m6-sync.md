# backe M6 — Sync, Replay, Claim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verteilung nach backe.md §2.16.2–2.16.5: Sync-Runde mit Verify, Fast-Forward oder semantischem Replay und Push; Hintergrund-Sync mit Debounce; Konfliktablage samt `sync status|resolve|--interactive`; Frische beim Lesen; synchroner Claim, `next --claim`, `commit --resign`. Dazu die mit `M6` markierten offenen Punkte aus M4 und M5b.

**Architecture:** Der Sync baut alle neuen Commits als Git-Objekte, ohne Arbeitsbaum oder Refs anzufassen. Dazu lädt er Snapshots aus einem Commit (neue `TreeSource`-Abstraktion in `store`, Git-Implementierung in `git`) und erzeugt Commits direkt aus `FileChange[]` über einen temporären Index. Erst ganz am Ende springt die Arbeitskopie mit einem einzigen `git reset --keep` auf den neuen Stand; ungesicherte Hand-Edits auf unbeteiligten Pfaden überleben das, Hand-Edits auf beteiligten Pfaden brechen die Runde ab, bevor sich etwas ändert. Netzwerk (`fetch`, `push`) läuft außerhalb des Write-Locks, die Rechnung und der `reset --keep` darunter. Backlogs ohne Remote bekommen einen lokalen Hub (bares Repo unter `BACKE_HOME`), sobald eine zweite Arbeitskopie entsteht. Damit läuft jeder Sync gegen ein bares Remote. Den Hintergrund-Sync startet der CLI-Adapter, nicht `executeWrite`; Tests steuern Nebenläufigkeit über ein injizierbares `SyncHooks`-Interface.

**Tech Stack:** wie M5b. Keine neue Runtime-Abhängigkeit. Git-Mindestversion bleibt 2.38 (`merge-file -p`, `reset --keep`, `cat-file -Z` sind darin).

**Spec:** `docs/proposals/backe.md` (§2.5, §2.8, §2.13, §2.16.1–2.16.6, §2.17, §2.18, §2.22, §3.6, §5), Gesamtplan `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`. Es gelten dessen Global Constraints, die M6-Zeilen in »Übernommen aus M4« und »Übernommen aus M5b« (Zuordnung unten) und die Planentscheidungen.

## Global Constraints

Alle Global Constraints des Gesamtplans und von M5a/M5b (Schichten, Services als Eingabegrenze, Fehlercodes, Meldungen mit `»…«`, stdout nur Ergebnis, JSON eine Zeile mit snake_case-Keys, `--end-of-options`/`--` vor Werten aus Nutzereingabe oder Backlog-Daten, E2E nur über `dist/cli.js`). Dazu für M6:

- **Ein Write wartet nie aufs Netz** (backe.md §3.6). `fetch` und `push` laufen ohne Write-Lock; unter dem Write-Lock stehen nur die lokale Rechnung und der abschließende `reset --keep`.
- **Der Sync verändert die Arbeitskopie genau einmal**, und zwar per `git reset --keep <neu>` unter dem Write-Lock. Davor entstehen nur Objekte (Commits, Blobs), keine Ref- oder Dateiänderung. Ein Abbruch an jeder früheren Stelle hinterlässt die Arbeitskopie wie vor der Runde.
- **Kein Env-Schalter** im ausgelieferten Code. Tests steuern Reihenfolge, Pausen, Zeit und das Starten von Prozessen über `SyncDeps`/`SyncHooks` (Gesamtplan, Planentscheidung M6).
- **Tests ohne Netz und ohne Timing.** Remotes sind lokale bare Repos. Wartezeiten (`Backoff`, `pull_interval`) laufen über injiziertes `sleep`/`now` bzw. Fake Timers. Kein Test startet einen echten Hintergrundprozess außer dem E2E-Aufruf von `backe sync --background` als normalem Subprozess.
- E2E-Tests, die den Sync nicht prüfen, setzen `backe config set backlogs.<name>.sync.mode manual`, damit kein Write einen Hintergrundprozess startet.
- Sync-Zustand liegt nur unter `.git/backe/` der Arbeitskopie (`sync.json`, `sync.lock`, `sync.dirty`, `sync.log`, `conflicts/`), nie im Backlog-Baum.
- Coverage-Gate `src/services/**` bleibt `lines: 90, branches: 90`; `src/cli/**` über E2E.

## Review Focus

1. **Hand-Edits während eines Hintergrund-Syncs** — Ein Mensch hat `issues/…/issue.md` im Editor geändert, aber nicht committet; eingehende Commits ändern dieselbe Datei oder eine andere. Erwartet: Bei einer anderen Datei läuft die Runde durch, und der Hand-Edit bleibt byte-gleich stehen. Bei derselben Datei bricht die Runde ab (`conflict`, Hint `backe commit` oder `git stash`), Arbeitskopie und HEAD bleiben unverändert, und `sync status` nennt den Pfad. → Task 6 `hand edits on untouched paths survive a round`, `a hand edit on an incoming path stops the round untouched`.
2. **Netz weg oder Remote nicht erreichbar mitten im Betrieb** — Erwartet: `fetch` scheitert → `sync` (Exit 6), lokale Writes laufen weiter und stapeln sich, `sync status` zeigt den letzten Fehler samt Zeit, und die nächste erfolgreiche Runde pusht alles. Ein Push, der nach dem Replay scheitert, hinterlässt die neu signierten Commits lokal (HEAD steht darauf) und keinen halben Zustand. → Task 6 `an unreachable remote fails with sync and keeps local writes`, `a failed push keeps the replayed commits for the next round`.
3. **Abgestürzter Hintergrund-Sync** — SIGKILL zwischen Commit-Bau und `reset --keep`, liegengebliebenes `sync.lock` eines toten Prozesses. Erwartet: Arbeitskopie und HEAD unverändert, der nächste Sync übernimmt den Lock und läuft. → Task 7 `a stale sync lock of a dead process is taken over`, Task 5 `nothing changes before the final reset`.
4. **Umgeschriebene Remote-Historie** — Force-Push auf dem Remote, ein Remote mit fremdem Wurzel-Commit. Erwartet: `verify` (Exit 5), nichts übernommen, `upstream` unverändert, die lokalen Commits bleiben. → Task 6 `a force-pushed remote is refused`.
5. **ID-Kollision mit Folgeoperationen** — Zwei Clients legen offline Issues an; eins bekommt zufällig dieselbe ID, und auf dem lokalen Issue liegen danach `comment.add`, `issue.edit --add-dep` eines anderen Issues darauf und ein Anhang. Erwartet: Das lokale Issue bekommt beim Replay eine neue ID, alle späteren lokalen Operationen nennen die neue ID, Kommentar und Anhang landen unter dem neuen Verzeichnis, und das Remote-Issue bleibt unberührt. → Task 5 `an id collision rewrites the issue and every later reference`.

## Festlegungen

Stellen, die Spec und Gesamtplan offenlassen und die dieser Plan festlegt. Nach Abnahme wandern sie in die Planentscheidungen des Gesamtplans (Task 11).

| Stelle | Festlegung |
| --- | --- |
| §2.16.1 Backlog ohne Remote | Lokaler Hub `<BACKE_HOME>/backlogs/<name>/hub.git` (bare). Angelegt von `ensureWorkingCopy`, sobald für einen Backlog ohne `remote` in der User-Config eine weitere Arbeitskopie geklont wird: `git clone --bare -q` der Quell-Arbeitskopie in ein Temp-Verzeichnis, unter dem Config-Lock per `rename` an seinen Platz (existiert er schon, gilt der vorhandene). Die Quell-Arbeitskopie bekommt dann den Git-Remote `sync.remote` → Hub (ein vorhandener Remote dieses Namens, der auf ein nicht-bares Verzeichnis zeigt, wird umgehängt; einer auf ein bares Repo oder eine URL bleibt) und ein `fetch`. Die neue Arbeitskopie klont vom Hub, mit `--reference` auf die Quelle. Hinweis im Ergebnis: `Lokaler Hub <pfad> angelegt; <quelle> synct jetzt darüber`. Ein Backlog mit genau einer Arbeitskopie hat keinen Hub; Sync ist dort »kein Remote« (no-op). Ein später ergänztes echtes Remote hängt M6 nicht automatisch um (Roadmap-Punkt). |
| §2.16.2 Remote einer Arbeitskopie | Der Git-Remote `sync.remote` der Arbeitskopie (Default `origin`), Branch `sync.branch`. Fehlt der Git-Remote → Status `kein Remote`, `syncNow` liefert `{ skipped: 'no_remote' }`, Exit 0. |
| §2.16.2 Modus | wirksam = `backlogs.<name>.sync.mode` der User-Config, sonst `sync.mode` aus `.backe/backlog.jsonc` im `HEAD` der Arbeitskopie. `manual` heißt: kein automatischer Start nach Writes und Reads; `backe sync` und der Claim-Sync laufen trotzdem. |
| §2.16.2 Ablauf der Runde | 1. `git fetch -q --no-tags <remote> +refs/heads/<branch>:refs/remotes/<remote>/<branch>` ohne Lock, Timeout 60 s, Scheitern → `sync` `Fetch von <remote> fehlgeschlagen: <erste stderr-Zeile>`. 2. Eingehendes prüfen (Zeile »Verify beim Sync«). 3. Unter dem Write-Lock: lokale Einheiten = `git rev-list --reverse <HEAD> --not <tip>`; keine → `reset --keep <tip>` (Fast-Forward), fertig ohne Push; `tip` Vorfahre von HEAD → kein Replay; sonst Replay auf `tip` (Task 5) und `reset --keep <neu>`. 4. Ohne Lock `git push -q <remote> <sha>:refs/heads/<branch>` (nie `--force`). Abgelehnt (non-fast-forward oder fetch first) → Backoff `200 ms · 2^(runde-1)`, zurück zu 1, höchstens 5 Runden; danach `sync` `Push nach 5 Runden abgelehnt`. Ein leerer Remote-Branch (frischer Hub, frisches Remote) heißt: kein `tip`, lokale Einheiten = alles, gepusht wird HEAD. |
| §2.13 Verify beim Sync | `verifyRange(wc, { to: tip, ancestor: upstream })` prüft ab dem Anker; die Abstammungsprüfung läuft gegen den neuen lokalen Zustand `upstream` (zuletzt verifizierter Remote-Stand), nicht gegen `verified`, das auf ungepushte lokale Commits zeigen darf. Ungültige Commits: Modus aus dem Stand vor dem ersten davon (`trustedMode`, Task 1). `strict` → `verify` (Exit 5), nichts übernommen; `warn` → Gründe als Hinweise, weiter; `off` → still weiter. Nach bestandener Prüfung `upstream` = `tip`, nach erfolgreichem Push `upstream` = gepushter Commit. |
| §2.13 Fremde lokale Commits | Ein lokaler Commit ohne gültige backe-Signatur des eigenen Handles oder ohne lesbaren `Backe-Op` (etwa nacktes `git commit`) blockiert den Sync in jedem Modus: `verify` `Lokaler Commit <kurz> ist nicht von backe signiert`, Hint `backe commit --resign`. |
| §2.16.4 Einheiten | Je lokalem Commit eine Einheit: `Backe-Op: <op>` → `op`, `batch` → `batch` (Ops aus dem Body), `manual` → `manual`. `init` lokal ist nur als Wurzel eines frischen Hubs möglich und wird nie replayt. |
| §2.16.4 Replay je Einheit | `op`/`batch`: vorab Kollisionen umschreiben (Zeile »ID-Kollision«), dann `applyOperation` bzw. `applyBatch` gegen den Stand nach den bisherigen Einheiten. Gelingt es → Commit mit derselben Subject-Logik wie `executeWrite` (`opMessage`), eigener Akteur, eigener Key. Ohne Änderung (alles schon erreicht) → kein Commit. Scheitert es an einer Verletzung (jeder `BackeError` mit `details.reason`) → Einheit in die Konfliktablage. Andere Fehler brechen die Runde ab. |
| §2.16.4 Folgeoperationen | Eine abgelegte Einheit macht ihre Schlüssel »belastet«: alle Issue-IDs aus `referencedIds` ihrer Ops und die IDs, die ihre `issue.create` vergeben haben, dazu je Nicht-Issue-Op `<kind>:<subjekt>` (`project:web/auth`, `sprint:2026-w47`, `repo:api`, `user:claude-1`). Eine spätere Einheit, die einen belasteten Schlüssel nennt, geht ohne eigenen Versuch in denselben Konflikt-Eintrag (`followers`) und belastet ihre Schlüssel mit. |
| §2.16.4 ID-Kollision | Vor dem Anwenden einer Einheit: jede `issue.create` mit `id`, die im aktuellen Stand schon existiert, bekommt eine frische ID (`generateIssueId` gegen den aktuellen Stand); die Zuordnung alt → neu gilt per `substituteIds` für den Rest der Einheit und alle späteren Einheiten. Hinweis `ID-Kollision: <alt> heißt jetzt <neu>` (Code `id_rewritten`, `ids: [alt, neu]`). Anhänge und Kommentare folgen, weil ihre Pfade aus der Op-ID entstehen. |
| §2.8 Anhänge im Replay | `attach.add` mit Datei bekommt `content` aus dem Ursprungs-Commit (`<sha>:<pfad aus der ursprünglichen ID>`), als Blob unverändert übernommen, auch als LFS-Pointer. Führt die Einheit die LFS-Regel ein, übernimmt der neue Commit für jeden Anhang, den der Ursprungs-Commit über seine Ops hinaus renormalisiert hat, den Pointer-Blob aus dem Ursprungs-Commit, sofern der Blob in der neuen Basis gleich dem im Parent des Ursprungs-Commits ist; sonst bleibt er, wie er ist. |
| §2.16.2 `manual`-Einheit | Je Pfad, den der Commit gegenüber seinem Parent ändert: `basis` = Parent, `lokal` = Ursprungs-Commit, `aktuell` = Stand nach den bisherigen Einheiten. `aktuell == basis` → `lokal`; `lokal == basis` oder `lokal == aktuell` → nichts; beide Seiten Text und vorhanden → `git merge-file -p`, sauber → Ergebnis; sonst (Konfliktmarker, Binär, Löschen gegen Ändern) → Runde abbrechen mit `conflict` `Textkonflikt in manual-Commit <kurz>: <pfade>`. Neu signiert mit Subject und `Backe-Op: manual` des Ursprungs-Commits und eigenem `Backe-Actor`. |
| §2.16.4 Konfliktablage | `.git/backe/conflicts/<YYYYMMDDTHHMMSSZ>-<6 hex>.json` = `{"version":1,"id":"<stem>","created":"<iso>","onto":"<tip>","reason":{"code","message","reason"?,"ids"?},"units":[{"sha","subject","kind","ops"}]}`; `units[0]` ist die gescheiterte Einheit, danach die Folgeeinheiten in Reihenfolge. Atomar geschrieben. Ein abgelegter Claim (Zeile »Claim«) landet nicht hier. |
| §2.16.4 `sync resolve` | `sync resolve` ohne Argument = Liste wie in `sync status`. `sync resolve <id> --drop` löscht den Eintrag. `sync resolve <id> --apply` setzt die Vorbedingungen aller Ops auf den aktuellen Stand (`rebaseOp`: `set.*.from`, `from` von `issue.move`, `from_hash` von `issue.edit`-Body und Kommentaren werden die Ist-Werte) und schreibt alle Einheiten als **einen** Batch-Write mit voller Prüfung der Invarianten; Erfolg löscht den Eintrag, Scheitern lässt ihn stehen (Fehler wie beim Write). Genau eins von `--drop`/`--apply`, sonst `usage`; unbekannte ID → `not_found`. |
| §2.16.2 `sync --interactive` | Vordergrund-Runde; bei einem `manual`-Textkonflikt fragt sie je Commit `[e]ditieren, [l]okal nehmen, [r]emote behalten, [a]bbrechen`: `e` schreibt je Konfliktpfad den Text mit Markern (`<<<<<<< remote` / `>>>>>>> lokal`) in eine Temp-Datei, öffnet den Editor (Regeln wie `issue edit` per Editor) und verlangt danach eine Datei ohne Zeilen, die mit `<<<<<<< `, `=======` oder `>>>>>>> ` beginnen (sonst erneut fragen); `l` nimmt `lokal`; `r` lässt den Commit weg; `a` bricht ab wie die Hintergrund-Runde. Danach läuft die Runde weiter. Ohne TTY auf stdin und stdout → `usage` `--interactive braucht ein Terminal`. |
| §2.16.2 Zustand | `.git/backe/sync.json` = `{"version":1,"last_attempt":"<iso>","last_success"?:"<iso>","last_error"?:{"code","message","at","paths"?,"commit"?}}`, nach jeder Runde atomar geschrieben; Erfolg löscht `last_error`. Ein kaputtes `sync.json` gilt als leer. Lokaler Zustand `upstream` in `.git/backe/upstream` (wie `anchor`). |
| §2.16.2 Hintergrund-Prozess | `spawn(process.execPath, [...process.execArgv, process.argv[1], 'sync', '--background', '--backlog', <name>, '--as', <handle>], { cwd: <wc>, detached: true, stdio: ['ignore', log, log], env })` + `unref()`. Log `.git/backe/sync.log` im Append-Modus; ist es beim Start größer als 1 MiB, wird es nach `sync.log.1` verschoben. |
| §2.16.2 Debounce | `sync --background` versucht `sync.lock` einmal (`timeoutMs: 0`). Gehalten → `sync.dirty` anlegen, Exit 0. Sonst Schleife: `sync.dirty` löschen, Runde, solange `sync.dirty` danach existiert. Nach der Freigabe prüft der Prozess `sync.dirty` noch einmal und versucht bei Bedarf erneut den Lock (schließt die Lücke zwischen letzter Prüfung und Freigabe). Fehler einer Runde landen in `sync.json` und im Log, der Prozess endet mit 0. Vordergrund-`backe sync` wartet auf `sync.lock` (Default-Timeout von `withFileLock`) und dreht genau eine Runde (mit ihren bis zu 5 Push-Versuchen). |
| §2.16.1 Start nach Writes | Der CLI-Adapter ruft nach jedem erfolgreichen Write mit Commit `scheduleSync(ctx, 'write')`: Modus `auto` und Git-Remote vorhanden → Hintergrund-Prozess. Kein Remote oder `manual` → nichts. |
| §2.16.3 Frische beim Lesen | Lesende Befehle (Liste in Task 9) rufen vor dem Lesen `freshen(ctx, { force })`. `--sync` → blockierende Runde (`syncNow`); ein Fehler darin bricht den Befehl ab. Sonst bei `auto`, vorhandenem Remote und `now − last_attempt ≥ pull_interval` (fehlt `last_attempt`: immer) → Hintergrund-Prozess, das Lesen läuft sofort weiter. `pull_interval: 0` heißt: bei jedem Read. |
| §2.16.2 Kopfzeile | Im Text-Modus schreibt jeder Befehl mit aufgelöster Arbeitskopie nach seiner Ausgabe eine Zeile auf stderr, sobald etwas offen ist: `Sync: ` + Teile mit ` · ` getrennt: `<n> ungepusht` (nur wenn `n > 0` und die letzte Runde fehlschlug oder der Modus `manual` ist), `<n> Konflikt(e)` (bei `n > 0`), `letzter Sync fehlgeschlagen: <message>` (bei `last_error`); dahinter `Hinweis: backe sync status`. Nichts offen → keine Zeile. JSON-Modus nie. Ohne Remote zählt `ungepusht` nicht. |
| §2.16.5 Claim | `claimIssue`: 1. `syncNow` (blockierend, mit Replay); 2. Write `issue.claim` mit `derive` (prüft claimbar, Exit 4 bei `occupied`/`not_claimable`; schon `in_progress` mit mir → `unverändert`, ohne Push); 3. Push mit dem Claim als letztem Commit; abgelehnt → Runde wiederholen, wobei die Claim-Einheit im Replay **nicht** in die Konfliktablage geht, sondern als `claimLost` endet → Exit 4 `<id> wurde inzwischen von <assignee> übernommen` (bzw. die Meldung der Verletzung). Die übrigen lokalen Einheiten bleiben und gehen beim nächsten Sync raus. Ohne Remote oder bei `manual`: nur Schritt 2, Hinweis `Claim nur lokal: kein Remote` bzw. `Claim nur lokal: sync.mode manual`. |
| §2.16.5 `next --claim` | Auswahl wie `next`; geht der Claim verloren, wählt `next` nach der Runde neu, ohne die verlorenen Kandidaten, höchstens 5 Versuche. Exit 4 erst, wenn alle Versuche verloren gehen (`Claim fünfmal verloren: <ids>`); kein Kandidat → `not_found` wie `next`. |
| §2.13 `commit --resign` | Lokale Commits = `upstream..HEAD` (ohne `upstream`: `verified..HEAD`). Gültige backe-Commits des eigenen Handles bleiben Einheiten wie im Replay; jeder andere wird übersetzt: `translateEdits` gegen den Snapshot seines Parents, `manual`-Anteil zuerst, dann die Ops (Strategie wie `backe commit`). Neu gebaut auf der Basis `upstream` (bzw. `verified`) und mit einem `reset --keep` übernommen. Nichts Fremdes → `Nichts neu zu signieren`, Exit 0. Mit Hand-Edits im Arbeitsbaum zusammen → `usage` `--resign geht nicht zusammen mit Hand-Edits`, Hint `erst backe commit`. |
| §2.16.1 Signale | Ein gemeinsamer, verschachtelbarer Aufschub für SIGINT/SIGTERM (`withDeferredSignals`): Im äußersten Abschnitt werden fremde Listener abgehängt und eigene installiert; jedes Signal wird gemerkt (das erste zählt); am Ende des äußersten Abschnitts kommen die fremden Listener zurück, dann wird das gemerkte Signal einmal neu ausgelöst. Schreibpfad und Sync (der `reset --keep` samt Zustand) nutzen ihn. |
| M4 Verseuchte Pfade | Ist der Stand eingefroren, ist jede Änderung an einem Pfad, dessen Inhalt im Parent vom Inhalt im eingefrorenen Stand abweicht, selbst ein Grund `baut auf ungültigem Commit <kurz> auf` (`<kurz>` = erster offener ungültiger Commit). Verglichen wird über die Blob-IDs der beiden Bäume. |
| M4 Abstammung beim Clone | `cloneInto` prüft gegen `upstream` der vertrauten Arbeitskopie, sonst gegen `git merge-base <verified> refs/remotes/<remote>/<branch>` darin, sonst gegen `verified`. |
| M4 Agent ohne gepushten User | Fehlt `users/<handle>.md` im frischen Clone, liegt aber in der Quell-Arbeitskopie: `sync` `User <handle> ist noch nicht gepusht`, Hint `backe sync --as <identität der quelle>`, Clone verworfen. |
| M5b `attach get` mit Pointer | Beginnt der Inhalt mit `version https://git-lfs.github.com/spec/v1` und ist `attachments.lfs` an → `sync` `Anhang <name> ist nicht geladen (LFS)`, Hint `git -C <wc> lfs pull`. Nach jedem Sync, der den Baum ändert, und nach einem Clone führt `backe` bei `attachments.lfs` `git lfs pull` aus, wenn `git lfs version` gelingt; scheitert es, ein Hinweis, kein Fehler. |
| M5b LFS-Push | Bei `attachments.lfs` läuft vor jedem `git push` `git lfs push <remote> <sha>`; fehlt git-lfs → `validation` `attachments.lfs verlangt git-lfs` wie beim Write. |
| Ausgabe `backe sync` | Text: `aktuell` oder Zeilen `fetch: <n> neue Commits`, `replay: <n> Einheiten neu signiert`, `konflikt: <id>  <subject>` je Eintrag, `push: <sha7>`; `kein Remote` bei Skip. JSON: `{"fetched":<n>,"replayed":<n>,"conflicts":[<id>…],"pushed":<sha\|null>,"rounds":<n>,"skipped"?:"no_remote","notices"?:[…]}`. Exit: Verify 5, Netz/Push 6, `manual`-Konflikt oder blockierende Hand-Edits 4. |
| Ausgabe `sync status` | Text: Zeilen `remote  <url\|kein Remote>`, `modus  <auto\|manual>`, `ungepusht  <n>`, `letzter Sync  <iso\|nie>`, `fehler  <message>` (falls), `läuft  ja` (falls `sync.lock` gehalten), dann je Konflikt `<id>  <subject>  <reason.message>`. JSON: `{"remote","mode","unpushed","last_attempt"?,"last_success"?,"last_error"?,"running","conflicts":[{id,created,subject,reason}]}`. Exit 0. |

### Übernommene Punkte — Zuordnung

| Herkunft | Punkt | Wo |
| --- | --- | --- |
| M4 (Pflicht) | Folge-Commits auf verseuchten Pfaden | Task 1 |
| M4 (Pflicht) | `trustedMode` beim Clone liest den Modus am falschen Commit | Task 1 |
| M4 (Pflicht) | `checkSigningKey` gegen HEAD statt gegen den eingefrorenen Stand | Task 2 |
| M4 | Arbeitskopien ohne Remote (`origin` → nicht-bares Geschwister) | Task 6 (Hub) |
| M4 | Agent mit ungepushtem `user.add` | Task 6 |
| M4 | Abstammungsprüfung beim Clone gegen ungepushtes `verified` | Task 1 |
| M4 | Signal-Verzögerung nur fürs erste Signal, fremde Listener | Task 2 |
| M5b | Renormalisierte Anhänge nicht im Journal | Task 2 |
| M5b | `landedChain` erkennt LFS-Commits nicht | Task 2 |
| M5b | `attach get` liefert Pointer-Text | Task 10 |
| M5b | Fallback `--skip-repo` ohne pre-push-Hook → Sync pusht LFS selbst | Task 6 |
| M5b | Hand-Edits gegen HEAD statt gegen den eingefrorenen Stand | Task 2 |
| M5b | `checkFormatVersion` bei `edits` aus der Arbeitskopie | Task 2 |

---

### Task 1: Verify — verseuchte Pfade, vertrauter Modus, `upstream`

**Files:**
- Modify: `src/services/verify.ts`, `src/services/working-copy.ts`, `src/git/local-state.ts`
- Test: `src/services/verify.test.ts`, `src/services/working-copy.test.ts`

**Interfaces:**
- Produces:
  - `LocalStateName` um `'upstream'` erweitert.
  - `VerifyOptions` bekommt `ancestor?: string` — ersetzt `verified` in der Abstammungsprüfung von `resolveRange`, wenn gesetzt.
  - `walk` wertet die Festlegung »M4 Verseuchte Pfade« aus; `Walk` bekommt `firstOpen: string | undefined` (erster offener ungültiger Commit) und `frozenAt: string | undefined` (der Commit, dessen Stand eingefroren ist).
  - `export async function trustedVerifyMode(wc: string, to?: string): Promise<'strict' | 'warn' | 'off'>` in `verify.ts`: Modus der Config im Stand, gegen den der erste verbliebene ungültige Commit beurteilt wurde (der eingefrorene Stand aus `walk`); ohne lesbare Config `strict`. Ersetzt `trustedMode` in `working-copy.ts`.
  - `cloneInto`: Abstammung nach Festlegung »M4 Abstammung beim Clone«; schreibt `upstream` = `HEAD` des frischen Clones, wenn er von einem Remote kommt.

- [ ] **Step 1: Failing Tests**

```ts
// verify.test.ts
test('a commit building on a path changed by an open invalid commit is itself invalid', async () => {
  // B (unsigniert) setzt operator: eve bei claude-1; C (gültig signiert von spw) trägt Eves Key bei claude-1 ein.
  const r = await verifyRange(wc);
  expect(r.invalid.map((f) => f.sha)).toEqual([B, C]);
  expect(r.invalid[1]?.reasons).toContain(`baut auf ungültigem Commit ${B.slice(0, 7)} auf`);
});
test('a commit on untouched paths after an invalid one stays valid', …);   // C ändert nur issues/… → gültig
test('after a covering quarantine, paths are judged against their parent again', …);
test('ancestor overrides verified in the descent check', async () => {
  // verified zeigt auf einen lokalen, ungepushten Commit; to = Remote-Tip ohne ihn
  expect((await verifyRange(wc, { to: tip, ancestor: upstream })).invalid).toEqual([]);
  expect((await catchErrAsync(() => verifyRange(wc, { to: tip }))).code).toBe('verify');
});
test('trustedVerifyMode reads the frozen state, not the parent of the first remaining invalid commit', …);
// working-copy.test.ts
test('clone checks descent against upstream of the trusted copy', …);   // trusted.verified auf ungepushtem Commit → Clone gelingt
test('clone writes upstream for a remote clone', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/verify.test.ts src/services/working-copy.test.ts` → FAIL**
- [ ] **Step 3: Implementieren** — Vergleich über `git ls-tree` bzw. `objectInfo` beider Stände je geändertem Pfad; nur solange `frozen` gesetzt ist.
- [ ] **Step 4: Tests → PASS; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `fix(services): verify friert auch Pfade ein, Clone prüft gegen upstream`

---

### Task 2: Schreibpfad — Signale, eingefrorener Stand, Journal, LFS

**Files:**
- Create: `src/services/signals.ts`
- Modify: `src/services/write.ts`, `src/services/hand-edits.ts`
- Test: `src/services/signals.test.ts`, `src/services/write.test.ts`

**Interfaces:**
- Consumes: Task 1 (`nextCommitBasis` liefert den eingefrorenen Stand korrekt).
- Produces:
  - `export async function withDeferredSignals<T>(fn: () => Promise<T>, opts?: { raise?: (s: NodeJS.Signals) => void }): Promise<T>` — Festlegung »§2.16.1 Signale«; modulweiter Zähler für die Verschachtelung. `executeWrite` ersetzt `signalDeferral` durch diesen Aufruf um den kritischen Abschnitt; `WriteDeps.raise` bleibt und wird durchgereicht.
  - `checkSigningKey` und die Policy-Prüfung der Hand-Edits (`checkEditsPolicy`, Startzustand) nutzen den Stand aus `nextCommitBasis(wc).state`, wenn er von HEAD abweicht (eingefroren); sonst wie bisher.
  - `checkFormatVersion(wc, rev?: string)`: bei `edits` aus `HEAD:.backe/backlog.jsonc`.
  - Journal: `paths` enthält die renormalisierten Pfade (`step.renormalize`) aller Schritte.
  - `matchesStep` vergleicht für Pfade mit `isLfsPath` unter wirksamer LFS-Regel die Blob-ID gegen `git hash-object --path=<pfad> --stdin` der geplanten Bytes (Clean-Filter) statt der Rohbytes.

- [ ] **Step 1: Failing Tests**

```ts
// signals.test.ts
test('nested sections raise the first signal once after the outermost ends', async () => {
  const raised: string[] = [];
  await withDeferredSignals(async () => {
    await withDeferredSignals(async () => { process.emit('SIGINT'); process.emit('SIGTERM'); }, { raise: (s) => raised.push(s) });
    expect(raised).toEqual([]);
  }, { raise: (s) => raised.push(s) });
  expect(raised).toEqual(['SIGINT']);
});
test('foreign listeners are detached during the section and restored afterwards', async () => {
  const seen: string[] = [];
  const own = () => seen.push('cli');
  process.on('SIGINT', own);
  await withDeferredSignals(async () => { process.emit('SIGINT'); expect(seen).toEqual([]); }, { raise: () => {} });
  expect(process.listeners('SIGINT')).toContain(own);
  process.off('SIGINT', own);
});
// write.test.ts
test('a write with an open invalid commit refuses a key that verify would refuse', …);  // neuer Key im ungültigen Commit → usage
test('hand edits are checked against the frozen state', …);
test('edits read the format version from HEAD', …);                      // Arbeitskopie-Config mit version 99 (Hand-Edit) → kein Abbruch
test('a crash after update-ref with renormalized attachments leaves them unstaged', …); // Journal-Recovery; nur mit git-lfs, sonst skip
test('landedChain recognizes a landed commit with an lfs attachment', …); // nur mit git-lfs, sonst skip
```

- [ ] **Step 2: `pnpm vitest run src/services/signals.test.ts src/services/write.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: Tests → PASS; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `fix(services): Signal-Aufschub verschachtelbar, Writes gegen den eingefrorenen Stand, LFS im Journal`

---

### Task 3: Snapshots aus Commits, Commits aus Änderungen

**Files:**
- Create: `src/store/source.ts`, `src/git/tree-source.ts`, `src/git/commit-changes.ts`, `src/git/merge-file.ts`
- Modify: `src/store/snapshot.ts`, `src/git/commit.ts` (Signieren als gemeinsamer Helfer)
- Test: `src/store/source.test.ts`, `src/store/snapshot.test.ts`, `src/git/tree-source.test.ts`, `src/git/commit-changes.test.ts`, `src/git/merge-file.test.ts`

**Interfaces:**
- Produces:
  - `store/source.ts`:
    - `export type SourceEntry = { name: string; dir: boolean }`
    - `export type TreeSource = { list(dir: string): Promise<SourceEntry[]>; read(path: string): Promise<Buffer | undefined> }` — Pfade relativ, `/`-getrennt; `list` sortiert nach Code-Units, fehlendes Verzeichnis → `[]`; `read` fehlend → `undefined`.
    - `export function fsSource(root: string): TreeSource`
    - `export function overlaySource(base: TreeSource, changes: readonly FileChange[]): TreeSource` — spätere Änderungen gewinnen; `recursive`-Löschung blendet alles darunter aus.
  - `store/snapshot.ts`: `loadSnapshotFrom(src: TreeSource): Promise<BacklogSnapshot>` und `listCommentsFrom(src: TreeSource, id: string)`; `loadSnapshot(root)` = `loadSnapshotFrom(fsSource(root))`, `listComments(root, id)` = `listCommentsFrom(fsSource(root), id)`. Verhalten und Problemmeldungen bleiben identisch (bestehende Tests unverändert grün).
  - `git/tree-source.ts`: `export async function gitTreeSource(wc: string, rev: string): Promise<TreeSource>` — ein `git ls-tree -r -z --full-tree <rev>`, dann alle Blobs unter `.backe/`, `users/`, `projects/`, `sprints/`, `repos/`, `.gitattributes` und `issues/*/*/issue.md` in **einem** `readBlobs`-Aufruf vorab; alle anderen Pfade bei Bedarf (mit Cache).
  - `git/commit-changes.ts`: `export async function commitChanges(wc: string, input: { parent: string | undefined; changes: readonly FileChange[]; message: string; key: string; author: { name: string; email: string }; env: GitEnv }): Promise<string>` — temporärer Index aus `parent`, Inhalte per `git hash-object -w --stdin` **ohne** `--path` (Bytes unverändert, auch Pointer), Einträge per `update-index --index-info` (Modus `100644`), Löschung per `update-index --force-remove`, rekursive Löschung per `rm --cached -r -q --ignore-unmatch`; leere Änderung am Baum → `unexpected` `Write ohne Änderung am Baum`; signiert wie `commitPaths` (gemeinsamer Helfer `signedCommit(wc, { tree, parent, message, key, author, env })`). Rührt weder HEAD noch Index noch Arbeitsbaum an.
  - `git/merge-file.ts`: `export async function mergeText(wc: string, sides: { base: Buffer; ours: Buffer; theirs: Buffer; labels: [string, string, string] }): Promise<{ clean: boolean; content: Buffer }>` — Temp-Dateien in `stateDir(wc)`, `git merge-file -p -L <ours> -L <base> -L <theirs>`; Exit 0 → `clean: true`, Exit > 0 → `clean: false` mit Markern, Exit < 0/Fehler → `unexpected`.

- [ ] **Step 1: Failing Tests**

```ts
// snapshot.test.ts
test('loadSnapshotFrom(gitTreeSource(HEAD)) equals loadSnapshot of a clean working copy', async () => {
  expect(await loadSnapshotFrom(await gitTreeSource(wc, 'HEAD'))).toEqual(await loadSnapshot(wc));
});
test('a hand edit changes loadSnapshot but not the HEAD source', …);
// source.test.ts
test('overlaySource applies writes, deletions and recursive deletions in order', …);
// commit-changes.test.ts
test('commitChanges builds a signed commit without touching HEAD, index or files', async () => {
  const before = { head: await revParse(wc, 'HEAD'), status: await statusShort(wc) };
  const sha = await commitChanges(wc, { parent: before.head, changes: [{ path: 'notes/a.md', content: 'x\n' }], message: 'm\n\nBacke-Actor: spw\nBacke-Op: manual\n', key, author, env });
  expect(await revParse(wc, 'HEAD')).toBe(before.head);
  expect(await statusShort(wc)).toEqual(before.status);
  expect((await sigOf(wc, sha)).status).toBe('G');
  expect(await git(['show', `${sha}:notes/a.md`], { cwd: wc })).toMatchObject({ stdout: 'x\n' });
});
test('commitChanges removes an issue directory recursively', …);
test('commitChanges stores bytes verbatim, also lfs pointers', …);
test('commitChanges without effect is unexpected', …);
// merge-file.test.ts
test('non-overlapping edits merge cleanly', …);
test('overlapping edits return markers with the labels', …);   // enthält '<<<<<<< remote' und '>>>>>>> lokal'
```

- [ ] **Step 2: `pnpm vitest run src/store src/git` → FAIL**
- [ ] **Step 3: Implementieren** — `loadSnapshot` intern auf `TreeSource` umstellen, ohne die Lesereihenfolge oder `mapPool`-Parallelität zu ändern.
- [ ] **Step 4: Tests → PASS; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `feat(git): Snapshots aus Commits und Commits aus Dateiänderungen`

---

### Task 4: `ops` — Replay-Bausteine

**Files:**
- Create: `src/ops/replay.ts`
- Modify: `src/ops/operation.ts` (nur falls `subjectOf` exportiert werden muss)
- Test: `src/ops/replay.test.ts` (erweitern)

**Interfaces:**
- Produces:
  - `export function rewriteCollisions(s: BacklogSnapshot, ops: readonly Operation[], map: Map<string, string>, ctx: Pick<ApplyContext, 'randomBytes'>): { ops: Operation[]; notices: Notice[] }` — Festlegung »ID-Kollision«; wendet erst `map` an, dann ergänzt sie um neue Kollisionen der `issue.create`s in `ops` (auch Kollisionen untereinander nach Umschreiben ausgeschlossen).
  - `export function taintKeys(ops: readonly Operation[], created: readonly string[]): string[]` — Festlegung »Folgeoperationen«.
  - `export function rebaseOp(s: BacklogSnapshot, op: Operation, comments?: ReadonlyMap<string, readonly StoredEntity<Comment>[]>): Operation` — Festlegung »`sync resolve`«; Ops ohne Vorbedingung kommen unverändert zurück.
  - `export function isViolation(err: unknown): err is BackeError` — `BackeError` mit `details.reason`.

- [ ] **Step 1: Failing Tests**

```ts
test('a colliding create gets a fresh id and later ops follow', () => {
  const s = snap({ issues: [{ id: I(1), title: 'remote' }] });
  const map = new Map<string, string>();
  const r = rewriteCollisions(s, [create(I(1), 'lokal'), { op: 'comment.add', id: I(1), file: F, body: 'x' }], map, { randomBytes: seqBytes(9) });
  const fresh = map.get(I(1));
  expect(fresh).toBeDefined();
  expect(fresh).not.toBe(I(1));
  expect(r.ops.map((o) => 'id' in o && o.id)).toEqual([fresh, fresh]);
  expect(r.notices).toEqual([{ code: 'id_rewritten', message: `ID-Kollision: ${I(1)} heißt jetzt ${fresh}`, ids: [I(1), fresh] }]);
});
test('taintKeys names issue ids, created ids and entity subjects', () => {
  expect(taintKeys([{ op: 'project.mv', from: 'web/auth', to: 'platform/auth' }], [])).toEqual(['project:web/auth']);
});
test('rebaseOp moves preconditions to the current values', () => {
  const s = snap({ issues: [{ id: I(1), title: 'B', state: 'review' }] });
  expect(rebaseOp(s, { op: 'issue.edit', id: I(1), set: { title: { from: 'A', to: 'C' } } }))
    .toEqual({ op: 'issue.edit', id: I(1), set: { title: { from: 'B', to: 'C' } } });
  expect(rebaseOp(s, { op: 'issue.move', id: I(1), from: 'todo', to: 'done' })).toMatchObject({ from: 'review' });
});
test('a rebased op still fails on invariants', () => { /* depends_on-Zyklus nach rebaseOp → reason cycle */ });
```

- [ ] **Step 2: `pnpm vitest run src/ops/replay.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: Tests → PASS; Coverage `src/ops/**` ≥ 90 %**
- [ ] **Step 5: Commit** — `feat(ops): Bausteine fürs Replay — ID-Kollisionen, Folgeschlüssel, Vorbedingungen neu setzen`

---

### Task 5: Services — Replay auf eine Basis

**Files:**
- Create: `src/services/replay.ts`, `src/services/sync-state.ts`
- Test: `src/services/replay.test.ts`, `src/services/sync-state.test.ts`, `test/helpers/git.ts` (Helfer `twoClones`)

**Interfaces:**
- Consumes: Tasks 3, 4; `opMessage` und `manualStep`-Logik aus `write.ts` (als `export function opMessage(...)` bzw. `manualMessage(subject, handle)` herauslösen).
- Produces:
  - `export type ReplayUnit = { sha: string; subject: string; kind: 'op' | 'batch' | 'manual'; ops: Operation[] }`
  - `export async function readUnits(wc: string, range: { base: string | undefined; head: string }, handle: string): Promise<ReplayUnit[]>` — Festlegungen »Einheiten« und »Fremde lokale Commits« (Signaturprüfung gegen den Users-Stand des Parents über `signatureCache`).
  - `export type ReplayResult = { head: string; replayed: number; conflicts: ConflictEntry[]; claimLost?: { id: string; error: BackeError }; notices: Notice[] }`
  - `export async function replayOnto(wc: string, input: { onto: string; units: readonly ReplayUnit[]; actor: string; key: string; author: { name: string; email: string }; env: GitEnv; now: () => Date; randomBytes?: (n: number) => Uint8Array; claimSha?: string; resolveManual?: ManualResolver }): Promise<ReplayResult>` — baut alle Commits mit `commitChanges` auf `onto`; Snapshot über `loadSnapshotFrom(overlaySource(gitTreeSource(wc, onto), bisherige Änderungen))`, danach je Einheit über `ApplyResult.snapshot` weitergereicht. Rührt Arbeitskopie und Refs nicht an und schreibt keine Konflikt-Einträge: Die liefert `ReplayResult.conflicts`, und `syncNow` (Task 6) schreibt sie erst nach dem erfolgreichen `reset --keep` per `writeConflicts`, damit ein späterer Abbruch keine verwaisten Einträge hinterlässt.
  - `export type ManualResolver = (c: { sha: string; subject: string; paths: { path: string; base: Buffer | null; ours: Buffer | null; theirs: Buffer | null; merged?: Buffer }[] }) => Promise<{ kind: 'edit'; files: Map<string, Buffer> } | { kind: 'local' } | { kind: 'remote' } | { kind: 'abort' }>` — ohne Resolver gilt `abort`; `ours` = aktueller Stand (Remote-Seite), `theirs` = lokal.
  - `sync-state.ts`:
    - `export type ConflictEntry = { version: 1; id: string; created: string; onto: string; reason: { code: string; message: string; reason?: string; ids?: string[] }; units: { sha: string; subject: string; kind: ReplayUnit['kind']; ops: Operation[] }[] }`
    - `writeConflicts(wc, entries)`, `listConflicts(wc): Promise<ConflictEntry[]>` (nach `id`), `removeConflict(wc, id)`.
    - `export type SyncState = { last_attempt?: string; last_success?: string; last_error?: { code: string; message: string; at: string; paths?: string[]; commit?: string } }`; `readSyncState(wc)`, `writeSyncState(wc, s)`.
  - `test/helpers/git.ts`: `twoClones(): Promise<{ remote: string; spw: TestBacklog & { ctx: ResolvedContext }; agent: { ctx: ResolvedContext; wc: string } }>` — Backlog mit bare Remote, Agent `claude-1` (Operator spw) mit eigener Arbeitskopie, beide auf demselben gepushten Stand; `sync.mode` bleibt `auto` (die Services starten nichts).

- [ ] **Step 1: Failing Tests (`replay.test.ts`, echte Repos, je zwei Arbeitskopien)**

```ts
test('parallel edits of different fields replay without conflict', …);          // backe.md §5
test('the same field edited on both sides lands in the conflict store', async () => {
  const r = await replayOnto(/* lokal: title A→C, remote: title A→B */);
  expect(r.conflicts).toHaveLength(1);
  expect(r.conflicts[0]?.reason).toMatchObject({ code: 'conflict', reason: 'precondition' });
});
test('two clean depends_on additions forming a cycle are shelved with their followers', async () => {
  // remote: X depends_on Y; lokal: Y depends_on X, danach comment.add auf Y, danach unabhängiges issue.create Z
  expect(r.conflicts[0]?.units.map((u) => u.kind)).toEqual(['op', 'op']);
  expect(r.conflicts[0]?.reason.reason).toBe('cycle');
  expect(r.replayed).toBe(1);                                                    // nur Z
});
test('project.mv in replay also moves an issue assigned to the old path meanwhile', …); // backe.md §5
test('replayed commits are signed with the own key and carry the own actor', …);
test('a batch is replayed as one unit and shelved as one', …);
test('an id collision rewrites the issue and every later reference', …);          // Review Focus 5
test('attach.add takes its content from the original commit', …);
test('a manual commit on untouched paths is cherry-picked and re-signed', …);
test('a manual text conflict aborts without writing conflicts', async () => {
  const err = await catchErrAsync(() => replayOnto(/* manual ändert notes.md, remote auch, überlappend */));
  expect(err.code).toBe('conflict');
  expect(err.message).toMatch(/^Textkonflikt in manual-Commit [0-9a-f]{7}: notes\.md$/);
});
test('a resolver choosing local, remote and edit is honoured', …);
test('nothing changes before the final reset', async () => {
  const before = { head: await revParse(wc, 'HEAD'), status: await statusShort(wc) };
  await replayOnto(/* … */);
  expect({ head: await revParse(wc, 'HEAD'), status: await statusShort(wc) }).toEqual(before);
});
test('a lost claim unit is reported as claimLost, not shelved', …);
test('readUnits refuses a foreign local commit with a resign hint', …);
// sync-state.test.ts
test('conflict entries round-trip and list sorted', …);
test('a broken sync.json reads as empty', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/replay.test.ts src/services/sync-state.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: Tests → PASS; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `feat(services): semantisches Replay auf einen Remote-Stand mit Konfliktablage`

---

### Task 6: Services — Sync-Runde, Hub, Push

**Files:**
- Create: `src/services/sync.ts`, `src/services/hub.ts`
- Modify: `src/services/working-copy.ts` (Hub beim Clone ohne Remote, ungepushter User), `src/git/query.ts` (Remote-URL lesen)
- Test: `src/services/sync.test.ts`, `src/services/hub.test.ts`, `src/services/working-copy.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 5.
- Produces:
  - `export type SyncHooks = { afterFetch?: (round: number) => Promise<void>; beforePush?: (round: number, sha: string) => Promise<void>; afterRound?: () => Promise<void> }`
  - `export type SyncDeps = { now?: () => Date; randomBytes?: (n: number) => Uint8Array; sleep?: (ms: number) => Promise<void>; hooks?: SyncHooks; lock?: LockOptions; spawn?: SpawnFn; resolveManual?: ManualResolver }` (`SpawnFn` aus Task 7).
  - `export type SyncOutcome = { fetched: number; replayed: number; conflicts: string[]; pushed: string | undefined; rounds: number; skipped?: 'no_remote'; notices: string[]; claimLost?: { id: string; error: BackeError } }`
  - `export async function syncNow(ctx: ResolvedContext, deps?: SyncDeps, opts?: { claimSha?: string }): Promise<SyncOutcome>` — eine Runde nach Festlegung »Ablauf der Runde«, unter `sync.lock` (wartend); schreibt `sync.json`, Konflikt-Einträge, `upstream`; nach Baumänderung `git lfs pull` (Festlegung »M5b `attach get`«). Fehler werden nach dem Schreiben von `last_error` neu geworfen: Hand-Edits auf beteiligten Pfaden → `conflict` `Ungesicherte Änderungen an <pfade> verhindern den Sync`, Hint `backe commit oder git -C <wc> stash`.
  - `export function effectiveMode(ctx: ResolvedContext, config: BacklogConfig): 'auto' | 'manual'`
  - `export async function syncRemote(wc: string, remote: string): Promise<string | undefined>` — URL des Git-Remotes oder `undefined`.
  - `hub.ts`: `export async function ensureHub(homes: Homes, name: string, source: string, config: { remote: string; branch: string }): Promise<{ hub: string; created: boolean }>` — Festlegung »Backlog ohne Remote«.
  - `ensureWorkingCopy` ohne registriertes Remote: `ensureHub` + Clone vom Hub mit `--reference` auf die Quelle; `notices` bekommt den Hub-Hinweis. Festlegung »M4 Agent ohne gepushten User«.

- [ ] **Step 1: Failing Tests (`sync.test.ts`, zwei Service-Instanzen in einem Prozess)**

```ts
test('a round fast-forwards when only the remote moved', …);
test('a round pushes local commits when the remote did not move', …);
test('a round replays local commits onto a moved remote and pushes', …);
test('hand edits on untouched paths survive a round', …);                           // Review Focus 1
test('a hand edit on an incoming path stops the round untouched', async () => {
  const err = await catchErrAsync(() => syncNow(agent.ctx));
  expect(err.code).toBe('conflict');
  expect(await revParse(agent.wc, 'HEAD')).toBe(headBefore);
  expect((await readSyncState(agent.wc)).last_error?.paths).toEqual([path]);
});
test('a push rejected by a faster client retries after replay', async () => {
  // hooks.beforePush von spw pausiert; agent pusht dazwischen; spw: rounds === 2, sleep mit 200 aufgerufen
});
test('five rejected pushes end with sync', …);                                       // sleep-Aufrufe [200, 400, 800, 1600]
test('an unreachable remote fails with sync and keeps local writes', …);             // Review Focus 2
test('a failed push keeps the replayed commits for the next round', …);
test('a force-pushed remote is refused', …);                                         // Review Focus 4, Exit-Code 5, upstream unverändert
test('an invalid incoming commit in warn mode is reported and taken', …);
test('a working copy without remote skips', async () => {
  expect(await syncNow(solo.ctx)).toMatchObject({ skipped: 'no_remote', rounds: 0 });
});
// hub.test.ts
test('a second identity without remote creates the hub and both copies sync through it', …);
test('two concurrent first clones share one hub', …);                                // beforeFinish-Hook
test('a source remote pointing to a non-bare sibling is moved to the hub', …);
// working-copy.test.ts
test('an agent whose user is not pushed yet gets a sync hint', …);                   // Code sync, Hint »backe sync --as spw«
```

- [ ] **Step 2: `pnpm vitest run src/services/sync.test.ts src/services/hub.test.ts src/services/working-copy.test.ts` → FAIL**
- [ ] **Step 3: Implementieren** — Netzwerkaufrufe mit `transportEnv(ctx.env)`; der Abschnitt unter dem Write-Lock läuft in `withDeferredSignals`.
- [ ] **Step 4: Tests → PASS; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `feat(services): Sync-Runde mit Verify, Replay und Push; lokaler Hub ohne Remote`

---

### Task 7: Services — Hintergrund, Debounce, Frische, Status

**Files:**
- Create: `src/services/background.ts`
- Modify: `src/services/sync-state.ts`
- Test: `src/services/background.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces:
  - `export type SpawnFn = (args: { argv: string[]; cwd: string; env: Env; log: string }) => void` — Default nach Festlegung »Hintergrund-Prozess«.
  - `export async function runBackground(ctx: ResolvedContext, deps?: SyncDeps): Promise<{ rounds: number; deferred: boolean }>` — Festlegung »Debounce«; wirft nie (Fehler in `sync.json` und als Zeile `<iso> <code>: <message>` ins Log).
  - `export async function scheduleSync(ctx: ResolvedContext, reason: 'write' | 'read', deps?: SyncDeps): Promise<boolean>` — Festlegungen »Start nach Writes« und »Frische beim Lesen«; liefert, ob gestartet wurde.
  - `export async function freshen(ctx: ResolvedContext, opts: { force: boolean }, deps?: SyncDeps): Promise<SyncOutcome | undefined>` — `force` → `syncNow`, sonst `scheduleSync(ctx, 'read')`.
  - `export type SyncStatus = { remote: string | undefined; mode: 'auto' | 'manual'; unpushed: number; running: boolean; state: SyncState; conflicts: ConflictEntry[] }`
  - `export async function syncStatus(ctx: ResolvedContext): Promise<SyncStatus>` — `unpushed` = `rev-list --count <upstream>..HEAD` (ohne Remote 0).
  - `export function statusLine(s: SyncStatus): string | undefined` — Festlegung »Kopfzeile« (ohne Präfix `Hinweis:`; den setzt die CLI).

- [ ] **Step 1: Failing Tests**

```ts
test('a second background run while one holds the lock only marks dirty', async () => {
  // hooks.afterFetch des ersten Laufs pausiert; zweiter runBackground → { rounds: 0, deferred: true }, sync.dirty existiert;
  // erster läuft weiter → rounds === 2, sync.dirty weg
});
test('a dirty flag set right before release triggers another round', …);
test('a stale sync lock of a dead process is taken over', …);                        // Review Focus 3, isAlive: () => false
test('scheduleSync after a write spawns only in auto mode with a remote', …);        // spawn-Spy; manual → false; kein Remote → false
test('the spawned argv names sync --background with backlog and handle', …);
test('freshen spawns when pull_interval has elapsed', () => {
  vi.useFakeTimers({ now: new Date('2026-11-19T10:00:00Z') });
  // last_attempt 10:00:00, pull_interval 60 → 10:00:59 kein Spawn, 10:01:00 Spawn
});
test('pull_interval 0 spawns on every read', …);
test('freshen with force runs a blocking round', …);
test('statusLine shows conflicts, failures and unpushed only when relevant', () => {
  expect(statusLine(status({ unpushed: 2, mode: 'auto' }))).toBeUndefined();
  expect(statusLine(status({ unpushed: 2, mode: 'manual', conflicts: 1 }))).toBe('Sync: 2 ungepusht · 1 Konflikt');
  expect(statusLine(status({ lastError: 'Fetch von origin fehlgeschlagen: x', unpushed: 1 })))
    .toBe('Sync: 1 ungepusht · letzter Sync fehlgeschlagen: Fetch von origin fehlgeschlagen: x');
});
```

- [ ] **Step 2: `pnpm vitest run src/services/background.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: Tests → PASS; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `feat(services): Hintergrund-Sync mit Debounce, Frische beim Lesen, Sync-Status`

---

### Task 8: Services — Claim, `next --claim`, `resolve`, `--resign`

**Files:**
- Create: `src/services/claim.ts`, `src/services/resolve.ts`, `src/services/resign.ts`
- Modify: `src/services/next.ts` (Auswahl mit Ausschlussliste)
- Test: `src/services/claim.test.ts`, `src/services/resolve.test.ts`, `src/services/resign.test.ts`

**Interfaces:**
- Consumes: Tasks 4–7.
- Produces:
  - `export type ClaimOutcome = WriteOutcome & { local?: 'no_remote' | 'manual'; pushed?: string }`
  - `export async function claimIssue(ctx: ResolvedContext, ref: string, deps?: SyncDeps & WriteDeps): Promise<ClaimOutcome>` — Festlegung »Claim«.
  - `export async function nextClaim(ctx: ResolvedContext, q: NextQuery, deps?: SyncDeps & WriteDeps): Promise<NextOutcome & { claim: ClaimOutcome; attempts: string[] }>` — Festlegung »`next --claim`«; `nextIssue` bekommt `exclude?: readonly string[]` in `NextQuery`.
  - `export async function resolveConflict(ctx: ResolvedContext, id: string, action: 'drop' | 'apply', deps?: WriteDeps): Promise<{ commit: string | undefined; ops: Operation[] }>` — Festlegung »`sync resolve`«.
  - `export async function resignCommits(ctx: ResolvedContext, deps?: WriteDeps): Promise<{ commits: { commit: string; kind: ChainEntry['kind']; summary: string }[]; rewritten: number }>` — Festlegung »`commit --resign`«; unter dem Write-Lock, Übernahme per `reset --keep` in `withDeferredSignals`.

- [ ] **Step 1: Failing Tests**

```ts
// claim.test.ts
test('parallel claim from two clones has exactly one winner', async () => {
  // spw.beforePush pausiert nach dem lokalen Claim; agent claimt dasselbe Issue und pusht; spw läuft weiter
  const [a, b] = await Promise.allSettled([claimIssue(spw.ctx, id, spwDeps), claimIssue(agent.ctx, id)]);
  expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
  expect(((a.status === 'rejected' ? a : b) as PromiseRejectedResult).reason.code).toBe('conflict');
  // Remote: genau ein claim-Commit für id; der Verlierer hat keinen lokalen Claim-Commit mehr, seine übrigen Commits bleiben
});
test('claim from backlog works with workflow.strict', …);
test('claiming my own in_progress issue is unchanged without push', …);
test('claim without remote is local with a notice', …);                 // local: 'no_remote'
test('claim in manual mode is local with a notice', …);
test('a non-claimable issue exits with conflict', …);
test('next --claim tries the next candidate after a lost claim', …);   // attempts.length === 2
test('next --claim gives up after five lost claims', …);                // Code conflict, Meldung »Claim fünfmal verloren: …«
// resolve.test.ts
test('drop removes the entry', …);
test('apply rebases preconditions and writes one batch', …);
test('apply that still violates an invariant keeps the entry', …);
test('unknown conflict id is not_found', …);
// resign.test.ts
test('resign translates a bare git commit into operations and signs it', …);
test('resign keeps valid backe commits as they are', …);
test('resign with nothing foreign reports nothing to do', …);
test('resign with hand edits in the working copy is a usage error', …);
```

- [ ] **Step 2: `pnpm vitest run src/services/claim.test.ts src/services/resolve.test.ts src/services/resign.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: Tests → PASS; `mise run check` → PASS; Coverage `src/services/**` ≥ 90 %**
- [ ] **Step 5: Commit** — `feat(services): synchroner Claim, next --claim, sync resolve und commit --resign`

---

### Task 9: CLI — `sync`, `issue claim`, `next --claim`, `commit --resign`, Frische, Kopfzeile

**Files:**
- Create: `src/cli/commands/sync.ts`
- Modify: `src/cli/run.ts`, `src/cli/options.ts`, `src/cli/commands/issue.ts`, `src/cli/commands/next.ts`, `src/cli/commands/commit.ts`, alle lesenden Befehle (Liste unten), `test/e2e/tools.ts` (Setup: `sync.mode manual`)
- Test: `test/e2e/sync.test.ts`, `test/e2e/golden/`

**Interfaces:**
- Consumes: Tasks 6–8.
- Produces:
  - `CommandSpec` bekommt `read?: true` und `write?: true`. `read`: Option `--sync`, vor der Aktion `freshen(ctx, { force: opts.sync === true })`. `write`: nach erfolgreicher Aktion mit Commit `scheduleSync(ctx, 'write')`. Lesend: `issue list|show`, `next` (ohne `--claim`), `comment list`, `attach list|get`, `project list|show`, `sprint list|show`, `repo list`, `user list|show`, `context`. Schreibend: jeder Befehl, der `executeWrite` erreicht.
  - Nach jeder Aktion im Text-Modus: Ist eine Arbeitskopie aufgelöst und `statusLine` nicht leer → stderr `<statusLine>\nHinweis: backe sync status\n`. Fehler beim Bestimmen des Status bleiben still.
  - Befehle: `sync [--background] [--interactive]`, `sync status`, `sync resolve [<id>] [--drop | --apply]`, `issue claim <id>`, `next --claim` (Ausgabe wie `next`, dahinter wie ein Write: JSON zusätzlich `commit`, `attempts`), `commit --resign` (Text: je Commit `summary`, sonst `Nichts neu zu signieren`; JSON `{"commits":[…],"rewritten":<n>}`). Festlegungen »Ausgabe `backe sync`« und »Ausgabe `sync status`«; Claim-Hinweise `Claim nur lokal: …` auf stderr.
  - `--background` schreibt nichts nach stdout und endet immer mit 0.

- [ ] **Step 1: Failing E2E-Tests (`test/e2e/sync.test.ts`; Remotes als bare Repos im Temp-Verzeichnis)**

```ts
test('sync pushes and a second clone sees the issue', …);                // Golden sync.txt, sync.json
test('sync status shows unpushed, last sync and conflicts', …);          // Golden sync-status.txt, sync-status.json
test('a shelved conflict is listed, applied and dropped via sync resolve', …);
test('issue claim pushes; a second claim from another clone exits 4', …);
test('next --claim claims and prints the issue', …);
test('a read with --sync pulls before listing', …);
test('a failed sync shows the status line on stderr in text mode only', async () => {
  // Remote-Verzeichnis gelöscht → backe sync Exit 6; danach backe ls: stderr enthält »Sync: « und »Hinweis: backe sync status«; mit --json nicht
});
test('sync --background runs a round and exits 0', …);
test('commit --resign signs a bare git commit', …);
test('sync without remote prints kein Remote', …);
```

- [ ] **Step 2: `pnpm build && pnpm vitest run test/e2e/sync.test.ts` → FAIL**
- [ ] **Step 3: Implementieren; `test/e2e/tools.ts` und bestehende E2E-Setups setzen `sync.mode manual`**
- [ ] **Step 4: `pnpm build && pnpm vitest run test/e2e -u`, Golden-Files gegen die Festlegungen prüfen; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `feat(cli): sync, sync status und resolve, issue claim, next --claim, commit --resign`

---

### Task 10: CLI — `sync --interactive`, LFS beim Lesen

**Files:**
- Create: `src/cli/prompt.ts`
- Modify: `src/cli/io.ts`, `src/cli/commands/sync.ts`, `src/cli/editor.ts`, `src/services/attachments.ts`
- Test: `src/cli/prompt.test.ts`, `test/e2e/sync.test.ts`, `src/services/attachments.test.ts`

**Interfaces:**
- Consumes: Task 5 (`ManualResolver`), Task 6.
- Produces:
  - `CliIo` bekommt `prompt(question: string): Promise<string>` (`nodeIo`: `readline` auf stdin/stderr, eine Zeile, getrimmt; EOF → `''`).
  - `interactiveResolver(io: CliIo): ManualResolver` in `prompt.ts` — Festlegung »`sync --interactive`«; unbekannte Eingabe → erneut fragen; leere Eingabe (EOF) → `abort`.
  - `attach get` nach Festlegung »M5b `attach get` mit Pointer«.

- [ ] **Step 1: Failing Tests**

```ts
// sync.test.ts (E2E; prompt über einen Test-Hook ist nicht möglich → E2E nur für den TTY-Fehler)
test('sync --interactive without a tty is a usage error', …);            // Exit 2, »--interactive braucht ein Terminal«
// src/cli/prompt.test.ts (Unit gegen ein Fake-CliIo; Adaptercode, zählt nicht ins Gate)
test('interactive resolver maps l, r, a and retries on unknown input', …);
test('edit loops until no conflict markers remain', …);                  // Editor-Fake schreibt erst mit, dann ohne Marker
// attachments.test.ts
test('attach get on an lfs pointer asks for lfs pull', …);               // nur mit git-lfs, sonst skip
```

- [ ] **Step 2: `pnpm vitest run src/cli/prompt.test.ts src/services/attachments.test.ts && pnpm build && pnpm vitest run test/e2e/sync.test.ts` → FAIL**
- [ ] **Step 3: Implementieren**
- [ ] **Step 4: Tests → PASS; `mise run check` → PASS**
- [ ] **Step 5: Commit** — `feat(cli): sync --interactive für Textkonflikte, LFS-Pointer bei attach get`

---

### Task 11: Abnahme — Doku und Gesamtplan

**Files:**
- Modify: `README.md`, `docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`

**Interfaces:**
- Produces:
  - README: Stand nach M6 (»sync, claim, background sync and conflict handling work; the MCP server is not built yet«).
  - Gesamtplan: M6-Zeile der Meilenstein-Tabelle verlinkt diesen Plan; M6-Punkte unter »Übernommen aus M4/M5b« sind abgehakt (`✓ … → M6, Task n`); die Festlegungen dieses Plans als Planentscheidungen mit Meilenstein `M6`; neuer Abschnitt »Übernommen aus M6« für offene Befunde des Abschluss-Reviews und den Roadmap-Punkt »Hub auf ein später ergänztes echtes Remote umhängen«; Abschnitt M6 mit »Abgenommen am …« erst nach dem Abschluss-Review.

- [ ] **Step 1: README und Gesamtplan aktualisieren**
- [ ] **Step 2: `mise run check` → PASS; CI grün auf `ubuntu-latest` und `macos-latest`**
- [ ] **Step 3: Commit** — `docs: Gesamtplan nach M6`

---

## Abnahme M6

- `mise run check` grün, CI grün auf `ubuntu-latest` und `macos-latest`.
- Integrationstests aus backe.md §5: parallele Änderungen verschiedener Felder, gleiches Feld → Konflikt-Eintrag, Zyklus aus zwei sauberen Änderungen samt Folgeoperationen, `project.mv` im Replay, Re-Signatur mit dem eigenen Key, `manual`-Konflikt lässt die Arbeitskopie sauber, paralleler Claim mit genau einem Gewinner (Reihenfolge über `SyncHooks`), Debounce und Dirty-Flag über einen pausierenden Hook, `pull_interval` mit Fake Timers.
- E2E gegen `dist/cli.js` mit Golden-Files für `sync`, `sync status`; Exit-Codes 4, 5 und 6 je mindestens einmal aus dem Sync.
- Coverage-Gate `src/services/**` eingehalten.
- Gesamtplan zeigt die M6-Punkte als eingelöst und M7 als nächsten Meilenstein.

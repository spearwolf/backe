# backe — Git-basiertes Backlog für Menschen und Agents

> **Status: umgesetzt (M1–M8); veröffentlicht auf npm als `@spearwolf/backe` (erste Version 0.1.1).**
> Verbindlicher Spec, beschreibt den gebauten Stand. Keine offenen Entscheidungen.
> Bezug: — (erstes Proposal des Projekts)

## 0. Problem & Abgrenzung

### 0.1 Problem

Issues sollen dort leben, wo Code und Agents ohnehin arbeiten: als Dateien in einem Git-Repository, von Hand editierbar, maschinenlesbar, versioniert und verteilt über ganz normales `git push`. Mehrere Agents und Menschen arbeiten parallel am selben Backlog; jede Änderung muss einer Identität zweifelsfrei zuzuordnen sein. Ein Agent bekommt den Auftrag »arbeite Sprint X ab« und muss daraus selbstständig ableiten können, welches Issue als Nächstes dran ist, wem es gehört und wo das zugehörige Repository lokal liegt.

`backe` ist das CLI dafür, mit einem MCP-Modus als zweiter Tür für Agents. Der Name ist die eingedeutschte, personifizierte Kurzform von »Backlog«: back-e.

### 0.2 Ziele

- Ein Backlog ist ein eigenständiges Git-Repository; `backe` kennt mehrere Backlogs und einen aktiven Kontext (vergleichbar mit Namespaces in `kubectl`).
- Issues mit Zustandsmodell, Projekten (hierarchisch), Sprints, Kommentaren, Anhängen und Repository-Verknüpfungen.
- Jede schreibende Operation ist signiert und einer registrierten Identität (Mensch oder Agent) zugeordnet.
- Parallelbetrieb mehrerer Agents ohne Merge-Conflict-Hölle; ein Issue kann nicht von zwei Agents gleichzeitig »geclaimt« werden.
- Dateiformat und CLI-Ausgabe sind token-sparsam.
- `backe` trägt als Issue-Grundlage die Agent-Skills `js-ts-project-audit` und `js-ts-audit-remediation` (§2.25): deren Findings, Pakete, Läufe und Entscheidungen lassen sich ohne Sonderfelder im Kern abbilden.

### 0.3 Nicht-Ziele (v1)

- Kein Server, keine Datenbank, kein Web-UI, kein TUI. Eine lokale Web-Oberfläche als eigener Befehl `backe ui` beschreibt UI (`ui.md`).
- Keine Synchronisation mit GitHub Issues, Jira o. ä.
- Keine eingebaute Priorität, Labels, Schätzungen, Zeiterfassung. Wer so etwas braucht, legt es als Custom Property ab (§2.24).
- Keine Verschlüsselung. Signiert heißt authentisch, nicht geheim.
- Keine Rollen oder Rechte über den Schutz gegen Identitätsanmaßung hinaus (§3.10). Jedes Mitglied darf jedes Issue anlegen, ändern, verschieben und löschen.
- Kein dauerhaft laufender Daemon (§3.8).

### 0.4 Anti-Ziele

Das Projekt ist gescheitert, auch wenn alles technisch funktioniert, wenn …

- … ein Mensch die Issue-Datei nicht mehr gern im Editor öffnet, weil sie voller Hashes, Signaturen und generierter Felder steckt;
- … zwei Agents, die verschiedene Felder desselben Issues ändern, regelmäßig einen Merge-Konflikt erzeugen;
- … ein Agent für »was ist mein nächstes Issue?« mehrere tausend Tokens Output lesen muss.

### 0.5 Prior Art

Abgleich vor dem Bau lohnt sich (ungeprüft, aus dem Gedächtnis): **git-bug** (Operationen als Git-Objekte, nicht als Dateien — maximal merge-fest, aber nicht von Hand editierbar), **Backlog.md** (Markdown-Tasks im Repo, CLI und MCP — am nächsten an `backe`, aber ohne Signaturen und ohne separates Backlog-Repo mit Kontexten), **beads** (Agent-Issue-Tracker mit JSONL und Hash-IDs). `backe` unterscheidet sich durch die Kombination aus separatem Backlog-Repo, Kontext-Auflösung, Signaturen und Claim-Semantik für Multi-Agent-Betrieb.

## 1. Ist-Zustand

`backe` ist nach diesem Spec gebaut, in den Meilensteinen M1–M8 des Gesamtplans; Gesamtplan und Detailpläne liegen unter `docs/superpowers/plans/`. Was der erste Release bewusst offen lässt, steht in §4.2.

## 2. Soll-Zustand

### 2.1 Entitäten

| Entität | Datei im Backlog | Kern-Attribute |
| --- | --- | --- |
| Backlog | `.backe/backlog.jsonc` | Name, ID-Präfix, Admins, Sync-, Verify- und Anhang-Policy |
| User | `users/<handle>.md` | Name, Art (`human`/`agent`), Public Keys, bei Agents der verantwortliche Mensch |
| Projekt | `projects/<pfad>.md` | Titel, Beschreibung; Hierarchie über den Pfad |
| Sprint | `sprints/<slug>.md` | Titel, optional Start/Ende, Ziel |
| Repository | `repos/<name>.md` | Git-URL, Default-Ref |
| Issue | `issues/<shard>/<id>/issue.md` | ID, Titel, State, Creator, Assignee, Parent, Abhängigkeiten, Projekte, Sprints, Repos, Anhänge, Custom Properties, Beschreibung |
| Kommentar | `issues/<shard>/<id>/comments/<ts>-<user>-<rnd>.md` | Autor, Zeitpunkt, Art, Text |
| Anhang | `issues/<shard>/<id>/attachments/<datei>` oder URL im Frontmatter | Name (Pflicht), Datei oder URL |

### 2.2 Layout eines Backlogs

```
<backlog>/                          eigenständiges Git-Repo
├── .backe/
│   └── backlog.jsonc               Backlog-Config (§2.15.3)
├── .gitattributes                  von backe gepflegt (LFS-Regeln für Anhänge, §2.8)
├── .gitignore                      von backe init angelegt (Editor- und Systemdateien, §2.13)
├── users/
│   ├── spw.md
│   └── claude-1.md
├── projects/
│   ├── web.md
│   └── web/
│       └── auth.md                 Projekt »web/auth«
├── sprints/
│   └── 2026-w47.md
├── repos/
│   └── webapp.md
└── issues/
    └── 7f/                         Shard: erste 2 Zeichen des Zufallsteils (§2.5)
        └── bk-7f3k2/
            ├── issue.md
            ├── comments/
            │   └── 20261118T100400Z-spw-q8x.md
            └── attachments/
                └── trace.json
```

Regeln:

- **Eine Entität, eine Datei.** Zwei parallele Änderungen an verschiedenen Entitäten berühren nie dieselbe Datei.
- **Issues liegen nach ID geshardet unter `issues/<shard>/`**, nicht unter Projekten — ein Issue kann mehreren Projekten angehören, und ein Projekt-Umzug darf keine Issue-Dateien verschieben. Der Pfad ist eine reine Funktion der ID (§2.5) und ändert sich nie.
- **Abgeleitetes wird nicht eingecheckt.** `allowed_signers`, Caches, Sync-Logs und Locks liegen unter `.git/backe/` der lokalen Arbeitskopie.

### 2.3 Dateiformate

- **Entitäten:** Markdown mit YAML-Frontmatter. Der Body ist die Beschreibung (Markdown), das Frontmatter trägt die Metadaten.
- **Konfiguration:** JSONC (`*.jsonc`), mit JSON Schema für Editor-Support.
- **YAML-Subset:** nur Maps, Listen, Strings, Zahlen, Booleans, ISO-8601-Timestamps. Keine Anchors, keine Tags, keine Multi-Docs, keine Kommentare im Frontmatter. Der Parser lehnt alles andere mit `datei:zeile` ab.
- **Kanonische Serialisierung:** `backe` schreibt Keys in fester Reihenfolge: bekannte Keys in der Reihenfolge der Schema-Definition, danach unbekannte in ihrer Originalreihenfolge, zuletzt `props`. Listen stehen als Flow-Sequenz, solange die Zeile `key: [a, b]` höchstens 100 Zeichen hat (`projects: [web/auth, api]`), sonst als Block. Ein Roundtrip `parse → serialize` einer kanonischen Datei ist byte-identisch. Damit erzeugt jede Änderung den kleinstmöglichen Diff.
- **Eigene Daten gehören nach `props`** (§2.24). Unbekannte Top-Level-Keys bleiben trotzdem erhalten und werden nach den bekannten ausgegeben, damit kein Hand-Edit verloren geht; `backe commit` und `backe verify` warnen aber, weil eine künftige Version denselben Namen als eingebautes Feld beanspruchen könnte.
- **Kein `updated`-Feld, kein Zähler.** Ein Feld, das bei jeder Änderung neu geschrieben wird, macht jede parallele Änderung desselben Issues zum Zeilenkonflikt. Wann zuletzt geändert wurde, sagt `git log`; `backe` liest es von dort.
- Zeilenenden LF, UTF-8, abschließender Newline. Zeilenenden und Schluss-Newline normalisiert `backe` beim Write auch im Body.
- **Kaputte Dateien:** Eine Entitätsdatei, die sich nicht parsen oder validieren lässt, überspringt `backe` beim Laden und meldet sie als Problem; Writes auf diese Entität scheitern mit Exit-Code 2.

### 2.4 Issue

```markdown
---
id: bk-7f3k2
title: SSO-Login bricht nach Token-Refresh ab
state: blocked
blocked_by: [bk-a91c0]
paused_from: in_progress
parent: bk-x2c8d
depends_on: [bk-3m9qa]
rank: 3000
creator: spw
assignee: claude-1
projects: [web/auth]
sprints: [2026-w47]
repos: [webapp@feat/sso, infra@4e1f9c2]
attachments:
  - {name: trace, file: trace.json}
  - {name: figma, url: "https://www.figma.com/file/…"}
created: 2026-11-18T10:04:00Z
props:
  estimate_h: 4
  github_issue: acme/webapp#123
---
Nach dem Refresh des Access-Tokens landet der User wieder auf `/login`.

## Akzeptanzkriterien
- [ ] Refresh hält die Session
```

| Feld | Pflicht | Regel |
| --- | --- | --- |
| `id` | ja | unveränderlich, entspricht dem Verzeichnisnamen (§2.5) |
| `title` | ja | eine Zeile, 1–200 Zeichen (gezählt in Unicode-Codepoints) |
| `state` | ja | §2.6 |
| `blocked_by` | wenn `state: blocked` | ≥ 1 existierende Issue-ID, nicht die eigene; sonst verboten |
| `paused_from` | wenn `blocked`/`on_hold` | State vor der Pause, von `backe` gesetzt; Ziel von `resume` |
| `parent` | nein | genau eine existierende Issue-ID; macht das Issue zum Sub-Issue (§2.23) |
| `depends_on` | nein | existierende Issue-IDs, die vorher erledigt sein müssen — harter Zwang (§2.22) |
| `rank` | nein | Ganzzahl, kleiner = früher — weiche Reihenfolge (§2.22) |
| `creator` | ja | Handle eines Users; unveränderlich; muss dem Signierer des erzeugenden Commits entsprechen (§2.13) |
| `assignee` | nein | Handle eines Users |
| `projects` | nein | existierende Projekt-Pfade |
| `sprints` | nein | existierende Sprint-Slugs; beliebig viele |
| `repos` | nein | `name` oder `name@ref`; `name` muss in `repos/` registriert sein; `ref` ist Branch, Tag oder Commit; höchstens ein Eintrag je Repo-Name (`issue link` ersetzt den Ref) |
| `attachments` | nein | §2.8 |
| `created` | ja | UTC, unveränderlich |
| `props` | nein | beliebige Custom Properties (§2.24); steht immer als letzter Key |

Die Beschreibung ist freies Markdown. `backe` fasst den Body nie an, außer der User ändert ihn ausdrücklich; nur Zeilenenden und der Schluss-Newline werden beim Write normalisiert (§2.3).

### 2.5 Issue-IDs

- Format `<präfix>-<5 Zeichen Crockford-Base32, lowercase>`, z. B. `bk-7f3k2`. Präfix aus `backlog.jsonc` (`id_prefix`, 2–6 Zeichen `[a-z]`).
- Zufällig erzeugt (`crypto.randomBytes`), nicht fortlaufend: Zwei Agents, die offline gleichzeitig ein Issue anlegen, kollidieren bei fortlaufenden Nummern garantiert, bei 32⁵ ≈ 33,5 Mio. Möglichkeiten praktisch nie.
- Kollision mit einer lokal existierenden ID → neu würfeln. Kollision beim Sync (§2.16) → das lokal neue Issue wird beim Replay mit neuer ID angelegt; die alte ID erscheint in der Ausgabe von `backe sync`.
- Bei mehr als 50 000 Issues im Backlog steigt die Länge für neue IDs auf 6 Zeichen.
- **Ablage (Sharding):** Ein Issue liegt unter `issues/<shard>/<id>/`. `<shard>` sind die ersten zwei Zeichen des Zufallsteils der ID: `bk-7f3k2` → `issues/7f/bk-7f3k2/`. Das ergibt 32² = 1024 mögliche Shards; weil die Zeichen gleichverteilt gewürfelt werden, füllen sie sich gleichmäßig — bei 10 000 Issues rund 10 je Shard, bei 50 000 rund 50. Das Verzeichnis trägt weiterhin die volle ID, damit `find`/`grep` und Menschen es ohne Umrechnung erkennen. Auch 6-stellige IDs (s. u.) bleiben bei zwei Shard-Zeichen. Die Shard-Regel ist Teil der Formatversion (`version` in `backlog.jsonc`, §2.15.3); eine Änderung wäre ein Major-Bump mit Migrationsbefehl.
- **Kurzform:** Überall, wo eine ID erwartet wird, genügt ein eindeutiger Anfang des Zufallsteils ohne Backlog-Präfix (`7f3` statt `bk-7f3k2`), analog zu Git-Short-Hashes. Verglichen wird ohne Groß-/Kleinschreibung; der Präfix des Backlogs darf davorstehen (`bk-7f3`), ein fremder Präfix (`ac-7f3` in einem `bk`-Backlog) passt nie (`not_found`). Ein exakter Treffer des ganzen Zufallsteils gewinnt vor Mehrdeutigkeit. Ab zwei Zeichen muss `backe` dafür nur einen Shard lesen. Mehrdeutig → Exit-Code 2 mit Kandidatenliste. Die Kurzform braucht mindestens 3 Zeichen, kürzer ist `validation`.

### 2.6 Zustandsmodell

```
           ┌──────────── Hauptlinie ────────────┐
 backlog → todo → in_progress → review → done
    ↑                                      │
    └──────────── reopen ──────────────────┘

 Seitenzustände (aus jedem Hauptlinien-Zustand erreichbar):
   blocked   – Pflicht: blocked_by (≥ 1 Issue-ID)
   on_hold   – optional: reason (Markdown)
   cancelled – optional: reason; terminal bis reopen
   rejected  – optional: reason; terminal bis reopen
```

Schreibweise in Dateien: `snake_case`. Das CLI akzeptiert zusätzlich `kebab-case` (`in-progress`).

Übergänge:

- **Hauptlinie:** frei vor und zurück, auch mit Sprüngen (`backlog → in_progress` beim Claim). Mit `workflow.strict: true` in `backlog.jsonc` nur zum direkten Nachbarn; aus `blocked` und `on_hold` gemessen an `paused_from`.
- **Move in den aktuellen State** ist kein Fehler, sondern ein No-op ohne Commit: Ausgabe `unchanged: …`, Exit-Code 0.
- **→ `blocked`/`on_hold`:** `backe` setzt `paused_from`. `backe issue resume <id>` kehrt dorthin zurück und entfernt `paused_from` und `blocked_by`. Ein expliziter Übergang in einen anderen Hauptlinien-Zustand ist ebenso erlaubt.
- **Zwischen Seitenzuständen:** `blocked ↔ on_hold` ist erlaubt; `paused_from` bleibt dabei erhalten, `blocked_by` entfällt beim Wechsel nach `on_hold`. Aus `blocked` und `on_hold` geht es direkt nach `cancelled` oder `rejected`; `paused_from` und `blocked_by` entfallen. Jeder Übergang, der `blocked` verlässt, entfernt `blocked_by`.
- **Letzter Blocker gelöscht:** Entfernt `issue delete` die letzte ID aus `blocked_by` eines anderen Issues, setzt dieselbe Operation dieses Issue auf `on_hold` (mit erhaltenem `paused_from`) und schreibt einen Transition-Kommentar »Blocker <id> gelöscht«. Ein `blocked` ohne Blocker gibt es nie.
- **Blocker erledigt:** Erledigt heißt hier dasselbe wie bei `depends_on` (§2.22): `done`, `cancelled` oder `rejected`. Sind alle Issues in `blocked_by` erledigt, wird das blockierte Issue **nicht** automatisch entsperrt (jeder Write braucht einen signierenden Akteur), aber `backe issue list --unblockable` findet es und `backe next` meldet es als Hinweis. Ist ein Blocker `cancelled` oder `rejected` statt `done`, sagt der Hinweis das ausdrücklich — das Hindernis ist dann nicht beseitigt, nur nicht mehr in Arbeit.
- **Zyklen** in `blocked_by` werden beim Setzen abgelehnt.
- **Issue mit offenen Sub-Issues → `done`** wird abgelehnt (Exit-Code 4, Liste der offenen Sub-Issues); `--force` setzt es trotzdem. Offen heißt: nicht `done`, `cancelled` oder `rejected` (§2.23). Umgekehrt kommt kein Kind unter einem `done`-Parent in einen offenen State: Anlegen, Umhängen, `move`, `resume` und `reopen` eines Kindes scheitern dann mit Exit-Code 4 und dem Hinweis `backe issue reopen <parent>`; `move --force` übergeht das wie die `done`-Sperre.
- **`blocked_by` ist nicht `depends_on`.** `blocked_by` beschreibt ein akutes Hindernis während der Arbeit, gehört zum State `blocked` und löst sich nur durch ein ausdrückliches `resume`. `depends_on` (§2.22) ist ein beim Planen gesetzter harter Zwang, gilt in jedem State, ändert den State nie und löst sich von selbst, sobald die Abhängigkeiten erledigt sind. Die weiche Reihenfolge ist keins von beiden, sondern `rank`.
- **`done`, `cancelled`, `rejected`:** nur über `backe issue reopen <id> [--to todo]` verlassbar (Default `backlog`).
- **Begründung:** Ein `--reason` (Markdown, inline, aus Datei oder stdin) wird als Kommentar mit `kind: transition` gespeichert (§2.7), nicht im Frontmatter. `backe issue show` zeigt beim State die Begründung aus dem jüngsten Transition-Kommentar, dessen `to` der aktuelle State ist.

### 2.7 Kommentare

```markdown
---
author: claude-1
created: 2026-11-18T10:04:00Z
kind: transition
from: in_progress
to: on_hold
---
Warte auf Freigabe der Redirect-URIs durch das IdP-Team.
```

- `kind`: `comment` (Default) oder `transition` (mit `from`, `to`).
- Dateiname `<created als YYYYMMDDTHHMMSSZ>-<author>-<3 Zeichen Zufall>.md` — chronologisch sortierbar, kollisionsfrei, append-only. Parallele Kommentare erzeugen nie Konflikte.
- **Reihenfolge** ist die der Dateinamen. Kommentare derselben Sekunde ordnet damit das Zufallssuffix: beliebig, aber für gegebene Dateien stabil.
- Bearbeiten und Löschen nur durch den Autor (geprüft in §2.13). `comment edit|delete <id> <kommentar>` nimmt den vollen Dateinamen oder den 1-basierten Index aus `comment list`.
- `backe issue show` zeigt per Default keine Kommentare, nur ihre Anzahl und die jüngste Transition-Begründung; `--comments <n|all>` holt sie dazu. Token-Sparsamkeit für Agents.

### 2.8 Anhänge

- Ein Issue darf beliebig viele Anhänge beliebigen Dateityps haben (Bilder, PDFs, Archive, JSON, …); `backe` interpretiert Dateiinhalte nicht, außer bei `--json` (s. u.).
- Jeder Anhang hat einen `name`: Pflicht, eindeutig pro Issue, `[a-z0-9][a-z0-9._-]{0,63}`.
- **Datei:** wird nach `attachments/<datei>` kopiert; Frontmatter-Eintrag `{name, file}`. Enthält `name` einen Punkt, ist er der Dateiname, sonst `name` plus die kleingeschriebene Endung der Quelle. Passt das Ergebnis nicht zum Namensmuster → `validation` mit Hinweis `--name <n>.<ext>`. Die Quelle muss eine reguläre Datei sein (Verzeichnis → `validation`, fehlt → `not_found`); leere Dateien sind erlaubt.
- **JSON:** `--json '<json>'` oder `--json -` (stdin) wird validiert, mit zwei Leerzeichen Einrückung formatiert (Key-Reihenfolge bleibt) und als `<name>.json` abgelegt — außer `name` endet schon auf `.json` —, also ein Datei-Anhang. Ungültiges JSON → `validation`. Bei `attach add` ist `--json` deshalb die Inhaltsquelle und nicht die globale Option; JSON-Ausgabe gibt es dort per `--format json`.
- **URL:** nur im Frontmatter `{name, url}`, keine Datei.
- Größenlimit pro Datei `attachments.max_bytes` in `backlog.jsonc` (Default 10 MiB, `null` = kein Limit), auch mit LFS; darüber Abbruch mit Hinweis auf LFS. Das Limit schützt das Git-Repo vor versehentlich eingecheckten Riesendateien, nicht vor bestimmten Dateitypen.
- `attachments.lfs: true` → `backe` pflegt `.gitattributes` (`issues/*/*/attachments/** filter=lfs diff=lfs merge=lfs -text`) und setzt `git lfs` voraus (`backe doctor` prüft das). Die Regel gilt als vorhanden, wenn eine Zeile ohne Leerraum am Rand genau so lautet.
  - **Einrichtung je Arbeitskopie:** `git lfs install --local` (Filter-Config und LFS-Hooks nur in deren `.git/config`; steht dort schon ein fremder Hook, ohne Hooks); die globale Git-Config bleibt unberührt. Der Commit, der die Regel einführt, nimmt alle schon roh committeten Anhänge mit auf; sie landen als Pointer.
  - **Transport:** Vor jedem Push des Sync läuft `git lfs push`. Nach einem Clone und nach jedem Sync, der den Baum ändert, holt `git lfs pull` die Objekte; scheitert das Holen, ist es ein Hinweis, kein Fehler. LFS-Aufrufe brechen nach 300 s ab; ein gescheitertes `git lfs push` ist ein Sync-Fehler.
  - **Nicht geladene Anhänge:** Liegt statt der Datei ein LFS-Pointer in der Arbeitskopie (erkannt nur bei `attachments.lfs: true`), scheitert `attach get` mit Exit-Code 6 (`Attachment '<name>' is not loaded (LFS)`, Hinweis `git -C <wc> lfs pull`). `attach list --format json` kennzeichnet sie mit `not_loaded: true`.
- **Ohne LFS-Smudge**, unabhängig von `attachments.lfs`: Clone, Branch-Wechsel und das Zurücksetzen der Arbeitskopie beim Sync lassen den LFS-Filter keine Objekte laden; Dateien unter einer LFS-Regel kommen dabei als Pointer an. Nur bei `attachments.lfs: true` folgt `git lfs pull` (s. o.).
- `backe attach get <id> <name> [-o pfad]`: Text ohne `-o` schreibt die Dateibytes roh nach stdout; `-o` schreibt die Datei (überschreibt) und druckt den Zielpfad; bei URL-Anhängen nur die URL. JSON: `{name, file?, url?, size?, path?}` (`path` ist das Ziel bzw. der absolute Pfad in der Arbeitskopie), nie der Inhalt.
- **Replay** (§2.16.4): Den Inhalt eines Datei-Anhangs trägt die Operation nicht; das Replay übernimmt ihn als Blob unverändert aus dem Ursprungs-Commit, auch als LFS-Pointer.

### 2.9 Projekte

- Identifiziert über einen Pfad aus Slug-Segmenten: `web`, `web/auth` (`[a-z0-9][a-z0-9-]*` je Segment, max. 5 Ebenen).
- Datei `projects/<pfad>.md`; Frontmatter `title`, optional `lead` (User-Handle), Body = Beschreibung. `title` ist beim Anlegen optional; ohne Angabe gilt das letzte Pfadsegment.
- Ein Unterprojekt setzt das Elternprojekt voraus.
- Filter sind rekursiv: `--project web` umfasst `web/auth`; `--project web --exact` nur `web`.
- `backe project mv <alt> <neu>` benennt Projekt und alle Unterprojekte um und schreibt alle betroffenen Issues um — in **einem** Commit.
- `backe project rm` nur ohne referenzierende Issues, sonst `--reassign <pfad>` oder `--detach`; ein Projekt mit Unterprojekten lässt sich nicht entfernen (Exit-Code 4).
- `project list` und `project show` zählen offene Issues rekursiv über die Unterprojekte.

### 2.10 Sprints

- Slug frei wählbar im Muster `[a-z0-9][a-z0-9-]{0,63}` (`2026-w47`, `auth-hardening`). Datei `sprints/<slug>.md`, Frontmatter `title`, optional `start`, `end` (Datum), `closed: true`; Body = Sprint-Ziel. `title` ist beim Anlegen optional; ohne Angabe gilt der Slug.
- Sprints sind in erster Linie Filter: `backe issue list --sprint 2026-w47`, `backe sprint show 2026-w47` (Issues gruppiert nach State, innerhalb der Gruppe nach `rank`, dann `created` — §2.18).
- `backe sprint close <slug>` setzt `closed: true`; offene Issues bleiben unverändert zugeordnet, `--carry-over <slug>` hängt sie zusätzlich dem Nachfolger an.
- **Arbeitsauftrag für Agents:** `backe next --sprint <slug> [--claim]` liefert das nächste bearbeitbare Issue. Auswahl und Reihenfolge regelt §2.22.

### 2.11 Repositories

**Registry im Backlog** — `repos/<name>.md`:

```markdown
---
url: git@github.com:acme/webapp.git
default_ref: main
---
Haupt-Webanwendung.
```

- Repo-Name = Dateiname, `[a-z0-9][a-z0-9._-]{0,63}`.
- Issues verweisen per Name (`webapp@feat/sso`), nicht per URL. Das hält Issues kurz; zieht ein Repo um, ändert sich eine Datei statt hundert. `repo rm` eines Repos, auf das Issues verweisen, scheitert mit Exit-Code 4.
- **Refs** (`ref` in `name@ref`, `default_ref`) folgen `git check-ref-format --allow-onelevel`: kein Segment beginnt mit `.` oder endet auf `.lock`, kein `..`, kein `@{`, nicht `@`, keine Steuer- oder Leerzeichen, keins von `~^:?*[\`, kein `/` am Anfang oder Ende, kein `//`, kein `.` am Ende.
- `backe issue link <id> <ziel>`: Passt `ziel` auf `<repo-name>[@<ref>]` und ist der Name registriert, ist es dieses Repo. Sonst ist es eine URL; steht nach ihrem letzten `@` kein `:` und ist der Teil davor eine normalisierbare URL, ist der Rest der Ref. Eine unbekannte URL registriert das Repo implizit (Name aus dem Repo-Namen abgeleitet, bei Kollision mit Owner-Präfix) und verknüpft es — beides in einem Commit.
- **URL-Normalisierung:** `git@github.com:acme/webapp.git`, `https://github.com/acme/webapp`, `ssh://git@github.com/acme/webapp` und die Kurzform `gh:acme/webapp` ergeben dieselbe kanonische Form `github.com/acme/webapp`. Zwei Registry-Einträge mit gleicher kanonischer URL sind verboten. Regeln:
  - Jedes abschließende `.git` fällt weg, mit und ohne Schema (`github.com/a/b.git` → `github.com/a/b`, auch `….git.git`); ebenso abschließende und doppelte Slashes.
  - Der Pfad wird kleingeschrieben für `github.com`, `gitlab.com`, `codeberg.org` und `bitbucket.org`, sonst bleibt er, wie er ist. `?` oder `#` in der URL → `validation`.
  - Die Normalisierung ist auf der kanonischen Form idempotent: `host/pfad` (Host `[a-z0-9-]+` auch ohne Punkt, damit `localhost`- und Intranet-Namen funktionieren, mindestens ein Pfadsegment) und `file:/abs` gelten als URL. Ein relativer Pfad wie `a/b` ist damit eine Repo-URL mit Host `a`.
- **Validierung** `backe repo check [name…]` (ohne Namen alle Repos):
  - immer: URL normalisierbar, kanonische URL eindeutig, Dateiname ist gültiger Repo-Name, `default_ref` und die Refs aus Issues sind gültige Refs;
  - `--remote`: Erreichbarkeit via `git ls-remote` (Timeout 20 s), Existenz von `default_ref` und der Branch- und Tag-Refs aus Issues; Refs, die wie ein Commit aussehen (`^[0-9a-f]{7,40}$`), lassen sich so nicht prüfen und ergeben einen Hinweis;
  - bei GitHub-URLs zusätzlich Sichtbarkeit (public/private), archiviert ja/nein (archiviert ist eine Warnung) — über `gh api repos/<owner>/<repo>`, falls `gh` im `PATH` liegt, sonst REST, mit `GITHUB_TOKEN`, falls gesetzt.
  Ein Issue-Ref auf ein nicht registriertes Repo ist ein Hinweis. Ergebnisse werden nicht ins Backlog geschrieben (flüchtig), sondern in `~/.backe/cache/repo-check.json` mit TTL 24 h abgelegt; `--fresh` umgeht den Cache, ein Ergebnis aus dem Cache nennt seinen Zeitstempel. Ein kaputter Cache wird verworfen, ein Fehler beim Schreiben bleibt still. Der Bericht steht immer auf stdout; danach Exit-Code 2 bei einem lokalen oder Ref-Fehler, 6 bei nur Erreichbarkeitsfehlern, sonst 0. Normale Writes prüfen nie remote — `backe` bleibt offline-fähig.
- **Lokale Pfade** stehen in der User-Config (§2.15.1), geschlüsselt nach kanonischer URL — nicht nach Name, weil Namen nur innerhalb eines Backlogs eindeutig sind.
  - `backe repo where <name>` löst Name → URL → lokalen Pfad auf; Text ist nur der Pfad, JSON `{name, url, canonical, default_ref?, path}`. Fehlt der Eintrag oder der Pfad auf der Platte → Exit-Code 3 mit Hinweis auf `repo scan` bzw. `config set repos.<kanonisch> <pfad>`.
  - `backe repo scan <verzeichnis>` findet Clones über ihre Remotes und trägt sie ein: rekursiv bis Tiefe 4, ohne versteckte Verzeichnisse und `node_modules`, ohne Symlinks zu folgen und ohne in ein gefundenes Git-Repo abzusteigen; nur Repos, die im aktiven Backlog registriert sind; Pfade physisch. Ein vorhandener Eintrag mit anderem Pfad bleibt (`abweichend`), außer mit `--force`; `--dry-run` schreibt nichts.

### 2.12 Users und Identität

```markdown
---
name: Claude (Agent 1)
kind: agent
operator: spw
keys:
  - ssh-ed25519 AAAAC3Nza… claude-1@backe
revoked_keys:
  - {key: "ssh-ed25519 AAAAC3Nza…", revoked: 2026-12-01T00:00:00Z}
---
Arbeitet Sprints im Projekt web ab.
```

- Handle = Dateiname, `[a-z0-9][a-z0-9-]{1,31}`. `me` ist reserviert (CLI-Alias für die eigene Identität).
- `kind`: `human` oder `agent`. Agents haben Pflichtfeld `operator` (verantwortlicher Mensch).
- Schlüssel: SSH-Public-Keys, v1 nur `ssh-ed25519`. Private Keys liegen nie im Backlog. Ein Key steht bei genau einem User (verglichen nach Typ und Key-Daten, nicht nach Kommentar), in `keys` oder `revoked_keys`.
- `keys` darf fehlen: Der User hat dann keinen aktiven Key und kann nicht signieren, auch der letzte Key ist widerrufbar. `user add` verlangt trotzdem mindestens einen Key.
- `backe user add <handle> --key <pubfile> [--agent --operator <handle>]` registriert einen vorhandenen Key. Der `operator` eines Agents ist ein existierender Mensch; ein User, der Operator von Agents ist, bleibt Mensch und lässt sich nicht entfernen, solange seine Agents ihn nennen.
- `backe user create-agent <handle>` erzeugt ein Ed25519-Keypair via `ssh-keygen` unter `~/.backe/keys/<backlog>/<handle>` (Modus 0600), registriert den Public Key mit `operator` = ausführender User und trägt die Identität unter `identities` in die User-Config ein (§2.15.1). Signiert wird dieser Commit vom ausführenden Menschen. Jedes Mitglied darf so eigene Agents anlegen; menschliche User legen nur Admins an (§2.13).
- `backe user revoke-key <handle> <fingerprint>` verschiebt einen Key nach `revoked_keys`. Ab dem Widerrufs-Commit ist der Key ungültig: Ein Commit ist nur gültig, wenn sein Key im `users/`-Stand seines **Parent-Commits** nicht widerrufen ist (§2.13). Maßgeblich ist die Position in der Historie, nicht die Uhrzeit — Commit-Zeitstempel setzt der Signierer selbst. Das Feld `revoked` ist Pflicht, aber nur Information.
- **Widerruf ist endgültig und betrifft nur eigene Keys:** Ein neuer Eintrag in `revoked_keys` muss vorher in `keys` desselben Users gestanden haben; ein widerrufener Key wird weder gelöscht noch wieder aktiv. Einen Key von Hand aus `keys` zu entfernen, ohne ihn zu widerrufen, ist erlaubt: Er ist ab diesem Commit ungültig, eine Anmaßung ergibt sich daraus nicht (§3.10).
- `user rm` eines Admins scheitert mit Exit-Code 4. Einen einmal entfernten Handle legt nur ein Admin neu an, damit ein neuer User nicht die Autorschaft alter Kommentare erbt.
- **Bootstrap:** `backe init` legt das Backlog an, registriert den ausführenden User und trägt ihn als Admin ein. Dieser erste Commit ist der Vertrauensanker (§2.13).

### 2.13 Signaturen und Verifikation

**Mechanismus: Git-native Commit-Signaturen mit SSH-Keys** (`gpg.format=ssh`; `backe` verlangt Git ≥ 2.38, §2.20).

- **Jeder Write ist genau ein Commit**, signiert mit dem Key des Akteurs. `backe` setzt dafür `-c gpg.format=ssh -c user.signingkey=<key> -c commit.gpgsign=true` pro Aufruf und fasst die globale Git-Config nicht an. `key` darf ein Private Key oder ein Public Key mit laufendem `ssh-agent` sein.
- **Commit-Message** (maschinenlesbar, kurz):

  ```
  issue move bk-7f3k2 review

  Backe-Actor: claude-1
  Backe-Op: {"op":"issue.move","id":"bk-7f3k2","from":"in_progress","to":"review"}
  ```

  `Backe-Op` ist die serialisierte Operation (§2.16.4). Ein Batch trägt `Backe-Op: batch` und die Operationen im Body (§2.16.6). Nur Änderungen, die sich nicht als Operation ausdrücken lassen, tragen `Backe-Op: manual` (s. »Hand-Edits«), ebenso die Quarantäne-Commits von `verify`. Der Commit von `init` trägt `Backe-Op: init`; er ist der Vertrauensanker und wird nie replayt.
- **Lineare Historie.** Der Sync-Branch enthält keine Merge-Commits; `backe` integriert per Replay (§2.16.2). `verify` lehnt Merge-Commits ab. Erst dadurch ist »der `users/`-Stand des Parent-Commits« eindeutig.
- **Vertrauensanker.** Der erste Commit des Backlogs. `backe backlog clone` und `backe init` merken seinen Hash in `.git/backe/anchor`; `verify` prüft gegen diesen gemerkten Anker, nicht gegen den ersten Commit der gerade vorliegenden Historie. Der Anker selbst wird gegen seinen eigenen Baum geprüft (`Backe-Op: init`, Akteur ist Admin). `clone` und `backlog add` übernehmen den Anker einer vorhandenen Arbeitskopie desselben Backlogs, sonst die einzige Wurzel der Historie. Ein Remote, dessen Stand kein Nachfahre des zuletzt verifizierten lokalen Stands ist (Force-Push, umgeschriebene Historie), wird abgelehnt (Exit-Code 5).
- **Verifikation** `backe verify [--since <rev>]` prüft jeden Commit seit dem Vertrauensanker:
  1. Signatur gültig, und zwar eine SSH-Signatur (GPG- und X.509-Signaturen sind ungültig);
  2. der signierende Key gehört laut `users/` **im Stand des Parent-Commits** zu einem User und ist dort nicht widerrufen — gebunden an den Prinzipal: Der Key muss ein aktiver Key genau des Users sein, den die Signatur nennt;
  3. `Backe-Actor` ist dieser User;
  4. Identitätsschutz — genau die Regeln, ohne die sich jemand als ein anderer ausgeben könnte, und keine weiteren (§3.10):
     - `users/<handle>.md` ändern nur dieser User selbst, bei Agents ihr `operator` (nur wenn der Akteur ein Mensch ist), oder ein Admin (sonst könnte jemand seinen Key bei einem fremden User eintragen); `kind` und `operator` ändern nur Admins, auch der bisherige Operator nicht;
     - neue Agent-User legt jedes Mitglied an, sofern `operator` es selbst ist und kein bestehender User den neuen Handle als `operator` nennt; neue menschliche User anlegen, einen früher entfernten Handle wieder anlegen, User entfernen und `.backe/**` ändern nur Admins (`admins` in `backlog.jsonc`) — sonst ließe sich die Verifikation abschalten. Admin ist nur, wer in `admins` steht und als menschlicher User existiert;
     - für alle, auch Admins: Keys sind über alle User eindeutig, Widerruf ist endgültig und betrifft nur eigene Keys (§2.12), der `operator` eines Agents ist ein Mensch, und ein Operator von Agents wird nicht zum Agent;
     - `creator` eines neuen Issues = Akteur; `creator`, `id`, `created` sind danach unveränderlich;
     - ein neuer Kommentar hat den Akteur als `author`, und `author` passt zum Dateinamen und ist unveränderlich; einen Kommentar ändern oder einzeln löschen nur sein Autor (sonst ließen sich jemandem Worte in den Mund legen). Wer ein ganzes Issue löscht, löscht dessen Kommentare mit — das ist keine Anmaßung, die Historie zeigt, wer gelöscht hat;
  5. keine Symlinks, keine Submodule, kein Pfad, der nur in Groß-/Kleinschreibung vom Layout abweicht (auf Dateisystemen ohne Unterscheidung landete er im geschützten Verzeichnis);
  6. jede geänderte Users-, Issue- oder Kommentar-Datei ist parsebar und gültig — sonst ist der Commit »not verifiable« und damit ungültig. Ein fehlendes `Backe-Op` ist ein Hinweis, kein Verstoß.

  **Eingefrorener Stand.** Ab dem ersten ungültigen Commit prüft `verify` alle folgenden gegen den Stand davor (Keys, Admin-Status, Policy), bis ein gültiger Quarantäne-Commit alle offenen ungültigen Commits deckt; ein ungültiger Commit verleiht so keine Rechte. Solange einer offen ist, ist außerdem jede Änderung an einem Pfad, dessen Inhalt im Parent vom eingefrorenen Stand abweicht, selbst ein Grund (»builds on invalid commit <kurz>«). Ausgenommen sind `.backe/quarantine.jsonc` selbst und ein Quarantäne-Commit, der alle offenen deckt; ein Quarantäne-Commit, der das nicht tut, darf Pfade nur auf den Inhalt im eingefrorenen Stand, in einem offenen ungültigen Commit oder in dessen Parent zurücksetzen. Der Schreibpfad (§2.16.1) prüft in diesem Zustand jeden eigenen Commit vorab gegen denselben Stand und lehnt ab, was `verify` ablehnen würde (`validation` `verify would reject the commit: …`).

  Technisch: `allowed_signers` je relevantem Users-Stand nach `.git/backe/` generieren, Signatur über `git verify-commit` bzw. `git log --format='%G? %GK %GS'` auswerten; Policy-Prüfung über den Diff des Commits.
- **Wann geprüft wird:** `backe sync` prüft eingehende Commits **vor** dem Übernehmen; ein ungültiger Commit stoppt den Sync mit Exit-Code 5 und Bericht. `verify` in `backlog.jsonc`: `strict` (Default; Sync stoppt, nichts wird übernommen), `warn` (Sync läuft, die Gründe erscheinen als Hinweise), `off` (still). Maßgeblich ist der Modus im Stand vor dem ersten ungültigen Commit, damit ein ungültiger Commit die Prüfung nicht selbst abschalten kann. Im Modus `warn` meldet ein Sync im Vordergrund die Gründe je ungültigem Commit einmal, nicht in jeder Runde neu; der Hintergrund-Sync schreibt sie jedes Mal ins Log und zählt nicht als Meldung.
- **Fremde lokale Commits:** Ein lokaler, noch nicht gepushter Commit ohne gültige `backe`-Signatur des eigenen Handles oder ohne lesbares `Backe-Op` (etwa aus nacktem `git commit`) blockiert den Sync in jedem Modus: Exit-Code 5, `Local commit <short> was not signed by backe`, Hinweis `backe commit --resign`.
- **Quarantäne — der Weg zurück.** Ein ungültiger Commit auf dem Remote würde im Modus `strict` jeden Client dauerhaft anhalten, und Historie umzuschreiben ist ausgeschlossen. Deshalb führt `.backe/quarantine.jsonc` (nur Admins ändern es) eine Liste `{"entries": [{"sha": …, "decision": "accepted" | "reverted", "reason": …}]}` (`sha` voll, `reason` nicht leer). `backe verify --accept <sha> --reason <text>` trägt ein, dass der Commit inhaltlich hingenommen wird; `--revert <sha>` trägt ihn ein und erzeugt im selben signierten Commit die Umkehrung seiner Änderungen — nur, wenn die betroffenen Pfade seit dem Commit unverändert sind. `verify` lässt eingetragene Commits passieren und meldet sie als Hinweis. Ein Client, der hängt, läuft weiter, sobald der Quarantäne-Commit eines Admins auf dem Remote liegt — dieser Commit ist selbst gültig und steht hinter dem ungültigen.
  - **Maßgeblich** ist die Quarantäne aus dem letzten Commit, der die Datei ändert und selbst gültig ist. `--accept`/`--revert` bauen darauf auf und prüfen den neuen Commit vorab mit derselben Policy.
  - `verify` prüft nicht nach, ob ein Eintrag `reverted` die Änderungen tatsächlich umkehrt: Die Quarantäne ändern nur Admins, und Admins sind vertraut (§3.10).
- **Hand-Edits:** Menschen dürfen Dateien direkt im Editor ändern. `backe commit [-m <msg>]` validiert alle geänderten Dateien, normalisiert sie kanonisch und **übersetzt die Änderungen in Operationen**: Frontmatter-Änderungen in Feld-Operationen, eine Body-Änderung in den Abschnitt `body` von `issue.edit` (Vorbedingung: Hash des alten Bodys), neue Kommentar-Dateien in `comment.add`. Dasselbe gilt für `backe issue edit <id>` per `$EDITOR` und `--body-file`. Damit sind auch Hand-Edits replaybar.
  - **Umfang:** alle Pfade, die `git status` als geändert, neu (nicht ignoriert) oder gelöscht meldet, Index und Arbeitsbaum zusammen, verglichen mit `HEAD`. Nichts geändert → `Nothing to commit`, Exit-Code 0. Ein Symlink oder sonst keine reguläre Datei darunter → `validation`, bevor etwas gelesen wird; ebenso eine `issue.md` an einem Ort, der nicht zu ihrer ID passt (falscher Shard, ungültige ID), mit dem richtigen Pfad in der Meldung.
  - **Übersetzung:** Eine Datei wird ganz übersetzt oder ganz `manual`. `Backe-Op: manual` bleibt für Änderungen ohne Operations-Entsprechung: Anhänge, neue oder geänderte unbekannte Keys, `.backe/**` und Dateien außerhalb des Layouts. Reines Umsortieren einer Liste ist keine Änderung; angehängte Leerzeilen am Body-Ende sind eine. Umhängungen stehen in der Reihenfolge des Nachher-Baums, Wurzeln zuerst — so gelingen auch getauschte Parents zweier Issues.
  - **Editor- und Systemdateien:** `backe init` committet eine `.gitignore` mit `.*.swp`, `.*.swo`, `*~`, `\#*#` und `.DS_Store`. Neue, ungetrackte Dateien mit solchen Namen lehnt `backe commit` auch ohne `.gitignore` ab (`validation`, nichts committet).
  - **Gemischtes Ergebnis:** erst ein `manual`-Commit mit allen Dateien ohne Operations-Entsprechung (Subject aus `-m`, sonst `manual: <n> Dateien`), dann die Operationen (eine → Trailer mit der Operation, mehrere → `Backe-Op: batch`). Jeder Commit der Kette wird vorab geprüft, auch gegen den Identitätsschutz (sonst `validation` `verify would reject the commit: …`); scheitert etwas, landet keiner, und die Hand-Edits bleiben, wie sie waren. `-m` ohne `manual`-Anteil ergibt eine Warnung.
  - **Danach** trägt jeder bearbeitete Pfad den committeten Inhalt, sein Index ist `HEAD`. Weicht der committete Inhalt vom kanonisch serialisierten Hand-Edit ab, meldet ein Hinweis `<pfad>: rewritten canonically`; ein Pfad ohne wirksame Änderung wird auf `HEAD` zurückgesetzt (`<pfad>: no effective change`).
  - **Ausgabe:** Text je Commit sein Subject auf stdout; JSON `{"commits":[{commit,kind,summary,ops,paths}],"notices"?,"rewritten"?:[{path,reason}],"warnings"?,"unknown_keys"?:[{path,keys}]}`.
  - **`backe commit --resign`** übersetzt die lokalen, noch nicht gepushten Commits, die keine gültigen `backe`-Commits des eigenen Handles sind (etwa aus nacktem `git commit`), nachträglich wie Hand-Edits und signiert sie neu; gültige eigene bleiben Einheiten wie beim Replay. Nichts Fremdes → `Nothing to re-sign`, Exit-Code 0. Zusammen mit Hand-Edits im Arbeitsbaum → `usage`. Wie beim Replay (§2.16.4) wird vorab geprüft, dass `verify` die neuen Commits annähme.
- **Konsequenzen für den Betrieb:** Backlog-Repos werden direkt auf den Sync-Branch gepusht. Squash-Merges über eine Forge-UI oder Web-Edits auf GitHub zerstören bzw. ersetzen Signaturen und werden von `verify` als ungültig gemeldet. Ein Branch-Protection-Setup, das nur signierte Commits zulässt, ist empfohlen.

### 2.14 Kontext-Auflösung

Jeder Aufruf löst einen Kontext aus fünf Werten auf: **backlog**, **user** (Identität samt Key), **project**, **sprint**, **repo**. `backe context` zeigt alle fünf samt der Quelle, aus der jeder Wert stammt.

**Backlog** — erster Treffer gewinnt:

1. `--backlog <name|pfad>` (`-B`)
2. `BACKE_BACKLOG`
3. das aktuelle Verzeichnis liegt in einem Backlog-Repo (Git-Toplevel enthält `.backe/backlog.jsonc`)
4. nächste `.backlog.local.jsonc` / `.backlog.jsonc` vom aktuellen Verzeichnis aufwärts bis `/`, Feld `backlog`
5. `current` in `~/.backe/config.jsonc`
6. sonst Fehler (Exit-Code 2) mit Hinweis auf `backe backlog use` / `backe init`

Ein Backlog-Wert ist ein Name (registriert, sonst Exit-Code 3), ein Pfad (beginnt mit `/`, `./`, `../` oder `~`; nur in Flag und Env) oder eine Repo-URL (nicht registriert → Exit-Code 3 mit dem passenden `backe backlog clone`-Befehl als Hinweis). Ein Pfad und ein Backlog-Repo (Stufe 3) binden die Arbeitskopie direkt, ohne Registrierung; aus deren `.backe/backlog.jsonc` liest die Auflösung nur `name`, damit ein Backlog neuerer Formatversion lesbar bleibt. Gesucht wird ab dem physischen Pfad des aktuellen Verzeichnisses (`realpath`, wie Git) — ein Symlink führt nicht zu einer anderen Config.

**User, project, sprint** — erster Treffer gewinnt: Flag (`--as`, `--project`, `--sprint`) → Env (`BACKE_USER`, `BACKE_PROJECT`, `BACKE_SPRINT`) → `.backlog.local.jsonc` → `.backlog.jsonc` → Backlog-Eintrag in `~/.backe/config.jsonc` → globaler Default in `~/.backe/config.jsonc`. Der aufgelöste User-Handle wird über `identities` der User-Config (§2.15.1) zu einem Key; ein Handle ohne Eintrag dort darf lesen, aber nicht schreiben. Nennt eine Projekt-Config-Ebene per Name oder kanonischer URL einen anderen als den aufgelösten Backlog, zählt sie für user, project, sprint und repo nicht; eine Ebene ohne `backlog` gilt für jeden.

**Leere Werte:** Eine leere Umgebungsvariable gilt als nicht gesetzt; ein leerer Flag-Wert ist ein Fehler (Exit-Code 2).

**Repo** — liegt das aktuelle Verzeichnis in einem Git-Repo, dessen Remote (kanonische URL) im aktiven Backlog registriert ist, ist dieses Repo Kontext; geprüft wird `origin` zuerst, dann die übrigen Remotes nach Name, der erste mit registrierter URL gewinnt. `.backlog.jsonc` kann es mit `"repo": "<name>"` festlegen oder mit `"repo": null` abschalten.

**Wirkung des Kontexts:**

- `issue list`, `next`, `sprint show` filtern per Default nach project, sprint und repo des Kontexts. `-A`/`--all` hebt die Kontextfilter auf; explizite Filter-Flags ersetzen den jeweiligen Kontextwert und filtern auch mit `-A` weiter.
- `issue create` übernimmt project, sprint und repo als Vorbelegung, sofern kein Flag sie setzt — außer mit `--parent`: dann erbt das Issue vom Parent (§2.23), und der Kontext füllt nichts.
- Text-Ausgabe beginnt bei aktiven Kontextfiltern mit einer Kopfzeile (`backlog=acme project=web/auth repo=webapp`), damit niemand sich über fehlende Issues wundert. Sie nennt genau die Filter, deren Wert aus dem Kontext stammt, plus `backlog`; ohne solche Filter gibt es keine Kopfzeile. JSON-Ausgabe enthält dieselben Keys als Feld `context`, sonst fehlt es.

**Backlog-Verwaltung** (das Pendant zu `kubectl config use-context`):

```
backe backlog list                       registrierte Backlogs, aktuelles markiert
backe backlog use <name>                 setzt current
backe backlog clone <url> [--name n]     registriert; geklont wird je Identität bei Bedarf (§2.16.1)
backe backlog add <name> <pfad> [--as h] bindet einen vorhandenen Clone an eine Identität
backe backlog remove <name> [--purge]    deregistriert; --purge löscht verwalteten Clone
backe init [pfad] --name n --prefix p [--remote url]
```

- `backlog clone --name` muss dem Namen im Backlog entsprechen; lokale Aliasnamen gibt es in v1 nicht. Ein Backlog neuerer Formatversion lässt sich klonen und lesen; der Clone meldet das als Hinweis.
- `backlog remove --purge` verweigert ohne `--force` jeden verwalteten Clone ohne Remote oder mit Commits auf dem Sync-Branch, die in keinem Remote-Tracking-Ref stehen (Exit-Code 4, Hinweis `--purge --force`); die Registrierung bleibt dann stehen. `--force` ohne `--purge` ist `usage`.
- `init` nimmt den Handle aus `--as`, `BACKE_USER` oder `user` der User-Config und den Key aus `--key`, sonst `~/.ssh/id_ed25519.pub`, falls vorhanden; fehlt eins, ist das `usage`. `init` und `backlog add` nehmen relative Pfade und `~` relativ zum aktuellen Verzeichnis bzw. Home.

### 2.15 Konfigurationsdateien

#### 2.15.1 User-Config `~/.backe/config.jsonc`

Ort überschreibbar mit `BACKE_HOME`. Wird nie eingecheckt.

```jsonc
{
  "$schema": "https://…/schemas/user-config.schema.json",
  "current": "acme",
  "user": "spw",                          // globaler Default-Handle
  "identities": {                         // Handle → Key; je Backlog, weil Handles nur dort eindeutig sind
    "acme": {
      "spw":      { "key": "~/.ssh/id_ed25519.pub" },        // Public Key → ssh-agent
      "claude-1": { "key": "~/.backe/keys/acme/claude-1" }   // von create-agent eingetragen
    }
  },
  "backlogs": {
    "acme": {
      "remote": "git@github.com:acme/backlog.git",
      "user": "spw",                      // Default-Handle für dieses Backlog
      "paths": { "spw": "~/code/acme-backlog" },  // optional: eigene Arbeitskopie statt verwalteter (§2.16.1)
      "sync": { "mode": "manual" }        // optional: überschreibt backlog.jsonc lokal
    }
  },
  "repos": {
    "github.com/acme/webapp": "~/code/webapp"
  },
  "output": { "format": "text", "color": "auto" }
}
```

- `project` und `sprint` dürfen global und je `backlogs.<name>` stehen (§2.14). Relative Pfade gelten relativ zu `BACKE_HOME`, ein relatives `BACKE_HOME` relativ zum aktuellen Verzeichnis. Expandiert werden nur `~` und `~/…`; `~name/…` ist ein Schemafehler mit Key-Pfad.
- **Schreiben** geschieht kommentarerhaltend und serialisiert über `<BACKE_HOME>/config.lock` (verwaiste Locks toter Prozesse werden übernommen, sonst nach 5 s Exit-Code 4). Die erste Registrierung eines Backlogs setzt `current`. Ergäbe eine Änderung keinen parsebaren Text, bleibt die Datei unverändert (`unexpected`).
- **`backe config`:** Pfade schreiben sich `a.b.c`; unter `repos.` ist der ganze Rest ein Key und wird kanonisiert (§2.11). Unbekannte Pfade → `validation` mit den erlaubten Keys der Ebene.
  - `config get` ohne Key gibt die Datei aus, wie sie auf der Platte liegt (JSON: die geparste Config), mit Key den Wert (Strings roh, Objekte als JSON); ein fehlender Key ist `not_found`. Eine ungültige Config meldet `config get` selbst mit `datei:zeile`, statt schon beim Start abzubrechen.
  - `config set <pfad> <wert>` setzt nur String-Blätter des Schemas, wörtlich (`~` bleibt stehen); `--unset` entfernt.
  - `config edit` öffnet eine Kopie im Editor (Regeln wie `issue edit`, §2.17) und schreibt sie nach der Prüfung atomar, sofern sich das Original seit dem Start nicht geändert hat (sonst `conflict`). Eine ungültige Kopie bleibt als Entwurf `config.jsonc.draft` liegen (`validation` mit `config.jsonc.draft:<zeile>`), das Original unberührt; der nächste `config edit` öffnet den Entwurf. Gelöscht wird er nach erfolgreichem Anwenden oder wenn das Ergebnis gleich der aktuellen Config ist. `config edit` startet auch mit ungültiger Config — der Reparaturweg.

#### 2.15.2 Projekt-Config `.backlog.jsonc` / `.backlog.local.jsonc`

Liegt in einem Code-Repo oder Arbeitsverzeichnis. `.backlog.jsonc` ist zum Einchecken gedacht, `.backlog.local.jsonc` (gleiches Schema, gewinnt) für persönliche Werte und gehört in `.gitignore`. Gesucht wird vom aktuellen Verzeichnis aufwärts bis `/`; die erste Fundstelle gewinnt, es wird nicht über Verzeichnisebenen gemergt (eine Ebene enthält beide Dateien, die dort gemergt werden).

```jsonc
{
  "backlog": "acme",            // Name aus der User-Config oder Git-URL
  "project": "web/auth",
  "sprint": "2026-w47",
  "repo": "webapp"              // optional; Default: automatisch über Remote
}
```

`user` ist nur in `.backlog.local.jsonc` erlaubt — eine eingecheckte Identität wäre für das ganze Team falsch. Ist `backlog` eine Git-URL, die lokal nicht registriert ist, bricht `backe` mit dem passenden `backe backlog clone`-Befehl als Hinweis ab, statt ungefragt zu klonen.

#### 2.15.3 Backlog-Config `.backe/backlog.jsonc`

```jsonc
{
  "$schema": "https://…/schemas/backlog.schema.json",
  "version": 1,
  "name": "acme",
  "id_prefix": "bk",
  "admins": ["spw"],
  "workflow": { "strict": false },
  "sync": {
    "mode": "auto",          // auto | manual
    "remote": "origin",
    "branch": "main",
    "pull_interval": 60      // Sekunden; für langlebige Prozesse und Read-Prefetch
  },
  "verify": "strict",        // strict | warn | off
  "attachments": { "max_bytes": 10485760, "lfs": false },  // max_bytes: null = kein Limit
  "props_strict": false,     // true: nur deklarierte Properties erlaubt (§2.24)
  "props": {
    "severity": {
      "type": "enum",
      "values": ["critical", "high", "medium", "low", "info"],
      "ordered": true,       // Liste vom höchsten zum niedrigsten Wert; erlaubt --prop severity>=medium
      "description": "Schwere eines Audit-Findings"
    },
    "location": { "type": "string", "description": "Hauptfundstelle, Pfad mit :Zeile" }
  }
}
```

`version` ist die Formatversion des Backlogs. Eine neuere Major-Version als die von `backe` unterstützte → nur lesen, Writes verweigert, Hinweis auf Update.

Wirksamer Sync-Modus ist `backlogs.<name>.sync.mode` der User-Config, sonst `sync.mode` aus `.backe/backlog.jsonc` im `HEAD` der Arbeitskopie. `manual` heißt: kein automatischer Sync nach Writes und Reads; `backe sync` läuft trotzdem, und der Claim ist nur lokal (§2.16.5).

### 2.16 Git-Integration und Sync

#### 2.16.1 Schreibpfad

**Eine Arbeitskopie je Identität.** Jede Arbeitskopie gehört genau einer Identität (`.git/backe/identity`, gesetzt von `init`, `backlog clone`, `backlog add` und spätestens vom ersten Write; ein zweiter Pfad für denselben Handle ist Exit-Code 4). Nur so kann der Sync lokale Commits mit dem Key ihres eigenen Akteurs neu signieren (§2.16.2), ohne Zugriff auf fremde Keys. `backe` verwaltet die Clones selbst unter `~/.backe/backlogs/<backlog>/<handle>/` und legt sie beim ersten Zugriff einer Identität an (`git clone --reference` auf einen vorhandenen Clone desselben Backlogs, damit Objekte nicht doppelt liegen). Zwei Agents auf einer Maschine arbeiten damit transparent in zwei Clones. Eine eigene Arbeitskopie lässt sich per `backe backlog add … --as <handle>` binden; ein Write mit einer anderen Identität darin wird abgelehnt (Exit-Code 2, mit dem Pfad der passenden Arbeitskopie) — schon vor dem ersten Write. Lesen darf jede Identität auch aus einer anderen vorhandenen Arbeitskopie desselben Backlogs, solange sie selbst noch keine hat; geschrieben wird nur in die eigene.

**Backlog ohne Remote.** Bekommt ein Backlog ohne `remote` in der User-Config eine zweite Arbeitskopie, legt `backe` einen lokalen Hub an: ein bares Repo `<BACKE_HOME>/backlogs/<name>/hub.git`, geklont aus der vorhandenen Arbeitskopie. Diese bekommt den Git-Remote `sync.remote` auf den Hub (ein gleichnamiger Remote auf ein nicht-bares Verzeichnis wird umgehängt, einer auf ein bares Repo oder eine URL bleibt), die neue Arbeitskopie klont vom Hub. Das Ergebnis trägt den Hinweis `Lokaler Hub <pfad> angelegt; <quelle> synct jetzt darüber`. Ein Backlog mit genau einer Arbeitskopie hat keinen Hub; Sync ist dort »no remote«. Fehlt im frischen Clone der eigene User, der in der Quelle schon angelegt, aber noch nicht gepusht ist, wird der Clone verworfen (Exit-Code 6, Hinweis `backe sync --as <identität der quelle>`).

Jede schreibende Operation:

1. holt den Arbeitskopie-Lock `.git/backe/write.lock` (exklusiv angelegte Datei mit PID, Zeitstempel und Hostname). Übernommen wird nur ein Lock desselben Hosts, dessen Prozess tot ist oder der vor dem letzten Boot entstand; ein Lock eines anderen Hosts bleibt gehalten. Er serialisiert mehrere Prozesse derselben Identität — CLI-Aufrufe, MCP-Server, Hintergrund-Sync.
2. prüft, dass der Sync-Branch ausgecheckt ist (kein detached HEAD, kein laufender Rebase) — sonst Abbruch mit Hinweis.
3. lädt den Zustand, prüft Vorbedingungen, schreibt die Dateien kanonisch. Ungesicherte Hand-Edits an einem Pfad, den die Operation berührt, ergeben Exit-Code 4, statt mitcommittet zu werden. Der Signier-Key muss ein aktiver Key des Schreibenden sein (sonst Exit-Code 2).
4. committet genau die betroffenen Pfade, signiert (§2.13): über einen temporären Index, `commit-tree -S` und `update-ref` mit Vorwert. Ignore-Regeln blockieren keinen Write, vom User vorgemerkte Änderungen anderer Pfade bleiben im Index unberührt. Commit-Hooks laufen nicht; `update-ref` ruft nur den `reference-transaction`-Hook, den eine verwaltete Arbeitskopie nicht hat — `backe` greift dort nicht ein. Autor ist `name` des Users mit der E-Mail `<handle>@backe.invalid`.
5. gibt den Lock frei.
6. bei `sync.mode: auto` und vorhandenem Git-Remote: startet den Hintergrund-Sync (§2.16.2) und kehrt sofort zurück.

Ein Write ist alles oder nichts: Ein Journal `.git/backe/write.journal` hält den Vorher-Stand; ein Fehler rollt sofort zurück, nach einem Absturz tut das der nächste Write. SIGINT und SIGTERM wirken erst nach Commit oder Rollback.

Writes sind damit local-first und schnell; die Verteilung passiert danach.

#### 2.16.2 Hintergrund-Sync

`backe sync --background` wird als detached Prozess gestartet (`child_process.spawn` mit `detached: true`, `unref()`), Ausgabe nach `.git/backe/sync.log` (ist das Log beim Start größer als 1 MiB, wird es nach `sync.log.1` verschoben).

- **Remote** ist der Git-Remote `sync.remote` der Arbeitskopie (Default `origin`), Branch `sync.branch`. Fehlt der Git-Remote, ist der Status `no remote` und `backe sync` ein No-op mit Exit-Code 0.
- **Debounce:** Hält bereits ein Sync-Prozess `.git/backe/sync.lock`, setzt der neue nur ein Dirty-Flag, versucht den Lock danach noch einmal und beendet sich erst, wenn auch das scheitert; der laufende Sync dreht nach Abschluss eine weitere Runde, solange das Flag gesetzt ist. Vordergrund-Sync, `--sync`, `issue claim` und `next --claim` warten dagegen bis zu 300 s auf `sync.lock` und starten nach der Freigabe einen Hintergrund-Sync, wenn das Dirty-Flag liegt. Fehler einer Hintergrund-Runde landen im Log und im Sync-Zustand; der Prozess selbst endet mit Exit-Code 0.
- **Ablauf einer Runde:**
  1. `fetch` (ohne Lock, Frist 60 s), eingehende Commits verifizieren (§2.13).
  2. Gibt es keine ungepushten lokalen Commits: Fast-Forward, fertig.
  3. Sonst **immer Replay**, nicht nur bei einem Textkonflikt: Die Operationen der lokalen Commits werden gesammelt, die Arbeitskopie auf den Remote-Stand gesetzt und die Operationen in Reihenfolge erneut ausgeführt — mit voller Validierung gegen den neuen Stand (Vorbedingungen und Invarianten, §2.16.4) und je Operation bzw. Batch einem neuen, mit der eigenen Identität signierten Commit. Ein Git-Rebase allein sähe nicht, dass zwei textuell saubere Änderungen zusammen einen Zyklus bilden oder auf ein inzwischen gelöschtes Issue zeigen. Bevor die Arbeitskopie umgesetzt wird, prüft `backe`, dass `verify` die neu signierten Commits annähme; sonst bleibt alles, wie es war (Exit-Code 5).
  4. `push` (nie `--force`, Frist 120 s). Abgelehnt (jemand war schneller) → zurück zu 1, bis zu 5 Runden mit Backoff `200 ms · 2^(runde−1)`; danach Exit-Code 6 `Push rejected after 5 rounds`.

  Läuft eine Frist ab, beendet `backe` den Git-Prozess samt seinen Kindprozessen (etwa `ssh`). Die Kindprozesse bleiben in der Prozessgruppe von `backe`: Ctrl-C erreicht sie, und `ssh` behält das Terminal für Passwortabfragen.
- **`manual`-Commits** unter den lokalen werden an ihrer Stelle in der Reihe übernommen und neu signiert (Subject und `Backe-Op: manual` des Ursprungs-Commits, eigener Akteur). Je Pfad gilt ein Dreiwege-Vergleich zwischen Parent, lokalem Commit und aktuellem Stand: Hat nur eine Seite geändert, gewinnt sie; haben beide geändert und sind beide Text, führt `git merge-file` zusammen. Bleibt ein Konflikt (Konfliktmarker, Binärdatei, Löschen gegen Ändern), bricht der Sync die Runde ab (Exit-Code 4) und lässt die Arbeitskopie im Zustand vor der Runde — sauber, auf dem lokalen Stand, ohne laufenden Rebase. Lokale Writes gehen weiter (sie stapeln sich ungepusht), `backe sync status` meldet den Konflikt, und `backe sync --interactive` führt im Vordergrund durch die Auflösung.
- **`backe sync --interactive`** fragt bei einem solchen Konflikt je Commit `[e]dit, take [l]ocal, keep [r]emote, [a]bort`: `e` öffnet je Konfliktpfad den Text mit Markern (`<<<<<<< remote` / `>>>>>>> local`) im Editor und fragt erneut, solange noch eine Markerzeile darin steht (eine Zeile, die mit `<<<<<<< ` oder `>>>>>>> ` beginnt, oder genau `=======`); `l` nimmt die lokale Fassung, `r` verwirft den ganzen lokalen Commit, `a` bricht ab wie die Hintergrund-Runde. Danach läuft die Runde weiter. Ohne Terminal auf stdin und stdout ist das `usage`.
- **Fehler** (Netz weg, Verify fehlgeschlagen, manueller Konflikt) blockieren nie lokale Writes. `backe sync status` zeigt ungepushte Commits, letzte Sync-Zeit und offene Konflikte; die Kopfzeile (unten) meldet nur, was offen ist.
- **Kopfzeile:** Nach einem erfolgreichen Befehl mit aufgelöster Arbeitskopie schreibt der Text-Modus eine Zeile auf stderr, sobald etwas offen ist: `Sync: ` und mit ` · ` getrennt `<n> unpushed` (nur mit Remote, und nur wenn die letzte Runde fehlschlug oder der Modus `manual` ist), `<n> conflict(s)`, `last sync failed: <message>`; dahinter `Hint: backe sync status`. Nichts offen → keine Zeile; im JSON-Modus nie.
- **Ausgabe `backe sync`:** Text `up to date` oder Zeilen `fetch: <n> new commits`, `replay: <n> units re-signed`, `conflict: <id>  <subject>`, `push: <sha7>`, ohne Remote `no remote`. JSON `{"fetched","replayed","conflicts":[…],"pushed":<sha|null>,"rounds","skipped"?:"no_remote","notices"?}`.
- **Ausgabe `backe sync status`:** Zeilen `remote`, `mode`, `unpushed`, `last sync`, `error` (falls), `running  yes` (falls `sync.lock` gehalten), dann je Konflikt `<id>  <subject>  <grund>`; JSON `{"remote","mode","unpushed","last_attempt"?,"last_success"?,"last_error"?,"running","conflicts":[{id,created,subject,reason}]}`, Exit-Code 0. Ohne Arbeitskopie Exit-Code 3.

#### 2.16.3 Frische beim Lesen

Lesende Befehle arbeiten auf dem lokalen Stand. Bei `sync.mode: auto` stößt ein Read eine volle Hintergrund-Sync-Runde an (§2.16.2, inklusive Übernahme in die Arbeitskopie), wenn die letzte älter als `pull_interval` ist oder es noch keine gab (nicht blockierend; `pull_interval: 0` heißt bei jedem Read) — der nächste Read sieht dann den neuen Stand. `--sync` erzwingt eine blockierende Runde vor dem Lesen; scheitert sie, scheitert der Befehl. `next --claim --sync` ist `usage`; der Claim synchronisiert selbst (§2.16.5). Der MCP-Server (§2.19) synchronisiert zusätzlich periodisch im Takt von `pull_interval`.

#### 2.16.4 Operationen und semantisches Replay

Jede Mutation ist eine serialisierbare Operation mit Vorbedingungen, z. B.:

```json
{"op":"issue.move","id":"bk-7f3k2","from":"in_progress","to":"review"}
{"op":"issue.edit","id":"bk-7f3k2","set":{"assignee":{"from":null,"to":"claude-1"}},"add":{"projects":["api"]}}
{"op":"issue.edit","id":"bk-7f3k2","body":{"from_hash":"9c1e…","to":"…"}}
{"op":"issue.edit","id":"bk-7f3k2","props":{"estimate_h":{"from":4,"to":6}}}
{"op":"comment.add","id":"bk-7f3k2","body":"…","file":"20261118T100400Z-spw-q8x.md"}
{"op":"project.mv","from":"web/auth","to":"platform/auth"}
{"op":"issue.rank","id":"bk-7f3k2","from":3000,"before":"bk-a91c0"}
```

`issue.edit` hat die Abschnitte `set` (Setzen mit Vorbedingung `from`/`to` für `title`, `parent`, `assignee`), `add`/`remove` (Mengen-Operationen auf Listen), `props` (je Key `from`/`to`, §2.24) und `body` (`from_hash` = SHA-256 des alten Bodys). Damit bleibt `issue edit` mit mehreren Flags eine Operation; `issue assign` ist `issue.edit` mit `set.assignee`, `user create-agent` ist `user.add`. Body-Hashes rechnen ohne Rücksicht auf den Zeilenende-Stil.

**Inhalt einer Operation.** Operationen tragen ihre Nutzlast selbst (Issue-Body, Kommentartext). Erzeugte Werte — Issue-ID, `created`, Kommentar-Dateinamen, der von `repo.add` abgeleitete Repo-Name — stehen in der aufgezeichneten Operation, damit das Replay dasselbe erzeugt. Anhangsinhalte stehen nicht darin; die liest das Replay aus dem Ursprungs-Commit (§2.8).

**Eine Operation je Befehl, aufgezeichnet als Absicht.** Ein CLI-Befehl oder MCP-Aufruf ergibt genau eine Operation; sie beschreibt, was der Akteur wollte, nicht welche Dateien sich änderten. Zusammengesetzte Befehle bleiben eine Operation: `issue edit` mit mehreren Flags (jedes Feld mit eigener Vorbedingung, alles atomar), `project mv`, `issue delete --orphan/--recursive` samt Referenzbereinigung, `issue link` mit implizitem Repo-Eintrag, `sprint close --carry-over`, `issue rank` samt Neunummerierung. Beim Replay wird die Absicht gegen den neuen Stand neu ausgewertet: `project.mv` erfasst dann auch Issues, die inzwischen jemand dem alten Pfad zugeordnet hat; `issue.rank --before` rechnet den Wert gegen die aktuellen Nachbarn neu.

Die Operation steht im Trailer `Backe-Op` ihres Commits. Beim Replay (§2.16.2) ist jeder lokale Commit eine Einheit — eine Operation, ein Batch (§2.16.6) oder ein `manual`-Commit (§2.16.2) —, und es gilt je Einheit:

- **Vorbedingung:** Ist der Zielwert schon erreicht, ist die Operation ein No-op; sonst verletzt ein Ist-Wert ungleich `from` die Vorbedingung. Eine Einheit ohne Änderung ergibt keinen Commit.
- **Vorbedingungen und Invarianten erfüllt** → neuer signierter Commit, Message gebildet wie beim direkten Write, mit dem eigenen Akteur und Key. Invarianten sind die Regeln, die beim direkten Ausführen auch gelten: keine Zyklen in `blocked_by`, `depends_on`, `parent`; keine Referenz auf ein nicht existierendes Issue, Projekt, Sprint, Repo oder User; kein `done` an einem Parent mit offenen Sub-Issues; gültige Werte deklarierter Properties, die die Operation berührt (§2.24). Geprüft wird nur, was die Operation neu einführt: neue Referenzen, neue Kanten, geänderte Properties.
- **Mengen-Operationen** (`add`/`remove` auf Listen) haben keine Wert-Vorbedingung und kollidieren nie miteinander — an den Invarianten können sie trotzdem scheitern, etwa wenn zwei parallele `depends_on`-Ergänzungen zusammen einen Zyklus bilden.
- **Verletzt** → die Einheit wird nicht angewendet, sondern nach `.git/backe/conflicts/<YYYYMMDDTHHMMSSZ>-<6 hex>.json` geschrieben (Grund, Remote-Stand und die Einheiten samt Operationen, die gescheiterte zuerst); `backe sync status` listet sie. Andere Fehler als eine Verletzung brechen die Runde ab.
- **`backe sync resolve`** ohne Argument listet die Einträge. `sync resolve <id> --drop` verwirft einen; `sync resolve <id> --apply` setzt die Vorbedingungen aller Operationen auf den aktuellen Stand (`from` und `from_hash` werden die Ist-Werte) und schreibt alle Einheiten als **einen** Batch-Write mit voller Prüfung — Erfolg löscht den Eintrag, Scheitern lässt ihn stehen. Genau eins von `--drop`/`--apply`, sonst `usage`; eine unbekannte ID ist `not_found`.
- **Folgeoperationen:** Spätere lokale Operationen, die sich auf eine abgelegte beziehen — dasselbe Issue, ein von ihr erzeugtes Issue, ein Batch-Platzhalter, dasselbe Projekt, derselbe Sprint, dasselbe Repo, derselbe User —, landen ohne eigenen Versuch ebenfalls in der Konfliktablage, gemeinsam mit ihr, und belasten ihre eigenen Bezüge mit. Unabhängige Operationen laufen weiter.
- **Claims** landen nie in der Konfliktablage: Scheitert eine Einheit, die nur aus `issue.claim` besteht, wird sie verworfen (Hinweis `Claim <id> lost: <reason>`) und ist nie Folgeoperation.
- **ID-Kollision beim Replay** (§2.5): Das lokal erzeugte Issue bekommt eine neue ID; spätere lokale Operationen, die die alte ID nennen, werden mit umgeschrieben, Kommentare und Anhänge folgen. Hinweis `ID collision: <alt> is now <neu>`.

#### 2.16.5 Claim

`backe issue claim <id>` und `backe next --claim` sind die einzigen **synchronen** Writes:

1. blockierende Sync-Runde (§2.16.2), samt Replay ungepushter lokaler Operationen;
2. Prüfung: Das Issue ist claimbar (§2.22) — bereit, oder bereits `in_progress` mit Assignee = ich;
3. Commit: `assignee = ich`, `state = in_progress`. Der Sprung aus `backlog` oder `todo` ist auch bei `workflow.strict: true` erlaubt — Claim ist der vorgesehene Einstieg in die Arbeit;
4. sofortiger `push` aller ungepushten Commits, der Claim zuletzt. Abgelehnt → zurück zu 1; hat inzwischen jemand anderes geclaimt → Claim-Operation verwerfen, Exit-Code 4 (`<id> was taken by <assignee> in the meantime`). Die übrigen lokalen Operationen bleiben und gehen mit dem nächsten Sync raus.

Ist das Issue schon `in_progress` mit mir, ist der Claim `unchanged` und pusht nichts. `next --claim` wählt nach einem verlorenen Claim neu, ohne die verlorenen Kandidaten, höchstens fünfmal; erst dann Exit-Code 4 (`Claim lost five times: <ids>`). Ohne Kandidat endet es wie `next` (Exit-Code 3).

Bei einem gemeinsamen Remote gibt es damit pro Issue genau einen Gewinner — unter den Clients, die synchronisieren. Wer lokal `sync.mode: manual` setzt oder ohne Remote arbeitet, claimt nur lokal; die Garantie gilt für ihn nicht, und `backe` sagt das bei jedem Claim in einer Zeile (`Claim is local only: no remote` bzw. `Claim is local only: sync.mode manual`).

#### 2.16.6 Batch

Ein Audit legt Dutzende Findings auf einmal an, ein Folgelauf schließt und ändert viele zugleich. Ein signierter Commit pro Operation wäre dafür langsam und unübersichtlich. `backe batch [-f <ops.jsonl> | -]` führt viele Operationen als **einen** Commit aus:

- Eingabe: eine Operation pro Zeile im Format von §2.16.4, dazu `issue.create`, `comment.add` und alle anderen Mutationen. Neue Issues bekommen einen Platzhalter (`"ref":"$f1"`), auf den spätere Zeilen verweisen dürfen (`"parent":"$p1"`, `"depends_on":["$f1"]`). IDs stehen voll oder als Platzhalter, nie als Kurzform, und `me` gibt es nicht. Ein BOM am Anfang und CRLF sind erlaubt. `attach.add` mit Datei (der Inhalt passt nicht in JSONL) und `issue.claim` (synchron, §2.16.5) sind `validation`. Quelle ist `-f <pfad>`, `-f -` oder `-` für stdin; ohne Quelle `usage`.
- **Alles oder nichts:** Erst werden alle Operationen gegen den aktuellen Stand validiert, dann geschrieben. Scheitert eine, wird nichts geschrieben; die Fehlermeldung nennt die Zeile, bei mehreren Fehlern die früheste.
- Commit-Message: Zusammenfassung (`batch: 34 create, 12 move`), Trailer `Backe-Op: batch`, die Operationen als JSONL im Body — so bleibt der Batch für das Replay (§2.16.4) vollständig. Beim Replay gilt er als Einheit: Verletzt eine Operation ihre Vorbedingung, geht der ganze Batch in die Konfliktablage.
- Ausgabe: Text die Zusammenfassung, danach je Platzhalter `<ref>  <id>` in Vergabe-Reihenfolge; JSON `{"commit":<sha|null>,"refs":{…},"ops":<anzahl>,"notices"?,"warnings"?}`.
- Obergrenze 1000 Operationen pro Batch; darüber mehrere Batches.
- MCP-Tool `batch` mit derselben Semantik, beschränkt auf die Operationen, die auch die MCP-Tools schreiben (§2.19).

### 2.17 CLI-Oberfläche

Konventionen wie `gh`: `backe <nomen> <verb>`, für die häufigsten Befehle Top-Level-Aliase.

```
backe init | doctor | context | verify | commit | batch | mcp [--allow-delete]
backe backlog  list | use | clone | add | remove | show
backe issue    create | list | show | edit | move | resume | reopen
              | assign | claim | rank | link | unlink | delete
backe next     [--sprint s] [--project p] [--level leaf|top] [--claim]
backe comment  add | list | edit | delete
backe attach   add | list | get | rm
backe project  create | list | show | mv | rm
backe sprint   create | list | show | close
backe repo     add | list | rm | check | where | scan
backe user     add | create-agent | list | show | revoke-key | rm
backe sync     [--background] | status | resolve
backe config   get | set | edit          (User-Config)

Aliase: backe new = issue create, backe ls = issue list, backe show = issue show, backe mv = issue move
```

`backe --help` endet mit einem Abschnitt »Quick start«, der die ersten Befehle für ein neues Backlog zeigt.

Ausgewählte Signaturen:

```
backe issue create -t <titel> [-d <md> | -F <datei> | -d -] [-p <projekt>]… [-s <sprint>]…
                  [-a <user|me>] [--repo <name[@ref]>]… [--dep <id>]… [--parent <id>]
                  [--prop <key>=<wert> | --prop <key>:=<json>]… [--state <state>]
backe issue list   [--state <s>[,<s>]] [-p …] [-s …] [-a <user|me|none>] [--creator …]
                  [--repo …] [--blocked | --unblockable | --ready] [--parent <id> | --top-level]
                  [--prop <key>=<wert>[,<wert>] | --prop <key>>=<wert> | --prop <key><=<wert>]…
                  [--has-prop <key>]… [--tree] [--sort rank|created] [-q <text>] [-A] [--limit n]
backe issue rank   <id> (--top | --bottom | --before <id> | --after <id> | <zahl>)
backe batch        [-f <ops.jsonl> | -]
backe issue move   <id> <state> [--reason <md> | --reason-file <f> | --reason -] [--blocked-by <id>]…
backe issue edit   <id> [--title …] [--add-project …] [--rm-project …] [--add-sprint …]
                  [--rm-sprint …] [--add-dep <id>]… [--rm-dep <id>]…
                  [--parent <id> | --no-parent] [--prop <key>=<wert> | --prop <key>:=<json>]…
                  [--unset-prop <key>]… [--body-file <f>]
                                                             ohne Flags: $EDITOR
backe attach add   <id> --name <n> (<datei> | --url <u> | --json <json|->)
```

`issue delete` entfernt das Issue-Verzeichnis per signiertem Commit (Historie bleibt in Git) und verlangt `--force`, wenn andere Issues es in `blocked_by` oder `depends_on` führen; diese Referenzen werden im selben Commit entfernt. Hat das Issue Sub-Issues, verlangt `delete` eine Entscheidung: `--orphan` löst sie vom Parent (werden Top-Level-Issues), `--recursive` löscht den ganzen Teilbaum — beides in einem Commit.

Regeln einzelner Befehle:

- **`issue create`** ohne `--state` legt in `backlog` an. Mit `--parent` erben `projects`, `sprints` und `repos` ohne eigene Angabe vom Parent (§2.23); eine leere Liste (`[]`, auch im Batch) heißt ausdrücklich leer.
- **Beschreibung aus stdin:** Leeres stdin bei `-d -` oder `--body-file -` ist `validation` (»Description is empty«); `-d ''` oder eine leere Datei leeren den Body bewusst.
- **`issue edit` mit Flags:** Derselbe Wert in `--add-x` und `--rm-x`, in `--prop` und `--unset-prop` sowie `--parent` zusammen mit `--no-parent` sind `usage`. Werte gleich dem Ist-Stand fallen weg; bleibt nichts, ist das `unchanged: <summary>` mit Exit-Code 0, wie `issue move` in den aktuellen State.
- **`issue edit` per Editor** (ohne Änderungs-Flags): Editor ist `BACKE_EDITOR`, sonst `VISUAL`, dann `EDITOR` — die beiden letzten nur, wenn stdin und stdout ein Terminal sind; sonst `usage` »Nothing to change« mit Hinweis auf `BACKE_EDITOR`. Aufgerufen wird `sh -c '<editor> "$1"' backe-editor <datei>` mit einer Temp-Datei `backe-<id>-<6 hex>.md` (Modus 0600), die den Dateiinhalt wie auf der Platte enthält. Unverändert → `unchanged`, Exit-Code 0; Editor-Exit ≠ 0 → `unexpected`, nichts geändert; Parse- oder Schemafehler → `validation` mit `datei:zeile`, die Temp-Datei bleibt und der Hinweis nennt sie; ein Ergebnis ohne Operations-Entsprechung → `validation` mit dem Hinweis, die Datei direkt zu bearbeiten und `backe commit` zu nutzen. Mehrere Operationen (etwa Edit und Move) werden ein Batch-Commit. Nach Erfolg wird die Temp-Datei gelöscht.
- **`issue list --blocked`** heißt State `blocked`.

### 2.18 Ausgabe und Agent-Ergonomie

- **Sprache:** Jeder Text, den ein Mensch liest — Hilfe samt Argument-Platzhaltern und Abschnittstiteln, Fehlermeldungen, Hinweise, Warnungen, Write-Zusammenfassungen, auch im JSON-Modus (`message`, `hint`, `notices[].message`, `warnings`) —, ist englisch oder deutsch, nie gemischt. Deutsch gilt, wenn der erste gesetzte, nicht leere Wert aus `BACKE_LANG`, `LC_ALL`, `LC_MESSAGES`, `LANG` mit `de` beginnt (`de`, `de_DE.UTF-8`, `de-AT`); sonst Englisch. Die Präfixe sind `Error:`/`Fehler:`, `Hint:`/`Hinweis:`, `Warning:`/`Warnung:` und `unchanged:`/`unverändert:`. Der MCP-Modus (§2.19) ist immer englisch: Ab dem Start von `backe mcp` (nach dem Parsen der Argumente) ist alles englisch, auch die Startfehler auf stderr; ein Aufruffehler von `backe mcp` selbst (etwa eine unbekannte Option) folgt der Locale wie bei jedem Befehl. Sprachunabhängig bleiben Befehls- und Optionsnamen, Formate, JSON-Keys, Fehlercodes, Exit-Codes sowie alles, was `backe` in den Backlog schreibt — Commit-Subjects, Trailer und Text wie der Transition-Kommentar »Blocker <id> gelöscht« (§2.6) —, denn Backlog-Inhalt muss beim Replay auf jedem Rechner gleich entstehen. Zitierte Meldungen in diesem Spec sind die englische Fassung.
- `--format text|json|md` (`--json` als Kurzform); Default `text`, überschreibbar mit `BACKE_FORMAT` oder `output.format` (Agents setzen `json`). Kann ein Befehl den Default aus Env oder Config nicht, fällt er auf Text zurück; nur ein explizites `--format`/`--json`, das er nicht kann, ist `usage`.
- **JSON ist kompakt** (eine Zeile, keine Einrückung) und enthält nur gesetzte Felder. Keys sind snake_case (`can_write`, `working_copies`, `prop_notices`). In Fehler-`details` gilt das nur für die festen Keys (`exit_code`, `from_hash`, `reason_file`); alle anderen Keys und alle Werte bleiben, wie sie sind, damit Nutzer-Keys wie Property-Namen unverändert ankommen. `--fields id,title,state` reduziert weiter: nur mit `--format json` (sonst `usage`), wirkt auf die Issue-Objekte von `issue list`, `issue show` und `next`; ein unbekanntes Feld ist `usage` mit der Liste der erlaubten.
- **`issue list`** zeigt ohne `--state` nur offene Issues (nicht `done`, `cancelled`, `rejected`); `--state all` zeigt alle. Werte innerhalb eines Flags oder einer Komma-Liste sind ODER-verknüpft, verschiedene Flags UND; `-p` filtert rekursiv, mit `--exact` nur genau.
- **Sortierung:** Jede Ausgabe, die mehrere Issues aufzählt, sortiert per Default nach `rank` aufsteigend (Issues ohne `rank` zuletzt), dann nach `created` aufsteigend — in CLI und MCP, in Text und JSON: `issue list`, die Gruppen von `sprint show`, Sub-Issues und `dependents` in `issue show`, die Geschwister jeder Ebene von `--tree`, `issue_list`. `issue list` und `sprint show` bieten `--sort created` als Alternative an. Einzige Ausnahme ist `next`, das nach §2.22 auswählt — auch dort steht `rank` vor `created`.
- **Text-Listen:** eine Zeile pro Issue, feste Spalten, ohne Rahmen:
  `bk-7f3k2  in_progress  claude-1  SSO-Login bricht nach Token-Refresh ab`
  Spalten: ID, State (11 breit), Assignee oder `-`, Titel; ID und Assignee sind auf die breiteste Zeile gepolstert (in Codepoints). `⧗ ` vor dem Titel markiert offene `depends_on`; `--tree` rückt den Titel je Ebene um zwei Leerzeichen ein.
- `--format md` gibt es nur bei `issue show` (sonst `usage`): die Issue-Datei so, wie sie auf der Platte liegt, plus angeforderte Kommentare — das token-ärmste Vollformat.
- Farben nur auf TTY und ohne `NO_COLOR`.
- **Steuerzeichen:** Im Text-Modus geht Text aus Issues, Kommentaren, Configs und Git vor der Ausgabe auf stdout und stderr durch eine Entschärfung: Steuerzeichen (C0, DEL, C1) außer `\n` und `\t` werden sichtbar, `ESC` als `␛`, die übrigen als `\u{XX}`; ebenso Format- und Bidi-Zeichen (`\p{Cf}`, etwa U+202E) außer U+200C und U+200D (Emoji-Sequenzen). JSON und `--format md` bleiben roh.
- **Write-Ausgabe:** Text — `issue create` druckt nur die neue ID, sonst eine Zusammenfassung der Operation; ohne Änderung `unchanged: <summary>`, Exit-Code 0. JSON — `{"commit":<sha|null>,"op":<aufgezeichnete Operation>,"id"?:…,"notices"?:[…],"warnings"?:[…]}`.
- **Hinweise und Warnungen** stehen im Text-Modus als `Hint: …` bzw. `Warning: …` auf stderr, im JSON-Modus nur im Objekt (`notices`, `warnings`), nie zusätzlich auf stderr.
- **Fehler** gehen nach stderr: im Text-Modus `Error: <message>` und optional `Hint: <hint>`, im JSON-Modus als `{"error":{"code":"…","message":"…","hint":"…","details":{…}}}` (`hint` und `details` optional; `details` trägt etwa Kandidaten, Zyklus-IDs oder die Zeile). Fehlt ein Befehl, ein Unterbefehl, ein Pflichtargument oder eine Pflichtoption, folgt im Text-Modus der Fehlermeldung nach einer Leerzeile die Hilfe des betroffenen Befehls (statt `Hint: … --help`); im JSON-Modus trägt das Fehlerobjekt stattdessen `hint: "<befehl> --help"`. Der Exit-Code bleibt 2.
- **Fehlercodes `usage` und `validation`:** Ein fehlender Pflichtwert und sich ausschließende Angaben sind `usage`. Ein gelieferter, aber leerer Wert (auch leeres stdin), ein ungültiger State, ein ungültiger Bereichsfilter und eine zu kurze Kurz-ID sind `validation`. Beide haben Exit-Code 2.
- **Exit-Codes** (stabiler Vertrag): `0` ok · `1` unerwartet · `2` Usage/Validierung/mehrdeutige ID · `3` nicht gefunden · `4` Konflikt (Claim verloren, Vorbedingung verletzt) · `5` Verifikation fehlgeschlagen · `6` Sync/Netzwerk.
  Bei Operationen im Einzelnen: verletzte Vorbedingung, `done`-Sperre, fehlendes `--force`/`--orphan`/`--recursive`, Belegung, nicht claimbar, existiert schon, Admin entfernen → 4; fehlende Referenz → 3; Zyklus, Policy, Schema, Property, Übergang, Größe → 2.

### 2.19 MCP-Modus

`backe mcp [--allow-delete]` startet einen MCP-Server über stdio (offizielles TypeScript-SDK v2, Paket `@modelcontextprotocol/server`). Der Server bedient über `serveStdio` beide Protokoll-Generationen: Clients mit `initialize`-Handshake (Revisionen bis 2025-11-25) und Clients der Revision 2026-07-28. Die globalen Optionen `-B`/`--backlog` und `--as` dürfen vor oder nach `mcp` stehen.

- **Kontext:** Aufgelöst wird wie beim CLI, ausgehend vom Arbeitsverzeichnis des Prozesses, dessen Env und den globalen Optionen. Ohne auflösbare Identität mit Key, bei einem fremden Handle oder bei ungültiger Config startet der Server nicht: stderr trägt `Error: …` und `Hint: …` wie beim CLI (nach dem Parsen der Argumente immer englisch, §2.18), Exit-Code `2`, stdout bleibt leer. Danach löst jeder Tool-Aufruf den Kontext mit denselben Eingaben neu auf; Änderungen an Configs gelten ab dem nächsten Aufruf.
- **stdout** gehört dem Protokoll; Logs und Fehler des Servers gehen nach stderr.
- Der Server ist ein dünner Adapter über denselben Service-Layer wie das CLI (§2.20); kein Feature existiert nur in einer der beiden Türen, außer den hier genannten Ausnahmen. Die Tool-Definitionen liegen adapterneutral in `src/tools/`; MCP registriert die Einträge für die Oberfläche `mcp`. Jedes Tool liefert dasselbe JSON wie der entsprechende Befehl mit `--format json` (gleiche Keys, gleiche Auslassungen).
- **Ergebnisform:** Erfolg ist ein einzelner Text-Content mit kompaktem JSON, ohne `structuredContent` und ohne `outputSchema`. Ein Fehler hat `isError: true` und denselben Text-Content `{"error":{"code","message","hint?","details?"}}` wie das CLI im JSON-Modus (§2.18); der Server läuft weiter. Prüfungen auf Parameterebene (genau eins von, leer, widersprüchlich) melden `usage` bzw. `validation`. Jedes Tool-Schema ist strikt (`additionalProperties: false`): Ein unbekannter Parameter ist eine Schemaverletzung und fällt nicht still weg. Schemaverletzungen fängt das SDK vor dem Handler ab; sie kommen als Fehler-Ergebnis mit dem Klartext des SDK (`Input validation error: …`, der den Parameter nennt), nicht als JSON.
- **`notices`:** Im Ergebnis ist jeder Eintrag ein Objekt `{code?, message, ids?}`, auch die Hinweise von `sync_now`.
- **Hints** nennen CLI-Befehle und -Flags wörtlich. Der Server erklärt das in `instructions`: ein Tool entspricht dem gleichnamigen Befehl (`issue_move` ↔ `backe issue move`), ein Flag dem Parameter in snake_case (`--add-dep` ↔ `add_deps`, `--blocked-by` ↔ `blocked_by`). Server-Identität: Name `backe`, Version aus dem Paket.
- **Nebenläufigkeit:** Lokale Writes laufen im Server nacheinander über eine Warteschlange; parallele Aufrufe gelingen alle, jeder mit eigenem Commit. `issue_claim`, `issue_next` mit `claim` und `sync_now` sind synchron mit dem Remote, laufen daneben und warten selbst auf `sync.lock`. Lesende Tools laufen ohne Warteschlange.
- **Hintergrund-Sync (§2.16.2):** Nach jedem lokalen Write mit Commit startet der Server einen Hintergrund-Sync, ohne das Ergebnis darauf warten zu lassen; vor jedem lesenden Tool wie beim CLI nach §2.16.3. `issue_claim`, `issue_next` mit `claim` und `sync_now` sprechen selbst mit dem Remote und starten weder vorher noch nachher einen Hintergrund-Sync (wie `claim` und `next --claim` im CLI). Zusätzlich startet der Server alle `pull_interval` Sekunden einen Hintergrund-Sync, solange er läuft, unabhängig davon, wie lange der letzte Versuch zurückliegt (Modus `auto`, Arbeitskopie und Git-Remote vorausgesetzt; das Debounce über `sync.lock` fängt einen laufenden ab); das Intervall liest der Server beim Start aus `.backe/backlog.jsonc` in `HEAD` der Arbeitskopie (ungültige Config: Server startet nicht; Arbeitskopie fehlt noch: 60 s; `0`: kein Timer).
- **Ende:** Der Server endet mit Exit-Code `0`, wenn stdin endet oder der Transport sich selbst schließt (etwa nach einem Fehler beim Schreiben auf stdout oder einer zu großen Nachricht). Vorher warten Warteschlange, die von ihr angestoßenen Hintergrund-Syncs und laufende synchrone Aufrufe ab. Scheitert dabei das Schließen, steht das als `backe mcp: …` auf stderr; das Ende bleibt regulär, denn der Client ist schon weg.
- **Tools** (kurze englische Beschreibungen, wie alle Texte des MCP-Modus; Parameternamen in snake_case wie die JSON-Keys; `?` = optional):

  | Tool | Entspricht | Parameter |
  | --- | --- | --- |
  | `context_get` | `backe context` | `props?` |
  | `issue_list` | `issue list` | `state?[]`, `project?[]`, `exact?`, `sprint?[]`, `repo?[]`, `assignee?`, `creator?`, `mode?` (`blocked`\|`unblockable`\|`ready`), `parent?`, `top_level?`, `prop?[]`, `has_prop?[]`, `query?`, `tree?`, `sort?` (`rank`\|`created`), `all?`, `limit?` (≥ 1), `fields?[]` |
  | `issue_get` | `issue show`; enthält `depends_on`, `parent` und die abgeleiteten `dependents` und `children` | `id`, `comments?` (`none` Default \|`last`\|`all`), `fields?[]` |
  | `issue_create` | `issue create` | `title`, `body?`, `state?`, `projects?[]`, `sprints?[]`, `repos?[]`, `assignee?`, `depends_on?[]`, `parent?`, `props?` (Objekt) |
  | `issue_update` | `issue edit` und `issue assign` (über `assignee`; kein eigenes Tool; Patch-Semantik) | `id`, `title?`, `body?`, `add_projects?[]`, `rm_projects?[]`, `add_sprints?[]`, `rm_sprints?[]`, `add_deps?[]`, `rm_deps?[]`, `parent?` (`null` löst), `assignee?` (Handle oder `me`; `null` entfernt), `props?` (Objekt; `null` als Wert entfernt die Property) |
  | `issue_move` | `issue move` | `id`, `to`, `reason?`, `blocked_by?[]`, `force?` |
  | `issue_resume` | `issue resume` | `id`, `reason?` |
  | `issue_reopen` | `issue reopen` | `id`, `to?`, `reason?` |
  | `issue_rank` | `issue rank` | `id`, genau eins von `top`, `bottom`, `before`, `after`, `value` |
  | `issue_claim` | `issue claim` | `id` |
  | `issue_next` | `next` | `level?` (`leaf`\|`top`), `project?`, `sprint?`, `repo?`, `all?`, `claim?`, `fields?[]` |
  | `comment_add` | `comment add` | `id`, `body` |
  | `attachment_add` | `attach add` | `id`, `name`, genau eins von `path`, `url`, `json`, `text` |
  | `attachment_get` | `attach get` | `id`, `name` |
  | `project_list`, `sprint_list` | `project list`, `sprint list` | — |
  | `sprint_get` | `sprint show` | `slug`, `project?[]`, `repo?[]`, `all?`, `sort?` |
  | `repo_locate` | `repo where` — Name → URL, Default-Ref, lokaler Pfad | `name` |
  | `batch` | `batch` (§2.16.6), beschränkt auf `issue.create`, `issue.edit`, `issue.move`, `issue.resume`, `issue.reopen`, `issue.rank`, `comment.add`, `attach.add` (nur `url`) und mit `--allow-delete` `issue.delete` | `ops` (Array von Objekten, je eine Zeile im Format von §2.16.6; mindestens eine) |
  | `sync_now` | `sync` (blockierend) | — |
  | `issue_delete` | `issue delete`; nur mit `--allow-delete` registriert | `id`, `force?`, `children?` (`orphan`\|`recursive`) |

- **Parameterregeln:**
  - `props` in `issue_create` und `issue_update` ist ein Objekt; die Keys folgen der Key-Grammatik aus §2.24 (sonst `validation` `Invalid property key '<key>'`), jeder Wert ist ein JSON-Wert wie bei `--prop <key>:=<json>`. `null` ist nur in `issue_update` erlaubt und entfernt die Property.
  - `attachment_add` liest `path` relativ zum Arbeitsverzeichnis des Servers (`~` wird expandiert) wie `attach add <datei>`, aber nur Dateien, die physisch (auch über Symlinks hinweg) im Arbeitsverzeichnis liegen, damit ein Agent keine beliebige lesbare Datei in den geteilten, signierten Backlog committet; sonst `validation` `File '<path>' is outside the working directory` mit dem Hinweis, den Inhalt per `text` oder `json` zu übergeben. Verglichen wird je Pfadsegment, nicht als String-Präfix; nach dem Öffnen löst der Server den Pfad erneut auf und verlangt dieselbe Datei innerhalb des Arbeitsverzeichnisses, damit ein zwischendurch getauschtes Verzeichnis nicht nach außen führt (ein kleines Restfenster bleibt, weil Node kein `openat` anbietet). Eine fehlende Datei im Arbeitsverzeichnis bleibt `not_found`; `text` ist UTF-8-Inhalt, der Dateiname ist `name` und trägt eine Endung. Gibt der Aufruf nicht genau eins von `path`, `url`, `json`, `text` an, ist das ein `usage`-Fehler.
  - `attachment_get` liefert das Ergebnis von `attach get --json` und zusätzlich `text` mit dem Inhalt, wenn die Datei höchstens 262 144 Bytes groß und gültiges UTF-8 ist; sonst ohne `text`. Ein nicht geladener LFS-Anhang ist derselbe Fehler wie bei `attach get` (§2.8).
  - `issue_next` mit `claim` verhält sich wie `next --claim` (§2.16.5).
  - `fields` in `issue_list`, `issue_get` und `issue_next` wird vor jedem Service-Aufruf geprüft; ein unbekanntes Feld ist `usage`, bevor gelesen oder übernommen wird.
  - `batch` lehnt jede Operation außerhalb der Liste in der Tabelle ab, bevor etwas geschrieben wird: `validation` `line <n>: '<op>' is not available in MCP mode`.
- **Nicht exponiert** in v1, auch nicht über `batch`: `user *`, `backlog *`, `config *`, Änderungen an `.backe/` und die CLI-only-Befehle aus §4.2. `issue_delete` und `issue.delete` im Batch gibt es nur mit `--allow-delete`.
- **Resources:** `backe://issue/{id}` liefert die Issue-Datei als Markdown (`text/markdown`); `{id}` darf eine Kurz-ID sein, die Antwort trägt die volle ID im URI. Die Resource hat keine Liste (ein Backlog kann zehntausende Issues haben); eine unbekannte ID ist ein MCP-Fehler mit der Meldung des Service.

### 2.20 Technik

- **Runtime:** Node.js, aktuelles LTS. Stand heute ist das Node 26 (LTS laut Release-Schema seit Oktober 2026, aktuell 26.13.1 laut `mise ls-remote node`). `engines.node: ">=26"`. Weil `engines` bei `npm i -g` nicht bindend ist, prüft `backe` die Version beim Start selbst: `Error: backe needs Node.js ≥ 26 (found <version>)`, Exit-Code 1. Ein Node, das schon beim Laden des Bundles scheitert, sieht die Meldung nicht.
- **Sprache:** TypeScript strict, ESM only, `module: nodenext`.
- **Toolchain:** mise (`mise.toml`: Node-Version, pnpm, Tasks `lint`, `test`, `build`, `check`); pnpm als Package-Manager; Biome für Lint und Format; Vitest mit v8-Coverage; tsdown für das Bundle `dist/cli.js` mit Shebang.
- **Runtime-Abhängigkeiten** (klein halten): `commander` (CLI), `zod` (Schemas, daraus JSON Schemas für die Configs), `yaml` (Frontmatter, Round-Trip), `jsonc-parser` (JSONC lesen und kommentarerhaltend schreiben), `@modelcontextprotocol/server` (MCP-SDK v2; `@modelcontextprotocol/core` kommt transitiv mit, `@modelcontextprotocol/client` nur für Tests). Git über das System-`git` per `child_process` (eigener dünner Wrapper), kein isomorphic-git — SSH-Signing und LFS gibt es nur im echten Git.
- **Systemvoraussetzungen:** `git` ≥ 2.38 (wegen `cat-file -Z`) mit SSH-Signing, `ssh-keygen`; optional `git-lfs`, `gh`. `backe doctor` prüft alle.
- **`backe doctor`** prüft außerdem User-Config, Arbeitskopien (gebundene Pfade, die nicht mehr existieren, kaputte Alternates von Clones mit `--reference`, LFS-Filter in der lokalen Config bei `attachments.lfs`) und liegengebliebene Temp-Reste abgestürzter Prozesse. Jede Prüfung hat eine feste ID und den Status `ok`, `warn` oder `fail`; Text `<status>  <id>  <detail>`, bei `warn`/`fail` mit Hinweis `  → <hint>` darunter, JSON `{"checks":[{id,status,detail,hint?}]}`. Ein `fail` ergibt nach dem Bericht Exit-Code 2. `--fix` entfernt nur Temp-Reste: `tmp/clone-*`, die älter als eine Stunde sind, und Temp-Dateien von Locks toter Prozesse desselben Hosts.
- **Plattformen v1:** Linux und macOS. Windows folgt später (§4.2).
- **Lizenz:** MIT.
- **Name:** Tool und Binary heißen `backe`. npm-Paket: `@spearwolf/backe`. Den Namen `backe` ohne Scope hat npm beim ersten Publish wegen Ähnlichkeit zu bestehenden Paketen abgelehnt (`base`, `jake`, `brace`); das Binary bleibt `backe`.

Schichten (Abhängigkeiten nur nach unten):

```
src/
├── cli/         Adapter: commander-Befehle, Ausgabeformate, Exit-Codes
├── mcp/         Adapter: MCP-Server, SDK-Anbindung, Resource
├── tools/       Adapterneutraler Tool-Katalog: Namen, Schemas, Art, Ausführung; genutzt von mcp/ und ui/
├── services/    Use-Cases; erzeugen Operationen, führen sie aus (Schreibpfad), Sync, Verify,
│                Backlog-Verwaltung, Claim, Next
├── ops/         Operationstypen, Vorbedingungen, Apply, Replay
├── git/         Git-Bausteine ohne Fachlogik: Wrapper, Commit+Sign, Historie, lokaler Zustand
├── store/       Layout, Parse/Serialize (kanonisch), Laden/Schreiben von Entitäten
├── context/     Config-Dateien, Kontext-Auflösung, Pfad-Expansion, Locks
└── core/        Domain-Typen, zod-Schemas, Zustandsmodell, IDs, URL-Normalisierung — rein, ohne I/O
```

Die reine Hülle — `src/core/`, `src/ops/graph.ts`, `src/ops/issue-query.ts` und ihre Laufzeit-Imports — kommt ohne `node:`-Module, `Buffer` und ungeschütztes `process` aus, damit das Web-Bundle von `backe ui` sie importieren kann (`ui.md` §2.2); ein Konventionstest prüft das. `sshFingerprint` liegt deshalb in `src/core/fingerprint.ts` außerhalb der Hülle.

### 2.21 CI/CD (GitHub Actions)

Jeder Workflow und jeder Job hat ein explizites `permissions:`; Actions sind auf ihren Major-Tag gepinnt.

- **`ci.yml`** auf Push nach `main` und auf jeden PR (`contents: read`; Feature-Branches prüft nur der PR-Lauf, sonst liefe jeder Push doppelt). Beide Plattformen rufen den wiederverwendbaren Workflow `test.yml` auf, Ubuntu mit 2 Shards, macOS mit 4 (Vitest braucht dort etwa dreimal so lange):
  - jeder Shard: Checkout ohne gespeicherte Credentials, Setup über `jdx/mise-action` (gleiche Versionen wie lokal), `pnpm install --frozen-lockfile`, Build (die E2E-Tests rufen `dist/cli.js` auf), `vitest run --shard=<i>/<n>`;
  - Shard 1 jeder Plattform zusätzlich: `biome ci`, `mise run lint` (Biome und `tsc --noEmit`) und der Pack-Smoke-Test (`pnpm pack`, dann `scripts/pack-smoke.sh <tarball>`);
  - Coverage nur auf Ubuntu: Jeder Shard schreibt einen Blob-Report, der Job `coverage` führt sie zusammen und prüft erst dort die Schwellen aus §5 — ein einzelner Shard reißt sie zwangsläufig.
- **Ruleset auf `main`** (Repo-Einstellung »main: grüne CI vor dem Merge«): Ein PR, auch der Release-PR, lässt sich nur mergen, wenn alle Jobs von `ci.yml` grün sind (`ubuntu / shard 1/2`, `ubuntu / shard 2/2`, `ubuntu / coverage`, `macos / shard 1/4` bis `4/4`, gebunden an GitHub Actions). Der Branch muss dafür nicht auf dem neuesten Stand von `main` sein; was nach dem Merge zusammenkommt, prüft der Job `test` im Release-Lauf. Die Admin-Rolle darf die Regel umgehen: Direkte Pushes auf `main` gehen durch, einen roten PR merged ein Admin nur, wenn er das Umgehen ausdrücklich bestätigt. Ändert sich die Shard-Anzahl in `ci.yml`, ändern sich die Check-Namen, und das Ruleset muss mitgezogen werden.
- **Paket:** `prepack` baut, es gibt also keinen Tarball ohne frischen Build. Der Tarball enthält genau `LICENSE`, `README.md`, `dist/cli.js` und `package.json`, dazu `dist/ui/**`.
- **Pack-Smoke-Test** (`scripts/pack-smoke.sh`): installiert den Tarball per `npm install --prefix <tmp>` in ein leeres Verzeichnis (zieht nur die Prod-Abhängigkeiten), prüft `backe --version` gegen `version` aus `package.json` und fährt `init → new → issue claim → mv review → sync → verify` gegen ein Bare-Remote im Temp-Verzeichnis; danach müssen `issue show` und das Log des Remotes genau den erwarteten Stand zeigen. Isoliert wie die Tests (§5): eigenes `HOME` und `BACKE_HOME`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, Key frisch per `ssh-keygen`. Der Backlog steht auf `sync.mode manual`, damit kein Hintergrund-Prozess das Temp-Verzeichnis überlebt; der Claim synchronisiert trotzdem selbst. Danach startet der Test `backe ui --port 0`, ruft Start-URL, `/` und `/api/backlogs` ab und beendet den Server per SIGTERM.
- **Versionierung:** release-please im Manifest-Modus (`release-please-config.json`, `.release-please-manifest.json`), `release-type: node`, vor 1.0 erhöht ein `feat` nur die Minor-Version, Tags ohne Komponente (`v0.1.0`). Changelog-Abschnitte deutsch wie die Commits: `feat` → »Neu«, `fix` → »Behoben«, `perf` → »Schneller«; `docs`, `refactor`, `test`, `chore` und `ci` erscheinen nicht. `bootstrap-sha` ist der Plan-Commit des Release-Meilensteins (`4a936de`), damit der erste Changelog nicht aus der ganzen Entwicklungshistorie entsteht. Der erste Release war per `release-as` auf `0.1.0` festgelegt; Tag und GitHub-Release `v0.1.0` stehen ohne npm-Paket, weil npm den Namen `backe` ablehnte. Erste Version auf npm ist `0.1.1` unter `@spearwolf/backe`.
- **`release.yml`** auf Push nach `main` und per `workflow_dispatch` mit der Eingabe `tag`, oben `permissions: {}`, fünf Jobs:
  - `release-please` (nur bei Push; `permissions: {}`) pflegt Changelog und Release-PR aus Conventional Commits; der Merge des Release-PRs erzeugt Tag und GitHub-Release. Er schreibt mit dem Token der GitHub App des Repos (`actions/create-github-app-token`, Variable `RELEASE_APP_CLIENT_ID`, Secret `RELEASE_APP_PRIVATE_KEY`, Token beschränkt auf `contents: write` und `pull-requests: write`), nicht mit `GITHUB_TOKEN`: Einen PR, den `GITHUB_TOKEN` anlegt oder aktualisiert, prüft die CI erst nach manueller Freigabe, und der Auto-Merge aus `mise run release` bliebe hängen.
  - `target` (`contents: read`) läuft, wenn release-please einen Release meldet oder der Workflow manuell gestartet wurde. Er nimmt den Tag aus release-please bzw. aus der Eingabe, verlangt streng `vX.Y.Z`, leitet die Version durch Abschneiden des `v` ab und prüft, dass es zum Tag ein GitHub-Release gibt.
  - `test` (`contents: read`) ruft `test.yml` für den Tag auf: Ubuntu, 2 Shards, mit Coverage-Schwellen.
  - `build` (`contents: read`, Checkout des Tags ohne gespeicherte Credentials), parallel zu `test`: `mise run lint`, `pnpm pack` (baut per `prepack`), Pack-Smoke-Test, Vergleich der Tarball-Version mit der des Tags, Upload genau dieses Tarballs als Artifact. Fremder Code — Dev-Abhängigkeiten, Tests — läuft nur in `test` und `build`, ohne Schreibrechte und ohne OIDC.
  - `publish` (Environment `npm`, `contents: write`, `id-token: write`) läuft nur, wenn `test` und `build` erfolgreich waren, und führt keinen Projektcode aus: kein Checkout, kein `pnpm install`, Node über die Erstanbieter-Action `actions/setup-node`. Er lädt das Artifact, verlangt npm ≥ 11.5.1 (Voraussetzung für Trusted Publishing) und liest Name und Version aus dem `package.json` im Tarball, nicht aus einer hart kodierten Zeile. **Publish idempotent:** Gibt es `<name>@<version>` schon auf npm, überspringt er den Publish, sonst `npm publish <tarball> --provenance --access public`. Zuletzt lädt er den Tarball per `gh release upload --clobber` ans GitHub-Release. Ein Neustart nach einem gescheiterten Upload ist damit grün.
- **Release auslösen:** `mise run release` (`scripts/release.sh`) prüft, dass `main` gepusht ist, wartet, bis der release-please-Job des letzten Pushs den Release-PR nachgezogen hat, und schaltet für ihn den automatischen Squash-Merge ein (Repo-Einstellung »Allow auto-merge«). GitHub mergt, sobald die Pflicht-Checks des Rulesets grün sind; der Merge startet `release.yml`. Gibt es keinen offenen Release-PR, meldet der Task »nichts zu releasen« und endet mit Exit 0. Release-Branches werden nach dem Merge gelöscht.
- **Rückweg:** Scheitert `test`, `build` oder `publish`, nachdem der Tag schon existiert, wird nur der Rest wiederholt: entweder »Re-run failed jobs« im gescheiterten Lauf oder ein manueller Start von `release.yml` mit dem Tag (`gh workflow run release.yml -f tag=v0.1.0`). »Re-run all jobs« hilft nicht: release-please läuft dann erneut, meldet `release_created=false`, und es wird nichts gebaut oder hochgeladen. Liegt der Fehler im getaggten Stand selbst, hilft kein Neustart; dann folgt ein neuer Release (`0.1.1`). Werden Release und Tag gelöscht und bekommt der Release-PR wieder das Label `autorelease: pending`, legt release-please beim nächsten Push beide neu an — auf demselben Merge-Commit, das taugt also nur, wenn Release oder Tag selbst kaputt sind.
- **npm Trusted Publishing** (OIDC, kein dauerhaftes Token-Secret). npm erlaubt keinen Trusted Publisher für ein Paket, das es noch nicht gibt; deshalb läuft genau die erste Veröffentlichung mit einem granularen npm-Token (nur Publish, kurze Laufzeit) als Secret `NPM_TOKEN` im Environment `npm`, das der Publish-Schritt nur nutzt, wenn es gesetzt ist. Danach wird der Trusted Publisher für `@spearwolf/backe` eingerichtet (Repo `spearwolf/backe`, Workflow `release.yml`, Environment `npm`) und das Secret gelöscht; ab dem zweiten Release läuft der Publish über OIDC.
- **Renovate** (`renovate.json`) statt Dependabot, weil es neben npm und Actions auch die Versionen in `mise.toml` pflegt: `config:recommended` und `:semanticCommits`, `rangeStrategy: bump`, Lockfile-Pflege, Gruppen `vitest` (`vitest`, `@vitest/*`) und `mcp-sdk` (`@modelcontextprotocol/*`), Zeitplan montags vor 6 Uhr, Zeitzone `Europe/Berlin`.

### 2.22 Abhängigkeiten und Reihenfolge

Die Reihenfolge ergibt sich aus zwei Feldern: `depends_on` legt harte Zwänge fest (was vorher erledigt sein *muss*), `rank` eine weiche Reihenfolge (was vorher drankommen *soll*). Ein Issue ohne `depends_on` ist verschiebbar, auch wenn es einen `rank` hat. Es gibt kein Prioritätsfeld und keine Sortierliste im Sprint.

- **Richtung:** `depends_on` steht am abhängigen Issue. `B.depends_on: [A]` heißt: B ist erst dran, wenn A erledigt ist. Die Gegenrichtung (`dependents`) wird beim Lesen berechnet und nie gespeichert — so ändert eine neue Abhängigkeit genau eine Datei.
- **Erledigt** im Sinne von `depends_on` ist eine Abhängigkeit in `done`, `cancelled` oder `rejected`. Hängt ein Issue an einer `cancelled`- oder `rejected`-Abhängigkeit, gilt es als bereit, aber `backe next` und `issue show` weisen darauf hin, weil die Voraussetzung vielleicht nie geliefert wurde.
- **Bereit** (`issue list --ready`): State `todo` oder `backlog`, alle `depends_on` erledigt, keine offenen Sub-Issues (§2.23) — und dasselbe für die Vorfahren: Kein Parent bis zur Wurzel ist `blocked` oder `on_hold`, und die `depends_on` aller Parents sind erledigt. Hängt ein Paket an einer offenen Entscheidung oder ist es pausiert, sind damit auch seine Sub-Issues nicht bereit.
- **Claimbar** (§2.16.5): bereit, oder bereits `in_progress` mit Assignee = ich — und nicht belegt (§2.23, »Arbeitseinheit Teilbaum«), außer die Belegung ist meine eigene.
- **Grenzen:** Abhängigkeiten dürfen über Sprints und Projekte hinweg zeigen; `next --sprint X` berücksichtigt auch Abhängigkeiten außerhalb von X. Zyklen werden beim Setzen abgelehnt, die Fehlermeldung nennt den Zyklus. Eine Abhängigkeit auf sich selbst ist verboten.
- **`backe next`** liefert zuerst ein Issue, das ich schon bearbeite (`in_progress`, Assignee = ich, Vorfahren nicht pausiert, im Kontext) — ein Agent, der nach einem Absturz neu startet, setzt so dort fort, wo er war. Sonst wählt es aus den bereiten Issues des Kontexts (Sprint, Projekt, Repo) mit Assignee leer oder ich:
  1. `todo` vor `backlog`;
  2. `rank` aufsteigend, Issues ohne `rank` zuletzt;
  3. danach topologisch: Issues mit mehr offenen transitiven `dependents` zuerst — sie geben am meisten frei;
  4. bei Gleichstand `created` aufsteigend.
  Gibt es keinen Kandidaten, nennt `next` den ersten zutreffenden Grund in dieser Reihenfolge — alles wartet auf Abhängigkeiten (mit den wartenden IDs), alles vergeben, alles blockiert, nichts offen — und endet mit Exit-Code 3.
- **Ändern:** `issue create --dep`, `issue edit --add-dep/--rm-dep`, MCP `issue_update`. Hinzufügen und Entfernen sind kommutative Mengen-Operationen (§2.16.4) und überstehen parallele Änderungen ohne Konflikt. Ein Zyklus, der erst durch zwei parallele Änderungen entsteht, wird beim Sync erkannt: die später eingespielte Operation landet als Konflikt in `.git/backe/conflicts/`.
- **Anzeige:** `issue show` listet `depends_on` mit dem State jeder Abhängigkeit und die `dependents`; Text-Listen markieren Issues mit offenen Abhängigkeiten.

**`rank` — die weiche Reihenfolge:**

- Optionale Ganzzahl, kleiner = früher. Issues ohne `rank` stehen hinter allen mit `rank`. Gleiche Werte sind erlaubt und fallen auf die nächste Sortierstufe zurück.
- Der `rank` gilt backlogweit, nicht pro Sprint: Ein Issue in zwei Sprints steht in beiden an derselben relativen Stelle.
- **Umsortieren ohne Rechnen:** `backe issue rank <id> (--top | --bottom | --before <id> | --after <id> | <zahl>)`. `backe` vergibt neue Werte im Abstand 1000 und setzt beim Einsortieren die Mitte zwischen den Nachbarn; nur wenn dort kein Platz mehr ist, nummeriert es die betroffene Nachbarschaft neu (ein Commit, mehrere Dateien). `--top` ist der kleinste vorhandene Rank − 1000, `--bottom` der größte + 1000, ohne gerankte Issues 1000. Ein Anker (`--before`/`--after`) ohne `rank` ist ein Fehler (Exit-Code 2). Von Hand eine Zahl ins Frontmatter zu schreiben ist ebenso gültig.
- **Sortierung:** `rank` vor `created` ist die Default-Sortierung jeder Ausgabe (§2.18).
- **Operation:** Setzen mit Vorbedingung (§2.16.4). Zwei parallele Umsortierungen desselben Issues ergeben einen Konflikt; verschiedene Issues kommen sich nur in die Quere, wenn eine Neunummerierung beide trifft.

### 2.23 Sub-Issues

Ein Issue hat höchstens einen Parent; ein Parent beliebig viele Sub-Issues. Die Hierarchie darf beliebig tief sein.

- **Speicherung:** Feld `parent` am Sub-Issue. Die Gegenrichtung (`children`) wird beim Lesen berechnet. Sub-Issues liegen **nicht** im Verzeichnis ihres Parents, sondern wie jedes Issue unter `issues/<shard>/<id>/` — der Pfad bleibt eine Funktion der ID (§2.5), Umhängen verschiebt keine Dateien.
- **Regeln:** Der Parent muss existieren, darf nicht das Issue selbst sein, Zyklen werden beim Setzen abgelehnt. Ein Sub-Issue in einem anderen Projekt oder Sprint als sein Parent ist erlaubt.
- **Anlegen:** `issue create --parent <id>` belegt `projects`, `sprints` und `repos` mit den Werten des Parents vor (überschreibbar per Flag). Die Werte werden ausdrücklich in die Datei geschrieben, nicht beim Lesen geerbt — eine Datei sagt alles über ihr Issue, und Filter bleiben einfach.
- **Umhängen:** `issue edit --parent <id>` bzw. `--no-parent`. Als Operation ist das ein Setzen mit Vorbedingung (`from`, §2.16.4), nicht kommutativ: Zwei parallele Umhängungen desselben Issues ergeben einen Konflikt, ebenso ein Zyklus, der erst durch zwei parallele Änderungen entsteht.
- **Zusammenspiel mit dem State:**
  - Kein automatischer Übergang — weder schließt der Parent sich, wenn alle Sub-Issues erledigt sind, noch erben Sub-Issues den State des Parents. Jeder Write braucht einen signierenden Akteur.
  - Ein Parent mit offenen Sub-Issues ist nicht bereit (§2.22): Die Arbeit passiert in den Sub-Issues. Sind alle erledigt, wird der Parent bereit und von `backe next` vorgeschlagen — zum Abschließen oder Prüfen. Ausnahme ist die Arbeitseinheit Teilbaum (unten).
  - `done` am Parent mit offenen Sub-Issues wird abgelehnt (§2.6). `cancelled`/`rejected` am Parent ist erlaubt; `backe` nennt dabei die offenen Sub-Issues, ändert sie aber nicht.
- **Anzeige:** `issue show` listet die Sub-Issues mit State und Fortschritt (`3/5 erledigt`) und den Pfad der Parents bis zur Wurzel. `issue list --tree` stellt die Hierarchie eingerückt dar; `--parent <id>` zeigt die direkten Sub-Issues, `--top-level` nur Issues ohne Parent.
- **Abgrenzung:** `parent` ist Gliederung (»gehört zu«), `depends_on` ist Reihenfolge (»kommt nach«). Beide sind unabhängig, mit einer Ausnahme: `depends_on` zwischen einem Issue und seinem Vorfahren oder Nachfahren ist ein Zyklus (Exit-Code 2) — beim Setzen der Abhängigkeit wie beim Umhängen, das eine solche Beziehung erzeugt. Sonst entstünde ein Stillstand ohne Fehlermeldung: Ein Kind ist nur bereit, wenn die `depends_on` aller Vorfahren erledigt sind (§2.22), und ein Parent mit offenen Kindern wird nicht `done` (§2.6).

**Arbeitseinheit Teilbaum.** Per Default ist ein Blatt die Arbeitseinheit: `next` verteilt Sub-Issues, der Parent ist Container. Manche Arbeit wird aber als Ganzes erledigt — ein Remediation-Paket behebt seine Findings in einem Commit (§2.25). Dafür:

- **`backe next --level top`** wählt unter den obersten Issues des Kontexts (ohne `parent`) und behandelt jedes samt Teilbaum als eine Einheit. Bereit ist ein solches Issue nach den Regeln von §2.22, nur dass offene Sub-Issues es nicht ausschließen. Reihenfolge wie bei `next` (eigenes laufendes zuerst, dann `todo` vor `backlog`, `rank`, Topologie, `created`). `--level leaf` ist der Default.
- **Claim eines Parents mit offenen Sub-Issues** ist erlaubt, wenn er so bereit ist; der Claim setzt `assignee` und `in_progress` nur am Parent.
- **Belegung:** Ein Issue ist belegt, wenn ein Vorfahre `in_progress` oder `review` ist und einen gesetzten Assignee hat, der nicht ich bin; ein Vorfahre ohne Assignee belegt nichts. Belegte Issues sind nicht claimbar (Exit-Code 4, mit dem belegenden Vorfahren) und `next --level leaf` überspringt sie. Wer den Parent hält, arbeitet im Teilbaum frei: Sub-Issues schließen, neue anlegen, umhängen.
- **Ende der Belegung:** sobald der Parent `in_progress`/`review` verlässt. Geht er auf `blocked` oder `on_hold`, ist der Teilbaum ohnehin nicht bereit (§2.22); wird er `done`, sind alle Sub-Issues erledigt (§2.6).
- MCP: `issue_next` mit Parameter `level: "leaf" | "top"`.

### 2.24 Custom Properties

Ein Issue darf beliebige eigene Properties tragen — etwa die ID eines gespiegelten GitHub-Issues, eine Schätzung, eine externe Ticketnummer.

- **Ort:** ausschließlich unter dem Frontmatter-Key `props`, nie als eigene Top-Level-Keys. So kann eine künftige Version neue eingebaute Felder einführen, ohne mit Custom-Daten zu kollidieren.
- **Keys:** `[a-z][a-z0-9_.-]{0,63}`, eindeutig pro Issue. Punkte erlauben eine eigene Namensgebung nach Herkunft (`github.issue`, `jira.key`) — `backe` behandelt sie als Teil des Namens, nicht als Verschachtelung.
- **Werte:** beliebige Werte aus dem YAML-Subset von §2.3 — Strings, Zahlen, Booleans, Listen, Maps, beliebig verschachtelt. Was als JSON darstellbar ist, ist erlaubt.
- **Kanonische Form:** `props` steht als letzter Key im Frontmatter, als Block-Map, Keys alphabetisch sortiert. Jede Property belegt mindestens eine eigene Zeile; parallele Änderungen verschiedener Properties mergen in Git meist konfliktfrei.
- **CLI:** `--prop key=wert` setzt einen String, `--prop key:=<json>` einen getypten Wert (`--prop estimate_h:=4`, `--prop tags:='["sso","auth"]'`) — die Konvention von HTTPie. `--unset-prop key` entfernt. Leere `props` werden nicht geschrieben.
- **Filter:** `issue list --prop key=wert` (Gleichheit, Vergleich auf der JSON-Darstellung; bei Strings exakt), `--prop key=a,b` (einer der Werte; ein Komma im Wert über die JSON-Form `--prop key:='"a,b"'`), `--prop key>=wert` / `key<=wert` für Zahlen und geordnete Enums (s. u.), `--has-prop key`. Mehrere `--prop` sind UND-verknüpft.
- **Deklarierte Properties:** `backlog.jsonc` darf Properties deklarieren (§2.15.3). Eine deklarierte Property wird bei jedem Write gegen ihren Typ geprüft; nicht deklarierte bleiben frei, außer `props_strict: true`. Typen: `string`, `integer`, `number`, `boolean`, `enum` (mit `values`, optional `ordered: true` für `>=`/`<=`; die Liste steht dann vom höchsten zum niedrigsten Wert), `json` (beliebig). Jede Deklaration hat eine `description`; `backe context --props` und das MCP-Tool `context_get` liefern sie aus, damit ein Agent weiß, was eine Property bedeutet. Wird eine Deklaration verschärft, meldet `backe verify` (als Hinweis, nicht als Fehler) die Issues, deren Werte nicht mehr passen. Geprüft wird bei einem Write nur, was er berührt: Eine Operation, die eine solche Property setzt, muss einen gültigen Wert setzen; `claim`, `move`, `comment add` und jede andere Operation, die die Property nicht anfasst, laufen ungehindert — auch beim Replay. Agents, die eine Property nicht kennen, werden so nie von ihr blockiert.
- **Ausgabe:** JSON enthält `props` als Objekt; Text-`show` listet sie unter den eingebauten Feldern.
- **Operation:** der Abschnitt `props` von `issue.edit`, `{"op":"issue.edit","id":…,"props":{"<key>":{"from":…,"to":…}}}` — Setzen mit Vorbedingung pro Key (§2.16.4), `null` heißt »nicht gesetzt«. Zwei Akteure, die verschiedene Keys setzen, kommen sich nie in die Quere; derselbe Key mit verschiedenen Werten ergibt einen Konflikt.
- `backe` legt keine Bedeutung in einzelne Properties; v1 kennt keine reservierten Property-Namen.

### 2.25 Referenz-Anwendung: Audit- und Remediation-Skills

Die Skills `js-ts-project-audit` (erzeugt Findings) und `js-ts-audit-remediation` (arbeitet sie in Paketen ab) sind der Maßstab dafür, ob `backe` als Grundlage für agentische Arbeit trägt. Verbindlich für `backe` sind die Features, die diese Abbildung nutzt; die Konventionen selbst (Property-Namen, Body-Aufbau) gehören den Skills und werden dort spezifiziert.

| Skills | `backe` |
| --- | --- |
| Finding | Issue im Projekt des auditierten Repos |
| `severity`, `category`, `domain`, `effort`, `kind`, `location(s)`, `evidence` | deklarierte `props` (§2.24); `severity` als geordnetes Enum, damit eine Scope-Regel wie »ab medium« ein Filter ist (`--prop severity>=medium`) |
| Feature (`component`), Umbenennung (`componentRenames`) | Unterprojekt `<app>/<feature>` (§2.9), Umbenennung per `project mv` |
| behoben — aus dem Backlog entfernt, gezählt in `resolvedCount` | `done`; die Zahl ergibt sich aus der Git-Historie |
| akzeptiert (`acknowledged`) | `rejected` mit Begründung |
| Remediation-Lauf; Plan-Kopf mit Scope-Regel, Baseline, Konventionen | Sprint (§2.10), Kopf als Sprint-Body |
| Paket | Parent-Issue; die Findings sind seine Sub-Issues (§2.23). Der Runner holt Pakete mit `next --level top --sprint <lauf> --claim` und belegt damit den Teilbaum |
| Reihenfolge der Pakete (Phase, Stellung im Plan) | `rank` |
| »Hängt ab von« (echter Zwang) | `depends_on` |
| Paketmarken `[ ]` `[~]` `[r]` `[x]` `[!]` | `todo`, `in_progress`, `review`, `done`, `on_hold` |
| Paketdatei: Detailplan, Verlauf, Reviewer-Urteil | Issue-Body und Kommentare |
| `Hash:` des Paket-Commits | `repos: [<app>@<hash>]` |
| Nebenbefund-Queue mit Urteil `→ Scope` / `→ Audit` / `→ Rückfrage` | Issues im Sprint, Urteil als Property |
| Audit anlegen, Folgelauf zusammenführen | `backe batch` (§2.16.6) — ein Commit je Schritt |
| Runner-Rollen A, B, N | Agent-Identitäten (§2.12); jeder Write ist zurechenbar |

**Entscheidungen sind eigene Issues.** Eine offene Entscheidung (im Audit `finding.decision`, im Lauf eine Rückfrage eines Runners) wird ein Issue mit `props.kind: decision`, zugewiesen einem Menschen. Body bzw. `props.decision` tragen die Form der Entscheidungsvorlage: Frage mit den Alternativen, Auslöser, zwei bis drei Optionen mit Folge, markierter Vorschlag, Kipp-Punkt, Geprüft/Angenommen. Wie das Betroffene daran hängt, richtet sich danach, wann die Frage entsteht:

- **Vor Arbeitsbeginn** (`finding.decision` aus dem Audit, Klärungsrunde vor dem Plan): Das Finding oder Paket bekommt `depends_on: [<Entscheidung>]` und ist damit nicht bereit — `backe next` reicht es keinem Agent, solange die Entscheidung offen ist.
- **Mitten in der Arbeit** (ein Runner stellt eine Rückfrage, Status `question`): Das ist ein akutes Hindernis. Das Paket geht auf `blocked` mit `blocked_by: [<Entscheidung>]` und wird nach der Antwort per `resume` fortgesetzt.

Ein Agent übernimmt das Entscheidungs-Issue selbst nicht, weil es einem Menschen zugewiesen ist. Die Antwort kommt als Kommentar des Menschen, die gewählte Option nach `props.decision.chosen`, danach `done`. Entscheidungen, die als Regel für spätere Läufe gelten, sind damit abfragbar: `backe issue list --prop kind=decision --state done -p <app>`.

**Grenze zum Report.** `backe` hält die Findings und alles, was an ihnen hängt. Was einen Audit-Lauf als Ganzes beschreibt — gemessener Umfang, Scores, Portrait, Score-Verlauf, Fix-Bilanz —, bleibt in der `audit.html`; deren Build liest die offenen Findings aus `backe` (`issue list --json`).

**Was sich für die Skills vereinfacht** (Folgen für deren Spezifikation, nicht für `backe`):

- Plan und Paketdateien müssen nicht mehr ungetrackt bleiben, weil sie Commit-Hashes tragen: Sie liegen im separaten Backlog-Repo, die Hashes zeigen ins Code-Repo. Die beiden Abschluss-Commits, die den Plan ein- und wieder austragen, entfallen.
- Finding-IDs sind dauerhaft statt Laufnummern. Die Ausnahme für dauerhafte Tracker in der globalen Regel zu Audit-Kürzeln greift damit; ein Commit-Trailer `Backe-Issue: <id>` im Code-Repo wäre zulässig.
- Die Schleife liest Paketstand und Marken über `backe … --json`, statt Markdown-Überschriften per `sed` zu parsen.
- Ein Folgelauf paart frische Findings gegen die offenen Issues statt gegen den Datensatz des Vorlaufs; das heuristische Paaren bleibt nötig, aber das Gegenüber hat eine feste ID.

## 3. Designentscheidungen

Solange nichts gebaut ist, stehen hier die Abwägungen; beim Konsolidieren wandern sie in ADRs.

### 3.1 Git ist Pflicht, ein Backlog ist ein eigenes Repo

Versionierung, Verteilung, Signaturen und Konfliktbehandlung kommen aus Git; ein Modus ohne Git müsste all das zweimal bauen. Verworfen: Backlog als Verzeichnis im Code-Repo (koppelt den Backlog an genau ein Repo, Backlog-Commits verrauschen die Code-Historie), Backlog als Orphan-Branch im Code-Repo (§4.2, späterer Modus).

### 3.2 Markdown mit YAML-Frontmatter für Entitäten, JSONC für Configs

Der Issue-Text ist Markdown, also bleibt die Datei Markdown — rendert auf jeder Forge, diffbar zeilenweise, Frontmatter ist für Agents trivial zu lesen. Verworfen: reines YAML (Beschreibung als Block-Scalar ist unangenehm zu editieren), JSON (nicht menschlich editierbar, Escaping im Text), TOML-Frontmatter (weniger verbreitet, kein Gewinn). JSONC für Configs, weil der User es so vorgibt und Kommentare in Configs gewollt sind.

### 3.3 Kanonische Serialisierung, kein `updated`-Feld, eine Entität pro Datei

Alle drei Regeln dienen demselben Ziel: parallele Änderungen sollen in Git ohne Konflikt zusammenlaufen. Ein Zeitstempel-Feld, das jeder Write ändert, würde das allein zunichtemachen.

### 3.4 Zufalls-IDs statt Laufnummern

Offline-fähige, parallele Erzeugung ohne Koordination. Preis: IDs sind weniger sprechend; die Kurzform (§2.5) federt das ab. Verworfen: Zähler-Datei (Konflikt bei jedem parallelen Create), Laufnummer beim Sync vergeben (ID ändert sich nachträglich, Verweise brechen).

Die Ablage wird nach ID geshardet, damit `issues/` nicht vollläuft. Sonst schreibt jeder Commit den Git-Tree eines riesigen Verzeichnisses neu, und Menschen verlieren beim Durchblättern den Überblick. Zwei Zeichen (1024 Shards) halten jedes Verzeichnis über den ganzen vorgesehenen Bereich (bis 50 000 Issues) bei höchstens rund 50 Einträgen; bei kleinen Backlogs sind die Shards dafür fast leer. Verworfen: ein Zeichen (32 Shards — bei 50 000 Issues rund 1 500 je Verzeichnis), zwei Ebenen à ein Zeichen (gleiche Verteilung, ein Verzeichnis mehr pro Pfad, kein Gewinn), Sharding nach Datum (ein Issue müsste seinen Pfad aus Metadaten statt aus der ID ableiten).

### 3.5 Git-native SSH-Commit-Signaturen

Keine eigene Kryptographie, keine Kanonisierungsprobleme, keine Signaturfelder in Dateien, die ein Mensch dann nicht mehr editieren darf; Prüfung ist mit Standardwerkzeugen nachvollziehbar. Verworfen:

- **Signatur pro Datei im Frontmatter** — bläht jede Datei auf, jeder Hand-Edit invalidiert sie, braucht eigene Kanonisierung.
- **Signiertes Append-only-Operationslog als Wahrheit**, Issue-Dateien nur als Projektion — maximal merge-fest, aber die Datei, die Menschen editieren, wäre nicht mehr die Wahrheit.

Preis: Signaturen hängen an Commits; Workflows, die Commits umschreiben (Squash, Web-Edits), sind ausgeschlossen. Das Replay beim Sync erzeugt neue Commits mit der Identität der Arbeitskopie (§2.16.1, §2.16.2) und ist deshalb unkritisch.

### 3.6 Local-first-Writes, Hintergrund-Sync, synchroner Claim

Ein Write darf nie auf das Netz warten — außer genau dort, wo Konsistenz zählt: beim Claim. Semantisches Replay macht Konflikte zur Ausnahme mit klarer Auflösung statt zur Git-Archäologie für Agents.

### 3.7 Ein Service-Layer, zwei Adapter

CLI und MCP teilen alle Use-Cases. So bleibt das Verhalten identisch, und Tests decken den Kern einmal ab.

### 3.8 Kein Daemon in v1

Der Hintergrund-Sync ist ein kurzlebiger, debouncter Prozess pro Write; der MCP-Server synchronisiert periodisch, solange er läuft. Ein Watcher-Daemon (z. B. für Desktop-Benachrichtigungen) ist späterer Ausbau (§4.2).

### 3.9 Side-Quest: Backlog als Git-Submodule

**Empfehlung: nicht als Standard.** Technisch geht es — ein Submodule ist für `backe` nur ein Verzeichnis mit `.git`. Praktisch kollidiert es mit fast allem, was `backe` ausmacht:

- **Der Pin ist das Problem.** Das Superprojekt pinnt einen Commit des Backlogs. Jeder `backe`-Write — bei mehreren Agents dutzende pro Stunde — erzeugt im Code-Repo `modified: backlog (new commits)`. Entweder wird ständig gebumpt (Rauschen, Konflikte in PRs), oder der Pin wird ignoriert (`ignore = all`), dann hat das Submodule keinen Zweck mehr.
- **Detached HEAD.** Submodule-Checkouts stehen auf dem gepinnten Commit, nicht auf einem Branch. `git submodule update` setzt sie dorthin zurück und versteckt damit lokal geschriebene Backlog-Commits. Der Hintergrund-Sync und Superprojekt-Operationen (Checkout, Rebase, `submodule update`) laufen sich gegenseitig in die Quere.
- **Ein Backlog, viele Repos.** Mit Projekthierarchie und Repo-Registry ist der Normalfall *ein* Backlog für *mehrere* Code-Repos. In welches gehört dann das Submodule?

Dasselbe Ziel — »das Code-Repo weiß, zu welchem Backlog es gehört« — erreicht eine eingecheckte `.backlog.jsonc` mit `"backlog": "<git-url>"` ohne jeden Pin; `backe` verwaltet den Clone unter `~/.backe/backlogs/`.

Falls es trotzdem jemand so einrichtet: `backe` erkennt den detached HEAD (§2.16.1, Schritt 2) und bricht mit dem Hinweis `git -C <pfad> switch <sync.branch>` ab, statt still auf einem losen Commit zu schreiben. Ein Submodule-Modus wird nicht weiterverfolgt.

### 3.10 Signaturen schützen nur gegen Identitätsanmaßung

Die Signaturen sollen ausschließlich sicherstellen, dass sich niemand als jemand anderes ausgeben kann. Was ein Mitglied mit gültigem Key inhaltlich tut, regelt `backe` nicht: Ein Agent darf Issues löschen oder auf `done` setzen wie jeder Mensch. Geprüft wird nur, was die Zuordnung selbst angreifen würde (§2.13, Punkt 4). Verworfen: Rollen pro User (z. B. »Agents dürfen nicht löschen«) — größeres Modell, und das Ziel ist Zurechenbarkeit, nicht Zugriffskontrolle. Fehlverhalten eines Agents bleibt über die Git-Historie zurechenbar und rückgängig zu machen.

### 3.11 Weiche Reihenfolge als eingebautes Feld, Entscheidungen als Issues

`rank` ist ein eingebautes Feld, weil Menschen Issues bequem umsortieren wollen (`issue rank --before`) und dafür kein Prop-Name verabredet werden soll. Verworfen: Sortierung über eine frei gewählte Property (generischer, aber unbequem), Reihenfolge als `depends_on`-Kette (erzeugt Scheinzwänge, »verschiebbar« geht verloren).

Offene Entscheidungen werden eigene Issues, an denen das Betroffene per `depends_on` hängt. So braucht der Kern kein Entscheidungskonzept, `next` überspringt Unentschiedenes von selbst, und beantwortete Entscheidungen bleiben als Regeln abfragbar. Verworfen: eingebautes Feld `decision` mit eigenem State (größerer Kern), Entscheidung nur als Property (für `next` unsichtbar).

## 4. Was offen bleibt

### 4.1 Offene Entscheidungen

Keine. Der Name `backe` ist eine Format-Entscheidung: Er steckt in `~/.backe/`, `.backe/`, `.git/backe/`, den `BACKE_*`-Variablen, den `Backe-*`-Commit-Trailern und dem URI-Schema `backe://`. Ein späteres Umbenennen bräche bestehende Backlogs und ihre Signaturprüfung.

### 4.2 Späterer Ausbau

- **Windows-Support:** CI-Matrix um `windows-latest` erweitern, Pfad-Normalisierung, `ssh-keygen`/`ssh-agent` unter Windows, Locks ohne POSIX-Semantik.
- **Custom Git-Merge-Driver** für Issue-Dateien (feldweiser 3-Way-Merge des Frontmatters), falls Replay-Konflikte in der Praxis häufig werden — Bedingung: mehr als ein Replay-Konflikt pro 100 Sync-Runden im Realbetrieb.
- **Orphan-Branch-Modus:** Backlog als eigener Branch im Code-Repo, ausgecheckt als Worktree — für Ein-Repo-Projekte ohne separates Backlog-Repo.
- Watcher/Daemon mit Benachrichtigungen; TUI; Volltext-Index bei großen Backlogs (Bedingung: `issue list -q` über 1 s bei 10⁴ Issues).
- Brücke zu GitHub Issues.
- **Weitere MCP-Tools:** In v1 nur über das CLI erreichbar — weder als Tool noch als Operation im MCP-`batch` — sind `issue link|unlink`, `comment list|edit|rm`, `attach list|rm`, die Writes auf Projekte, Sprints und Repos, `repo check|scan`, `verify`, `commit`, `sync status|resolve` und `doctor`.
- Standalone-Binaries (Node SEA) zusätzlich zum npm-Paket.

Bewusst offen gelassen im ersten Release, jeweils mit Grund:

| Punkt | Grund |
| --- | --- |
| Den lokalen Hub (§2.16.1) auf ein später ergänztes echtes Remote umhängen | Funktion, kein Fehler; heute manuell per `git remote set-url`. |
| Das Write-Journal trägt die Vorher-Bytes base64-kodiert | Nur bei großen Anhängen groß; gemessen wird erst im Realbetrieb. |
| LFS-Idempotenz hängt allein an `filter.lfs.process` | Korrekt, nur nicht robust gegen exotische LFS-Konfigurationen. |
| Ein Backlog, das `attachments.lfs` erst an- und dann wieder ausschaltet, hat bei global installiertem LFS-Filter für alte Anhänge Pointer-Dateien in der Arbeitskopie; `attach get` gibt dann den Pointer-Text aus | Den Pointer erkennt `backe` nur bei `attachments.lfs: true` (§2.8). |
| Der Graph-Patch baut betroffene Listen je Operation neu; die Statusabfrage von `HEAD` startet etwa 12 Git-Prozesse | Performance; Bedingung wie beim Volltext-Index: messbar langsam bei 10⁴ Issues. |
| Gescheiterte GitHub-Abfragen von `repo check --remote` werden nicht gecacht | Kostet nur Latenz ohne Netz. |
| `issue.link` mit `url` zeichnet den abgeleiteten Repo-Namen nicht auf (§2.16.4); das Replay leitet ihn neu ab | Er weicht nur ab, wenn beim Replay ein gleichnamiges Repo dazukam; aufgezeichnet wird er, sobald Replay-Konflikte im Realbetrieb das zeigen. |

## 5. Tests

Umgesetzt nach diesem Plan; Testzahlen und Coverage je Meilenstein stehen im Gesamtplan.

**Isolation:** Jeder Test läuft mit eigenem `BACKE_HOME` im Temp-Verzeichnis, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`; Test-Keys erzeugt `ssh-keygen` einmal pro Suite.

**Unit** (`core`, `store`, `ops`, `context`):

- Parse/Serialize: Roundtrip-Property-Tests (fast-check) — `parse(serialize(x)) == x`, kanonische Ausgabe idempotent, unbekannte Keys bleiben erhalten.
- Zustandsmodell tabellengetrieben: jeder Übergang × `strict` an/aus × Pflichtfelder; Zykluserkennung in `blocked_by`.
- `rank`: Mitte zwischen Nachbarn, Neunummerierung bei fehlender Lücke, Sortierung mit und ohne `rank`, Reihenfolge von `next` (`todo` → `rank` → Topologie → `created`).
- Batch: Platzhalter-Auflösung, Alles-oder-nichts bei einer ungültigen Zeile, ein Commit mit vollständigem Op-Body, Replay als Einheit.
- Deklarierte Properties: Typprüfung je Typ, `props_strict`, Bereichsfilter auf geordneten Enums und Zahlen, Meldung nach verschärfter Deklaration.
- Custom Properties: Key-Validierung, `=`/`:=`-Parsing, Roundtrip verschachtelter Werte, alphabetische Ordnung, Filter `--prop`/`--has-prop`, parallele Änderungen verschiedener Keys.
- Sub-Issues: Zykluserkennung in `parent`, Vorbelegung beim Anlegen, `done`-Sperre bei offenen Sub-Issues, Bereitschaft eines Parents, `delete --orphan`/`--recursive`; `next --level top` mit offenen Sub-Issues, Belegung des Teilbaums (Blatt-`next` überspringt, fremder Claim → Exit-Code 4, eigener Claim erlaubt), Ende der Belegung.
- Abhängigkeitsgraph: Zykluserkennung in `depends_on`, `--ready`-Berechnung (inkl. `cancelled`/`rejected`-Abhängigkeiten), Auswahlreihenfolge von `next` an konstruierten Graphen.
- IDs: Format, Kurzform-Auflösung, Mehrdeutigkeit.
- URL-Normalisierung als Tabelle.
- Kontext-Auflösung: Fixture-Verzeichnisbäume für jede Stufe der Rangfolge.
- Replay: Vorbedingung erfüllt, verletzt, kommutativ.

**Integration** (echtes Git, Bare-Remote im Temp-Verzeichnis, zwei oder mehr Clones):

- `init`, `clone`, signierte Commits, `verify` gegen unsignierte, fremd signierte und nach Widerruf signierte Commits; Policy-Verstöße (Nicht-Admin ändert `users/`, `creator` geändert).
- Parallele Änderungen verschiedener Felder → konfliktfreies Replay; gleiches Feld → Konflikt-Eintrag; zwei textuell saubere `depends_on`-/`parent`-Änderungen, die zusammen einen Zyklus bilden → Konflikt-Eintrag samt Folgeoperationen; `project.mv` erfasst ein parallel dem alten Pfad zugeordnetes Issue.
- Identität je Arbeitskopie: automatischer Clone je Handle, Ablehnung eines fremden Handles, Re-Signatur beim Replay mit dem eigenen Key.
- Verify: Merge-Commit abgelehnt; Force-Push gegen den gemerkten Anker erkannt; Widerruf topologisch (ein Commit mit widerrufenem Key auf einem Parent nach dem Widerruf ist ungültig, unabhängig vom Commit-Datum); Quarantäne `accepted`/`reverted` lässt einen hängenden Client weiterlaufen.
- Hand-Edits: `backe commit` übersetzt Frontmatter-, Body- und Kommentar-Änderungen in Operationen; ein `manual`-Konflikt lässt die Arbeitskopie sauber und blockiert keine Writes.
- Paralleler Claim aus zwei Clones → genau ein Gewinner, Exit-Code 4 beim Verlierer. Die Reihenfolge der Pushes wird über einen Test-Hook im Sync deterministisch gesteuert, nicht über Last oder Timing.
- Hintergrund-Sync: Debounce und Dirty-Flag über einen Hook, der den laufenden Sync anhält; Fake Timers für `pull_interval`.
- Anhänge inkl. Größenlimit; LFS-Pfad nur, wenn `git-lfs` vorhanden ist (sonst skip mit Meldung).

**E2E:** gebautes `dist/cli.js` als Subprozess; Golden-Files für Text- und JSON-Ausgabe; Exit-Codes.

**MCP:** SDK-Client gegen den Server (In-Memory-Transport); Snapshot der Tool-Schemas; Flow create → next → claim → comment → move → review.

**Coverage-Gate:** ≥ 90 % Lines und Branches für `core`, `store`, `ops`, `services`, `context`; ≥ 85 % gesamt. Adapter-Code wird über E2E abgedeckt.

## 6. Umsetzung in Schritten *(erledigt)*

Umgesetzt in den Meilensteinen M1–M8 des Gesamtplans [`docs/superpowers/plans/2026-11-18-backe-gesamtplan.md`](../superpowers/plans/2026-11-18-backe-gesamtplan.md), der die Reihenfolge an zwei Stellen umstellt (Abschnitt »Abweichungen von `backe.md` §6«). Die ursprüngliche Schrittfolge:

1. **Gerüst:** mise, pnpm, TypeScript, Biome, Vitest, tsdown, `ci.yml` (lint, typecheck, test, build).
2. **Kern ohne Git:** `core` und `store` — Schemas, Zustandsmodell, IDs, kanonische Serialisierung, Layout.
3. **Git-Schicht:** Wrapper, `init`, signierter Commit, Users, `verify`.
4. **CLI-Grundbefehle:** issue, comment, attach, project, sprint, repo, user, rank, batch; deklarierte Properties; Ausgabeformate, Exit-Codes.
5. **Kontext:** User-, Projekt- und Backlog-Config, Backlog-Registry, `context`.
6. **Sync:** Locks, Hintergrund-Sync, Replay, Claim, `next`.
7. **MCP-Modus.**
8. **Release:** `release.yml`, Pack-Smoke-Test, README, erste Veröffentlichung.

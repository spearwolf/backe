# backe — Git-basiertes Backlog für Menschen und Agents

> **Status: spezifiziert.**
> Verbindlicher Spec, nichts gebaut. Keine offenen Entscheidungen.
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

- Kein Server, keine Datenbank, kein Web-UI, kein TUI.
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

Leeres Repository, keine Commits.

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
- **YAML-Subset:** nur Maps, Listen, Strings, Zahlen, Booleans, ISO-8601-Timestamps. Keine Anchors, keine Tags, keine Multi-Docs. Der Parser lehnt alles andere mit Zeilenangabe ab.
- **Kanonische Serialisierung:** `backe` schreibt Keys in fester Reihenfolge (Reihenfolge der Schema-Definition), Listen als Flow-Sequenz, solange sie in eine Zeile passen (`projects: [web/auth, api]`), sonst als Block. Ein Roundtrip `parse → serialize` einer kanonischen Datei ist byte-identisch. Damit erzeugt jede Änderung den kleinstmöglichen Diff.
- **Eigene Daten gehören nach `props`** (§2.24). Unbekannte Top-Level-Keys bleiben trotzdem erhalten und werden nach den bekannten ausgegeben, damit kein Hand-Edit verloren geht; `backe commit` und `backe verify` warnen aber, weil eine künftige Version denselben Namen als eingebautes Feld beanspruchen könnte.
- **Kein `updated`-Feld, kein Zähler.** Ein Feld, das bei jeder Änderung neu geschrieben wird, macht jede parallele Änderung desselben Issues zum Zeilenkonflikt. Wann zuletzt geändert wurde, sagt `git log`; `backe` liest es von dort.
- Zeilenenden LF, UTF-8, abschließender Newline.

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
| `title` | ja | eine Zeile, 1–200 Zeichen |
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
| `repos` | nein | `name` oder `name@ref`; `name` muss in `repos/` registriert sein; `ref` ist Branch, Tag oder Commit |
| `attachments` | nein | §2.8 |
| `created` | ja | UTC, unveränderlich |
| `props` | nein | beliebige Custom Properties (§2.24); steht immer als letzter Key |

Die Beschreibung ist freies Markdown. `backe` fasst den Body nie an, außer der User ändert ihn ausdrücklich.

### 2.5 Issue-IDs

- Format `<präfix>-<5 Zeichen Crockford-Base32, lowercase>`, z. B. `bk-7f3k2`. Präfix aus `backlog.jsonc` (`id_prefix`, 2–6 Zeichen `[a-z]`).
- Zufällig erzeugt (`crypto.randomBytes`), nicht fortlaufend: Zwei Agents, die offline gleichzeitig ein Issue anlegen, kollidieren bei fortlaufenden Nummern garantiert, bei 32⁵ ≈ 33,5 Mio. Möglichkeiten praktisch nie.
- Kollision mit einer lokal existierenden ID → neu würfeln. Kollision beim Sync (§2.16) → das lokal neue Issue wird beim Replay mit neuer ID angelegt; die alte ID erscheint in der Ausgabe von `backe sync`.
- Bei mehr als 50 000 Issues im Backlog steigt die Länge für neue IDs auf 6 Zeichen.
- **Ablage (Sharding):** Ein Issue liegt unter `issues/<shard>/<id>/`. `<shard>` sind die ersten zwei Zeichen des Zufallsteils der ID: `bk-7f3k2` → `issues/7f/bk-7f3k2/`. Das ergibt 32² = 1024 mögliche Shards; weil die Zeichen gleichverteilt gewürfelt werden, füllen sie sich gleichmäßig — bei 10 000 Issues rund 10 je Shard, bei 50 000 rund 50. Das Verzeichnis trägt weiterhin die volle ID, damit `find`/`grep` und Menschen es ohne Umrechnung erkennen. Auch 6-stellige IDs (s. u.) bleiben bei zwei Shard-Zeichen. Die Shard-Regel ist Teil der Formatversion (`version` in `backlog.jsonc`, §2.15.3); eine Änderung wäre ein Major-Bump mit Migrationsbefehl.
- **Kurzform:** Überall, wo eine ID erwartet wird, genügt ein eindeutiger Suffix-Präfix ohne Backlog-Präfix (`7f3` statt `bk-7f3k2`), analog zu Git-Short-Hashes. Ab zwei Zeichen muss `backe` dafür nur einen Shard lesen. Mehrdeutig → Exit-Code 2 mit Kandidatenliste. Die Kurzform braucht mindestens 3 Zeichen.

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

- **Hauptlinie:** frei vor und zurück, auch mit Sprüngen (`backlog → in_progress` beim Claim). Mit `workflow.strict: true` in `backlog.jsonc` nur zum direkten Nachbarn.
- **→ `blocked`/`on_hold`:** `backe` setzt `paused_from`. `backe issue resume <id>` kehrt dorthin zurück und entfernt `paused_from` und `blocked_by`. Ein expliziter Übergang in einen anderen Hauptlinien-Zustand ist ebenso erlaubt.
- **Zwischen Seitenzuständen:** `blocked ↔ on_hold` ist erlaubt; `paused_from` bleibt dabei erhalten, `blocked_by` entfällt beim Wechsel nach `on_hold`. Aus `blocked` und `on_hold` geht es direkt nach `cancelled` oder `rejected`; `paused_from` und `blocked_by` entfallen. Jeder Übergang, der `blocked` verlässt, entfernt `blocked_by`.
- **Letzter Blocker gelöscht:** Entfernt `issue delete` die letzte ID aus `blocked_by` eines anderen Issues, setzt dieselbe Operation dieses Issue auf `on_hold` (mit erhaltenem `paused_from`) und schreibt einen Transition-Kommentar »Blocker <id> gelöscht«. Ein `blocked` ohne Blocker gibt es nie.
- **Blocker erledigt:** Erledigt heißt hier dasselbe wie bei `depends_on` (§2.22): `done`, `cancelled` oder `rejected`. Sind alle Issues in `blocked_by` erledigt, wird das blockierte Issue **nicht** automatisch entsperrt (jeder Write braucht einen signierenden Akteur), aber `backe issue list --unblockable` findet es und `backe next` meldet es als Hinweis. Ist ein Blocker `cancelled` oder `rejected` statt `done`, sagt der Hinweis das ausdrücklich — das Hindernis ist dann nicht beseitigt, nur nicht mehr in Arbeit.
- **Zyklen** in `blocked_by` werden beim Setzen abgelehnt.
- **Issue mit offenen Sub-Issues → `done`** wird abgelehnt (Exit-Code 4, Liste der offenen Sub-Issues); `--force` setzt es trotzdem. Offen heißt: nicht `done`, `cancelled` oder `rejected` (§2.23).
- **`blocked_by` ist nicht `depends_on`.** `blocked_by` beschreibt ein akutes Hindernis während der Arbeit, gehört zum State `blocked` und löst sich nur durch ein ausdrückliches `resume`. `depends_on` (§2.22) ist ein beim Planen gesetzter harter Zwang, gilt in jedem State, ändert den State nie und löst sich von selbst, sobald die Abhängigkeiten erledigt sind. Die weiche Reihenfolge ist keins von beiden, sondern `rank`.
- **`done`, `cancelled`, `rejected`:** nur über `backe issue reopen <id> [--to todo]` verlassbar (Default `backlog`).
- **Begründung:** Ein `--reason` (Markdown, inline, aus Datei oder stdin) wird als Kommentar mit `kind: transition` gespeichert (§2.7), nicht im Frontmatter. `backe issue show` zeigt die jüngste Begründung beim State an.

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
- Bearbeiten und Löschen nur durch den Autor (geprüft in §2.13).
- `backe issue show` zeigt per Default keine Kommentare, nur ihre Anzahl und die jüngste Transition-Begründung; `--comments <n|all>` holt sie dazu. Token-Sparsamkeit für Agents.

### 2.8 Anhänge

- Ein Issue darf beliebig viele Anhänge beliebigen Dateityps haben (Bilder, PDFs, Archive, JSON, …); `backe` interpretiert Dateiinhalte nicht, außer bei `--json` (s. u.).
- Jeder Anhang hat einen `name`: Pflicht, eindeutig pro Issue, `[a-z0-9][a-z0-9._-]{0,63}`.
- **Datei:** wird nach `attachments/<name>.<ext>` kopiert (`ext` aus der Quelldatei, sofern `name` keine hat); Frontmatter-Eintrag `{name, file}`.
- **JSON:** `--json '<json>'` oder `--json -` (stdin) wird validiert, kanonisch formatiert und als `<name>.json` abgelegt — also ein Datei-Anhang.
- **URL:** nur im Frontmatter `{name, url}`, keine Datei.
- Größenlimit pro Datei `attachments.max_bytes` in `backlog.jsonc` (Default 10 MiB, `null` = kein Limit); darüber Abbruch mit Hinweis auf LFS. Das Limit schützt das Git-Repo vor versehentlich eingecheckten Riesendateien, nicht vor bestimmten Dateitypen.
- `attachments.lfs: true` → `backe` pflegt `.gitattributes` (`issues/*/*/attachments/** filter=lfs diff=lfs merge=lfs -text`) und setzt `git lfs` voraus (`backe doctor` prüft das).
- `backe attach get <id> <name> [-o pfad]` gibt Dateien aus bzw. kopiert sie; bei URL-Anhängen nur die URL.

### 2.9 Projekte

- Identifiziert über einen Pfad aus Slug-Segmenten: `web`, `web/auth` (`[a-z0-9][a-z0-9-]*` je Segment, max. 5 Ebenen).
- Datei `projects/<pfad>.md`; Frontmatter `title`, optional `lead` (User-Handle), Body = Beschreibung.
- Ein Unterprojekt setzt das Elternprojekt voraus.
- Filter sind rekursiv: `--project web` umfasst `web/auth`; `--project web --exact` nur `web`.
- `backe project mv <alt> <neu>` benennt Projekt und alle Unterprojekte um und schreibt alle betroffenen Issues um — in **einem** Commit.
- `backe project rm` nur ohne referenzierende Issues, sonst `--reassign <pfad>` oder `--detach`.

### 2.10 Sprints

- Slug frei wählbar (`2026-w47`, `auth-hardening`). Datei `sprints/<slug>.md`, Frontmatter `title`, optional `start`, `end` (Datum), `closed: true`; Body = Sprint-Ziel.
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

- Issues verweisen per Name (`webapp@feat/sso`), nicht per URL. Das hält Issues kurz; zieht ein Repo um, ändert sich eine Datei statt hundert.
- `backe issue link <id> <url>[@ref]` mit unbekannter URL registriert das Repo implizit (Name aus dem Repo-Namen abgeleitet, bei Kollision mit Owner-Präfix) und verknüpft es — beides in einem Commit.
- **URL-Normalisierung:** `git@github.com:acme/webapp.git`, `https://github.com/acme/webapp`, `ssh://git@github.com/acme/webapp` und die Kurzform `gh:acme/webapp` ergeben dieselbe kanonische Form `github.com/acme/webapp`. Zwei Registry-Einträge mit gleicher kanonischer URL sind verboten.
- **Validierung** `backe repo check [name…]`:
  - immer: Syntax, Normalisierung, Eindeutigkeit;
  - `--remote`: Erreichbarkeit und Existenz von Refs via `git ls-remote`;
  - bei GitHub-URLs zusätzlich Sichtbarkeit (public/private), archiviert ja/nein — über `gh api repos/<owner>/<repo>`, falls `gh` vorhanden, sonst REST mit `GITHUB_TOKEN`.
  Ergebnisse werden nicht ins Backlog geschrieben (flüchtig), sondern in `~/.backe/cache/` mit TTL abgelegt. Normale Writes prüfen nie remote — `backe` bleibt offline-fähig.
- **Lokale Pfade** stehen in der User-Config (§2.15.1), geschlüsselt nach kanonischer URL — nicht nach Name, weil Namen nur innerhalb eines Backlogs eindeutig sind. `backe repo where <name>` löst Name → URL → lokalen Pfad auf; `backe repo scan <verzeichnis>` findet Clones über ihre Remotes und trägt sie ein.

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
- Schlüssel: SSH-Public-Keys, v1 nur `ssh-ed25519`. Private Keys liegen nie im Backlog.
- `backe user add <handle> --key <pubfile> [--agent --operator <handle>]` registriert einen vorhandenen Key.
- `backe user create-agent <handle>` erzeugt ein Ed25519-Keypair via `ssh-keygen` unter `~/.backe/keys/<backlog>/<handle>` (Modus 0600), registriert den Public Key mit `operator` = ausführender User und trägt die Identität unter `identities` in die User-Config ein (§2.15.1). Signiert wird dieser Commit vom ausführenden Menschen. Jedes Mitglied darf so eigene Agents anlegen; menschliche User legen nur Admins an (§2.13).
- `backe user revoke-key <handle> <fingerprint>` verschiebt einen Key nach `revoked_keys`. Ab dem Widerrufs-Commit ist der Key ungültig: Ein Commit ist nur gültig, wenn sein Key im `users/`-Stand seines **Parent-Commits** nicht widerrufen ist (§2.13). Maßgeblich ist die Position in der Historie, nicht die Uhrzeit — Commit-Zeitstempel setzt der Signierer selbst. Das Feld `revoked` ist nur Information.
- **Bootstrap:** `backe init` legt das Backlog an, registriert den ausführenden User und trägt ihn als Admin ein. Dieser erste Commit ist der Vertrauensanker (§2.13).

### 2.13 Signaturen und Verifikation

**Mechanismus: Git-native Commit-Signaturen mit SSH-Keys** (`gpg.format=ssh`, verfügbar seit Git 2.34 — ungeprüft; lokal ist Git 2.56.1 installiert).

- **Jeder Write ist genau ein Commit**, signiert mit dem Key des Akteurs. `backe` setzt dafür `-c gpg.format=ssh -c user.signingkey=<key> -c commit.gpgsign=true` pro Aufruf und fasst die globale Git-Config nicht an. `key` darf ein Private Key oder ein Public Key mit laufendem `ssh-agent` sein.
- **Commit-Message** (maschinenlesbar, kurz):

  ```
  issue move bk-7f3k2 review

  Backe-Actor: claude-1
  Backe-Op: {"op":"issue.move","id":"bk-7f3k2","from":"in_progress","to":"review"}
  ```

  `Backe-Op` ist die serialisierte Operation (§2.16.4). Ein Batch trägt `Backe-Op: batch` und die Operationen im Body (§2.16.6). Nur Änderungen, die sich nicht als Operation ausdrücken lassen, tragen `Backe-Op: manual` (s. »Hand-Edits«).
- **Lineare Historie.** Der Sync-Branch enthält keine Merge-Commits; `backe` integriert per Replay (§2.16.2). `verify` lehnt Merge-Commits ab. Erst dadurch ist »der `users/`-Stand des Parent-Commits« eindeutig.
- **Vertrauensanker.** Der erste Commit des Backlogs. `backe backlog clone` und `backe init` merken seinen Hash in `.git/backe/anchor`; `verify` prüft gegen diesen gemerkten Anker, nicht gegen den ersten Commit der gerade vorliegenden Historie. Ein Remote, dessen Stand kein Nachfahre des zuletzt verifizierten lokalen Stands ist (Force-Push, umgeschriebene Historie), wird abgelehnt (Exit-Code 5).
- **Verifikation** `backe verify [--since <rev>]` prüft jeden Commit seit dem Vertrauensanker:
  1. Signatur gültig;
  2. der signierende Key gehört laut `users/` **im Stand des Parent-Commits** zu einem User und ist dort nicht widerrufen;
  3. `Backe-Actor` ist dieser User;
  4. Identitätsschutz — genau die Regeln, ohne die sich jemand als ein anderer ausgeben könnte, und keine weiteren (§3.10):
     - `users/<handle>.md` ändern nur dieser User selbst, bei Agents ihr `operator`, oder ein Admin (sonst könnte jemand seinen Key bei einem fremden User eintragen);
     - neue Agent-User legt jedes Mitglied an, sofern `operator` es selbst ist; neue menschliche User anlegen, User entfernen und `.backe/**` ändern nur Admins (`admins` in `backlog.jsonc`) — sonst ließe sich die Verifikation abschalten;
     - `creator` eines neuen Issues = Akteur; `creator`, `id`, `created` sind danach unveränderlich;
     - einen Kommentar ändern oder einzeln löschen nur sein Autor (sonst ließen sich jemandem Worte in den Mund legen). Wer ein ganzes Issue löscht, löscht dessen Kommentare mit — das ist keine Anmaßung, die Historie zeigt, wer gelöscht hat.
  Technisch: `allowed_signers` je relevantem Users-Stand nach `.git/backe/` generieren, Signatur über `git verify-commit` bzw. `git log --format='%G? %GK %GS'` auswerten; Policy-Prüfung über den Diff des Commits.
- **Wann geprüft wird:** `backe sync` prüft eingehende Commits **vor** dem Übernehmen; ein ungültiger Commit stoppt den Sync mit Exit-Code 5 und Bericht. `verify` in `backlog.jsonc`: `strict` (Default; Sync stoppt), `warn` (Sync läuft, Warnung), `off`.
- **Quarantäne — der Weg zurück.** Ein ungültiger Commit auf dem Remote würde im Modus `strict` jeden Client dauerhaft anhalten, und Historie umzuschreiben ist ausgeschlossen. Deshalb führt `.backe/quarantine.jsonc` (nur Admins ändern es) eine Liste `{sha, decision: "accepted" | "reverted", reason}`. `backe verify --accept <sha> --reason <text>` trägt ein, dass der Commit inhaltlich hingenommen wird; `--revert <sha>` trägt ihn ein und erzeugt im selben signierten Commit die Umkehrung seiner Änderungen. `verify` lässt eingetragene Commits passieren und meldet sie als Hinweis. Ein Client, der hängt, läuft weiter, sobald der Quarantäne-Commit eines Admins auf dem Remote liegt — dieser Commit ist selbst gültig und steht hinter dem ungültigen.
- **Hand-Edits:** Menschen dürfen Dateien direkt im Editor ändern. `backe commit [-m <msg>]` validiert alle geänderten Dateien, normalisiert sie kanonisch und **übersetzt die Änderungen in Operationen**: Frontmatter-Änderungen in Feld-Operationen, eine Body-Änderung in `issue.body` (Vorbedingung: Hash des alten Bodys), neue Kommentar-Dateien in `comment.add`. Dasselbe gilt für `backe issue edit <id>` per `$EDITOR` und `--body-file`. Damit sind auch Hand-Edits replaybar. `Backe-Op: manual` bleibt nur für Änderungen ohne Operations-Entsprechung (Dateien außerhalb des Layouts, Anhänge, die von Hand ersetzt wurden). Mit nacktem `git commit` erzeugte unsignierte Commits blockieren im Modus `strict` den Push; `backe commit --resign` übersetzt die lokalen, noch nicht gepushten Commits nachträglich und signiert sie neu.
- **Konsequenzen für den Betrieb:** Backlog-Repos werden direkt auf den Sync-Branch gepusht. Squash-Merges über eine Forge-UI oder Web-Edits auf GitHub zerstören bzw. ersetzen Signaturen und werden von `verify` als ungültig gemeldet. Ein Branch-Protection-Setup, das nur signierte Commits zulässt, ist empfohlen.

### 2.14 Kontext-Auflösung

Jeder Aufruf löst einen Kontext aus fünf Werten auf: **backlog**, **user** (Identität samt Key), **project**, **sprint**, **repo**. `backe context` zeigt alle fünf samt der Quelle, aus der jeder Wert stammt.

**Backlog** — erster Treffer gewinnt:

1. `--backlog <name|pfad>` (`-B`)
2. `BACKE_BACKLOG`
3. das aktuelle Verzeichnis liegt in einem Backlog-Repo (Git-Toplevel enthält `.backe/backlog.jsonc`)
4. nächste `.backlog.local.jsonc` / `.backlog.jsonc` vom aktuellen Verzeichnis aufwärts bis `/`, Feld `backlog`
5. `current` in `~/.backe/config.jsonc`
6. sonst Fehler mit Hinweis auf `backe backlog use` / `backe init`

**User, project, sprint** — erster Treffer gewinnt: Flag (`--as`, `--project`, `--sprint`) → Env (`BACKE_USER`, `BACKE_PROJECT`, `BACKE_SPRINT`) → `.backlog.local.jsonc` → `.backlog.jsonc` → Backlog-Eintrag in `~/.backe/config.jsonc` → globaler Default in `~/.backe/config.jsonc`. Der aufgelöste User-Handle wird über `identities` der User-Config (§2.15.1) zu einem Key; ein Handle ohne Eintrag dort darf lesen, aber nicht schreiben.

**Repo** — liegt das aktuelle Verzeichnis in einem Git-Repo, dessen Remote (kanonische URL) im aktiven Backlog registriert ist, ist dieses Repo Kontext. `.backlog.jsonc` kann es mit `"repo": "<name>"` festlegen oder mit `"repo": null` abschalten.

**Wirkung des Kontexts:**

- `issue list`, `next`, `sprint show` filtern per Default nach project, sprint und repo des Kontexts. `-A`/`--all` hebt die Kontextfilter auf; explizite Filter-Flags ersetzen den jeweiligen Kontextwert.
- `issue create` übernimmt project, sprint und repo als Vorbelegung.
- Text-Ausgabe beginnt bei aktiven Kontextfiltern mit einer Kopfzeile (`backlog=acme project=web/auth repo=webapp`), damit niemand sich über fehlende Issues wundert. JSON-Ausgabe enthält den Kontext als Feld `context`.

**Backlog-Verwaltung** (das Pendant zu `kubectl config use-context`):

```
backe backlog list                       registrierte Backlogs, aktuelles markiert
backe backlog use <name>                 setzt current
backe backlog clone <url> [--name n]     registriert; geklont wird je Identität bei Bedarf (§2.16.1)
backe backlog add <name> <pfad> [--as h] bindet einen vorhandenen Clone an eine Identität
backe backlog remove <name> [--purge]    deregistriert; --purge löscht verwalteten Clone
backe init [pfad] --name n --prefix p [--remote url]
```

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

### 2.16 Git-Integration und Sync

#### 2.16.1 Schreibpfad

**Eine Arbeitskopie je Identität.** Jede Arbeitskopie gehört genau einer Identität (`.git/backe/identity`, gesetzt beim ersten Write). Nur so kann der Sync lokale Commits mit dem Key ihres eigenen Akteurs neu signieren (§2.16.2), ohne Zugriff auf fremde Keys. `backe` verwaltet die Clones selbst unter `~/.backe/backlogs/<backlog>/<handle>/` und legt sie beim ersten Zugriff einer Identität an (`git clone --reference` auf einen vorhandenen Clone desselben Backlogs, damit Objekte nicht doppelt liegen). Zwei Agents auf einer Maschine arbeiten damit transparent in zwei Clones. Eine eigene Arbeitskopie lässt sich per `backe backlog add … --as <handle>` binden; ein Write mit einer anderen Identität darin wird abgelehnt (Exit-Code 2, mit dem Pfad der passenden Arbeitskopie).

Jede schreibende Operation:

1. holt den Arbeitskopie-Lock `.git/backe/write.lock` (exklusiv angelegte Datei mit PID und Zeitstempel; verwaiste Locks toter Prozesse werden übernommen). Er serialisiert mehrere Prozesse derselben Identität — CLI-Aufrufe, MCP-Server, Hintergrund-Sync.
2. prüft, dass der Sync-Branch ausgecheckt ist (kein detached HEAD, kein laufender Rebase) — sonst Abbruch mit Hinweis.
3. lädt den Zustand, prüft Vorbedingungen, schreibt die Dateien kanonisch.
4. `git add` exakt der betroffenen Pfade, signierter Commit (§2.13).
5. gibt den Lock frei.
6. bei `sync.mode: auto`: startet den Hintergrund-Sync (§2.16.2) und kehrt sofort zurück.

Writes sind damit local-first und schnell; die Verteilung passiert danach.

#### 2.16.2 Hintergrund-Sync

`backe sync --background` wird als detached Prozess gestartet (`child_process.spawn` mit `detached: true`, `unref()`), Ausgabe nach `.git/backe/sync.log`.

- **Debounce:** Hält bereits ein Sync-Prozess `.git/backe/sync.lock`, setzt der neue nur ein Dirty-Flag und beendet sich; der laufende Sync dreht nach Abschluss eine weitere Runde, solange das Flag gesetzt ist.
- **Ablauf einer Runde:**
  1. `fetch`, eingehende Commits verifizieren (§2.13).
  2. Gibt es keine ungepushten lokalen Commits: Fast-Forward, fertig.
  3. Sonst **immer Replay**, nicht nur bei einem Textkonflikt: Die Operationen der lokalen Commits werden gesammelt, die Arbeitskopie auf den Remote-Stand gesetzt und die Operationen in Reihenfolge erneut ausgeführt — mit voller Validierung gegen den neuen Stand (Vorbedingungen und Invarianten, §2.16.4) und je Operation bzw. Batch einem neuen, mit der eigenen Identität signierten Commit. Ein Git-Rebase allein sähe nicht, dass zwei textuell saubere Änderungen zusammen einen Zyklus bilden oder auf ein inzwischen gelöschtes Issue zeigen.
  4. `push`. Abgelehnt (jemand war schneller) → zurück zu 1, bis zu 5 Runden mit Backoff.
- **`manual`-Commits** unter den lokalen: Sie werden an ihrer Stelle in der Reihe per Cherry-Pick übernommen und neu signiert. Gibt es dabei einen Textkonflikt, bricht der Sync die Runde ab und lässt die Arbeitskopie im Zustand vor der Runde — sauber, auf dem lokalen Stand, ohne laufenden Rebase. Lokale Writes gehen weiter (sie stapeln sich ungepusht), `backe sync status` meldet den Konflikt, und `backe sync --interactive` führt im Vordergrund durch die Auflösung.
- **Fehler** (Netz weg, Verify fehlgeschlagen, manueller Konflikt) blockieren nie lokale Writes. `backe sync status` und ein Hinweis in der Kopfzeile jeder Text-Ausgabe zeigen ungepushte Commits, letzte Sync-Zeit und offene Konflikte.

#### 2.16.3 Frische beim Lesen

Lesende Befehle arbeiten auf dem lokalen Stand. Bei `sync.mode: auto` stößt ein Read eine volle Hintergrund-Sync-Runde an (§2.16.2, inklusive Übernahme in die Arbeitskopie), wenn die letzte älter als `pull_interval` ist (nicht blockierend) — der nächste Read sieht dann den neuen Stand. `--sync` erzwingt einen blockierenden Pull vor dem Lesen. Der MCP-Server (§2.19) synchronisiert zusätzlich periodisch im Takt von `pull_interval`.

#### 2.16.4 Operationen und semantisches Replay

Jede Mutation ist eine serialisierbare Operation mit Vorbedingungen, z. B.:

```json
{"op":"issue.move","id":"bk-7f3k2","from":"in_progress","to":"review"}
{"op":"issue.edit","id":"bk-7f3k2","set":{"assignee":{"from":null,"to":"claude-1"}},"add":{"projects":["api"]}}
{"op":"issue.body","id":"bk-7f3k2","from_hash":"9c1e…","body":"…"}
{"op":"comment.add","id":"bk-7f3k2","file":"20261118T100400Z-spw-q8x.md"}
{"op":"project.mv","from":"web/auth","to":"platform/auth"}
{"op":"issue.rank","id":"bk-7f3k2","before":"bk-a91c0"}
```

**Eine Operation je Befehl, aufgezeichnet als Absicht.** Ein CLI-Befehl oder MCP-Aufruf ergibt genau eine Operation; sie beschreibt, was der Akteur wollte, nicht welche Dateien sich änderten. Zusammengesetzte Befehle bleiben eine Operation: `issue edit` mit mehreren Flags (jedes Feld mit eigener Vorbedingung, alles atomar), `project mv`, `issue delete --orphan/--recursive` samt Referenzbereinigung, `issue link` mit implizitem Repo-Eintrag, `sprint close --carry-over`, `issue rank` samt Neunummerierung. Beim Replay wird die Absicht gegen den neuen Stand neu ausgewertet: `project.mv` erfasst dann auch Issues, die inzwischen jemand dem alten Pfad zugeordnet hat; `issue.rank --before` rechnet den Wert gegen die aktuellen Nachbarn neu.

Die Operation steht im Trailer `Backe-Op` ihres Commits. Beim Replay (§2.16.2) gilt je Operation:

- **Vorbedingungen und Invarianten erfüllt** → neuer signierter Commit. Invarianten sind die Regeln, die beim direkten Ausführen auch gelten: keine Zyklen in `blocked_by`, `depends_on`, `parent`; keine Referenz auf ein nicht existierendes Issue, Projekt, Sprint oder Repo; kein `done` an einem Parent mit offenen Sub-Issues; gültige Werte deklarierter Properties, die die Operation berührt (§2.24).
- **Mengen-Operationen** (`add`/`remove` auf Listen) haben keine Wert-Vorbedingung und kollidieren nie miteinander — an den Invarianten können sie trotzdem scheitern, etwa wenn zwei parallele `depends_on`-Ergänzungen zusammen einen Zyklus bilden.
- **Verletzt** → die Operation wird nicht angewendet, sondern nach `.git/backe/conflicts/<ts>.json` geschrieben; `backe sync status` listet sie, `backe sync resolve` bietet *verwerfen* oder *trotzdem anwenden* (mit erneuter Prüfung) an.
- **Folgeoperationen:** Spätere lokale Operationen, die sich auf eine abgelegte beziehen — dasselbe Issue, ein von ihr erzeugtes Issue, ein Batch-Platzhalter —, landen ebenfalls in der Konfliktablage, gemeinsam mit ihr. Unabhängige Operationen laufen weiter.
- **ID-Kollision beim Replay** (§2.5): Das lokal erzeugte Issue bekommt eine neue ID; spätere lokale Operationen, die die alte ID nennen, werden mit umgeschrieben.

#### 2.16.5 Claim

`backe issue claim <id>` und `backe next --claim` sind die einzigen **synchronen** Writes:

1. blockierende Sync-Runde (§2.16.2), samt Replay ungepushter lokaler Operationen;
2. Prüfung: Das Issue ist claimbar (§2.22) — bereit, oder bereits `in_progress` mit Assignee = ich;
3. Commit: `assignee = ich`, `state = in_progress`. Der Sprung aus `backlog` oder `todo` ist auch bei `workflow.strict: true` erlaubt — Claim ist der vorgesehene Einstieg in die Arbeit;
4. sofortiger `push` aller ungepushten Commits, der Claim zuletzt. Abgelehnt → zurück zu 1; hat inzwischen jemand anderes geclaimt → Claim-Operation verwerfen, Exit-Code 4. Die übrigen lokalen Operationen bleiben und gehen mit dem nächsten Sync raus.

Bei einem gemeinsamen Remote gibt es damit pro Issue genau einen Gewinner — unter den Clients, die synchronisieren. Wer lokal `sync.mode: manual` setzt oder ohne Remote arbeitet, claimt nur lokal; die Garantie gilt für ihn nicht, und `backe` sagt das bei jedem Claim in einer Zeile.

#### 2.16.6 Batch

Ein Audit legt Dutzende Findings auf einmal an, ein Folgelauf schließt und ändert viele zugleich. Ein signierter Commit pro Operation wäre dafür langsam und unübersichtlich. `backe batch [-f <ops.jsonl> | -]` führt viele Operationen als **einen** Commit aus:

- Eingabe: eine Operation pro Zeile im Format von §2.16.4, dazu `issue.create`, `comment.add` und alle anderen Mutationen. Neue Issues bekommen einen Platzhalter (`"ref":"$f1"`), auf den spätere Zeilen verweisen dürfen (`"parent":"$p1"`, `"depends_on":["$f1"]`).
- **Alles oder nichts:** Erst werden alle Operationen gegen den aktuellen Stand validiert, dann geschrieben. Scheitert eine, wird nichts geschrieben; die Fehlermeldung nennt die Zeile.
- Commit-Message: Zusammenfassung (`batch: 34 create, 12 move`), Trailer `Backe-Op: batch`, die Operationen als JSONL im Body — so bleibt der Batch für das Replay (§2.16.4) vollständig. Beim Replay gilt er als Einheit: Verletzt eine Operation ihre Vorbedingung, geht der ganze Batch in die Konfliktablage.
- Ausgabe: die Zuordnung Platzhalter → vergebene ID, im JSON-Modus als Objekt.
- Obergrenze 1000 Operationen pro Batch; darüber mehrere Batches.
- MCP-Tool `batch` mit derselben Semantik.

### 2.17 CLI-Oberfläche

Konventionen wie `gh`: `backe <nomen> <verb>`, für die häufigsten Befehle Top-Level-Aliase.

```
backe init | doctor | context | verify | commit | batch | mcp
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

### 2.18 Ausgabe und Agent-Ergonomie

- `--format text|json|md` (`--json` als Kurzform); Default `text`, überschreibbar mit `BACKE_FORMAT` (Agents setzen `json`).
- **JSON ist kompakt** (eine Zeile, keine Einrückung) und enthält nur gesetzte Felder. `--fields id,title,state` reduziert weiter.
- **Sortierung:** Jede Ausgabe, die mehrere Issues aufzählt, sortiert per Default nach `rank` aufsteigend (Issues ohne `rank` zuletzt), dann nach `created` aufsteigend — in CLI und MCP, in Text und JSON: `issue list`, die Gruppen von `sprint show`, Sub-Issues und `dependents` in `issue show`, die Geschwister jeder Ebene von `--tree`, `issue_list`. `issue list` und `sprint show` bieten `--sort created` als Alternative an. Einzige Ausnahme ist `next`, das nach §2.22 auswählt — auch dort steht `rank` vor `created`.
- **Text-Listen:** eine Zeile pro Issue, feste Spalten, ohne Rahmen:
  `bk-7f3k2  in_progress  claude-1  SSO-Login bricht nach Token-Refresh ab`
- `--format md` von `issue show` liefert die Issue-Datei so, wie sie auf der Platte liegt, plus angeforderte Kommentare — das token-ärmste Vollformat.
- Farben nur auf TTY und ohne `NO_COLOR`.
- **Fehler** gehen nach stderr; im JSON-Modus als `{"error":{"code":"…","message":"…","hint":"…"}}`.
- **Exit-Codes** (stabiler Vertrag): `0` ok · `1` unerwartet · `2` Usage/Validierung/mehrdeutige ID · `3` nicht gefunden · `4` Konflikt (Claim verloren, Vorbedingung verletzt) · `5` Verifikation fehlgeschlagen · `6` Sync/Netzwerk.

### 2.19 MCP-Modus

`backe mcp [--backlog …]` startet einen MCP-Server über stdio (offizielles TypeScript-SDK `@modelcontextprotocol/sdk`).

- Kontext-Auflösung wie beim CLI, ausgehend vom Arbeitsverzeichnis des Prozesses und dessen Env. Ohne auflösbare Identität mit Key startet der Server nicht.
- Der Server ist ein dünner Adapter über denselben Service-Layer wie das CLI (§2.20); kein Feature existiert nur in einer der beiden Türen, außer den hier genannten Ausnahmen.
- **Tools** (kurze Beschreibungen, kompakte JSON-Ergebnisse):

  | Tool | Entspricht |
  | --- | --- |
  | `context_get` | `backe context` |
  | `issue_list` | `issue list` inkl. Filter, `fields`, `limit` |
  | `issue_get` | `issue show`, Parameter `comments: none\|last\|all`; enthält `depends_on`, `parent` und die abgeleiteten `dependents` und `children` |
  | `issue_create`, `issue_update` | `issue create`, `issue edit` (Patch-Semantik; `props` als Objekt, `null` als Wert entfernt die Property) |
  | `issue_move`, `issue_resume`, `issue_reopen` | gleichnamige Befehle |
  | `issue_claim`, `issue_next` | `issue claim`, `next` |
  | `comment_add` | `comment add` |
  | `attachment_add`, `attachment_get` | `attach add`, `attach get` |
  | `project_list`, `sprint_list`, `sprint_get` | gleichnamige Befehle |
  | `repo_locate` | `repo where` — Name → URL, Default-Ref, lokaler Pfad |
  | `issue_rank` | `issue rank` |
  | `batch` | `batch` (§2.16.6) |
  | `sync_now` | `sync` (blockierend) |

- **Nicht exponiert** in v1: `issue delete`, `user *`, `backlog *`, `config *`, Änderungen an `.backe/`. `--allow-delete` schaltet `issue_delete` frei.
- **Resources:** `backe://issue/{id}` liefert die Issue-Datei als Markdown.
- Periodischer Hintergrund-Sync alle `pull_interval` Sekunden, solange der Server läuft.

### 2.20 Technik

- **Runtime:** Node.js, aktuelles LTS. Stand heute ist das Node 26 (LTS laut Release-Schema seit Oktober 2026, aktuell 26.13.1 laut `mise ls-remote node`). `engines.node: ">=26"`.
- **Sprache:** TypeScript strict, ESM only, `module: nodenext`.
- **Toolchain:** mise (`mise.toml`: Node-Version, pnpm, Tasks `lint`, `test`, `build`, `check`); pnpm als Package-Manager; Biome für Lint und Format; Vitest mit v8-Coverage; tsdown für das Bundle `dist/cli.js` mit Shebang.
- **Runtime-Abhängigkeiten** (klein halten): `commander` (CLI), `zod` (Schemas, daraus JSON Schemas für die Configs), `yaml` (Frontmatter, Round-Trip), `jsonc-parser` (JSONC lesen und kommentarerhaltend schreiben), `@modelcontextprotocol/sdk`. Git über das System-`git` per `child_process` (eigener dünner Wrapper), kein isomorphic-git — SSH-Signing und LFS gibt es nur im echten Git.
- **Systemvoraussetzungen:** `git` mit SSH-Signing, `ssh-keygen`; optional `git-lfs`, `gh`. `backe doctor` prüft alle.
- **Plattformen v1:** Linux und macOS. Windows folgt später (§4.2).
- **Lizenz:** MIT.
- **Name:** Tool und Binary heißen `backe`. npm-Paket: `backe` ohne Scope (frei laut `npm view backe`, Stand 2026-11-18); Ausweichname `@spearwolf/backe` (ebenfalls frei). Ob npm den unscoped Namen wegen Ähnlichkeit zu bestehenden Paketen ablehnt, zeigt erst der erste Publish — dann greift der Ausweichname, das Binary bleibt `backe`.

Schichten (Abhängigkeiten nur nach unten):

```
src/
├── cli/         Adapter: commander-Befehle, Ausgabeformate, Exit-Codes
├── mcp/         Adapter: MCP-Server, Tool-Definitionen
├── services/    Use-Cases; erzeugen Operationen, führen sie aus, Claim, Next
├── ops/         Operationstypen, Vorbedingungen, Apply, Replay
├── git/         Wrapper, Commit+Sign, Sync, Verify, Locks
├── store/       Layout, Parse/Serialize (kanonisch), Laden/Schreiben von Entitäten
├── context/     Config-Dateien, Kontext-Auflösung, Pfad-Expansion
└── core/        Domain-Typen, zod-Schemas, Zustandsmodell, IDs, URL-Normalisierung — rein, ohne I/O
```

### 2.21 CI/CD (GitHub Actions)

- **`ci.yml`** auf Push und PR:
  - Setup über `jdx/mise-action` (gleiche Versionen wie lokal);
  - `biome ci`; `tsc --noEmit`;
  - Tests mit Coverage-Gate, Matrix `ubuntu-latest` + `macos-latest`;
  - Build, danach Pack-Smoke-Test: `pnpm pack`, Tarball in ein leeres Verzeichnis installieren, `backe --version` und ein Skript-E2E (init → create → claim → move → verify) gegen ein lokales Bare-Remote.
- **`release.yml`:** release-please pflegt Changelog und Release-PR aus Conventional Commits; beim Release: Build, `npm publish --provenance --access public` über npm Trusted Publishing (OIDC, kein Token-Secret), GitHub-Release mit Tarball.
- Renovate oder Dependabot für Abhängigkeiten und Actions.

### 2.22 Abhängigkeiten und Reihenfolge

Die Reihenfolge ergibt sich aus zwei Feldern: `depends_on` legt harte Zwänge fest (was vorher erledigt sein *muss*), `rank` eine weiche Reihenfolge (was vorher drankommen *soll*). Ein Issue ohne `depends_on` ist verschiebbar, auch wenn es einen `rank` hat. Es gibt kein Prioritätsfeld und keine Sortierliste im Sprint.

- **Richtung:** `depends_on` steht am abhängigen Issue. `B.depends_on: [A]` heißt: B ist erst dran, wenn A erledigt ist. Die Gegenrichtung (`dependents`) wird beim Lesen berechnet und nie gespeichert — so ändert eine neue Abhängigkeit genau eine Datei.
- **Erledigt** im Sinne von `depends_on` ist eine Abhängigkeit in `done`, `cancelled` oder `rejected`. Hängt ein Issue an einer `cancelled`- oder `rejected`-Abhängigkeit, gilt es als bereit, aber `backe next` und `issue show` weisen darauf hin, weil die Voraussetzung vielleicht nie geliefert wurde.
- **Bereit** (`issue list --ready`): State `todo` oder `backlog`, alle `depends_on` erledigt, keine offenen Sub-Issues (§2.23) — und dasselbe für die Vorfahren: Kein Parent bis zur Wurzel ist `blocked` oder `on_hold`, und die `depends_on` aller Parents sind erledigt. Hängt ein Paket an einer offenen Entscheidung oder ist es pausiert, sind damit auch seine Sub-Issues nicht bereit.
- **Claimbar** (§2.16.5): bereit, oder bereits `in_progress` mit Assignee = ich — und nicht belegt (§2.23, »Arbeitseinheit Teilbaum«), außer die Belegung ist meine eigene.
- **Grenzen:** Abhängigkeiten dürfen über Sprints und Projekte hinweg zeigen; `next --sprint X` berücksichtigt auch Abhängigkeiten außerhalb von X. Zyklen werden beim Setzen abgelehnt, die Fehlermeldung nennt den Zyklus. Eine Abhängigkeit auf sich selbst ist verboten.
- **`backe next`** liefert zuerst ein Issue, das ich schon bearbeite (`in_progress`, Assignee = ich, Vorfahren nicht pausiert) — ein Agent, der nach einem Absturz neu startet, setzt so dort fort, wo er war. Sonst wählt es aus den bereiten Issues des Kontexts (Sprint, Projekt, Repo) mit Assignee leer oder ich:
  1. `todo` vor `backlog`;
  2. `rank` aufsteigend, Issues ohne `rank` zuletzt;
  3. danach topologisch: Issues, von denen viele andere (transitiv) abhängen, zuerst — sie geben am meisten frei;
  4. bei Gleichstand `created` aufsteigend.
  Gibt es keinen Kandidaten, nennt `next` den Grund (alles vergeben, alles wartet auf Abhängigkeiten — mit den wartenden IDs, alles blockiert) und endet mit Exit-Code 3.
- **Ändern:** `issue create --dep`, `issue edit --add-dep/--rm-dep`, MCP `issue_update`. Hinzufügen und Entfernen sind kommutative Mengen-Operationen (§2.16.4) und überstehen parallele Änderungen ohne Konflikt. Ein Zyklus, der erst durch zwei parallele Änderungen entsteht, wird beim Sync erkannt: die später eingespielte Operation landet als Konflikt in `.git/backe/conflicts/`.
- **Anzeige:** `issue show` listet `depends_on` mit dem State jeder Abhängigkeit und die `dependents`; Text-Listen markieren Issues mit offenen Abhängigkeiten.

**`rank` — die weiche Reihenfolge:**

- Optionale Ganzzahl, kleiner = früher. Issues ohne `rank` stehen hinter allen mit `rank`. Gleiche Werte sind erlaubt und fallen auf die nächste Sortierstufe zurück.
- Der `rank` gilt backlogweit, nicht pro Sprint: Ein Issue in zwei Sprints steht in beiden an derselben relativen Stelle.
- **Umsortieren ohne Rechnen:** `backe issue rank <id> (--top | --bottom | --before <id> | --after <id> | <zahl>)`. `backe` vergibt neue Werte im Abstand 1000 und setzt beim Einsortieren die Mitte zwischen den Nachbarn; nur wenn dort kein Platz mehr ist, nummeriert es die betroffene Nachbarschaft neu (ein Commit, mehrere Dateien). Von Hand eine Zahl ins Frontmatter zu schreiben ist ebenso gültig.
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
- **Abgrenzung:** `parent` ist Gliederung (»gehört zu«), `depends_on` ist Reihenfolge (»kommt nach«). Beide dürfen gleichzeitig zwischen denselben Issues bestehen, sind aber unabhängig.

**Arbeitseinheit Teilbaum.** Per Default ist ein Blatt die Arbeitseinheit: `next` verteilt Sub-Issues, der Parent ist Container. Manche Arbeit wird aber als Ganzes erledigt — ein Remediation-Paket behebt seine Findings in einem Commit (§2.25). Dafür:

- **`backe next --level top`** wählt unter den obersten Issues des Kontexts (ohne `parent`) und behandelt jedes samt Teilbaum als eine Einheit. Bereit ist ein solches Issue nach den Regeln von §2.22, nur dass offene Sub-Issues es nicht ausschließen. Reihenfolge wie bei `next` (eigenes laufendes zuerst, dann `todo` vor `backlog`, `rank`, Topologie, `created`). `--level leaf` ist der Default.
- **Claim eines Parents mit offenen Sub-Issues** ist erlaubt, wenn er so bereit ist; der Claim setzt `assignee` und `in_progress` nur am Parent.
- **Belegung:** Ein Issue ist belegt, wenn ein Vorfahre `in_progress` oder `review` ist und einen anderen Assignee hat als ich. Belegte Issues sind nicht claimbar (Exit-Code 4, mit dem belegenden Vorfahren) und `next --level leaf` überspringt sie. Wer den Parent hält, arbeitet im Teilbaum frei: Sub-Issues schließen, neue anlegen, umhängen.
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
- **Operation:** `{"op":"issue.prop","id":…,"key":…,"from":…,"to":…}` — Setzen mit Vorbedingung pro Key (§2.16.4). Zwei Akteure, die verschiedene Keys setzen, kommen sich nie in die Quere; derselbe Key mit verschiedenen Werten ergibt einen Konflikt.
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
- Standalone-Binaries (Node SEA) zusätzlich zum npm-Paket.

## 5. Tests *(Plan)*

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

## 6. Umsetzung in Schritten *(Plan)*

1. **Gerüst:** mise, pnpm, TypeScript, Biome, Vitest, tsdown, `ci.yml` (lint, typecheck, test, build).
2. **Kern ohne Git:** `core` und `store` — Schemas, Zustandsmodell, IDs, kanonische Serialisierung, Layout.
3. **Git-Schicht:** Wrapper, `init`, signierter Commit, Users, `verify`.
4. **CLI-Grundbefehle:** issue, comment, attach, project, sprint, repo, user, rank, batch; deklarierte Properties; Ausgabeformate, Exit-Codes.
5. **Kontext:** User-, Projekt- und Backlog-Config, Backlog-Registry, `context`.
6. **Sync:** Locks, Hintergrund-Sync, Replay, Claim, `next`.
7. **MCP-Modus.**
8. **Release:** `release.yml`, Pack-Smoke-Test, README, erste Veröffentlichung.

# backe ui — lokale Web-Oberfläche für ein Backlog

> **Status: spezifiziert.** Nicht umgesetzt; die Empfehlungen in §4.1 gelten, solange keine Zeile dort anders entschieden ist. Wünsche an BK in §4.2.
> Bezug: Adapter über den Service-Layer von BK (`backe.md`), vor allem BK §2.14 (Kontext), §2.16 (Schreibpfad und Sync), §2.18 (Ausgabe), §2.19 (MCP als Vorbild des Adapters), §2.22–§2.24 (Abhängigkeiten, Sub-Issues, Properties).
> Skizzen: [`layout-tabs.png`](../assets/layout-tabs.png), [`backlog.png`](../assets/backlog.png), [`board.png`](../assets/board.png), [`issue-details.png`](../assets/issue-details.png), [`settings.png`](../assets/settings.png).

## 0. Problem & Abgrenzung

### 0.1 Problem

Ein Backlog, an dem mehrere Agents parallel arbeiten, ändert sich im Minutentakt. Über das CLI sieht ein Mensch davon nur, was er gerade abfragt: `issue list` ist eine Momentaufnahme, `sprint show` auch. Wer wissen will, was gerade läuft, was blockiert ist und was sich seit vorhin bewegt hat, fragt immer wieder dieselben Befehle ab.

`backe ui` startet eine lokale Web-Oberfläche für genau ein Backlog: eine Liste, ein Board, eine Detailansicht pro Issue und die Verwaltung von Projekten, Sprints, Repos und Usern. Jede Änderung am Backlog — aus dem CLI, aus einem MCP-Agent, aus einem anderen Clone oder aus der UI selbst — erscheint dort sofort ohne Reload.

### 0.2 Ziele

- **Live-Übersicht.** Jede Änderung, die die Arbeitskopie erreicht, ist in jeder offenen Ansicht sichtbar, ohne Reload und ohne Polling durch den Nutzer (§2.4). Das ist der Hauptzweck der UI.
- **Lesen und Schreiben.** Issues anlegen, bearbeiten, verschieben, umsortieren, kommentieren, Anhänge hinzufügen; Projekte, Sprints, Repos und User verwalten. Jeder Write ist ein signierter Commit der Identität, als die die UI läuft (BK §2.12).
- **Ein dritter Adapter, kein eigener Datenpfad.** Die UI nutzt denselben Service-Layer wie CLI und MCP (BK §3.7). Sie kann nichts, was das CLI nicht kann, und sie umgeht keine Prüfung (§3.3).
- **Ein Backlog im Fokus**, mit Umschalter zwischen den registrierten Backlogs (§2.6).
- **Ruhige, klare Oberfläche:** neutral hell oder dunkel, Zustände über Icon und Text statt über Farbe (§2.13).
- **Keine neue Runtime-Abhängigkeit für das CLI.** Der Server läuft auf `node:http`, das Frontend wird vorgebaut ausgeliefert (§2.16).

### 0.3 Nicht-Ziele (erste Version)

- Kein Zugriff von anderen Rechnern. Der Server lauscht nur auf `127.0.0.1` (§2.15).
- Kein Mehrbenutzer-Server. Eine laufende UI schreibt als genau eine Identität je Backlog.
- Keine Webhooks, keine Integrationen mit Fremdsystemen, keine Benachrichtigungen außerhalb des offenen Browsers (§4.1).
- Kein Bearbeiten der Backlog-Config `.backe/backlog.jsonc` (§4.1, §4.2).
- Kein Offline-Betrieb des Browsers. Ohne laufenden Server zeigt die UI nur den Verbindungsstatus.
- Kein Daemon. `backe ui` ist ein Vordergrundprozess wie `backe mcp` (BK §3.8).

### 0.4 Anti-Ziele

Die UI ist gescheitert, auch wenn alles technisch funktioniert, wenn …

- … jemand nach einer Änderung im CLI die Seite neu lädt, weil er der Anzeige nicht traut;
- … ein Write aus der UI etwas tut, was derselbe Befehl im CLI ablehnen würde, oder andere Commits erzeugt;
- … ein Board mit einigen tausend Issues beim Ziehen einer Karte ruckelt;
- … eine fremde Webseite im selben Browser über `localhost` im Namen des Nutzers signierte Commits auslöst (§2.15).

## 1. Ist-Zustand

Es gibt keine UI. Gelesen und geschrieben wird über das CLI und den MCP-Modus. BK §0.3 nennt ein Web-UI als Nicht-Ziel der ersten Version und verweist für `backe ui` auf dieses Proposal.

## 2. Soll-Zustand

### 2.1 Befehl `backe ui`

```
backe ui [-p | --port <n>] [--open]          globale Optionen -B/--backlog und --as wie bei mcp
```

- **Port:** Default `8002`. `--port 0` wählt einen freien Port. Belegter Port → `Error: Port 8002 is in use`, Hinweis `backe ui --port <n>`, Exit-Code 6.
- **Adresse:** immer `127.0.0.1`, keine Option dafür (§2.15).
- **Start-Ausgabe** auf stdout, eine Zeile: `backe ui: http://127.0.0.1:8002/?token=<token>`. Die URL trägt das Sitzungs-Token (§2.15). `--open` öffnet sie zusätzlich im Standardbrowser (`xdg-open` bzw. `open`); scheitert das, ist es ein Hinweis, kein Fehler.
- **Start-Backlog:** aus dem Kontext (BK §2.14), ausgehend von Arbeitsverzeichnis, Env und globalen Optionen. Löst sich kein Backlog auf, startet die UI trotzdem, sofern mindestens ein Backlog registriert ist, und zeigt den Umschalter. Ist keins registriert: Fehler wie im CLI (Exit-Code 2, Hinweis `backe init` / `backe backlog use`).
- **Identität:** je Backlog wie beim CLI aufgelöst, bei jedem Aufruf neu (wie MCP, BK §2.19). Ein Handle ohne Key in der User-Config darf lesen, nicht schreiben; die UI zeigt dann »nur lesen« und blendet Schreibaktionen aus.
- **Lebensdauer:** läuft bis SIGINT oder SIGTERM. Vor dem Ende warten die Write-Warteschlange, die von ihr angestoßenen Hintergrund-Syncs und laufende synchrone Aufrufe ab (wie BK §2.19, »Ende«). Offene Browser-Tabs zeigen danach »Verbindung getrennt«.
- **Sprache** der Konsolen-Ausgabe nach BK §2.18.

### 2.2 Architektur

```
src/
├── cli/         + Befehl `ui`
├── mcp/
├── ui/          Adapter: HTTP-Server, API, Event-Stream, Watcher, statische Auslieferung
├── services/    unverändert genutzt
└── …
web/             Frontend: Vite, React, TypeScript, Tailwind, shadcn/ui; baut nach dist/ui/
```

- `src/ui/` hängt wie `src/mcp/` nur von `services/` und darunter ab.
- `web/` importiert aus `src/` nur reine Module ohne I/O: die API-Typen aus `src/ui/api.ts` und die Domain-Logik aus `src/core/`, `src/ops/graph.ts` (Bereitschaft, `dependents`, `children`, Zyklen) und `src/ops/issue-query.ts` (Filter von `issue list`). Abgeleitete Werte rechnet der Client damit selbst (§3.5); die Regeln von BK §2.22 und §2.23 existieren so nur einmal. Ein Test stellt sicher, dass das Web-Bundle kein `node:`-Modul zieht.

### 2.3 HTTP-API

Alle Endpunkte liegen unter `/api` und verlangen das Sitzungs-Cookie (§2.15). JSON ist kompakt und hat dieselben Keys wie die `--format json`-Ausgabe des entsprechenden Befehls (BK §2.18). `<b>` ist der Name eines registrierten Backlogs.

#### 2.3.1 Lesen

| Methode und Pfad | Inhalt |
| --- | --- |
| `GET /api/backlogs` | registrierte Backlogs: `[{name, current, can_write, user}]`, dazu `lang` (Sprache des Servers, §2.14) |
| `GET /api/b/<b>/state` | Gesamtzustand für den Client: `{rev, head, context, config, issues, projects, sprints, repos, users, problems, sync}`. `issues` enthält alle Frontmatter-Felder jedes Issues, **ohne Body**. `users` enthält Key-Fingerprints, keine Keys. `config` ist der lesbare Teil von `backlog.jsonc` samt deklarierter Properties. `sync` ist das JSON von `sync status`. |
| `GET /api/b/<b>/issues/<id>` | wie `issue show --comments all --format json`: Body, Kommentare, `dependents`, `children`, Fortschritt |
| `GET /api/b/<b>/issues/<id>/attachments/<name>` | Dateibytes eines Anhangs (§2.9.4, Header nach §2.15) |
| `GET /api/b/<b>/search?q=<text>` | Volltextsuche wie `issue list -q <text> --state all` |
| `GET /api/b/<b>/events` | Event-Stream (§2.4.3) |

#### 2.3.2 Schreiben

`POST /api/b/<b>/tools/<tool>` mit den Parametern des Tools als JSON-Body. Tool-Namen, Parameter und Ergebnis-JSON entsprechen den MCP-Tools (BK §2.19, Tabelle »Tools«), damit es nur ein Vokabular gibt. Zusätzlich zu den MCP-Tools — die die UI für die Verwaltung braucht und die das CLI schon kann — gibt es:

| Tool | Entspricht |
| --- | --- |
| `issue_delete` | `issue delete` (in der UI immer verfügbar, mit Bestätigungsdialog) |
| `issue_link`, `issue_unlink` | `issue link`, `issue unlink` |
| `comment_edit`, `comment_delete` | `comment edit`, `comment delete` |
| `attachment_rm` | `attach rm` |
| `project_create`, `project_mv`, `project_rm` | `project create`, `mv`, `rm` |
| `sprint_create`, `sprint_close` | `sprint create`, `sprint close` |
| `repo_add`, `repo_rm`, `repo_check` | `repo add`, `rm`, `check` |
| `user_add`, `user_create_agent`, `user_revoke_key`, `user_rm` | die gleichnamigen `user`-Befehle |

- **Upload:** `PUT /api/b/<b>/issues/<id>/attachments/<name>` mit den Dateibytes als Body. Der Server schreibt sie in eine Temp-Datei in seinem eigenen Temp-Verzeichnis, ruft denselben Service wie `attach add <datei> --name <name>` und löscht sie danach. Das Größenlimit ist `attachments.max_bytes` (BK §2.8); der Server bricht den Upload ab, sobald es überschritten ist.
- **Nebenläufigkeit und Sync** wie im MCP-Modus (BK §2.19): lokale Writes nacheinander über eine Warteschlange, danach ein Hintergrund-Sync; `issue_claim`, `issue_next` mit `claim` und `sync_now` synchron mit dem Remote.
- **Ergebnis:** Das Write-JSON enthält `commit`. Den neuen Zustand selbst bekommt der Client über den Event-Stream, nicht aus der Antwort (§2.5).

#### 2.3.3 Fehler

Fehler kommen als `{"error":{code, message, hint?, details?}}` wie im CLI (BK §2.18). Der HTTP-Status folgt dem Exit-Code: `2` → 400, `3` → 404, `4` → 409, `5` → 422, `6` → 502, `1` → 500. Fehlendes oder falsches Sitzungs-Cookie → 401, falscher `Host` oder `Origin` → 403 (§2.15).

### 2.4 Live-Updates

#### 2.4.1 Änderungsquellen

Für jedes Backlog, das mindestens ein Browser-Tab abonniert hat, beobachtet der Server die eigene Arbeitskopie der Identität. Der Watcher endet 30 s nach dem letzten Abonnenten.

1. **Ref der eigenen Arbeitskopie.** Jeder Weg, der den Stand ändert — Write aus CLI, MCP oder UI, Fast-Forward oder Replay des Sync, ein manuelles `git` —, bewegt den Ref von `sync.branch`. Der Server beobachtet per `fs.watch` die Verzeichnisse unter `<gitdir>/refs/heads/` sowie `<gitdir>/packed-refs` und `<gitdir>/HEAD`; ein Ereignis löst `git rev-parse HEAD` aus. Git schreibt Refs über Lock-Datei und Umbenennen, deshalb werden Verzeichnisse beobachtet, nicht die Ref-Datei.
2. **Arbeitsbaum.** Hand-Edits vor `backe commit` liest auch das CLI (BK §2.3); die UI zeigt denselben Stand. Ein rekursiver `fs.watch` auf die Arbeitskopie (ohne `.git/`) sammelt geänderte Pfade unter `issues/`, `projects/`, `sprints/`, `repos/`, `users/` und `.backe/`, entprellt über 150 ms.
3. **Nachbarn auf derselben Maschine.** Andere Identitäten — etwa Agents — schreiben in ihre eigenen Arbeitskopien (BK §2.16.1), nicht in die der UI. Ihr Stand kommt erst über einen Sync an. Damit das sofort passiert, beobachtet der Server die Branch-Refs des lokalen Hubs (`hub.git`, BK §2.16.1) und die Remote-Tracking-Refs (`refs/remotes/<sync.remote>/<sync.branch>`) der anderen Arbeitskopien desselben Backlogs unter `<BACKE_HOME>/backlogs/<backlog>/`. Bewegt sich einer, hat ein Nachbar erfolgreich gepusht; der Server startet dann eine Hintergrund-Sync-Runde der eigenen Arbeitskopie (BK §2.16.2), entprellt über 250 ms. Nur bei `sync.mode: auto`.
4. **Entfernte Änderungen** auf einem echten Remote lassen sich nicht beobachten. Der Server synchronisiert im Takt von `pull_interval` wie der MCP-Server (BK §2.19, »Hintergrund-Sync«).
5. **Sicherheitsnetz:** `fs.watch` kann Ereignisse verlieren (Netzlaufwerke, Überlauf). Alle 10 s vergleicht der Server `HEAD` mit dem zuletzt gesehenen Stand.

Sync-Zustand und Konflikte (`sync.json`, `conflicts/` unter `.git/backe/`) werden ebenso beobachtet und als Ereignis `sync` gemeldet.

#### 2.4.2 Delta

Der Server hält je beobachtetem Backlog den zuletzt ausgelieferten Snapshot (BK, `loadSnapshot`). Bei einer Änderung:

1. Geänderte Pfade bestimmen: `git diff --name-only -z <alt> <neu>` bei bewegtem `HEAD`, dazu die Pfade aus dem Arbeitsbaum-Watcher.
2. Nur diese Pfade neu laden und den Snapshot fortschreiben (`snapshotAt`, samt den Pfaden aus `orphanedProjectPaths`).
3. Je Entitätsart vergleichen: neu oder geändert → `upsert`, verschwunden → `remove`. Pfade unter `comments/` und `attachments/` eines Issues ergeben einen Eintrag in `touched`.
4. Ein Patch mit fortlaufender Nummer `rev` geht an alle Abonnenten des Backlogs. Ändert sich nichts Sichtbares, entsteht kein Patch.

Abgeleitete Werte (`dependents`, `children`, offene Abhängigkeiten, Bereitschaft) stehen nicht im Patch; der Client rechnet sie selbst (§3.5).

#### 2.4.3 Event-Stream

`GET /api/b/<b>/events` liefert Server-Sent Events (§3.1):

| Ereignis | Daten |
| --- | --- |
| `hello` | `{rev, head}` direkt nach dem Verbinden |
| `patch` | `{rev, head, upsert: {issues?, projects?, sprints?, repos?, users?, config?}, remove: {issues?: [id], …}, touched?: [id], problems?}` |
| `sync` | JSON von `sync status` |
| `reset` | `{}` — der Client lädt `/state` neu |

- Jedes Ereignis trägt `id: <boot>:<rev>`; `boot` sind 8 Hex-Zeichen Zufall je Serverprozess, `rev` zählt je Backlog ab 0. Der Server hält die letzten 200 Patches. Verbindet sich ein Client mit `Last-Event-ID` neu, bekommt er die verpassten Patches; liegt `rev` außerhalb des Puffers oder stammt die ID aus einem früheren Serverprozess (anderes `boot`), bekommt er `reset`.
- Alle 15 s ein Kommentar-Heartbeat (`: ping`), damit die Verbindung nicht stillschweigend abreißt.

### 2.5 Client-Zustand und Reactivity

- **Transport:** Eine Verbindung je Backlog kapselt `EventSource` und `fetch`. Sie ist ein `@spearwolf/eventize`-Emitter mit den Ereignissen `hello`, `patch`, `sync`, `reset` und `status` (`connecting`, `open`, `offline`).
- **Store:** `@spearwolf/signalize` hält den Zustand feingranular — ein Signal je Entität (Issue, Projekt, Sprint, Repo, User), je Entitätsart ein Signal für die Menge der Keys, dazu Signale für Kontext, Config und Sync-Status. Abgeleitetes sind Memos: Graph (über `src/ops/graph.ts`), gefilterte und sortierte Listen je Ansicht, Board-Spalten, Suchindex.
- **Patch anwenden:** alle Änderungen eines Patches in einem Batch, damit jede Ansicht genau einmal neu rechnet. Ein Patch, der ein Issue betrifft, rendert nur die Zeilen, Karten und Tabs neu, die dieses Issue oder davon abgeleitete Werte zeigen (§3.6).
- **React-Anbindung:** ein Hook über `useSyncExternalStore`, der ein Signal oder Memo abonniert. Komponenten lesen nur über diesen Hook aus dem Store; React-State bleibt für lokalen UI-Zustand (offene Dialoge, Eingaben).
- **Optimistische Anzeige:** Board-Drag (§2.8) und Statuswechsel setzen eine Überlagerung (»ausstehend«) auf die betroffenen Issues. Sie fällt weg, sobald ein Patch mit dem `commit` der Antwort (oder einem späteren `head`) ankommt; bei einem Fehler sofort, mit Meldung samt `hint`. Kommt nach einer erfolgreichen Antwort 5 s lang kein passender Patch, lädt der Client `/state` neu.
- **Ansichtszustand** — Filter, Sortierung, Gruppierung, offene Tabs, eingeklappte Bereiche — steht in der URL, soweit er teilbar sein soll (Filter, aktiver Tab), sonst je Backlog im `localStorage`. Zugriffe auf `localStorage` sind fehlertolerant; ohne ihn funktioniert die UI mit Defaults.

### 2.6 App-Layout

Nach `layout-tabs.png`:

```
backe · Backlogs for humans                         [Backlog ▾]  spw  ● synced  ◐
┌─────────┬───────┬───────────────┬───────────────┐
│ Backlog │ Board │ bk-7f3k2 SSO… ×│ bk-a91c0 Tok… ×│          [ Suche…  ⌘K ]  ⚙
└─────────┴───────┴───────────────┴───────────────┘
```

- **Kopfzeile:** Wortmarke; Backlog-Umschalter (Name und ID-Präfix aller registrierten Backlogs); Identität (Handle, bei fehlendem Key mit Marke »nur lesen«); Sync-Anzeige (`up to date`, `<n> unpushed`, `<n> conflict(s)`, `last sync failed`, `offline` — dieselben Zustände wie die Kopfzeile des CLI, BK §2.16.2); Theme-Umschalter.
- **Tab-Leiste:** `Backlog` und `Board` sind immer da und nicht schließbar. Issue-Tabs (§2.9) öffnen sich aus jeder Ansicht per Klick und schließen per `×` oder Mittelklick; passen sie nicht in die Breite, scrollt die Leiste. Rechts das Suchfeld (§2.11) und `⚙` für Settings (§2.10), ebenfalls immer da.
- **Routing:** `/b/<backlog>/backlog`, `/b/<backlog>/board`, `/b/<backlog>/issue/<id>`, `/b/<backlog>/settings/<abschnitt>`. Jede Ansicht ist per Link und nach Reload erreichbar. Ein Backlog-Wechsel ist ein Routenwechsel; offene Issue-Tabs gelten je Backlog.
- **Gelöschtes Issue** in einem offenen Tab: Der Tab bleibt, zeigt »gelöscht« und schließt erst auf Wunsch.
- **Tastatur:** `⌘K`/`Ctrl-K` Suche, `c` neues Issue, `Esc` schließt Dialoge. Alle Aktionen sind ohne Maus erreichbar.

### 2.7 Tab Backlog

Nach `backlog.png`: Filterleiste oben, darunter die Issue-Liste.

- **Filter** mit der Semantik von `issue list` (BK §2.18): State (Mehrfachauswahl, Default »offen«, auch `all`), Projekt (Baumauswahl, rekursiv oder `exact`), Sprint, Assignee (User, `me`, `none`), Creator, Repo, Modus (`ready`, `blocked`, `unblockable`), Properties (`=`, `>=`, `<=`, vorhanden), Text. Werte innerhalb eines Filters sind ODER-, verschiedene Filter UND-verknüpft.
- **Darstellung:** Baum (Default, wie `issue list --tree`: Sub-Issues eingerückt unter ihrem Parent) oder flach. Sortierung `rank` (Default) oder `created` (BK §2.18).
- **Zeile:** State-Icon und State, ID, Titel, Assignee, Projekte und Sprints als dezente Chips, `⧗` bei offenen Abhängigkeiten, Fortschritt der Sub-Issues (`3/5`).
- **Aktionen:** Klick öffnet den Issue-Tab; Kontextmenü für State, Assignee, Rank (`top`, `bottom`), Löschen. Ziehen einer Zeile sortiert um (`issue_rank` mit `before`/`after`), nur bei Sortierung `rank`.
- **Live:** neue und geänderte Zeilen heben sich 1,5 s lang dezent ab, verschwundene blenden aus. Die Scrollposition bleibt stehen.
- **Virtualisiert:** gerendert werden nur sichtbare Zeilen.

### 2.8 Tab Board

Nach `board.png`:

- **Bahnen** (einklappbar) gruppieren nach Sprint (Default), Projekt, Repo oder gar nicht. Offene Sprints zuerst, nach `start` absteigend, geschlossene eingeklappt am Ende; Projekte nach Pfad, Repos nach Name; eine Bahn »ohne Sprint« bzw. »ohne Projekt« oder »ohne Repo« zuletzt. Ein Issue in zwei Sprints steht in beiden Bahnen.
- **Spalten** sind die Hauptlinie (BK §2.6): `todo`, `in_progress`, `review`, `done`; `backlog` lässt sich einblenden. Innerhalb einer Spalte gilt die Sortierung nach `rank`, dann `created`.
- **Seitenzustände:** `blocked` und `on_hold` stehen in der Spalte ihres `paused_from`, mit deutlicher Marke `BLOCKED` bzw. `ON HOLD` (Skizze). `cancelled` und `rejected` stehen nicht auf dem Board.
- **Karte:** Titel (höchstens zwei Zeilen), ID, Assignee als Initialen, Marken für Seitenzustand, offene Abhängigkeiten (`⧗`) und Sub-Issue-Fortschritt.
- **Drag & Drop:**
  - in eine andere Spalte → `issue_move` in deren State. Aus `blocked`/`on_hold` heraus ist das der explizite Übergang nach BK §2.6;
  - innerhalb einer Spalte → `issue_rank` mit `before`/`after` der neuen Nachbarn. Der Rank gilt backlogweit (BK §2.22); die Karte landet in jeder Ansicht an der entsprechenden relativen Stelle;
  - in eine andere Bahn → das Sprint-, Projekt- oder Repo-Mitglied wird getauscht (`remove` alt, `add` neu). Wechseln Bahn und Spalte zugleich, gehen beide Operationen als **ein** `batch` und damit als ein Commit raus (BK §2.16.6).
- **Abgelehnt** (strikter Workflow, `done` mit offenen Sub-Issues, Belegung): Die Karte springt zurück, die Meldung samt `hint` erscheint. Bei der `done`-Sperre bietet ein Dialog die offenen Sub-Issues und »trotzdem« (`force`) an.
- **Nach `blocked`** geht es nicht per Ziehen, sondern über das Kartenmenü, das `blocked_by` abfragt. Das Menü bietet jeden Übergang auch ohne Maus an, mit optionaler Begründung (`reason`).
- **Schnell anlegen:** `+` in einer Spalte legt ein Issue nur mit Titel an, State = Spalte, Mitgliedschaft = Bahn.

### 2.9 Tab Issue

Nach `issue-details.png`. Ein Issue-Tab zeigt den Stand von `GET …/issues/<id>` und lädt ihn neu, wenn ein Patch das Issue in `upsert` oder `touched` nennt.

#### 2.9.1 Kopf und Felder

- **Links:** ID (kopierbar), Titel, State samt jüngster Transition-Begründung (BK §2.6), Assignee, Creator, `created`, Rank, Projekte, Sprints, Repos (mit Ref; der lokale Pfad aus `repo_locate` zum Kopieren), Pfad der Parents bis zur Wurzel, Custom Properties.
- **Rechts:** `blocked_by`, `depends_on` (je mit State), `dependents`, Sub-Issues mit Fortschritt (`3/5 erledigt`).
- **Bearbeiten** direkt am Feld: Titel, State (mit `reason`, bei `blocked` mit `blocked_by`), Assignee (`me`, `none`, User), Projekte, Sprints, Abhängigkeiten, Parent, Properties. Deklarierte Properties (BK §2.24) bekommen ein Eingabefeld passend zu ihrem Typ (Auswahl bei `enum`, Zahl, Schalter, JSON); ihre `description` steht als Hilfetext daneben. Jede Feldänderung ist ein `issue_update`, `issue_move`, `issue_resume` oder `issue_reopen`.
- **Aktionen:** Übernehmen (`issue_claim`, synchron, mit Fortschrittsanzeige), Wiedereröffnen, Löschen (Dialog; bei Sub-Issues Wahl zwischen `orphan` und `recursive`, bei Verweisen anderer Issues `force`).

#### 2.9.2 Beschreibung: Markdown und Mermaid

- **Rendering** für Beschreibungen, Kommentare und die Beschreibungen von Projekten, Sprints und Repos gleich: CommonMark mit GFM (Tabellen, Task-Listen nur lesend, Durchstreichung, Autolinks), Code-Blöcke mit Syntax-Highlighting, Links, Bilder, Emojis (Unicode direkt, `:shortcode:` wie auf GitHub).
- **Rohes HTML** wird nach einer Allowlist im Stil von GitHub bereinigt (etwa `details`/`summary` bleiben, Skripte, Event-Handler, `iframe` und `style` fallen weg).
- **Issue-IDs** im Text (`bk-7f3k2`, voller Präfix des Backlogs) werden zu Links, die den Issue-Tab öffnen, sofern das Issue existiert.
- **Relative Bildpfade** gelten relativ zum Issue-Verzeichnis, wie auf einer Forge: `![trace](attachments/trace.png)` zeigt den Anhang über den Anhang-Endpunkt (§2.3.1).
- **Mermaid:** Code-Blöcke mit der Sprache `mermaid` werden als Diagramm gerendert. Mermaid lädt erst, wenn ein solcher Block sichtbar wird; es läuft mit `securityLevel: 'strict'` und folgt dem Theme. Ein Syntaxfehler zeigt den Quelltext und die Fehlermeldung.
- **Bearbeiten:** Editor mit Umschalter Text/Vorschau. Ein in den Editor eingefügtes oder gezogenes Bild wird als Anhang hochgeladen (§2.3.2) und als relativer Bildlink eingefügt. Speichern ist ein `issue_update` mit `body`.
- **Paralleles Ändern:** Meldet ein Patch während des Bearbeitens einen neuen Body, zeigt der Editor das an und bietet »meine Fassung speichern« oder »verwerfen und neu laden«. Stillschweigend überschrieben wird nichts.

#### 2.9.3 Kommentare und Verlauf

- Chronologisch nach Dateiname (BK §2.7): Kommentare und Transitionen (`from → to` samt Begründung) in einer Zeitleiste, mit Autor und Zeitpunkt.
- Neuer Kommentar mit demselben Editor wie die Beschreibung (`comment_add`). Bearbeiten und Löschen nur bei eigenen Kommentaren (`comment_edit`, `comment_delete`; BK §2.7).
- Neue Kommentare anderer erscheinen live.

#### 2.9.4 Anhänge

- **Liste** mit Name, Größe und Art; Hochladen per Dateiauswahl oder Drag auf den Tab; Entfernen (`attachment_rm`).
- **Bilder** (`png`, `jpg`, `gif`, `webp`, `avif`, `svg`) direkt als Vorschau, per Klick vergrößert. SVG wird nur als `<img>` eingebunden, nie als Dokument.
- **Text, Code und JSON** bis 262 144 Bytes und gültigem UTF-8 (dieselbe Grenze wie `attachment_get`, BK §2.19) direkt mit Highlighting, einklappbar; Markdown-Anhänge gerendert wie §2.9.2. Größere Dateien und alle anderen Arten: Download.
- **URL-Anhänge** als Link mit Hostname.
- **Nicht geladene LFS-Anhänge** (BK §2.8) zeigen den Hinweis `git -C <wc> lfs pull`.

#### 2.9.5 Abhängigkeiten und Graph

Hat das Issue mindestens eine Kante in `depends_on`, `blocked_by` oder eine in Gegenrichtung (`dependents`), zeigt der Tab den Abschnitt »Abhängigkeiten« (einklappbar, wie in der Skizze) mit zwei Darstellungen:

- **Graph** (Default): ein geschichteter Graph von oben nach unten — Voraussetzungen oben, das Issue in der Mitte hervorgehoben, Abhängige darunter. Durchgezogene Kanten für `depends_on`, gestrichelte für `blocked_by`, auf Wunsch gepunktete für `parent`. Knoten zeigen ID, gekürzten Titel und State-Icon; erledigte Knoten sind abgeschwächt, offene Voraussetzungen stark umrandet. Default-Tiefe 2 in jede Richtung, je Knoten aufklappbar; über 150 Knoten fasst ein Sammelknoten den Rest zusammen. Schwenken und Zoomen; Klick auf einen Knoten öffnet seinen Issue-Tab.
- **Baum:** dieselben Beziehungen als eingerückte Liste, zugänglich für Screenreader und Tastatur.

Der Graph rechnet auf dem Client-Store (§2.5) und aktualisiert sich live. Layout-Engine und Graph-Komponente laden erst, wenn der Abschnitt sichtbar wird.

### 2.10 Tab Settings

Nach `settings.png`: einklappbare Abschnitte, auf breiten Bildschirmen mit Navigation links.

| Abschnitt | Inhalt | Writes |
| --- | --- | --- |
| Repositories | Name, URL, `default_ref`, lokaler Pfad (BK §2.11); Prüfung per `repo_check`, Ergebnis flüchtig | `repo_add`, `repo_rm` |
| Projects | Baum mit Titel, `lead`, Anzahl offener Issues | `project_create`, `project_mv`, `project_rm` (Dialog für `reassign`/`detach`) |
| Sprints | offene zuerst, mit `start`, `end`, Ziel; geschlossene eingeklappt | `sprint_create`, `sprint_close` (mit `carry_over`) |
| Users & Agents | Handle, Name, Art, Operator, Key-Fingerprints, widerrufene Keys | `user_add` (Public Key einfügen), `user_create_agent` (Key entsteht auf diesem Rechner, BK §2.12), `user_revoke_key`, `user_rm` |
| Backlog | `backlog.jsonc` lesend: Name, ID-Präfix, Admins, Workflow, Sync, Anhänge, deklarierte Properties samt Beschreibung; Sync-Status und Konflikte (BK §2.16.4) | `sync_now`; Konflikte lösen bleibt im CLI (Hinweis `backe sync resolve`) |
| Oberfläche | Theme, Sprache, Browser-Benachrichtigungen, Default-Gruppierung des Boards | nur `localStorage` |

- Aktionen, die die Policy (BK §2.13) für die aktuelle Identität sicher ablehnt — etwa einen menschlichen User anlegen ohne Admin-Rechte —, blendet die UI aus. Was dennoch scheitert, meldet sie wie jeden Fehler.
- **Browser-Benachrichtigungen** (nach Zustimmung im Browser, nur solange die UI offen ist): ein Issue wird mir zugewiesen; ein Issue mit Assignee = ich ändert jemand anderes; ein neuer Sync-Konflikt.

### 2.11 Suche

- Feld in der Tab-Leiste, `⌘K`/`Ctrl-K` fokussiert es. Die Suche läuft auf dem Client-Store, ohne Roundtrip.
- **Treffer** gruppiert und je Gruppe auf 8 begrenzt: Issues (Kurzform-ID nach BK §2.5 mit und ohne Präfix, Wörter im Titel, unscharf), Projekte (Pfad, Titel), Sprints (Slug, Titel), Repos (Name, URL), User (Handle, Name). Ein exakter ID-Treffer steht ganz oben.
- **Auswahl** per Pfeiltasten und Enter: ein Issue öffnet seinen Tab; Projekt, Sprint, Repo und User öffnen den Tab Backlog mit dem passenden Filter.
- Der letzte Eintrag »In Beschreibungen suchen« ruft `GET …/search` auf und zeigt die Treffer in derselben Liste.

### 2.12 Issue anlegen

Dialog (`c` oder Schaltfläche in Backlog und Board): Titel (Pflicht), Beschreibung (Editor aus §2.9.2), State (Default `backlog`), Projekte, Sprints, Repos, Assignee, Parent, Abhängigkeiten, deklarierte Properties. Vorbelegt aus dem aktuellen Filter bzw. der Board-Bahn; mit Parent gilt die Vorbelegung von BK §2.23. »Nach dem Anlegen öffnen« öffnet den neuen Issue-Tab.

### 2.13 Design und Theme

- **Basis:** shadcn/ui auf Tailwind mit neutraler Grauskala. Es gibt keine Markenfarbe. Farbe tragen nur Fehler (destruktiv) und der Fokusring.
- **Zustände** unterscheiden sich über Icon und Beschriftung (Icon-Set `lucide`), nicht über Farbe; `blocked` zusätzlich über eine kräftige Umrandung (Skizze).
- **Theme:** hell, dunkel oder System; Umschalter in der Kopfzeile, gespeichert im `localStorage`. `index.html` lädt vor allen Styles synchron `/theme.js`, das das Theme setzt, damit nichts aufblitzt; ein Inline-Skript verbietet die CSP (§2.15).
- **Schrift:** System-Schrift, IDs und Code in Monospace.
- **Zugänglichkeit:** Kontrast WCAG AA in beiden Themes, sichtbarer Fokus, ARIA-Rollen für Tabs und Menüs, Tastaturalternative zu jedem Drag & Drop.

### 2.14 Sprache

Die UI ist wie das CLI englisch oder deutsch, nie gemischt. Default ist die Sprache des Servers (`lang` aus `/api/backlogs`, bestimmt nach BK §2.18), umstellbar in Settings. Fehlertexte aus dem Service-Layer (`message`, `hint`) kommen in der Sprache des Servers. Weicht die UI-Sprache davon ab, bleiben sie in der Server-Sprache (§4.1). Backlog-Inhalte (Titel, Beschreibungen, Commit-Subjects) werden nie übersetzt.

### 2.15 Sicherheit

Die UI kann signierte Commits im Namen des Nutzers erzeugen. Jede Webseite im selben Browser kann Anfragen an `127.0.0.1` schicken; davor schützt Folgendes:

- **Nur lokal:** Bind auf `127.0.0.1`.
- **Sitzungs-Token:** 32 Zufallsbytes je Serverprozess, nur in der Start-URL auf stdout. Die erste Anfrage mit `?token=` setzt ein Cookie `backe_ui` (`HttpOnly`, `SameSite=Strict`, `Path=/`) und leitet auf dieselbe URL ohne Token um. Jede API-Anfrage braucht das Cookie, sonst 401 mit dem Hinweis, die URL aus der Konsole zu öffnen. Wer das Token hat, schreibt als die Identität der UI.
- **DNS-Rebinding:** Der `Host`-Header muss `127.0.0.1:<port>` oder `localhost:<port>` sein, sonst 403.
- **CSRF:** Schreibende Anfragen verlangen einen `Origin`, der dem eigenen entspricht, und `Content-Type: application/json` (Upload: `application/octet-stream`).
- **Content-Security-Policy** der App: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. `unsafe-inline` bei Styles braucht Mermaid.
- **Anhänge** werden mit `X-Content-Type-Options: nosniff` und `Content-Security-Policy: sandbox` ausgeliefert. Inline (`Content-Disposition: inline`) gehen nur die Bild- und Textarten aus §2.9.4 hinaus, Text immer als `text/plain`; alles andere als `attachment`. HTML-Anhänge werden nie inline ausgeliefert.
- **Markdown** wird bereinigt (§2.9.2), Mermaid läuft strikt.
- **Uploads** bestimmen nie einen Pfad: Der Name ist ein Anhangsname nach BK §2.8, die Bytes landen in einer Temp-Datei des Servers.

### 2.16 Technik und Paket

- **Server:** `node:http` ohne Framework; SSE ohne Bibliothek; statische Auslieferung von `dist/ui/` mit `Cache-Control: immutable` für gehashte Assets und `index.html` als Fallback für App-Routen. Keine neue Runtime-Abhängigkeit (BK §2.20).
- **Frontend** (alles `devDependencies`, gebündelt nach `dist/ui/`): Vite, React, TypeScript strict, Tailwind CSS, shadcn/ui (Radix), `lucide-react`, `@spearwolf/signalize`, `@spearwolf/eventize`, `react-markdown` mit `remark-gfm`, `rehype-raw` und `rehype-sanitize`, Syntax-Highlighting mit Sprachen auf Abruf, `mermaid`, Graph-Darstellung (§3.8: `@xyflow/react` mit `@dagrejs/dagre`), Drag & Drop mit `@dnd-kit`, Listen-Virtualisierung mit `@tanstack/react-virtual`. Versionen pflegt Renovate (BK §2.21).
- **Code-Splitting:** Mermaid, Graph und Highlighting-Sprachen sind eigene Chunks und laden erst bei Bedarf. Budget für den initialen Chunk: 300 KB gzip.
- **Build:** `pnpm build` baut CLI (tsdown) und Frontend (`vite build` → `dist/ui/`). Entwicklung: `pnpm dev:ui` startet den Vite-Dev-Server mit Proxy `/api` auf ein laufendes `backe ui`. Dessen `Origin`-Prüfung erlaubt zusätzlich den Ursprung aus `BACKE_UI_DEV_ORIGIN`, sofern gesetzt.
- **Lint und Typen:** Biome und `tsc` decken `web/` mit ab (eigene `tsconfig` mit DOM-Typen).
- **Paket:** Der Tarball enthält zusätzlich `dist/ui/**` (BK §2.21 ist anzupassen, §4.2). Der Pack-Smoke-Test startet `backe ui --port 0`, ruft die Start-URL samt Token und `/api/backlogs` ab und beendet den Server per SIGTERM.
- **Browser:** aktuelle Versionen von Chromium, Firefox und Safari.

### 2.17 Performance-Ziele

Prüfbar mit einem Benchmark-Backlog von 10⁴ Issues auf localhost:

| Messgröße | Ziel |
| --- | --- |
| `GET /state` (Server, ohne Netz) | ≤ 1 s |
| Erste vollständige Darstellung des Tabs Backlog nach dem Laden | ≤ 1,5 s |
| Write im CLI bis zur sichtbaren Änderung in allen offenen Ansichten (eigene Arbeitskopie) | ≤ 300 ms |
| Board-Drag bis zur optimistischen Anzeige | im selben Frame |
| Scrollen durch die Liste | ohne Frame-Drops bei 60 Hz |

Verfehlt die Umsetzung ein Ziel, ist das ein offener Punkt mit Messung, kein stilles Nachgeben.

## 3. Designentscheidungen

Solange nichts gebaut ist, stehen hier die Abwägungen; beim Konsolidieren wandern sie in ADRs.

### 3.1 Server-Sent Events plus HTTP statt WebSocket

Der Server muss nur in eine Richtung pushen; Writes sind ohnehin Anfrage und Antwort, jede mit eigenem Ergebnis oder Fehler. SSE bringt der Browser mit (`EventSource`, automatisches Wiederverbinden, `Last-Event-ID` für verpasste Patches), und der Server braucht dafür nur `node:http`. Ein WebSocket-Server bräuchte nach unserem Kenntnisstand eine Bibliothek wie `ws` als neue Runtime-Abhängigkeit (für Node 26 ungeprüft), dazu ein eigenes Protokoll für Anfrage-Antwort-Zuordnung, Wiederverbinden und Nachholen.

Preis: Unter HTTP/1.1 erlaubt ein Browser rund sechs gleichzeitige Verbindungen je Origin, und jede SSE-Verbindung belegt eine. Weil die UI ihre Issues in eigenen Tabs innerhalb einer Seite öffnet, reicht im Normalfall ein Browser-Tab. Wer viele Browser-Tabs öffnet, stößt an die Grenze; die Abhilfe — ein `SharedWorker`, der die Verbindung für alle Tabs hält — ist späterer Ausbau (§4.3).

Verworfen: WebSocket (siehe oben); Polling (Latenz oder Last, und widerspricht dem Hauptziel).

### 3.2 Ref-Watch statt Git-Hooks

`backe` committet per `commit-tree` und `update-ref`. Commit-Hooks laufen dabei nicht (BK §2.16.1, Schritt 4), ein `post-commit`- oder `post-merge`-Hook sähe also keinen einzigen `backe`-Write. Der `reference-transaction`-Hook sähe ihn, müsste aber in jede verwaltete Arbeitskopie installiert werden — BK greift dort bewusst nicht ein —, und in vom Nutzer gebundenen Arbeitskopien käme er dessen eigenen Hooks in die Quere. Ein Hook auf einem anderen Rechner hilft der lokalen UI ohnehin nicht.

Das Beobachten der Ref-Dateien erfasst jeden Weg, der den Stand bewegt — CLI, MCP, UI, Sync, manuelles `git` —, ohne ein Repo anzufassen. Für Agents auf derselben Maschine erledigen das die Refs von Hub und Nachbar-Arbeitskopien (§2.4.1, Punkt 3), für entfernte Änderungen der periodische Sync.

### 3.3 Die UI ist ein dritter Adapter

Die UI ruft dieselben Services wie CLI und MCP, über dieselbe Write-Warteschlange, und liefert dasselbe JSON. Die Tool-Namen der API sind die des MCP-Modus. So gibt es kein zweites Verhalten, das auseinanderdriften kann, und kein Feature nur in der UI. Die zusätzlichen Tools für die Verwaltung (§2.3.2) sind Befehle, die das CLI schon hat.

### 3.4 Gesamtzustand im Client, Bodies auf Abruf

Filter, Board, Suche und Graph brauchen die Metadaten aller Issues. Liegen sie im Client, reagieren diese Ansichten ohne Roundtrip. Beschreibungen, Kommentare und Anhänge machen den Großteil der Daten aus und werden nur für offene Issue-Tabs gebraucht; sie kommen auf Abruf. Bei mehr als etwa 10⁴ Issues trägt das vermutlich nicht mehr, dann braucht es serverseitiges Paging (§4.3; Bedingung: das Ziel für `GET /state` aus §2.17 ist gerissen).

### 3.5 Abgeleitete Werte rechnet der Client mit dem Code von BK

Ein einziger State-Wechsel ändert Bereitschaft, offene Abhängigkeiten und Fortschritt vieler anderer Issues. Würde der Server diese Werte mitschicken, wüchse jeder Patch mit dem Graphen. Der Client rechnet sie stattdessen mit denselben reinen Modulen wie das CLI (`src/core/`, `src/ops/graph.ts`). Die Regeln existieren damit einmal, und Patches bleiben so klein wie die Änderung.

### 3.6 signalize als Store, React als View

Ein Patch betrifft meist ein einzelnes Issue. Mit einem Signal je Entität und Memos für das Abgeleitete rendert genau das neu, was sich geändert hat: die eine Zeile, die eine Karte, der eine Tab. Ein Gesamtzustand in React-State oder Context würde bei jedem Patch die ganze Ansicht durchrechnen. `eventize` trägt die Ereignisse der Verbindung, `signalize` den Zustand; React bleibt reine Darstellung.

### 3.7 Board-Spalten aus der Hauptlinie

Die Hauptlinie ist der Arbeitsfluss, die Seitenzustände sind Unterbrechungen darin (BK §2.6). Eine Karte in `blocked` gehört weiter in die Spalte, in der sie hängen geblieben ist (`paused_from`). So bleibt das Board bei vier bis fünf Spalten, und »blockiert« ist dort sichtbar, wo es stört.

### 3.8 Graph mit `@xyflow/react` und `dagre`

Der Abhängigkeitsgraph ist ein gerichteter, meist kleiner DAG. `dagre` liefert ein geschichtetes Layout von oben nach unten, `@xyflow/react` Schwenken, Zoomen und React-Komponenten als Knoten. Verworfen: Mermaid für den Graphen (statisch, keine klickbaren Knoten ohne Umwege), `elkjs` (bessere Layouts bei großen Graphen, aber deutlich größer; Wechsel möglich, wenn Graphen über 150 Knoten häufig werden), eigenes SVG-Layout (Aufwand ohne Gewinn).

### 3.9 Vorgebautes Frontend im npm-Paket

Vite, React und alle Frontend-Bibliotheken sind Werkzeuge zur Build-Zeit. Ausgeliefert werden statische Dateien, die `node:http` direkt serviert. Wer `backe` installiert, bekommt die UI ohne zusätzliches Installieren und ohne neue Runtime-Abhängigkeiten. Den Preis zahlt nur die Größe des Tarballs.

## 4. Was offen bleibt

### 4.1 Offene Entscheidungen

| Frage | Empfehlung |
| --- | --- |
| Transport: SSE plus HTTP oder WebSocket? | SSE plus HTTP (§3.1). |
| Frontend im Hauptpaket `@spearwolf/backe` oder als eigenes Paket `@spearwolf/backe-ui`? | Hauptpaket (§3.9), solange `dist/ui/` den Tarball nicht um mehr als 3 MB vergrößert; sonst eigenes Paket, das `backe ui` bei Bedarf nachlädt. |
| Projekte, Sprints und Repos: in Settings (wie oben) oder als eigene feste Tabs (Skizze `backlog.png`)? | Settings, dazu der Einstieg über Suche und Filter. Eigene Tabs verdoppeln, was Filter schon leisten. |
| Darf die UI `.backe/backlog.jsonc` bearbeiten? | Erst, wenn BK dafür eine Operation hat (§4.2); bis dahin lesend. |
| Externe Bilder in Markdown laden (Tracking über Bild-URLs)? | Ja, per CSP auf `https:` beschränkt; ein Schalter in Settings blockt sie. |
| Fehlertexte in der UI-Sprache statt der Server-Sprache (§2.14)? | Erst, wenn sich die Auswahl der Messages je Aufruf statt je Prozess treffen lässt; bis dahin Server-Sprache. |
| Webhooks und Integrationen (Settings-Wunsch)? | Nicht in der UI. Sie bräuchten einen dauerhaft laufenden Prozess und gehören, wenn überhaupt, zu BK (»Watcher/Daemon«, BK §4.2). |

### 4.2 Wünsche an BK

Verbindlich erst, wenn BK sie aufnimmt:

- BK §2.17: `backe ui` in die Befehlsübersicht, sobald gebaut.
- BK §2.20/§2.21: `dist/ui/**` im Tarball, Pack-Smoke-Test um den UI-Start erweitert.
- Eine Operation zum Ändern von `.backe/backlog.jsonc` (heute nur Hand-Edit und `backe commit` als `manual`-Commit, BK §2.13), falls die UI die Backlog-Config bearbeiten soll (§4.1).

### 4.3 Späterer Ausbau

- `SharedWorker`, der eine Event-Verbindung für alle Browser-Tabs hält (§3.1).
- Serverseitiges Paging und Filtern bei sehr großen Backlogs (Bedingung in §3.4).
- Zugriff von anderen Rechnern mit echter Authentifizierung.
- Ansicht für die Backstube (Phasen, Merge-Queue, Rückfragen; BS).

## 5. Tests

**Isolation** wie BK §5: eigenes `BACKE_HOME`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, Test-Keys per `ssh-keygen`. Verzögerungen (Debounce, Heartbeat, Watcher-Timeouts) über Fake Timers und Test-Hooks im Code, nie über Last oder echtes Warten.

**Server** (`src/ui/`, gegen einen echten `node:http`-Server auf Port 0):

- Sitzung: Token-Tausch gegen Cookie, 401 ohne Cookie, 403 bei fremdem `Host` oder `Origin`, CSP- und Anhang-Header.
- API-Parität: Jedes Tool liefert dasselbe JSON wie das MCP-Tool bzw. der CLI-Befehl mit `--format json`; Fehler-Mapping Exit-Code → HTTP-Status.
- Upload: Größenlimit greift während des Uploads, Temp-Datei ist danach weg.

**Live-Updates** (echtes Git, Temp-Backlogs, Bare-Remote bzw. Hub):

- Write per CLI in der Arbeitskopie der UI → genau ein `patch` mit den richtigen `upsert`/`remove`/`touched`.
- Hand-Edit im Arbeitsbaum → `patch`; `backe commit` danach → kein zweiter sichtbarer Patch.
- Write eines zweiten Handles in seinem Clone über den lokalen Hub → `patch` ohne Warten auf `pull_interval`.
- Wiederverbinden mit `Last-Event-ID` → verpasste Patches; zu alte oder fremde `rev` → `reset`.
- Verlorenes `fs.watch`-Ereignis (per Test-Hook unterdrückt) → Patch über das Sicherheitsnetz.

**Client** (Vitest, Testing Library, jsdom):

- Store: Patches anwenden, abgeleitete Werte gegen dieselben Fixtures wie die Unit-Tests von `src/ops/graph.ts`; ein Patch auf ein Issue rendert nur dessen Abonnenten neu.
- Filter-Parität: Client-Filter gegen `issue list --format json` auf Fixture-Backlogs.
- Markdown: Bereinigung (Skripte, Event-Handler, `javascript:`-Links fallen weg), relative Bildpfade, Issue-ID-Links.

**E2E** (Playwright gegen das gebaute `backe ui`): anlegen, bearbeiten, verschieben per Drag & Drop und per Tastatur, Live-Update nach parallelem CLI-Write, Theme-Wechsel ohne Aufblitzen, Mermaid-Rendering, Anhang hochladen und anzeigen, Backlog-Wechsel.

**Performance:** ein Benchmark-Skript prüft die Ziele aus §2.17 gegen ein generiertes Backlog mit 10⁴ Issues; es läuft auf Anfrage, nicht in jedem CI-Lauf.

## 6. Umsetzung in Schritten

1. **Server-Gerüst:** Befehl `backe ui`, `node:http`, Sitzung und Sicherheits-Header, `/api/backlogs`, `/state`, statische Auslieferung eines Platzhalters.
2. **Live-Kern:** Watcher (eigene Arbeitskopie, Arbeitsbaum, Sicherheitsnetz), Delta, Event-Stream mit Puffer und `reset`.
3. **Frontend-Gerüst:** Vite, Tailwind, shadcn/ui, Theme, Routing, Tab-Leiste, Backlog-Umschalter, Verbindung und Store mit signalize/eventize.
4. **Tab Backlog:** Liste, Baum, Filter, Sortierung, Virtualisierung, Live-Hervorhebung.
5. **Tab Issue lesend:** Felder, Markdown, Kommentare, Anhänge; Mermaid als Lazy-Chunk.
6. **Writes:** Tool-Endpunkte, Bearbeiten am Feld, Editor, Kommentare, Upload, Issue anlegen, optimistische Anzeige.
7. **Tab Board:** Bahnen, Spalten, Drag & Drop mit Batch, Tastaturalternative.
8. **Abhängigkeitsgraph** und Baumansicht.
9. **Settings** und **Suche**.
10. **Nachbarn und Benachrichtigungen:** Hub- und Nachbar-Refs, Browser-Benachrichtigungen.
11. **Paket und CI:** Tarball-Inhalt, Pack-Smoke-Test, E2E in der CI, Performance-Benchmark.

# Backstube — Software-Factory auf `backe`

> **Status: Entwurf.** Noch nicht umgesetzt; offene Entscheidungen in §4.1.
> Bezug: baut auf BK auf (`backe.md`), vor allem BK §2.6 (Zustandsmodell), §2.16.5 (Claim), §2.22–§2.24 (Bereitschaft, Sub-Issues, Properties) und §2.25 (Entscheidungen als Issues).

## 0. Problem & Abgrenzung

### 0.1 Problem

Ein `backe`-Backlog enthält Arbeit, die Coding-Agents erledigen können. Heute startet ein Mensch jede Session von Hand: Er wählt das Issue, öffnet den Worktree, ruft den passenden Superpowers-Skill auf und reicht den Kontext durch. Die Arbeit des Menschen besteht damit zum größten Teil aus Disposition, nicht aus Entscheidungen.

Die **Backstube** übernimmt die Disposition. Sie überwacht freigegebene Sprints und Projekte, zieht bereite Issues, lässt jedes davon phasenweise von Claude-Code-Sessions bearbeiten (bei Superpowers: Spec → Plan → Build → Review) und merged das Ergebnis selbst in den Ziel-Branch, bevor abhängige Issues starten. So setzt sie ganze Sprints und Backlogs um, nicht einzelne Branches. Den Menschen holt sie nur dort dazu, wo er gebraucht wird: bei Rückfragen und optionalen Freigaben.

Der Name: In der Backstube wird gebacken (BK, »Der Name«).

### 0.2 Ziele

- Ein deterministischer Orchestrator. Welches Issue als Nächstes dran ist und welche Session läuft, entscheidet Code anhand des Backlog-Zustands, kein Sprachmodell (§3.1).
- Jede Session bearbeitet genau eine Phase eines Issues und hinterlässt ihr Ergebnis in `backe` und im Branch. Sessions sind damit austauschbar, und ein Absturz kostet höchstens eine Phase (§3.4).
- Jede Rückfrage erreicht den Menschen mit einer Benachrichtigung auf dem Handy. In Stufe 1 bleiben die Rückfragen interaktiv in der Session (§2.9.1), ab Stufe 2 werden sie zu Issues (§2.9.2), und in Stufe 3 sortiert eine Triage vor, was wirklich nur der Mensch entscheiden kann (§2.9.3).
- **Fertig heißt gemergt.** Ein Issue ist erst `done`, wenn sein Code im Ziel-Branch liegt und dort die Verifikation des Repos besteht. Die Backstube merged selbst, seriell über eine Merge-Queue je Ziel-Branch (§2.6). Abhängige Issues starten damit auf einem Stand, der ihre Abhängigkeiten enthält.
- Jeder Write ist einer Rollen-Identität zurechenbar (BK §2.12): Orchestrator, Worker-Slot, Reviewer, Triage.
- Nicht jedes Issue braucht Superpowers. Ein Issue wählt per `backstube.workflow` seinen Workflow, also die Folge seiner Phasen und die Skills darin (§2.5.1). `superpowers` ist ein Workflow unter mehreren, wenn auch der für ernsthafte Feature-Arbeit.
- Superpowers wird unverändert genutzt. Die Anpassungen an den Factory-Betrieb liegen in einem eigenen Skill, der davor sitzt (§2.7).
- Jede Session startet im richtigen Verzeichnis des richtigen Repos, damit Claude Code dessen Kontext lädt: `CLAUDE.md`, repo-lokale Skills, Settings, Hooks und MCP-Konfiguration (§2.5.3). Ein Repo ist optional; Workflows ohne Code-Bezug laufen in einem Scratch-Verzeichnis.

### 0.3 Nicht-Ziele (erste Version)

- Kein Deploy. Auto-Merge in den Ziel-Branch gehört zum Fundament (§2.6); was danach ausgeliefert wird, entscheidet die Pipeline des Repos.
- Ein Host. Mehrere Backstuben auf demselben Backlog sind späterer Ausbau (§4.2).
- Kein Agent-Framework als Runtime, auch nicht Hermes (§3.2).
- Keine Änderung am `backe`-Kern als Voraussetzung (§3.5). Wünsche an BK stehen in §4.2.
- Keine eigene UI. Der Mensch arbeitet mit der Claude-App und dem `backe`-CLI.

### 0.4 Anti-Ziele

Das Projekt ist gescheitert, auch wenn alles technisch funktioniert, wenn …

- … der Mensch Pull Requests einzeln mergen muss. Die Backstube ist keine PR-Factory; ein PR pro Issue ist kein Ergebnis, sondern liegen gebliebene Arbeit;
- … ein Issue `done` ist, dessen Code nicht im Ziel-Branch liegt, oder ein Issue auf einem Stand startet, der seine erledigten Abhängigkeiten nicht enthält;
- … der Mensch täglich mehr als eine Handvoll Pings bekommt, die er ohne Nachdenken beantwortet. Solche Fragen gehören in die Triage oder in eine Regel;
- … eine Triage-Antwort Arbeit in eine Richtung lenkt, ohne dass das im Backlog nachvollziehbar ist;
- … man das Log eines Sprachmodells lesen muss, um zu verstehen, warum die Backstube Issue X gestartet hat;
- … ein Issue nach einem Absturz still auf `in_progress` liegen bleibt.

## 1. Ist-Zustand

- **`backe` 0.3** liefert die Bausteine: synchroner Claim mit genau einem Gewinner (BK §2.16.5), `next --ready`-Semantik samt `depends_on` und Sub-Issues (BK §2.22, §2.23), `blocked`/`resume` und `issue list --unblockable` (BK §2.6), deklarierte Properties (BK §2.24), atomare Batches (BK §2.16.6) und das Muster »Entscheidungen sind Issues« (BK §2.25). Einen Daemon hat `backe` bewusst nicht (BK §3.8). Die Backstube ist genau dieser langlebige Prozess, nur außerhalb von `backe`.
- **Superpowers** bringt die Skills mit, die die Backstube braucht: `brainstorming`, `writing-plans`, `using-git-worktrees`, `subagent-driven-development`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `verification-before-completion` und `finishing-a-development-branch`. Sie sind **interaktiv** ausgelegt: `brainstorming` stellt dem Menschen Frage für Frage und reicht am Ende selbst an `writing-plans` weiter; `finishing-a-development-branch` fragt, ob gemergt, ein PR geöffnet, der Branch behalten oder verworfen werden soll. Spec und Plan landen als Dateien im Code-Repo (`docs/superpowers/specs/`, `docs/superpowers/plans/`), so auch in diesem Repo.
- **Claude Code** läuft interaktiv oder headless (`claude -p`). Über Remote Control ist eine lokale interaktive Session in der Claude-App erreichbar, auch auf dem Handy, mitsamt Benachrichtigung, sobald sie auf Eingabe wartet. Eine Headless-Session hat keinen Rückkanal zum Menschen. Den Projektkontext lädt Claude Code aus dem Arbeitsverzeichnis: `CLAUDE.md` (auch aus übergeordneten Verzeichnissen) und `CLAUDE.local.md`, unter `.claude/` Skills, Subagents, Settings und Hooks, dazu projektbezogene MCP-Server aus `.mcp.json`. Wo eine Session startet, entscheidet also, was sie kann und weiß. Neue Verzeichnisse verlangen beim ersten Start eine Vertrauensbestätigung, Projekt-MCP-Server eine Freigabe.

## 2. Soll-Zustand

### 2.1 Überblick

```
             ┌──────────────── backe CLI --format json ────────────────┐
             ▼                                                          │
   backe-Backlog (Git)                                    Backstube (Loop, deterministisch)
     ▲          ▲                                           │ spawn / reap │ Session-Tabelle
     │          │ signierte Writes (State, Props, Kommentare)▼              ▼
     │          └──────────── Worker-Session: Claude Code, eine Phase, im Repo-Kontext
     │                          └─ Skill backstube-worker → Skills des Workflows
     │                                                      Merge-Queue je Ziel-Branch
     │                                         rebase · verify · push ff-only ──► Code-Repo
     └── Mensch: Claude-App (Stufe 1) · backe CLI (ab Stufe 2) · Freigaben · Notbremse
```

**`backe` ist der Bus.** Worker melden ihr Ergebnis ausschließlich über `backe`-Writes und über den Branch. Die Backstube liest nur das Backlog und ihre eigene Session-Tabelle; Session-Ausgaben parst sie nie. Damit ist jeder Zustand der Fabrik im Backlog sichtbar, und ein Neustart der Backstube verliert nichts (§2.8, Punkt 2.7).

### 2.2 Rollen und Identitäten

Alle Rollen sind Agent-Identitäten mit dem Menschen als `operator`, angelegt per `backe user create-agent` (BK §2.12).

| Handle | Rolle | Schreibt |
| --- | --- | --- |
| `backstube` | Orchestrator und Merge-Queue | `resume`, Recovery-Moves, Zähler und Status bei Abstürzen, `on_hold` bei erschöpftem Budget, `done` nach dem Merge |
| `bs-w1` … `bs-wN` | Worker-Slots | Claim (`next --claim --as bs-wK`), Ergebnisse aller Phasen, die der Workflow nicht dem Reviewer zuweist |
| `bs-review` | Reviewer | Urteil der Phasen mit `role: reviewer` |
| `bs-triage` | Triage (Stufe 3) | Antworten oder Eskalationen auf Fragen |

**Slot gleich Identität.** Der Assignee eines Issues sagt, welcher Slot es hält. Darüber gleicht die Backstube Issues mit laufenden Sessions ab, ohne eigene Lease (§3.5). Die Zahl der Keys bleibt dadurch auf die Zahl der Slots begrenzt. Ein Slot kann mehrere Issues halten (eins in Arbeit, weitere in `review`, `blocked` oder in der Merge-Queue), aber nur eine Session gleichzeitig. Die Kapazität zählt Sessions, nicht Issues. Dass `backe next` das eigene laufende Issue zuerst liefert (BK §2.22), passt zur Regel »erst fertig machen, dann neu anfangen« (§2.8, Punkt 3).

### 2.3 Konfiguration

Host-lokal unter `~/.backstube/config.jsonc` (§3.9):

```jsonc
{
  "backlog": "acme",
  "watch": [                          // Reihenfolge = Priorität beim Dispatch
    { "sprint": "2026-w48" },
    { "project": "web/auth", "level": "top" },  // level wie bei backe next (BK §2.23)
    { "project": "ops", "workflow": "direct" }, // Default-Workflow dieses Eintrags
    { "sprint": "2026-w49", "target": "sprint" }  // Integrations-Branch je Sprint (§2.6.1)
  ],
  "target": "default",                // default (default_ref des Repos) | sprint
  "merge": { "strategy": "squash", "via": "git" },  // §2.6.2, §2.6.4
  "workflow": "superpowers",          // globaler Default-Workflow
  "workflows": { /* eigene Workflows und Overrides der eingebauten, §2.5.1 */ },
  "repos": {                          // je backe-Repo-Name, alles optional (§2.5.3)
    "webapp": {
      "local_files": ["CLAUDE.local.md", ".claude/settings.local.json"],
      "verify": ["pnpm install --frozen-lockfile", "pnpm lint", "pnpm test"],  // Pflicht für Auto-Merge
      "add_dirs": []
    }
  },
  "slots": ["bs-w1", "bs-w2"],
  "reviewer": "bs-review",
  "triage": null,                     // Stufe 3: "bs-triage"
  "questions": "interactive",         // interactive (Stufe 1) | issues (ab Stufe 2)
  "human": "spw",                     // Empfänger von Entscheidungen
  "gates": { "plan": false, "sprint": false },         // Plan-Freigabe im Workflow superpowers (§2.5.2)
  "runtime": { "kind": "remote-control" },      // remote-control | headless (§2.10)
  "worktrees": "~/.backstube/worktrees",
  "scratch": "~/.backstube/scratch",
  "limits": { "attempts": 2, "phase_timeout_min": 240, "tick_s": 60 },
  "session_title": "{id} · {phase} · {title}"
}
```

**Opt-in:** Die Backstube fasst nur Issues an, die einem `watch`-Eintrag entsprechen. Ob ein Repo nötig ist, sagt der Workflow (§2.5.1): Fehlt es bei einem Workflow mit `repo: required` oder liefert `backe repo where` keinen lokalen Pfad, bekommt das Issue einen Kommentar mit dem Hinweis auf `backe repo scan` und geht auf `on_hold`. Einzelne Issues lassen sich per `backstube.skip: true` ausnehmen.

**Workflow eines Issues:** `backstube.workflow` am Issue, sonst `workflow` des passenden `watch`-Eintrags, sonst der globale `workflow`.

### 2.4 Properties

Deklariert in `backlog.jsonc` (BK §2.24), alle unter dem Präfix `backstube.`:

| Property | Typ | Bedeutung | Setzt |
| --- | --- | --- | --- |
| `backstube.workflow` | string | Workflow des Issues (§2.5.1); fehlt sie, gilt der Default aus der Config | Mensch, beim Anlegen oder später |
| `backstube.phase` | string | aktuelle Phase, gültig sind die Phasen des Workflows; fehlt sie, gilt dessen erste Phase | Worker beim Abschluss; Mensch, um später einzusteigen (ein Bug mit klarem Repro startet in `superpowers` bei `plan`) |
| `backstube.repo` | string | Haupt-Repo, wenn `repos` mehrere Einträge hat; sonst gilt der erste (§2.5.3) | Mensch |
| `backstube.dir` | string | Unterverzeichnis im Repo als Arbeitsverzeichnis, etwa ein Paket im Monorepo (§2.5.3) | Mensch |
| `backstube.status` | enum `running`, `waiting`, `done`, `failed`, `stalled` | Zustand der Phase | `running`: Backstube beim Start; `done`, `failed`, `waiting`: Worker; `stalled`: Backstube bei Timeout |
| `backstube.attempts` | integer | gescheiterte Versuche der aktuellen Phase | Backstube |
| `backstube.session` | string | Session-Name bzw. Link zur Remote-Control-Session | Backstube |
| `backstube.target` | enum `default`, `sprint` | Ziel-Branch dieses Issues, überschreibt die Config (§2.6.1) | Mensch |
| `backstube.merge` | enum `auto`, `manual` | `manual`: vor dem Merge eine Freigabe einholen (§2.6.4) | Mensch, Triage |
| `backstube.pr` | string | URL des PRs, nur bei `merge.via: github-pr` | Backstube |
| `backstube.gate` | enum `none`, `plan` | überschreibt `gates.plan` für dieses Issue | Mensch |
| `backstube.skip` | boolean | Issue nicht anfassen | Mensch |
| `backstube.asked_by` | string | ab Stufe 2: Issue, dessen Arbeit die Frage gestellt hat | Worker |
| `backstube.route` | enum `answered`, `escalated`, `invalid` | Stufe 3: Ergebnis der Triage | Triage |

`backstube.workflow` und `backstube.phase` sind bewusst `string` statt `enum`: Welche Workflows es gibt, steht in der Host-Config, nicht im Backlog (§3.10). Die Backstube prüft die Werte beim Dispatch; ein unbekannter Workflow oder eine Phase, die es im Workflow nicht gibt, führt zu `on_hold` mit Begründung. Den Branch trägt das eingebaute Feld `repos` (`webapp@backstube/bk-7f3k2`), nach dem Merge den Merge-Commit (`webapp@3e1f9a2`, wie in BK §2.25). `kind` (`question`, `decision`) folgt der Konvention aus BK §2.25 und wird nicht als Enum deklariert, weil die Audit-Skills `kind` mit eigenen Werten belegen.

### 2.5 Workflows und Lebenszyklus

#### 2.5.1 Workflows

Ein Workflow ist eine benannte, geordnete Liste von Phasen. Er legt fest, welche Phasen ein Issue durchläuft, wer sie ausführt, welche Skills die Session nutzen soll und wo sie startet. Superpowers ist ein guter Workflow für Feature-Arbeit mit offenem Design, für einen Dependency-Bump oder eine Textkorrektur aber reine Zeremonie: Spec, Plan und Review kosten dort mehr, als sie bringen.

```jsonc
"workflows": {
  "direct": {
    "repo": "required",               // required | optional | none
    "cwd": "worktree",                // worktree | repo | scratch (§2.5.3)
    "phases": [
      { "name": "build",  "skills": [], "state_after": "review" },
      { "name": "review", "role": "reviewer", "skills": [] },
      { "name": "merge",  "role": "backstube" }
    ]
  }
}
```

Je Phase: `name`, `role` (`slot`, Default; `reviewer`; `backstube` für die Merge-Phase, die ohne Session und ohne Sprachmodell läuft, §2.6.2), `skills` (Namen, die der Start-Prompt der Session nennt; leer heißt, die Session nutzt, was Repo und Host mitbringen), optional `state_after` (backe-State nach erfolgreichem Abschluss), `gate` (Rückfrage zur Freigabe am Ende, §3.8), `model`. Bei »changes« eines Reviewers springt das Issue in die Phase davor zurück. Jeder Workflow, der Code ändert, endet mit `merge`; die Backstube lehnt Workflows mit `cwd: worktree` ohne `merge`-Phase ab.

**Eingebaute Workflows.** Die Backstube bringt drei mit, die Config kann sie überschreiben oder eigene hinzufügen:

| Workflow | Phasen | `repo` | `cwd` | Wofür |
| --- | --- | --- | --- | --- |
| `superpowers` | `spec` → `plan` → `build` → `review` → `merge` | required | worktree | Features und Änderungen mit offenem Design (§2.5.2) |
| `direct` | `build` → `review` → `merge` | required | worktree | kleine, klar umrissene Änderungen: Chores, Bugs mit klarem Repro, Bumps. Arbeitet nach den Konventionen des Repos, ohne Superpowers. Das Review bleibt, weil es ohne PR das einzige zweite Augenpaar ist |
| `task` | `run` | optional | repo bzw. scratch | Arbeit ohne Branch und ohne Merge: Recherche, Analysen, ein Audit mit einem repo-lokalen Skill, Text im Backlog. Ergebnis als Kommentar, danach `done` |

Ein eigener Workflow für die Audit-Skills aus BK §2.25 wäre etwa `audit` mit einer Phase `run`, `skills: ["js-ts-project-audit"]` und `cwd: repo`. Der Skill liegt im Code-Repo unter `.claude/skills/` und ist deshalb nur in einer Session verfügbar, die dort startet (§2.5.3).

**Workflow wechseln:** Der Mensch ändert `backstube.workflow`, solange keine Session für das Issue läuft. Gibt es die aktuelle Phase im neuen Workflow nicht, setzt die Backstube auf dessen erste Phase zurück und schreibt das als Kommentar.

#### 2.5.2 Workflow `superpowers`

| Phase | Identität | Superpowers-Skills | Artefakt | Erfolg → |
| --- | --- | --- | --- | --- |
| `spec` | Slot | `brainstorming` | Spec unter `docs/superpowers/specs/` im Branch, Kurzfassung als Kommentar | `plan` |
| `plan` | Slot | `writing-plans` | Plan unter `docs/superpowers/plans/` im Branch | `build`, bei aktivem Gate erst nach der Freigabe |
| `build` | Slot | `subagent-driven-development` (darin `test-driven-development`), `systematic-debugging`, `verification-before-completion` | Commits im Branch | `review`; State → `review` |
| `review` | `bs-review` | `requesting-code-review`, `verification-before-completion` | Urteil als Kommentar | »approve« → `merge`; »changes« → `build`, State → `in_progress` |
| `merge` | `backstube` | keine, Merge-Queue (§2.6.2) | Squash-Commit im Ziel-Branch | `done`; bei Konflikt oder rotem Verify → `integrate` (§2.6.3) |

- **States:** Der Claim setzt `in_progress` (BK §2.16.5); `spec`, `plan` und `build` laufen darin. `build` endet mit `review`. Eine Rückweisung im Review geht zurück auf `in_progress`, das erlaubt die Hauptlinie ohne `workflow.strict` (BK §2.6). Während `merge` bleibt das Issue auf `review`; `done` setzt die Backstube im selben Batch, der den Merge-Commit einträgt.
- **Worktree:** `superpowers` arbeitet mit `cwd: worktree` (§2.5.3). Spec und Plan liegen dort als Dateien; jede neue Session findet so die Arbeit der vorigen.
- **Overrides:** Der Workflow gibt `backstube-worker` drei Superpowers-spezifische Regeln mit: `brainstorming` reicht nicht von sich aus an `writing-plans` weiter, die Phase endet mit der committeten Spec; `using-git-worktrees` entfällt, denn der Worktree existiert schon; `finishing-a-development-branch` entfällt, denn gemergt wird ausschließlich über die Merge-Queue.
- **Review-Unabhängigkeit:** Der Reviewer ist eine eigene Identität in einer frischen Session. Er sieht Spec, Plan und Diff, aber nicht den Verlauf der Build-Session.
- **Plan-Gate:** Ist das Gate aktiv, stellt die `plan`-Session am Ende die Frage »Plan freigeben?« mit den Optionen Freigeben, Überarbeiten (mit Hinweis) und Abbrechen. Das Gate ist eine gewöhnliche Rückfrage und folgt dem Modus aus `questions` (§3.8).

#### 2.5.3 Arbeitsverzeichnis und Projektkontext

Claude Code lädt seinen Projektkontext aus dem Arbeitsverzeichnis (§1). Die Backstube bestimmt es deshalb ausdrücklich, statt es der Session zu überlassen:

1. **Haupt-Repo:** `backstube.repo`, sonst der erste Eintrag in `repos`. Lokaler Pfad über `backe repo where <name>` (BK §2.11).
2. **Modus** aus dem Workflow (`cwd`):
   - **`worktree`** (Workflows, die Code ändern): `git worktree add <worktrees>/<repo>/<id> -b backstube/<id> <ziel>` im lokalen Clone, abgezweigt vom aktuellen Stand des Ziel-Branches (§2.6.1); der Branch wird per `backe issue link` am Issue verknüpft. Der Pfad ist je Issue stabil, alle Phasen arbeiten im selben Worktree. Nach `done`, `cancelled` oder `rejected` räumt die Backstube Worktree und Branch ab; ein abgebrochener Branch bleibt bis zum Ende des Sprints erhalten, damit nichts verloren geht.
   - **`repo`** (lesende Arbeit): direkt im lokalen Clone. Weil dort auch der Mensch arbeitet, läuft je Repo höchstens eine Session im Modus `repo` gleichzeitig, und der Workflow-Vertrag verbietet ihr Commits und Branch-Wechsel.
   - **`scratch`**: `<scratch>/<id>`, für Issues ohne Repo (`repo: optional` ohne Eintrag oder `repo: none`). Bleibt bis `done` erhalten, damit Wiedereinstiege den Stand finden.
3. **Unterverzeichnis:** `backstube.dir` macht ein Verzeichnis im Repo zum Arbeitsverzeichnis, etwa `packages/web` im Monorepo. `CLAUDE.md` aus übergeordneten Verzeichnissen bis zur Repo-Wurzel lädt Claude Code dabei mit.
4. **Lokale Dateien:** Ein Worktree enthält nur, was eingecheckt ist. Projekt-Settings, Skills, Hooks und ein eingechecktes `.mcp.json` sind damit da; `CLAUDE.local.md`, `.claude/settings.local.json` oder ein nicht eingechecktes `.mcp.json` fehlen. Die Backstube kopiert die Dateien aus `repos.<name>.local_files` beim Anlegen des Worktrees und frisch vor jeder Phase aus dem Clone. Kopie statt Symlink, damit eine Session die Konfiguration des Menschen nicht verändert. Dateien mit Secrets (`.env`) gehören nur bewusst in die Liste.
5. **Weitere Repos** des Issues (alle Einträge in `repos` außer dem Haupt-Repo) und `repos.<name>.add_dirs` gibt die Backstube der Session als zusätzliche Verzeichnisse mit (`--add-dir`): lesbar, aber ohne eigenen Worktree. Wer in zwei Repos schreiben muss, schneidet das Issue in Sub-Issues je Repo (BK §2.23).
6. **Vertrauen und MCP-Freigabe:** Ein neues Worktree-Verzeichnis ist für Claude Code ein unbekanntes Projekt. Eine interaktive Session bliebe an der Vertrauensabfrage und an der Freigabe der Projekt-MCP-Server hängen, bevor sie den Prompt überhaupt liest. Die Backstube erledigt beides vor dem Start, für genau dieses Verzeichnis und nur für Repos aus dem Backlog. Wie das zuverlässig geht, klärt F1 (§4.1).

### 2.6 Integration und Auto-Merge

Issues bauen aufeinander auf (`depends_on`, Sub-Issues, schlicht dieselben Dateien). Zweigen alle Branches eines Sprints vom selben Stand ab und warten auf einen Menschen, der sie einzeln merged, entstehen genau die Konflikte, die die Fabrik vermeiden soll, und ein abhängiges Issue baut auf Code, den es im Ziel-Branch noch gar nicht gibt. Deshalb gilt: **Fertig heißt gemergt.** `backe next` reicht ein abhängiges Issue erst weiter, wenn seine Abhängigkeiten `done` sind (BK §2.22), und `done` setzt die Backstube erst, wenn der Code im Ziel-Branch liegt. Damit ist garantiert, dass jedes Issue auf einem Stand startet, der seine Abhängigkeiten enthält.

#### 2.6.1 Ziel-Branch

- **`default`** (Default): der `default_ref` des Repos, also Trunk-based. Jedes Issue landet direkt im Hauptzweig.
- **`sprint`**: ein Integrations-Branch `backstube/sprint/<slug>` je Sprint und Repo, beim ersten Issue vom `default_ref` abgezweigt. Issues mergen dort hinein. Hat der Sprint in diesem Repo keine offenen Issues mehr, merged die Backstube den Sprint-Branch über dieselbe Queue in den `default_ref`. Mit `gates.sprint: true` ist das eine Rückfrage: eine Freigabe pro Sprint und Repo statt eines Merges pro Issue.
- Auflösung: `backstube.target` am Issue, sonst `target` des `watch`-Eintrags, sonst der globale `target`. Ein Issue ohne Sprint hat immer `default`.
- **Frischer Stand vor dem Build:** Spec und Plan ändern nur Doku. Vor der ersten Code-Phase rebased die Backstube den Issue-Branch auf den aktuellen Ziel-Branch, damit der Build die inzwischen gemergten Issues sieht.

#### 2.6.2 Merge-Queue

Die Phase `merge` läuft ohne Session und ohne Sprachmodell, als Hintergrundjob der Backstube. Je Paar aus Repo und Ziel-Branch gibt es eine Queue, streng seriell, in der Reihenfolge des Eintritts. Ein Job:

1. **Rebase:** `git fetch`, Issue-Branch auf die Spitze des Ziel-Branches rebasen. Ein Konflikt führt in die Phase `integrate` (§2.6.3).
2. **Verify:** die Kommandos aus `repos.<name>.verify` im Worktree, auf dem rebasten Stand. Rot heißt ebenfalls `integrate`. Verify ist deterministisch; das Urteil »Tests sehen gut aus« eines Sprachmodells ersetzt es nicht. Ein Repo ohne `verify` bekommt keinen Auto-Merge: `backstube doctor` warnt, und Issues bleiben mit einem Hinweis vor der Queue stehen.
3. **Commit:** nach `merge.strategy`, Default `squash`: ein Commit je Issue im Ziel-Branch, Titel des Issues als Message, Trailer `Backe-Issue: <id>` (in BK §2.25 als zulässig genannt). Alternativen sind `rebase` (die Commits des Issues einzeln) und `merge` (Merge-Commit).
4. **Push fast-forward-only** auf den Ziel-Branch. Abgelehnt, weil inzwischen jemand anderes gepusht hat, auch ein Mensch → zurück zu Schritt 1; nach drei Runden `on_hold`.
5. **Abschluss als ein Batch:** `repos` auf `<repo>@<commit>`, Kommentar mit Commit und Verify-Ergebnis, `done`. Danach Worktree und Branch abräumen.

Weil die Queue seriell ist und jeder Job auf der aktuellen Spitze verifiziert, ist der Ziel-Branch nach jedem Merge grün, soweit `verify` reicht.

#### 2.6.3 Phase `integrate`

Bei einem Rebase-Konflikt oder rotem Verify startet die Backstube eine Session im Worktree, im Slot, der das Issue hält. Sie bekommt den Konflikt bzw. die Verify-Ausgabe und die Specs beider Seiten: das eigene Issue und die Issues, deren Commits seit dem Abzweigen in den Ziel-Branch gekommen sind (über den Trailer `Backe-Issue`). Im Workflow `superpowers` nutzt sie `systematic-debugging` und `verification-before-completion`. Ist der Stand integriert und das Verify grün, geht das Issue zurück in `review`, weil neuer Code entstanden ist; der Reviewer sieht dann nur den Integrations-Diff. Danach folgt wieder `merge`. Das Budget aus `limits.attempts` gilt auch hier, erschöpft heißt Entscheidung an den Menschen bzw. `on_hold`.

#### 2.6.4 Wo der Mensch bleibt

- **Freigabe je Issue:** `backstube.merge: manual` hält das Issue vor der Queue an und stellt die Rückfrage »Mergen?«. Für heikle Änderungen gedacht; die Triage setzt es bei den Themen ihrer Pflicht-Eskalation (§2.9.3) von selbst.
- **Freigabe je Sprint:** `gates.sprint` mit Ziel `sprint` (§2.6.1).
- **Notbremse:** `backstube pause [--repo <name>]` hält Queues an, laufende Jobs enden vor dem Push.
- **Rückgängig:** `backstube revert <id>` erzeugt über dieselbe Queue einen Revert-Commit des Squash-Commits und öffnet das Issue wieder (`backe issue reopen`). Hängen erledigte Issues per `depends_on` daran, nennt die Backstube sie und revertiert nichts ohne `--cascade`.
- **PR nur als Transportmittel:** Verbietet eine Branch-Protection Pushes auf den Ziel-Branch, öffnet die Backstube mit `merge.via: "github-pr"` einen PR und aktiviert GitHubs Auto-Merge. Die Status-Checks ersetzen dann Schritt 2 oder ergänzen ihn, und `done` folgt erst auf den Merge. Der PR ist kein Arbeitsauftrag an den Menschen.

### 2.7 Der Worker-Vertrag: Skill `backstube-worker`

Die Backstube startet jede Session mit einem minimalen Prompt: »Worker der Backstube. Issue `<id>`, Workflow `<workflow>`, Phase `<phase>`. Skills dieser Phase: `<skills>`. Lade den Skill `backstube-worker`.« Den eigentlichen Vertrag trägt der Skill. So bleibt er versioniert und testbar, und Prompts in der Backstube bleiben dünn.

1. **Kontext laden:** `backe issue show <id> --comments --format json`, dazu die Artefakte früherer Phasen im Arbeitsverzeichnis (bei `superpowers` Spec und Plan). Beim Wiedereinstieg nach einer Rückfrage zusätzlich die Antworten an den Issues aus dem letzten `blocked_by`.
2. **Genau eine Phase.** Kein Vorgreifen, auch wenn ein Skill von sich aus weiterreichen will.
3. **Workflow-Overrides beachten:** Regeln, die ein Workflow für seine Skills mitbringt, gehen den Skills vor (für `superpowers` §2.5.2). Unabhängig vom Workflow: Der Default-Branch wird nie angefasst, und im Modus `repo` gibt es weder Commits noch Branch-Wechsel (§2.5.3).
4. **Abschluss als ein Batch** (BK §2.16.6): Ergebnis-Kommentar, `backstube.phase` = nächste Phase, `backstube.status: done`, gegebenenfalls der State-Move. Atomar, damit die Backstube nie einen halben Abschluss sieht.
5. **Scheitern:** `backstube.status: failed` plus Kommentar mit Grund und letztem Stand. Kein State-Move, die Wiederholung entscheidet die Backstube.
6. **Nie:** fremde Issues claimen oder ändern (Ausnahme: Fragen anlegen, §2.9.2), mergen oder auf den Ziel-Branch pushen (das macht allein die Merge-Queue, §2.6.2), eigene Phasen überspringen.
7. **Rückfragen** nach dem Modus aus `questions` (§2.9). In Stufe 1 hält der Ergebnis-Kommentar zusätzlich jede gestellte Frage samt Antwort fest. Was am Handy entschieden wurde, landet so trotzdem im Backlog.

### 2.8 Die Schleife

Alle `tick_s` Sekunden:

1. `backe sync`, dann ein **Snapshot**: die beobachteten Issues (`issue list --format json` je `watch`-Eintrag, dazu alle Issues mit Assignee aus `slots`, `reviewer` und `triage`), die Session-Tabelle, die laufenden Sessions der Runtime und die Merge-Jobs.
2. **Reconcile.** Eine reine Funktion `(Snapshot, jetzt) → Aktionen`:
   1. **Mensch hat Vorrang:** Ein Issue mit laufender Session steht auf `on_hold`, `cancelled` oder `rejected` oder hat `backstube.skip` → Session beenden.
   2. **Phase beendet:** `backstube.status` ist `done`, `failed` oder `waiting`, die Session lebt noch → Session beenden.
   3. **Absturz:** `backstube.status: running`, aber keine lebende Session → `attempts + 1`, `status: failed`. Den Neustart erledigt Schritt 3.
   4. **Budget erschöpft:** `status: failed` mit `attempts ≥ limits.attempts` → `on_hold` mit Begründung. Ab Stufe 2 stattdessen eine Entscheidung »Phase X scheitert wiederholt« an `human`, das Issue geht auf `blocked`.
   5. **Entsperrt:** Ein beobachtetes Issue steht in `issue list --unblockable` → `backe issue resume <id>` als `backstube`.
   6. **Timeout:** `status: running` länger als `phase_timeout_min` → `status: stalled`. Die Session bleibt am Leben, denn in Stufe 1 lässt sich ein Hänger nicht von einem Menschen unterscheiden, der noch nicht geantwortet hat. `backstube status` zeigt das Issue an, der Mensch entscheidet.
   7. **Neustart der Backstube:** Ein Issue gehört einem Slot und steht auf `running`, die Session-Tabelle kennt es aber nicht → per Session-Name (`bs-<id>-<phase>`) in der Runtime suchen und übernehmen, sonst gilt Punkt 3.
   8. **Merge-Job abgebrochen:** Ein Issue steht in Phase `merge` auf `running`, ohne lebenden Job → Job neu starten. Das ist gefahrlos, weil jeder Job mit `fetch` und Rebase beginnt und nur fast-forward pusht; ein schon gepushter Commit wird über den Trailer `Backe-Issue` im Ziel-Branch erkannt und nur noch der Abschluss-Batch geschrieben.
3. **Dispatch.** Erst fertig machen, dann neu anfangen:
   1. Issues in Arbeit, deren Phase `done` oder `failed` (mit Restbudget) ist und die keine Session haben → nächste bzw. dieselbe Phase im selben Slot starten. Hat die nächste Phase `role: reviewer`, übernimmt `bs-review`, sofern frei.
   2. Freie Slots → `backe next --claim --as <slot>` je `watch`-Eintrag in Reihenfolge, gefiltert um `backstube.skip`; Workflow bestimmen, Arbeitsverzeichnis vorbereiten (§2.5.3), Phase aus `backstube.phase` starten. Ein Issue, dessen Workflow `cwd: repo` verlangt, wartet, solange im selben Repo schon eine solche Session läuft.
   3. **Merge-Queues:** je Queue ohne laufenden Job das älteste Issue in Phase `merge` starten, sofern die Queue nicht pausiert ist und `backstube.merge` nicht `manual` ohne Freigabe steht. Merge-Jobs belegen keinen Slot.
   4. **Sprint-Merge:** Ziel `sprint`, keine offenen Issues des Sprints im Repo mehr → Sprint-Branch in die Queue des `default_ref` stellen, mit `gates.sprint` erst nach der Freigabe.
4. Aktionen ausführen, Session-Tabelle schreiben.

Die **Session-Tabelle** (`~/.backstube/state.json`: Issue, Slot, Phase, Session-Name bzw. Merge-Job, Startzeit, Link) ist nur ein Cache. Sie lässt sich aus Backlog und Runtime vollständig wieder aufbauen, weil Session-Namen die Issue-ID tragen.

### 2.9 Rückfragen

#### 2.9.1 Stufe 1: interaktiv über Remote Control

Jede Worker-Session ist interaktiv und per Remote Control erreichbar (§2.10). Superpowers fragt, wie es das immer tut; der Mensch bekommt die Benachrichtigung aufs Handy und antwortet direkt in der Claude-App. Der Session-Titel trägt ID, Phase und Titel des Issues, `backstube.session` den Link.

Das bringt viel und kostet wenig: Superpowers bleibt unverändert, und `brainstorming` funktioniert in voller Qualität. Dazu sammelt die Stufe echtes Material darüber, welche Fragen Agents tatsächlich stellen, und das ist die Grundlage für die Regeln der Triage. Die Kosten: Ein wartender Worker hält seinen Slot, Fragen lassen sich nicht bündeln oder vorsortieren, und die Antwort existiert im Backlog nur, weil der Worker-Vertrag sie in den Ergebnis-Kommentar schreibt (§2.7, Punkt 7).

#### 2.9.2 Stufe 2: Rückfragen als Issues

Mit `questions: "issues"` übersteuert `backstube-worker` jede Stelle, an der ein Superpowers-Skill den Menschen fragen würde:

1. **Sammeln statt tröpfeln:** Der Worker sammelt alle Fragen, die die Phase gerade blockieren, statt sie einzeln zu stellen. Jede bekommt das Format der Entscheidungsvorlage aus BK §2.25: Frage, Auslöser, zwei bis drei Optionen mit Folgen, markierter Vorschlag, Kipp-Punkt.
2. **Zwischenstand sichern:** Der Spec- oder Plan-Entwurf wird im Branch committet, eine Kurzfassung kommt als Kommentar ans Issue.
3. **Ein Batch:** je Frage ein `issue.create` mit `kind: decision`, Assignee `human`, `backstube.asked_by: <id>`, Projekte und Sprints wie beim Arbeits-Issue; dazu `issue.move` des Arbeits-Issues nach `blocked` mit `blocked_by` auf die neuen Platzhalter und `backstube.status: waiting`. Die Backstube beendet die Session (§2.8, Punkt 2.2) und gibt den Slot frei.
4. **Antwort:** Der Mensch antwortet wie in BK §2.25, also mit einem Kommentar, `props.decision.chosen` und `done`.
5. **Wiedereinstieg:** Sind alle Fragen erledigt, findet die Backstube das Issue über `--unblockable`, setzt es per `resume` fort und startet dieselbe Phase neu. Der Worker liest Zwischenstand und Antworten (§2.7, Punkt 1).

`brainstorming` braucht so eventuell zwei bis drei Runden statt eines Dialogs. Das ist der Preis dafür, dass jede Frage adressierbar wird; erst damit lässt sich etwas zwischen Frage und Mensch schalten. Wie der Mensch in dieser Stufe von neuen Entscheidungen erfährt, ist offen (§4.1).

#### 2.9.3 Stufe 3: Triage

Nicht jede Frage eines Agents ist eine Entscheidung, die nur der Mensch treffen kann. Viele lassen sich aus dem Code, der Spec, den Konventionen des Repos oder einer früheren Entscheidung beantworten. Mit `triage: "bs-triage"` legt der Worker Fragen deshalb als `kind: question` mit Assignee `bs-triage` an statt direkt beim Menschen. Die Backstube startet für jede offene Frage eine Triage-Session.

**Quellen, in dieser Reihenfolge:** menschliche Entscheidungen im Projekt (`backe issue list --prop kind=decision --state done -p <projekt>`), Spec und Plan im Branch, `CLAUDE.md`, README und Proposals des Repos, der Code, das Arbeits-Issue samt Kommentaren.

| Ergebnis | Wann | Write |
| --- | --- | --- |
| `answered` | Die Antwort folgt zwingend aus einer Quelle | Kommentar mit Antwort und Beleg (Pfad, Zeile, Entscheidungs-ID), `backstube.route: answered`, `done` |
| `invalid` | Die Frage beruht auf einem Missverständnis oder liegt außerhalb des Issue-Scopes | Kommentar mit Begründung, `rejected`. Der Worker bekommt die Begründung beim Wiedereinstieg |
| `escalated` | alles andere, insbesondere die Pflichtfälle unten | Body als Entscheidungsvorlage mit dem Vorschlag der Triage, `kind: decision`, Assignee `human`, `backstube.route: escalated` |

**Pflicht-Eskalation.** Die Triage beantwortet niemals Fragen, die …

- den Scope des Issues ändern;
- öffentliche APIs, Datenformate oder Migrationen festlegen;
- Sicherheit, Lizenzen, Kosten oder externe Dienste betreffen;
- einer menschlichen Entscheidung widersprechen oder sie erweitern;
- Geschmack ohne Präzedenzfall verlangen (Produkt, UX, Naming nach außen).

Eine selbst gemeldete Konfidenz des Modells ist als Schwelle schwach. Die harten Regeln oben tragen die Last, die Konfidenz ist höchstens ein zusätzlicher Filter.

**Nur Menschen setzen Regeln.** `kind: decision` mit State `done` gilt als Präzedenzfall, eine Triage-Antwort nie. Die Triage kann damit nicht auf ihren eigenen Fehlern aufbauen (§3.7).

**Veto.** Jede Triage-Antwort ist abfragbar (`backe issue list --prop kind=question --prop backstube.route=answered`). Öffnet der Mensch eine solche Frage wieder (`backe issue reopen`), behandelt die Backstube sie als neu gestellt: Ist das Arbeits-Issue aus `backstube.asked_by` noch nicht `done`, geht es zurück auf `blocked` mit `blocked_by` auf die Frage. Ist es schon `done`, legt die Backstube eine Entscheidung »Nacharbeit nach Veto« an den Menschen an. Die Veto-Quote ist die Kennzahl, an der sich die Regeln der Triage messen lassen müssen.

### 2.10 Session-Runtime

Schnittstelle: `spawn(slot, issue, phase, prompt, cwd, add_dirs, settings) → handle`, `alive(handle)`, `kill(handle)`, `link(handle)`.

- **`remote-control`** (Stufe 1, Default): eine interaktive Claude-Code-Session in einer tmux-Session `bs-<id>-<phase>`, Arbeitsverzeichnis nach §2.5.3, Remote Control aktiv, `BACKE_USER=<slot>`. Die Session läuft lokal, weil der Worker `backe`-Commits signiert: Der private Key des Slots liegt auf dem Host (BK §2.12) und gehört in keinen Cloud-Container.
- **`headless`** (ab Stufe 2, optional): `claude -p` ohne Rückkanal, nur zulässig mit `questions: "issues"`. Ohne TTY und ohne wartende Sessions, also billiger im Betrieb.
- **Voraussetzungen auf dem Host:** `backstube-worker` und die Skills der benutzten Workflows sind auf User-Ebene installiert (Superpowers als Plugin); repo-lokale Skills bringt das Arbeitsverzeichnis mit. Die Worker brauchen eine Permission-Allowlist für Tests, Git und `backe`, sonst wird jede Freigabe zum Ping aufs Handy und verletzt das erste Anti-Ziel. Die Backstube übergibt sie als Settings-Datei beim Start und schreibt nichts in das Code-Repo.

### 2.11 Kommandos

| Kommando | Zweck |
| --- | --- |
| `backstube run` | die Schleife im Vordergrund; Betrieb als systemd-User-Unit |
| `backstube tick` | genau ein Durchlauf, für Tests und Cron |
| `backstube plan` | Trockenlauf: die Aktionen des nächsten Ticks, ohne sie auszuführen. Fällt aus dem reinen Reconcile ab |
| `backstube status` | Slots, Sessions, Phasen, Links, `stalled`-Issues |
| `backstube kick <id> [--workflow <w>] [--phase <p>]` | Phase von Hand starten oder zurücksetzen, `attempts` auf 0 |
| `backstube queue [--repo <name>]` | Merge-Queues: wartende Issues, laufender Job, letzter Merge |
| `backstube pause` / `resume [--repo <name>]` | Notbremse für Merge-Queues und Dispatch (§2.6.4) |
| `backstube revert <id> [--cascade]` | Merge eines Issues über die Queue rückgängig machen und das Issue wieder öffnen |
| `backstube workflows` | eingebaute und konfigurierte Workflows mit Phasen, Skills und `cwd` |
| `backstube doctor` | Identitäten und Keys, deklarierte Properties, `backe`-Version, tmux, Claude Code, Skills der Workflows, Remote Control, lokale Pfade der Repos, ihre `local_files` und `verify`, Push-Rechte auf die Ziel-Branches |

## 3. Designentscheidungen

### 3.1 Deterministischer Orchestrator statt Agent

Ob ein Issue bereit ist, steht in `backe next`. Ob eine Session lebt, sagt die Runtime. Ob eine Phase fertig ist, steht in `backstube.status`. Keine dieser Fragen braucht Urteilsvermögen, also bekommt keine davon ein Sprachmodell. Ein LLM als Orchestrator kostet bei jedem Tick Tokens, entscheidet nicht reproduzierbar und ist nur mit Prompt-Roulette zu testen. Urteil braucht es in den Phasen selbst und in der Triage, genau dort sitzen die Sessions. Verworfen: Orchestrator als langlaufende Claude-Session mit `/loop`.

### 3.2 Kein Hermes

Hermes Agent (Nous Research) bringt nach eigener, ungeprüfter Kenntnis eine Always-on-Runtime, einen Cron-Scheduler, ein Messaging-Gateway (Telegram, Discord, Slack u. a.), Persistent Memory und ein eigenes Skill-System mit. Für die Backstube:

- Scheduler und Always-on erledigen systemd und eine Schleife, ohne Tokens pro Tick.
- Das Gedächtnis der Fabrik ist das Backlog: Issue-Bodies, Kommentare und Entscheidungen als abfragbare Regeln.
- Ein zweites Skill-System neben Superpowers verdoppelt die Fläche, an der Verhalten debuggt werden muss.
- Der Orchestrator wäre wieder ein Agent (§3.1).

Interessant bleibt allein das Messaging-Gateway, und zwar als Frontend für Benachrichtigungen ab Stufe 2 (§4.1), nicht als Runtime.

### 3.3 CLI-JSON als Vertrag statt Service-Import

`backe` exportiert keine Library-API; das Paket ist ein CLI (`bin`), und der Service-Layer ist Interna. Stabil zugesagt sind die JSON-Ausgaben, `--fields` und die Exit-Codes (BK §2.18). Die Backstube nutzt also dieselbe Tür wie Menschen und Skripte, und `backstube doctor` prüft die Mindestversion. Verworfen: Import aus `@spearwolf/backe/src/services`, weil er jedes Refactoring in `backe` zum Breaking Change für die Backstube machen würde.

### 3.4 Eine Session pro Phase

Frischer Kontext je Phase (Superpowers setzt mit `subagent-driven-development` selbst auf frische Subagents), ein Absturz kostet eine Phase, das Modell ist je Phase wählbar, und der Reviewer ist echt unabhängig. Der Preis ist ein Start pro Phase und das Neu-Einlesen des Kontexts. Ihn begrenzen die Artefakte im Branch: Spec und Plan sind genau die Übergabe, für die Superpowers sie ohnehin schreibt. Verworfen: eine Session für den ganzen Lebenszyklus (Kontext läuft voll, ein Absturz kostet alles, Review durch denselben Kontext).

### 3.5 Keine Lease in `backe`, solange es einen Host gibt

Ein abgestürzter Worker hinterlässt ein Issue auf `in_progress`. Auf einem Host erkennt die Backstube das ohne Hilfe von `backe`: Der Assignee ist ein Slot, und die Runtime weiß, ob dessen Session lebt (§2.8, Punkte 2.3 und 2.7). Eine Lease mit Ablaufzeit braucht es erst, wenn mehrere Backstuben dasselbe Backlog bedienen und keine die Sessions der anderen sieht. Das ist ein Wunsch an BK für später (§4.2).

### 3.6 Rückfragen in Stufen

Stufe 1 zuerst, weil sie Superpowers unverändert lässt, am schnellsten trägt und das Material liefert, aus dem die Triage-Regeln entstehen. Stufe 2 ist Voraussetzung für Stufe 3: Eine Frage, die nur in einer Session existiert, ist nicht adressierbar, also kann niemand sie abfangen, bündeln oder vorbeantworten.

### 3.7 `kind: decision` nur für menschliche Entscheidungen

Invariante: `kind: decision` ⇔ Assignee ist ein Mensch ⇔ die Antwort gilt als Regel. Fragen, die die Triage beantwortet, bleiben `kind: question`. Damit bleibt die Regelbasis sauber, und die Triage kann sich nicht selbst Präzedenzfälle schaffen. Verworfen: ein gemeinsames `kind` mit einem Feld »beantwortet von« (eine Abfrage mehr bei jeder Regelsuche, und vergessen wird sie bestimmt).

### 3.8 Das Plan-Gate ist eine Rückfrage

Kein eigener Freigabe-Mechanismus: Das Gate nutzt denselben Kanal wie jede andere Frage, in Stufe 1 interaktiv, ab Stufe 2 als Entscheidung. In Stufe 3 eskaliert die Triage ein Gate immer, weil eine Freigabe per Definition Sache des Menschen ist.

### 3.9 Host-Config statt Backlog-Config

Slots, Runtime, Timeouts und Worktree-Pfade sind Betriebsparameter eines Hosts, nicht Inhalt des Backlogs. Die `watch`-Liste wäre im Backlog für alle sichtbar; das spräche dafür, sie dort abzulegen. In der ersten Version bleibt sie trotzdem lokal, weil es nur einen Host gibt.

### 3.10 Workflows in der Host-Config, Auswahl am Issue

Die Auswahl gehört ans Issue, weil der Mensch beim Anlegen am besten weiß, wie viel Zeremonie es braucht. Die Definition gehört in die Host-Config, weil sie Skills nennt, die auf diesem Host installiert sein müssen. Darum ist `backstube.workflow` im Backlog nur ein String (§2.4). Verworfen: Workflow aus Labels oder Projekt ableiten (implizit, und genau die Ausnahmen gehen schief); feste Phasen mit überspringbaren Schritten (jeder neue Workflow würde dann zur Sonderregel im Kern).

### 3.11 Die Session startet im Repo, nicht in der Backstube

Der Kontext eines Projekts liegt im Projekt: Konventionen in `CLAUDE.md`, Werkzeuge als repo-lokale Skills und MCP-Server, Leitplanken als Hooks. Startet eine Session woanders und bekommt das Repo nur als Pfad im Prompt, fehlt ihr all das, oder die Backstube müsste es nachbauen. Mit dem richtigen Arbeitsverzeichnis lädt Claude Code den Kontext selbst, und ein Repo bestimmt sein Verhalten in der Fabrik mit denselben Dateien wie bei der Arbeit von Hand. Verworfen: Kontext durch die Backstube in den Prompt kopieren (doppelte Pflege, und MCP-Server lassen sich so gar nicht übertragen).

### 3.12 Auto-Merge ist Fundament, kein PR je Issue

Die Backstube soll Sprints und Backlogs umsetzen, nicht Branches abliefern. Ein PR je Issue verlagert die eigentliche Integrationsarbeit auf den Menschen, und zwar in der ungünstigsten Form: Dutzende Branches vom selben alten Stand, Konflikte untereinander, abhängige Issues ohne die Arbeit ihrer Vorgänger. Integration ist deshalb Teil jeder Phase-Folge, die Code ändert. Ein Issue ist erst fertig, wenn es integriert ist. Die menschliche Kontrolle verschiebt sich vom Durchsehen jedes Diffs auf drei Hebel, die skalieren: deterministisches `verify`, ein unabhängiges Agent-Review und gezielte Freigaben (`backstube.merge: manual`, `gates.sprint`). Dazu kommen die Notbremse und `revert`. Verworfen: PR je Issue mit Merge durch den Menschen; PR je Issue mit GitHub-Auto-Merge als Standard (bindet die Fabrik an GitHub und ihre Geschwindigkeit an die CI, bleibt aber als Adapter erhalten, §2.6.4).

### 3.13 Serielle Merge-Queue, Squash, Trunk als Default

- **Seriell:** Jeder Merge wird auf der aktuellen Spitze verifiziert, der Ziel-Branch bleibt nach jedem Schritt grün. Paralleles Verifizieren mehrerer Issues mit Bisektion bei Rot ist schneller, aber komplizierter; es lohnt sich erst, wenn die Queue nachweislich zum Flaschenhals wird (§4.2).
- **Squash:** Ein Commit je Issue mit Trailer `Backe-Issue` macht `revert` und die Zuordnung Code ↔ Issue trivial. Wer die einzelnen Commits braucht, stellt `merge.strategy` um.
- **Trunk als Default:** Abhängige Issues sehen die Arbeit ihrer Vorgänger sofort, und es gibt keinen zweiten, großen Merge am Sprint-Ende. Der Sprint-Branch ist die Option für alle, die eine Freigabe pro Sprint wollen, bevor etwas den Hauptzweig erreicht.

## 4. Was offen bleibt

### 4.1 Offene Entscheidungen

- **Remote Control aus einem Skript starten.** Wie wird eine interaktive Session mit initialem Prompt und aktiver Remote Control ohne Handarbeit gestartet, und benachrichtigt die App bei solchen Sessions genauso? Wird in F1 als Erstes geprüft. Kipp-Punkt: Geht es nicht, rückt Stufe 2 vor Stufe 1, und `headless` wird der Default.
- **Benachrichtigung ab Stufe 2.** Optionen:
  - (a) **Relay-Session:** Die Backstube startet je neuer Entscheidung eine kurze Remote-Control-Session, die die Vorlage zeigt und die Antwort zurückschreibt. Bequem, aber die Antwort signiert dann ein Agent, nicht der Mensch. Das verträgt sich nur mit BK §2.25, wenn der Kommentar die Herkunft ausweist (etwa »weitergeleitet für spw aus Session …«).
  - (b) **Externer Push** (Mail, Messenger, ggf. Hermes-Gateway) mit Link; die Antwort gibt der Mensch per `backe`.
  - (c) **GitHub-Brücke** (BK §4.2): Entscheidungen als GitHub-Issues, Antworten dort.
  
  Vorschlag: (a). Kipp-Punkt: Wiegt Zurechenbarkeit schwerer als Bequemlichkeit, dann (c).
- **Vertrauen und MCP-Freigabe in frischen Worktrees** (§2.5.3, Punkt 6): Kandidaten sind die Vorab-Freigabe des Verzeichnisses in der Claude-Code-Konfiguration und eine Settings-Datei, die die Projekt-MCP-Server des Repos ausdrücklich freigibt. Muss in F1 mit der aktuellen Claude-Code-Version geprüft werden. Kipp-Punkt: Geht es nur über das pauschale Abschalten der Abfragen, beschränkt sich die Backstube auf Repos, die der Mensch per `repos.<name>` ausdrücklich freigegeben hat.
- **Kontext aus `--add-dir`:** Ob und welche `CLAUDE.md`, Skills und MCP-Konfigurationen Claude Code aus zusätzlichen Verzeichnissen lädt, ist zu prüfen. Bis dahin gelten weitere Repos nur als lesbarer Code, nicht als Kontext.
- **Modell je Phase** (etwa das stärkste Modell für `spec` und `review`, ein schnelleres für `build`): nur Konfiguration, entschieden wird nach Messung in F1.
- **Ort des Codes:** eigenes Repo `spearwolf/backstube` oder ein Paket in diesem Repo. Vorschlag: eigenes Repo. `backe` bleibt ein Werkzeug und wird kein Framework; der Vertrag zwischen beiden ist das CLI (§3.3).

### 4.2 Späterer Ausbau

- **Mehrere Hosts:** Lease in `backe` als Wunsch an BK, etwa `claimed_at` am Issue, `issue claim --renew` als Heartbeat und eine abgelaufene Lease als claimbar. Bedingung: ein zweiter Host im Betrieb.
- **`next` mit `--prop`-Filter** als Wunsch an BK, damit Triage- und Review-Queues ohne Umweg über `issue list` claimbar werden.
- **Batch-Merges in der Queue:** mehrere Issues gemeinsam rebasen und verifizieren, bei Rot bisektieren. Bedingung: Issues warten im Mittel länger in der Queue, als ihr Verify dauert.
- **CI als Verify** über Status-Checks des Code-Hosts, zusätzlich zu oder statt der lokalen `verify`-Kommandos.
- **Kosten je Issue** (Tokens, Laufzeit) als Property, damit sich »lohnt sich die Fabrik für diese Art Issue?« beantworten lässt.
- `watch`-Liste ins Backlog, sobald es mehr als einen Host gibt (§3.9).

## 5. Tests

- **Reconcile tabellengetrieben:** jede Regel aus §2.8 als Fall `Snapshot → Aktionen`, inklusive Neustart der Backstube mitten in jeder Phase.
- **Workflows und Arbeitsverzeichnis tabellengetrieben:** Auflösung von Workflow (Issue, `watch`, global) und Phase, Rücksprung bei »changes«, Wechsel des Workflows; Auflösung von Haupt-Repo, Modus, `backstube.dir`, `local_files` und `add_dirs`, inklusive fehlender lokaler Pfade und `repo: none`.
- **Merge-Queue gegen echte Git-Repos** (lokaler Bare-Remote): Konflikt → `integrate` → erneutes Review → Merge; rotes Verify; abgelehnter Push durch einen parallelen Push von Hand; Abbruch des Jobs nach dem Push und Wiederaufnahme ohne Doppel-Commit; `revert` mit und ohne abhängige Issues.
- **Property-Based** (fast-check, wie in `backe`): Für beliebige Snapshots gibt es nie zwei Sessions für dasselbe Issue, nie mehr Sessions als Slots, und jedes Issue eines Slots auf `in_progress` hat danach eine lebende Session oder eine Recovery-Aktion, je Repo läuft höchstens eine Session im Modus `repo`, je Queue höchstens ein Merge-Job, und jedes `done`-Issue mit Code-Workflow hat einen Commit im Ziel-Branch, der vom Ziel-Branch aus erreichbar ist.
- **E2E gegen echtes `backe`** mit lokalem Hub (BK §2.16.1) und einer Fake-Runtime, deren Worker die `backe`-Writes des Vertrags skriptgesteuert ausführen: ein Issue durch alle Phasen bis in den Ziel-Branch, zwei abhängige Issues in Folge, eine Rückweisung im Review, ein Absturz, eine Rückfrage (Stufe 2), ein Veto (Stufe 3).
- **Skill-Vertrag:** ein Sandbox-Repo mit einem kleinen Issue, das ein echter Headless-Worker bearbeitet. Nightly und manuell, nicht in der CI: zu teuer und nicht deterministisch.

## 6. Umsetzung in Schritten

| Schritt | Inhalt | Fertig, wenn |
| --- | --- | --- |
| **F1 — MVP** | Config, `doctor`, Identitäten, Reconcile und Dispatch, Runtime `remote-control`, Skill `backstube-worker` mit `questions: interactive`, Workflows `superpowers`, `direct` und `task`, Arbeitsverzeichnis nach §2.5.3 samt `local_files` und Vertrauensfreigabe, Merge-Queue mit `verify`, Squash und Ziel `default`, Phase `integrate`, `pause` und `revert`, `status`, `plan`, `queue` und `workflows` | Ein Sprint mit mindestens drei Issues, davon eines per `depends_on` abhängig und zwei mit Überschneidung in denselben Dateien, landet vollständig im Ziel-Branch, ohne einen einzigen Merge von Hand; der Mensch hat dafür nur am Handy Fragen beantwortet. Ein `direct`-Issue kommt ohne Spec und Plan in den Ziel-Branch; eine `task`-Session nutzt einen repo-lokalen Skill und einen Projekt-MCP-Server |
| **F2 — Fragen als Issues** | `questions: issues`, Batch-Protokoll, Wiedereinstieg, Runtime `headless`, Benachrichtigung nach §4.1 | Eine Rückfrage blockiert nur ihr Issue, nicht ihren Slot, und die Antwort steht als Entscheidung im Backlog |
| **F3 — Triage** | `bs-triage`, Quellen, Pflicht-Eskalation, Veto, Veto-Quote | Über zwei Wochen Betrieb landen messbar weniger Fragen beim Menschen, bei einer Veto-Quote, die der Mensch akzeptiert |
| **F4 — Rundum** | Ziel `sprint` mit `gates.sprint`, `merge.via: github-pr`, Batch-Merges, CI als Verify, Kosten je Issue, mehrere Hosts nach BK-Lease | je Punkt aus §4.2 |

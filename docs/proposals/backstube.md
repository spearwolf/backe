# Backstube — Software-Factory auf `backe`

> **Status: Entwurf.** Noch nicht umgesetzt; offene Entscheidungen in §4.1.
> Bezug: baut auf BK auf (`backe.md`), vor allem BK §2.6 (Zustandsmodell), §2.16.5 (Claim), §2.22–§2.24 (Bereitschaft, Sub-Issues, Properties) und §2.25 (Entscheidungen als Issues).

## 0. Problem & Abgrenzung

### 0.1 Problem

Ein `backe`-Backlog enthält Arbeit, die Coding-Agents erledigen können. Heute startet ein Mensch jede Session von Hand: Er wählt das Issue, öffnet den Worktree, ruft den passenden Superpowers-Skill auf und reicht den Kontext durch. Die Arbeit des Menschen besteht damit zum größten Teil aus Disposition, nicht aus Entscheidungen.

Die **Backstube** übernimmt die Disposition. Sie überwacht freigegebene Sprints und Projekte, zieht bereite Issues, lässt jedes davon phasenweise von Claude-Code-Sessions mit den Superpowers-Skills bearbeiten (Spec → Plan → Build → Review → PR) und holt den Menschen nur dort dazu, wo er gebraucht wird: bei Rückfragen, bei optionalen Freigaben und beim Merge.

Der Name: In der Backstube wird gebacken (BK, »Der Name«).

### 0.2 Ziele

- Ein deterministischer Orchestrator. Welches Issue als Nächstes dran ist und welche Session läuft, entscheidet Code anhand des Backlog-Zustands, kein Sprachmodell (§3.1).
- Jede Session bearbeitet genau eine Phase eines Issues und hinterlässt ihr Ergebnis in `backe` und im Branch. Sessions sind damit austauschbar, und ein Absturz kostet höchstens eine Phase (§3.4).
- Jede Rückfrage erreicht den Menschen mit einer Benachrichtigung auf dem Handy. In Stufe 1 bleiben die Rückfragen interaktiv in der Session (§2.8.1), ab Stufe 2 werden sie zu Issues (§2.8.2), und in Stufe 3 sortiert eine Triage vor, was wirklich nur der Mensch entscheiden kann (§2.8.3).
- Jeder Write ist einer Rollen-Identität zurechenbar (BK §2.12): Orchestrator, Worker-Slot, Reviewer, Triage.
- Superpowers wird unverändert genutzt. Die Anpassungen an den Factory-Betrieb liegen in einem eigenen Skill, der davor sitzt (§2.6).

### 0.3 Nicht-Ziele (erste Version)

- Kein Auto-Merge und kein Deploy. Der Merge eines PRs bleibt beim Menschen.
- Ein Host. Mehrere Backstuben auf demselben Backlog sind späterer Ausbau (§4.2).
- Kein Agent-Framework als Runtime, auch nicht Hermes (§3.2).
- Keine Änderung am `backe`-Kern als Voraussetzung (§3.5). Wünsche an BK stehen in §4.2.
- Keine eigene UI. Der Mensch arbeitet mit der Claude-App und dem `backe`-CLI.

### 0.4 Anti-Ziele

Das Projekt ist gescheitert, auch wenn alles technisch funktioniert, wenn …

- … der Mensch täglich mehr als eine Handvoll Pings bekommt, die er ohne Nachdenken beantwortet. Solche Fragen gehören in die Triage oder in eine Regel;
- … eine Triage-Antwort Arbeit in eine Richtung lenkt, ohne dass das im Backlog nachvollziehbar ist;
- … man das Log eines Sprachmodells lesen muss, um zu verstehen, warum die Backstube Issue X gestartet hat;
- … ein Issue nach einem Absturz still auf `in_progress` liegen bleibt.

## 1. Ist-Zustand

- **`backe` 0.3** liefert die Bausteine: synchroner Claim mit genau einem Gewinner (BK §2.16.5), `next --ready`-Semantik samt `depends_on` und Sub-Issues (BK §2.22, §2.23), `blocked`/`resume` und `issue list --unblockable` (BK §2.6), deklarierte Properties (BK §2.24), atomare Batches (BK §2.16.6) und das Muster »Entscheidungen sind Issues« (BK §2.25). Einen Daemon hat `backe` bewusst nicht (BK §3.8). Die Backstube ist genau dieser langlebige Prozess, nur außerhalb von `backe`.
- **Superpowers** bringt die Skills mit, die die Backstube braucht: `brainstorming`, `writing-plans`, `using-git-worktrees`, `subagent-driven-development`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `verification-before-completion` und `finishing-a-development-branch`. Sie sind **interaktiv** ausgelegt: `brainstorming` stellt dem Menschen Frage für Frage und reicht am Ende selbst an `writing-plans` weiter; `finishing-a-development-branch` fragt, ob gemergt, ein PR geöffnet, der Branch behalten oder verworfen werden soll. Spec und Plan landen als Dateien im Code-Repo (`docs/superpowers/specs/`, `docs/superpowers/plans/`), so auch in diesem Repo.
- **Claude Code** läuft interaktiv oder headless (`claude -p`). Über Remote Control ist eine lokale interaktive Session in der Claude-App erreichbar, auch auf dem Handy, mitsamt Benachrichtigung, sobald sie auf Eingabe wartet. Eine Headless-Session hat keinen Rückkanal zum Menschen.

## 2. Soll-Zustand

### 2.1 Überblick

```
             ┌──────────────── backe CLI --format json ────────────────┐
             ▼                                                          │
   backe-Backlog (Git)                                    Backstube (Loop, deterministisch)
     ▲          ▲                                           │ spawn / reap │ Session-Tabelle
     │          │ signierte Writes (State, Props, Kommentare)▼              ▼
     │          └──────────── Worker-Session: Claude Code, eine Phase, eigener Worktree
     │                          └─ Skill backstube-worker → Superpowers-Skills
     │
     └── Mensch: Claude-App (Stufe 1) · backe CLI (ab Stufe 2) · Merge des PRs
```

**`backe` ist der Bus.** Worker melden ihr Ergebnis ausschließlich über `backe`-Writes und über den Branch. Die Backstube liest nur das Backlog und ihre eigene Session-Tabelle; Session-Ausgaben parst sie nie. Damit ist jeder Zustand der Fabrik im Backlog sichtbar, und ein Neustart der Backstube verliert nichts (§2.7, Punkt 2.7).

### 2.2 Rollen und Identitäten

Alle Rollen sind Agent-Identitäten mit dem Menschen als `operator`, angelegt per `backe user create-agent` (BK §2.12).

| Handle | Rolle | Schreibt |
| --- | --- | --- |
| `backstube` | Orchestrator | `resume`, Recovery-Moves, Zähler und Status bei Abstürzen, `on_hold` bei erschöpftem Budget |
| `bs-w1` … `bs-wN` | Worker-Slots | Claim (`next --claim --as bs-wK`), Ergebnisse der Phasen `spec`, `plan`, `build`, `ship` |
| `bs-review` | Reviewer | Urteil der Phase `review` |
| `bs-triage` | Triage (Stufe 3) | Antworten oder Eskalationen auf Fragen |

**Slot gleich Identität.** Der Assignee eines Issues sagt, welcher Slot es hält. Darüber gleicht die Backstube Issues mit laufenden Sessions ab, ohne eigene Lease (§3.5). Die Zahl der Keys bleibt dadurch auf die Zahl der Slots begrenzt. Ein Slot kann mehrere Issues halten (eins in Arbeit, weitere in `review`, `blocked` oder beim Warten auf den Merge), aber nur eine Session gleichzeitig. Die Kapazität zählt Sessions, nicht Issues. Dass `backe next` das eigene laufende Issue zuerst liefert (BK §2.22), passt zur Regel »erst fertig machen, dann neu anfangen« (§2.7, Punkt 3).

### 2.3 Konfiguration

Host-lokal unter `~/.backstube/config.jsonc` (§3.9):

```jsonc
{
  "backlog": "acme",
  "watch": [                          // Reihenfolge = Priorität beim Dispatch
    { "sprint": "2026-w48" },
    { "project": "web/auth", "level": "top" }   // level wie bei backe next (BK §2.23)
  ],
  "slots": ["bs-w1", "bs-w2"],
  "reviewer": "bs-review",
  "triage": null,                     // Stufe 3: "bs-triage"
  "questions": "interactive",         // interactive (Stufe 1) | issues (ab Stufe 2)
  "human": "spw",                     // Empfänger von Entscheidungen
  "gates": { "plan": false },         // Plan-Freigabe durch den Menschen (§2.5)
  "runtime": { "kind": "remote-control" },      // remote-control | headless (§2.9)
  "worktrees": "~/.backstube/worktrees",
  "limits": { "attempts": 2, "phase_timeout_min": 240, "tick_s": 60 },
  "session_title": "{id} · {phase} · {title}"
}
```

**Opt-in:** Die Backstube fasst nur Issues an, die einem `watch`-Eintrag entsprechen und `repos` gesetzt haben. Ein Issue ohne Repo bekommt einen Kommentar und geht auf `on_hold`. Einzelne Issues lassen sich per `backstube.skip: true` ausnehmen.

### 2.4 Properties

Deklariert in `backlog.jsonc` (BK §2.24), alle unter dem Präfix `backstube.`:

| Property | Typ | Bedeutung | Setzt |
| --- | --- | --- | --- |
| `backstube.phase` | enum `spec`, `plan`, `build`, `review`, `ship` | aktuelle Phase; fehlt sie, gilt `spec` | Worker beim Abschluss; Mensch beim Anlegen, um später einzusteigen (ein Bug mit klarem Repro startet in `plan`, ein Chore in `build`) |
| `backstube.status` | enum `running`, `waiting`, `done`, `failed`, `stalled` | Zustand der Phase | `running`: Backstube beim Start; `done`, `failed`, `waiting`: Worker; `stalled`: Backstube bei Timeout |
| `backstube.attempts` | integer | gescheiterte Versuche der aktuellen Phase | Backstube |
| `backstube.session` | string | Session-Name bzw. Link zur Remote-Control-Session | Backstube |
| `backstube.pr` | string | URL des PRs | Worker in `ship` |
| `backstube.gate` | enum `none`, `plan` | überschreibt `gates.plan` für dieses Issue | Mensch |
| `backstube.skip` | boolean | Issue nicht anfassen | Mensch |
| `backstube.asked_by` | string | ab Stufe 2: Issue, dessen Arbeit die Frage gestellt hat | Worker |
| `backstube.route` | enum `answered`, `escalated`, `invalid` | Stufe 3: Ergebnis der Triage | Triage |

Den Branch trägt das eingebaute Feld `repos` (`webapp@backstube/bk-7f3k2`). `kind` (`question`, `decision`) folgt der Konvention aus BK §2.25 und wird nicht als Enum deklariert, weil die Audit-Skills `kind` mit eigenen Werten belegen.

### 2.5 Lebenszyklus eines Issues

| Phase | Identität | Superpowers-Skills | Artefakt | Erfolg → |
| --- | --- | --- | --- | --- |
| `spec` | Slot | `brainstorming` | Spec unter `docs/superpowers/specs/` im Branch, Kurzfassung als Kommentar | `plan` |
| `plan` | Slot | `writing-plans` | Plan unter `docs/superpowers/plans/` im Branch | `build`, bei aktivem Gate erst nach der Freigabe |
| `build` | Slot | `subagent-driven-development` (darin `test-driven-development`), `systematic-debugging`, `verification-before-completion` | Commits im Branch | `review`; State → `review` |
| `review` | `bs-review` | `requesting-code-review`, `verification-before-completion` | Urteil als Kommentar | »approve« → `ship`; »changes« → `build`, State → `in_progress` |
| `ship` | Slot | `finishing-a-development-branch`, Option »Push + PR« fest vorgegeben | PR, `backstube.pr` | wartet auf den Merge |

- **States:** Der Claim setzt `in_progress` (BK §2.16.5); `spec`, `plan` und `build` laufen darin. `build` endet mit `review`. Eine Rückweisung im Review geht zurück auf `in_progress`, das erlaubt die Hauptlinie ohne `workflow.strict` (BK §2.6). Nach `ship` bleibt das Issue auf `review`, bis der Mensch den PR merged und `done` setzt. Die automatische Erkennung des Merges ist Stufe 4.
- **Worktree:** Beim Start von `spec` legt die Backstube `git worktree add <worktrees>/<id> -b backstube/<id> <default_ref>` im Clone an, den `backe repo where` liefert, und verknüpft den Branch per `backe issue link`. Alle Phasen arbeiten im selben Worktree. Spec und Plan liegen dort als Dateien; jede neue Session findet so die Arbeit der vorigen. Nach `done`, `cancelled` oder `rejected` räumt die Backstube den Worktree ab, den Branch nur nach einem Merge.
- **Review-Unabhängigkeit:** Der Reviewer ist eine eigene Identität in einer frischen Session. Er sieht Spec, Plan und Diff, aber nicht den Verlauf der Build-Session.
- **Plan-Gate:** Ist das Gate aktiv, stellt die `plan`-Session am Ende die Frage »Plan freigeben?« mit den Optionen Freigeben, Überarbeiten (mit Hinweis) und Abbrechen. Das Gate ist eine gewöhnliche Rückfrage und folgt dem Modus aus `questions` (§3.8).

### 2.6 Der Worker-Vertrag: Skill `backstube-worker`

Die Backstube startet jede Session mit einem minimalen Prompt: »Worker der Backstube. Issue `<id>`, Phase `<phase>`. Lade den Skill `backstube-worker`.« Den eigentlichen Vertrag trägt der Skill. So bleibt er versioniert und testbar, und Prompts in der Backstube bleiben dünn.

1. **Kontext laden:** `backe issue show <id> --comments --format json`, dazu Spec und Plan im Worktree. Beim Wiedereinstieg nach einer Rückfrage zusätzlich die Antworten an den Issues aus dem letzten `blocked_by`.
2. **Genau eine Phase.** Kein Vorgreifen. Das betrifft vor allem `brainstorming`, das von sich aus an `writing-plans` weiterreicht: Im Factory-Betrieb endet die Phase mit der committeten Spec.
3. **Entscheidungspunkte der Superpowers-Skills übersteuern:** `using-git-worktrees` entfällt, denn der Worktree existiert schon. `finishing-a-development-branch` wählt immer »Push + PR«. Der Default-Branch wird nie angefasst.
4. **Abschluss als ein Batch** (BK §2.16.6): Ergebnis-Kommentar, `backstube.phase` = nächste Phase, `backstube.status: done`, gegebenenfalls der State-Move. Atomar, damit die Backstube nie einen halben Abschluss sieht.
5. **Scheitern:** `backstube.status: failed` plus Kommentar mit Grund und letztem Stand. Kein State-Move, die Wiederholung entscheidet die Backstube.
6. **Nie:** fremde Issues claimen oder ändern (Ausnahme: Fragen anlegen, §2.8.2), mergen, eigene Phasen überspringen.
7. **Rückfragen** nach dem Modus aus `questions` (§2.8). In Stufe 1 hält der Ergebnis-Kommentar zusätzlich jede gestellte Frage samt Antwort fest. Was am Handy entschieden wurde, landet so trotzdem im Backlog.

### 2.7 Die Schleife

Alle `tick_s` Sekunden:

1. `backe sync`, dann ein **Snapshot**: die beobachteten Issues (`issue list --format json` je `watch`-Eintrag, dazu alle Issues mit Assignee aus `slots`, `reviewer` und `triage`), die Session-Tabelle und die laufenden Sessions der Runtime.
2. **Reconcile.** Eine reine Funktion `(Snapshot, jetzt) → Aktionen`:
   1. **Mensch hat Vorrang:** Ein Issue mit laufender Session steht auf `on_hold`, `cancelled` oder `rejected` oder hat `backstube.skip` → Session beenden.
   2. **Phase beendet:** `backstube.status` ist `done`, `failed` oder `waiting`, die Session lebt noch → Session beenden.
   3. **Absturz:** `backstube.status: running`, aber keine lebende Session → `attempts + 1`, `status: failed`. Den Neustart erledigt Schritt 3.
   4. **Budget erschöpft:** `status: failed` mit `attempts ≥ limits.attempts` → `on_hold` mit Begründung. Ab Stufe 2 stattdessen eine Entscheidung »Phase X scheitert wiederholt« an `human`, das Issue geht auf `blocked`.
   5. **Entsperrt:** Ein beobachtetes Issue steht in `issue list --unblockable` → `backe issue resume <id>` als `backstube`.
   6. **Timeout:** `status: running` länger als `phase_timeout_min` → `status: stalled`. Die Session bleibt am Leben, denn in Stufe 1 lässt sich ein Hänger nicht von einem Menschen unterscheiden, der noch nicht geantwortet hat. `backstube status` zeigt das Issue an, der Mensch entscheidet.
   7. **Neustart der Backstube:** Ein Issue gehört einem Slot und steht auf `running`, die Session-Tabelle kennt es aber nicht → per Session-Name (`bs-<id>-<phase>`) in der Runtime suchen und übernehmen, sonst gilt Punkt 3.
3. **Dispatch.** Erst fertig machen, dann neu anfangen:
   1. Issues in Arbeit, deren Phase `done` oder `failed` (mit Restbudget) ist und die keine Session haben → nächste bzw. dieselbe Phase im selben Slot starten. Ist die nächste Phase `review`, übernimmt `bs-review`, sofern frei.
   2. Freie Slots → `backe next --claim --as <slot>` je `watch`-Eintrag in Reihenfolge, gefiltert um `backstube.skip`; Worktree anlegen, Phase aus `backstube.phase` starten.
4. Aktionen ausführen, Session-Tabelle schreiben.

Die **Session-Tabelle** (`~/.backstube/state.json`: Issue, Slot, Phase, Session-Name, Startzeit, Link) ist nur ein Cache. Sie lässt sich aus Backlog und Runtime vollständig wieder aufbauen, weil Session-Namen die Issue-ID tragen.

### 2.8 Rückfragen

#### 2.8.1 Stufe 1: interaktiv über Remote Control

Jede Worker-Session ist interaktiv und per Remote Control erreichbar (§2.9). Superpowers fragt, wie es das immer tut; der Mensch bekommt die Benachrichtigung aufs Handy und antwortet direkt in der Claude-App. Der Session-Titel trägt ID, Phase und Titel des Issues, `backstube.session` den Link.

Das bringt viel und kostet wenig: Superpowers bleibt unverändert, und `brainstorming` funktioniert in voller Qualität. Dazu sammelt die Stufe echtes Material darüber, welche Fragen Agents tatsächlich stellen, und das ist die Grundlage für die Regeln der Triage. Die Kosten: Ein wartender Worker hält seinen Slot, Fragen lassen sich nicht bündeln oder vorsortieren, und die Antwort existiert im Backlog nur, weil der Worker-Vertrag sie in den Ergebnis-Kommentar schreibt (§2.6, Punkt 7).

#### 2.8.2 Stufe 2: Rückfragen als Issues

Mit `questions: "issues"` übersteuert `backstube-worker` jede Stelle, an der ein Superpowers-Skill den Menschen fragen würde:

1. **Sammeln statt tröpfeln:** Der Worker sammelt alle Fragen, die die Phase gerade blockieren, statt sie einzeln zu stellen. Jede bekommt das Format der Entscheidungsvorlage aus BK §2.25: Frage, Auslöser, zwei bis drei Optionen mit Folgen, markierter Vorschlag, Kipp-Punkt.
2. **Zwischenstand sichern:** Der Spec- oder Plan-Entwurf wird im Branch committet, eine Kurzfassung kommt als Kommentar ans Issue.
3. **Ein Batch:** je Frage ein `issue.create` mit `kind: decision`, Assignee `human`, `backstube.asked_by: <id>`, Projekte und Sprints wie beim Arbeits-Issue; dazu `issue.move` des Arbeits-Issues nach `blocked` mit `blocked_by` auf die neuen Platzhalter und `backstube.status: waiting`. Die Backstube beendet die Session (§2.7, Punkt 2.2) und gibt den Slot frei.
4. **Antwort:** Der Mensch antwortet wie in BK §2.25, also mit einem Kommentar, `props.decision.chosen` und `done`.
5. **Wiedereinstieg:** Sind alle Fragen erledigt, findet die Backstube das Issue über `--unblockable`, setzt es per `resume` fort und startet dieselbe Phase neu. Der Worker liest Zwischenstand und Antworten (§2.6, Punkt 1).

`brainstorming` braucht so eventuell zwei bis drei Runden statt eines Dialogs. Das ist der Preis dafür, dass jede Frage adressierbar wird; erst damit lässt sich etwas zwischen Frage und Mensch schalten. Wie der Mensch in dieser Stufe von neuen Entscheidungen erfährt, ist offen (§4.1).

#### 2.8.3 Stufe 3: Triage

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

### 2.9 Session-Runtime

Schnittstelle: `spawn(slot, issue, phase, prompt, cwd) → handle`, `alive(handle)`, `kill(handle)`, `link(handle)`.

- **`remote-control`** (Stufe 1, Default): eine interaktive Claude-Code-Session in einer tmux-Session `bs-<id>-<phase>`, Arbeitsverzeichnis = Worktree, Remote Control aktiv, `BACKE_USER=<slot>`. Die Session läuft lokal, weil der Worker `backe`-Commits signiert: Der private Key des Slots liegt auf dem Host (BK §2.12) und gehört in keinen Cloud-Container.
- **`headless`** (ab Stufe 2, optional): `claude -p` ohne Rückkanal, nur zulässig mit `questions: "issues"`. Ohne TTY und ohne wartende Sessions, also billiger im Betrieb.
- **Voraussetzungen auf dem Host:** Superpowers und `backstube-worker` sind installiert. Die Worker brauchen eine Permission-Allowlist für Tests, Git und `backe`, sonst wird jede Freigabe zum Ping aufs Handy und verletzt das erste Anti-Ziel. Die Backstube übergibt sie als Settings-Datei beim Start und schreibt nichts in das Code-Repo.

### 2.10 Kommandos

| Kommando | Zweck |
| --- | --- |
| `backstube run` | die Schleife im Vordergrund; Betrieb als systemd-User-Unit |
| `backstube tick` | genau ein Durchlauf, für Tests und Cron |
| `backstube plan` | Trockenlauf: die Aktionen des nächsten Ticks, ohne sie auszuführen. Fällt aus dem reinen Reconcile ab |
| `backstube status` | Slots, Sessions, Phasen, Links, `stalled`-Issues |
| `backstube kick <id> [--phase <p>]` | Phase von Hand starten oder zurücksetzen, `attempts` auf 0 |
| `backstube doctor` | Identitäten und Keys, deklarierte Properties, `backe`-Version, tmux, Claude Code, Skills, Remote Control |

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

Ein abgestürzter Worker hinterlässt ein Issue auf `in_progress`. Auf einem Host erkennt die Backstube das ohne Hilfe von `backe`: Der Assignee ist ein Slot, und die Runtime weiß, ob dessen Session lebt (§2.7, Punkte 2.3 und 2.7). Eine Lease mit Ablaufzeit braucht es erst, wenn mehrere Backstuben dasselbe Backlog bedienen und keine die Sessions der anderen sieht. Das ist ein Wunsch an BK für später (§4.2).

### 3.6 Rückfragen in Stufen

Stufe 1 zuerst, weil sie Superpowers unverändert lässt, am schnellsten trägt und das Material liefert, aus dem die Triage-Regeln entstehen. Stufe 2 ist Voraussetzung für Stufe 3: Eine Frage, die nur in einer Session existiert, ist nicht adressierbar, also kann niemand sie abfangen, bündeln oder vorbeantworten.

### 3.7 `kind: decision` nur für menschliche Entscheidungen

Invariante: `kind: decision` ⇔ Assignee ist ein Mensch ⇔ die Antwort gilt als Regel. Fragen, die die Triage beantwortet, bleiben `kind: question`. Damit bleibt die Regelbasis sauber, und die Triage kann sich nicht selbst Präzedenzfälle schaffen. Verworfen: ein gemeinsames `kind` mit einem Feld »beantwortet von« (eine Abfrage mehr bei jeder Regelsuche, und vergessen wird sie bestimmt).

### 3.8 Das Plan-Gate ist eine Rückfrage

Kein eigener Freigabe-Mechanismus: Das Gate nutzt denselben Kanal wie jede andere Frage, in Stufe 1 interaktiv, ab Stufe 2 als Entscheidung. In Stufe 3 eskaliert die Triage ein Gate immer, weil eine Freigabe per Definition Sache des Menschen ist.

### 3.9 Host-Config statt Backlog-Config

Slots, Runtime, Timeouts und Worktree-Pfade sind Betriebsparameter eines Hosts, nicht Inhalt des Backlogs. Die `watch`-Liste wäre im Backlog für alle sichtbar; das spräche dafür, sie dort abzulegen. In der ersten Version bleibt sie trotzdem lokal, weil es nur einen Host gibt.

## 4. Was offen bleibt

### 4.1 Offene Entscheidungen

- **Remote Control aus einem Skript starten.** Wie wird eine interaktive Session mit initialem Prompt und aktiver Remote Control ohne Handarbeit gestartet, und benachrichtigt die App bei solchen Sessions genauso? Wird in F1 als Erstes geprüft. Kipp-Punkt: Geht es nicht, rückt Stufe 2 vor Stufe 1, und `headless` wird der Default.
- **Benachrichtigung ab Stufe 2.** Optionen:
  - (a) **Relay-Session:** Die Backstube startet je neuer Entscheidung eine kurze Remote-Control-Session, die die Vorlage zeigt und die Antwort zurückschreibt. Bequem, aber die Antwort signiert dann ein Agent, nicht der Mensch. Das verträgt sich nur mit BK §2.25, wenn der Kommentar die Herkunft ausweist (etwa »weitergeleitet für spw aus Session …«).
  - (b) **Externer Push** (Mail, Messenger, ggf. Hermes-Gateway) mit Link; die Antwort gibt der Mensch per `backe`.
  - (c) **GitHub-Brücke** (BK §4.2): Entscheidungen als GitHub-Issues, Antworten dort.
  
  Vorschlag: (a). Kipp-Punkt: Wiegt Zurechenbarkeit schwerer als Bequemlichkeit, dann (c).
- **Modell je Phase** (etwa das stärkste Modell für `spec` und `review`, ein schnelleres für `build`): nur Konfiguration, entschieden wird nach Messung in F1.
- **Ort des Codes:** eigenes Repo `spearwolf/backstube` oder ein Paket in diesem Repo. Vorschlag: eigenes Repo. `backe` bleibt ein Werkzeug und wird kein Framework; der Vertrag zwischen beiden ist das CLI (§3.3).

### 4.2 Späterer Ausbau

- **Mehrere Hosts:** Lease in `backe` als Wunsch an BK, etwa `claimed_at` am Issue, `issue claim --renew` als Heartbeat und eine abgelaufene Lease als claimbar. Bedingung: ein zweiter Host im Betrieb.
- **`next` mit `--prop`-Filter** als Wunsch an BK, damit Triage- und Review-Queues ohne Umweg über `issue list` claimbar werden.
- **Merge-Erkennung** per `gh pr view` → `done`; **CI-Ergebnis** des PRs als Rückkanal in die Phase `build`.
- **Kosten je Issue** (Tokens, Laufzeit) als Property, damit sich »lohnt sich die Fabrik für diese Art Issue?« beantworten lässt.
- `watch`-Liste ins Backlog, sobald es mehr als einen Host gibt (§3.9).

## 5. Tests

- **Reconcile tabellengetrieben:** jede Regel aus §2.7 als Fall `Snapshot → Aktionen`, inklusive Neustart der Backstube mitten in jeder Phase.
- **Property-Based** (fast-check, wie in `backe`): Für beliebige Snapshots gibt es nie zwei Sessions für dasselbe Issue, nie mehr Sessions als Slots, und jedes Issue eines Slots auf `in_progress` hat danach eine lebende Session oder eine Recovery-Aktion.
- **E2E gegen echtes `backe`** mit lokalem Hub (BK §2.16.1) und einer Fake-Runtime, deren Worker die `backe`-Writes des Vertrags skriptgesteuert ausführen: ein Issue durch alle Phasen, eine Rückweisung im Review, ein Absturz, eine Rückfrage (Stufe 2), ein Veto (Stufe 3).
- **Skill-Vertrag:** ein Sandbox-Repo mit einem kleinen Issue, das ein echter Headless-Worker bearbeitet. Nightly und manuell, nicht in der CI: zu teuer und nicht deterministisch.

## 6. Umsetzung in Schritten

| Schritt | Inhalt | Fertig, wenn |
| --- | --- | --- |
| **F1 — MVP** | Config, `doctor`, Identitäten, Worktrees, Reconcile und Dispatch, Runtime `remote-control`, Skill `backstube-worker` mit `questions: interactive`, Phasen `spec` bis `ship`, `status` und `plan` | Ein Issue in einem beobachteten Sprint endet als PR, und der Mensch hat dafür nur am Handy Fragen beantwortet |
| **F2 — Fragen als Issues** | `questions: issues`, Batch-Protokoll, Wiedereinstieg, Runtime `headless`, Benachrichtigung nach §4.1 | Eine Rückfrage blockiert nur ihr Issue, nicht ihren Slot, und die Antwort steht als Entscheidung im Backlog |
| **F3 — Triage** | `bs-triage`, Quellen, Pflicht-Eskalation, Veto, Veto-Quote | Über zwei Wochen Betrieb landen messbar weniger Fragen beim Menschen, bei einer Veto-Quote, die der Mensch akzeptiert |
| **F4 — Rundum** | Merge-Erkennung, CI-Rückkanal, Kosten je Issue, mehrere Hosts nach BK-Lease | je Punkt aus §4.2 |

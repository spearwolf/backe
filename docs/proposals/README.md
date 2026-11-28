# Proposals

Verbindliche Spezifikation, eine Datei je Domain. Der Status jedes Proposals
steht in seinem Kopf, nicht hier.

| Proposal | Kürzel | Zuständig für — hier gewinnt es |
| --- | --- | --- |
| [`backe.md`](./backe.md) | BK | Das gesamte `backe`-Tool: Datenmodell, Dateiformate, Signaturen, Kontext, Sync, CLI, MCP, Build und CI |
| [`backstube.md`](./backstube.md) | BS | Die Backstube (`backe loop`): Orchestrator, Workflow-Engine und Ausführungsdatenbank, Worker-Vertrag, Harness-Anbindung, Merge-Queue, Rückfragen und Triage |
| [`ui.md`](./ui.md) | UI | `backe ui`: lokale Web-Oberfläche, HTTP-API, Live-Updates, Ansichten Backlog, Board, Issue, Settings |

Ein Kürzel ist die einzige Definition und wird nie geändert oder neu vergeben.
Verweise in `docs/` und `ROADMAP.md` dürfen es nutzen (`BK §3.2`); Code, Tests
und Commit-Messages schreiben den Dateinamen.

## Vorrang

BK vor BS. BS ist der Befehl `backe loop` und nutzt den Service-Layer von BK
wie die übrigen Adapter, ohne dessen Prüfungen zu umgehen; was BS von BK
zusätzlich braucht, steht dort als Wunsch (BS §4.2) und wird erst verbindlich,
wenn BK es aufnimmt.

BK vor UI. UI ist ein Adapter über den Service-Layer wie CLI und MCP; was UI
zusätzlich braucht, steht in UI §4.2 und wird erst verbindlich, wenn BK es
aufnimmt.

BS und UI berühren sich nur im Tab Loop (UI §2.18): Was der Zustand der
Backstube bedeutet und welche Felder ihr Lesemodell trägt, regelt BS (§2.14);
wie die UI ihn überträgt und darstellt, regelt UI.

Wird `backe.md` in Domains aufgeteilt (naheliegend: Datenmodell, Signaturen &
Sync, CLI & MCP), legt dieser Abschnitt die Reihenfolge innerhalb von BK fest.

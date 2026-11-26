# Proposals

Verbindliche Spezifikation, eine Datei je Domain. Der Status jedes Proposals
steht in seinem Kopf, nicht hier.

| Proposal | Kürzel | Zuständig für — hier gewinnt es |
| --- | --- | --- |
| [`backe.md`](./backe.md) | BK | Das gesamte `backe`-Tool: Datenmodell, Dateiformate, Signaturen, Kontext, Sync, CLI, MCP, Build und CI |
| [`backstube.md`](./backstube.md) | BS | Die Backstube: Orchestrator, Worker-Vertrag, Phasen, Rückfragen und Triage auf Basis von `backe` |
| [`ui.md`](./ui.md) | UI | `backe ui`: lokale Web-Oberfläche, HTTP-API, Live-Updates, Ansichten Backlog, Board, Issue, Settings |

Ein Kürzel ist die einzige Definition und wird nie geändert oder neu vergeben.
Verweise in `docs/` und `ROADMAP.md` dürfen es nutzen (`BK §3.2`); Code, Tests
und Commit-Messages schreiben den Dateinamen.

## Vorrang

BK vor BS. BS nutzt `backe` nur über dessen CLI-Vertrag; was BS von `backe`
zusätzlich braucht, steht dort als Wunsch (BS §4.2) und wird erst verbindlich,
wenn BK es aufnimmt.

BK vor UI. UI ist ein Adapter über den Service-Layer wie CLI und MCP; was UI
zusätzlich braucht, steht in UI §4.2 und wird erst verbindlich, wenn BK es
aufnimmt. BS und UI berühren sich nicht.

Wird `backe.md` in Domains aufgeteilt (naheliegend: Datenmodell, Signaturen &
Sync, CLI & MCP), legt dieser Abschnitt die Reihenfolge innerhalb von BK fest.

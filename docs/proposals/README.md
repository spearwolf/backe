# Proposals

Verbindliche Spezifikation, eine Datei je Domain. Der Status jedes Proposals
steht in seinem Kopf, nicht hier.

| Proposal | Kürzel | Zuständig für — hier gewinnt es |
| --- | --- | --- |
| [`backe.md`](./backe.md) | BK | Das gesamte `backe`-Tool: Datenmodell, Dateiformate, Signaturen, Kontext, Sync, CLI, MCP, Build und CI |

Ein Kürzel ist die einzige Definition und wird nie geändert oder neu vergeben.
Verweise in `docs/` und `ROADMAP.md` dürfen es nutzen (`BK §3.2`); Code, Tests
und Commit-Messages schreiben den Dateinamen.

## Vorrang

Solange es nur ein Proposal gibt, entfällt die Kette. Wird `backe.md` in Domains
aufgeteilt (naheliegend: Datenmodell, Signaturen & Sync, CLI & MCP), legt dieser
Abschnitt die Reihenfolge fest.

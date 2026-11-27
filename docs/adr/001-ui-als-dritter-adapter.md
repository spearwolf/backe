# ADR-001: Die UI ist ein dritter Adapter über einen gemeinsamen Tool-Katalog

- **Status:** akzeptiert
- **Datum:** 2026-11-27
- **Bezug:** `ui.md` §2.3.2, §3.3; `backe.md` §2.19, §2.20

## Kontext

Die UI soll nichts können, was das CLI nicht kann, keine Prüfung umgehen und dieselben Commits
erzeugen (`ui.md` §0.4). Die MCP-Tools hingen am `McpServer` (`defineTool` in `src/mcp/tool.ts`)
und ließen sich von einem zweiten Adapter nicht nutzen.

## Entscheidung

Tool-Definitionen stehen adapterneutral in `src/tools/` (`ToolDef`, `TOOLS`, `toolsFor`,
`runTool`). MCP registriert `toolsFor('mcp', …)`, die UI `toolsFor('ui', …)`: gleiche Namen,
Parameter, Ergebnisse und Write-Warteschlange. Tools nur für die UI (`issue_delete`, Verwaltung
von Projekten, Sprints, Repos und Usern) sind Befehle, die das CLI schon hat.

## Alternativen

- **Eigene Endpunkte und eigene Logik der UI** — ein zweites Verhalten, das gegen CLI und MCP
  auseinanderdriftet.

## Folgen

Neue Schicht `src/tools/` zwischen `services/` und den Adaptern (`backe.md` §2.20). Paritätstests
Tool ↔ MCP ↔ CLI halten die Adapter gleich. Ein Feature nur in der UI gibt es nicht.

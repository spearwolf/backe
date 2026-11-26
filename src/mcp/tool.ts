/**
 * Anbindung des Tool-Katalogs an das MCP-SDK (backe.md §2.19) samt Fehlergrenze: Kein Fehler
 * erreicht das SDK; er wird zum Tool-Ergebnis mit `isError: true` in der Form, die die CLI im
 * JSON-Modus ausgibt.
 */
import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { errorJson } from '../services/views.ts';
import { invokeTool } from '../tools/catalog.ts';
import type { ToolDef } from '../tools/define.ts';
import type { ToolEnv } from '../tools/run.ts';

/** Erfolg als ein Textblock mit kompaktem JSON; kein `structuredContent`. `undefined` wird `null`. */
export function toolResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) ?? 'null' }] };
}

/** Fehler als `{"error":{code,message,hint?,details?}}` wie die CLI, ohne Stacktrace. */
export function toolError(err: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(errorJson(err)) }], isError: true };
}

/**
 * Registriert ein Tool des Katalogs. Die Argumente hat das SDK vor dem Aufruf gegen `def.input`
 * geprüft; alles Weitere (`check`, Kontext, Warteschlange) erledigt `invokeTool`.
 */
export function registerTool(server: McpServer, env: ToolEnv, def: ToolDef): void {
  const inputSchema: StandardSchemaWithJSON = def.input;
  server.registerTool(
    def.name,
    { description: def.description, inputSchema },
    async (args): Promise<CallToolResult> => {
      try {
        return toolResult(await invokeTool(def, env, args));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}

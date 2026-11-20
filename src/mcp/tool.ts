/**
 * Tool-Definition des MCP-Adapters (backe.md §2.19) samt Fehlergrenze: Jeder Aufruf löst den
 * Kontext neu auf, stößt den Hintergrund-Sync an wie die CLI und liefert kompaktes JSON. Kein
 * Fehler erreicht das SDK; er wird zum Tool-Ergebnis mit `isError: true` in der Form, die die CLI
 * im JSON-Modus ausgibt.
 */
import type {
  CallToolResult,
  McpServer,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { ResolvedContext } from '../context/resolve.ts';
import { scheduleSync } from '../services/background.ts';
import { errorJson } from '../services/views.ts';
import type { McpOptions } from './server.ts';

/**
 * `read`: Frische vorher wie bei einem lesenden Befehl. `write`: lokaler Write über die
 * Warteschlange, danach Hintergrund-Sync, wenn ein Commit entstand. `sync`: spricht selbst mit
 * dem Remote (Claim, `sync_now`), daher weder Warteschlange noch Nachlauf.
 */
export type ToolKind = 'read' | 'write' | 'sync';

/** Lokale Writes eines Prozesses nacheinander; ein gescheiterter hält die folgenden nicht auf. */
export type WriteQueue = { run<T>(fn: () => Promise<T>): Promise<T> };

/** Geteilt von allen `McpServer`-Instanzen eines Prozesses. */
export type ToolEnv = { context(): Promise<ResolvedContext>; opts: McpOptions; queue: WriteQueue };

export function writeQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = tail.then(fn);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

/** Erfolg als ein Textblock mit kompaktem JSON; kein `structuredContent`. */
export function toolResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** Fehler als `{"error":{code,message,hint?,details?}}` wie die CLI, ohne Stacktrace. */
export function toolError(err: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(errorJson(err)) }], isError: true };
}

/** Hat das Ergebnis eines Writes einen Commit (`commit` ist ein SHA, nicht `null`)? */
function committed(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { commit?: unknown }).commit === 'string'
  );
}

async function execute(
  env: ToolEnv,
  kind: ToolKind,
  ctx: ResolvedContext,
  run: () => Promise<unknown>,
): Promise<unknown> {
  const sync = env.opts.deps?.sync;
  if (kind === 'read') {
    await scheduleSync(ctx, 'read', sync);
    return run();
  }
  if (kind === 'sync') return run();
  const value = await env.queue.run(run);
  // Nicht abgewartet: Das Ergebnis des Writes steht fest; `scheduleSync` wirft nie.
  if (committed(value)) void scheduleSync(ctx, 'write', sync);
  return value;
}

/** Registriert ein Tool mit Fehlergrenze; `run` bekommt den frisch aufgelösten Kontext. */
export function defineTool<S extends z.ZodObject>(
  server: McpServer,
  env: ToolEnv,
  name: string,
  spec: { description: string; input: S; kind: ToolKind },
  run: (ctx: ResolvedContext, args: z.infer<S>) => Promise<unknown>,
): void {
  // Mit generischem `S` löst TypeScript den Callback-Typ des SDK nicht auf; das Schema geht daher
  // ungenerisch hinein. Die Argumente hat das SDK vor dem Aufruf gegen `spec.input` geprüft.
  const inputSchema: StandardSchemaWithJSON = spec.input;
  server.registerTool(
    name,
    { description: spec.description, inputSchema },
    async (args): Promise<CallToolResult> => {
      try {
        const ctx = await env.context();
        return toolResult(await execute(env, spec.kind, ctx, () => run(ctx, args as z.infer<S>)));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}

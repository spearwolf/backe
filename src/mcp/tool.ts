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

/**
 * Was neben der Warteschlange läuft und vor dem Ende fertig werden muss: laufende Sync-Tools und
 * die Hintergrund-Starts nach Writes, die das Tool-Ergebnis nicht abwartet. `settled` wartet, bis
 * nichts mehr läuft — auch auf das, was währenddessen dazukommt.
 */
export type Pending = { add(p: Promise<unknown>): void; settled(): Promise<void> };

/** Geteilt von allen `McpServer`-Instanzen eines Prozesses. */
export type ToolEnv = {
  context(): Promise<ResolvedContext>;
  opts: McpOptions;
  queue: WriteQueue;
  pending: Pending;
};

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

export function pendingStarts(): Pending {
  const running = new Set<Promise<unknown>>();
  return {
    add(p) {
      const done = () => {
        running.delete(p);
      };
      running.add(p);
      p.then(done, done);
    },
    async settled() {
      while (running.size > 0) await Promise.allSettled([...running]);
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
  if (kind === 'sync') {
    // Neben der Warteschlange, aber verfolgt: `close()` lässt einen laufenden Claim oder
    // `sync_now` zu Ende laufen. Ablehnungen bekommt der Aufrufer, `pending` ignoriert sie.
    const running = run();
    env.pending.add(running);
    return running;
  }
  return env.queue.run(async () => {
    const value = await run();
    // Nicht abgewartet: Das Ergebnis des Writes steht fest; `scheduleSync` wirft nie. Gemerkt
    // noch im Job, damit `close()` nach dem Leeren der Warteschlange auch darauf wartet — sonst
    // ginge der Push des letzten Writes mit dem Prozess verloren.
    if (committed(value)) env.pending.add(scheduleSync(ctx, 'write', sync));
    return value;
  });
}

/**
 * Registriert ein Tool mit Fehlergrenze; `run` bekommt den frisch aufgelösten Kontext. `kind` darf
 * von den Argumenten abhängen (`issue_next` mit `claim` ist kein Read, sondern ein Sync-Tool).
 */
export function defineTool<S extends z.ZodObject>(
  server: McpServer,
  env: ToolEnv,
  name: string,
  spec: { description: string; input: S; kind: ToolKind | ((args: z.infer<S>) => ToolKind) },
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
        const a = args as z.infer<S>;
        const kind = typeof spec.kind === 'function' ? spec.kind(a) : spec.kind;
        const ctx = await env.context();
        return toolResult(await execute(env, kind, ctx, () => run(ctx, a)));
      } catch (err) {
        return toolError(err);
      }
    },
  );
}

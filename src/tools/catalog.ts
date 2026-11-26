/**
 * Der Tool-Katalog (backe.md §2.19, ui.md §2.3.2): alle Tools aller Adapter an einer Stelle, dazu
 * die Auswahl je Tür und die gemeinsame Ausführung. Die Fehlergrenze liegt beim Adapter.
 */
import type { z } from 'zod';
import { ADMIN_TOOLS } from './admin.ts';
import type { ToolDef, ToolSurface } from './define.ts';
import { READ_TOOLS } from './read.ts';
import { runTool, type ToolEnv } from './run.ts';
import { SYNC_TOOLS } from './sync.ts';
import { WRITE_TOOLS } from './write.ts';

export const TOOLS: readonly ToolDef[] = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  ...SYNC_TOOLS,
  ...ADMIN_TOOLS,
];

/** Die Tools einer Tür; `allowDelete` öffnet in MCP die Tools mit `gate: 'allowDelete'`. */
export function toolsFor(surface: ToolSurface, opts: { allowDelete: boolean }): ToolDef[] {
  return TOOLS.filter(
    (t) =>
      t.surfaces.includes(surface) &&
      (surface !== 'mcp' || t.gate !== 'allowDelete' || opts.allowDelete),
  );
}

/**
 * Führt ein Tool mit bereits geprüften Argumenten aus: `check`, Art, frischer Kontext, dann
 * `runTool`. Wirft den Fehler des Services; geprüft gegen `def.input` hat der Adapter vorher.
 */
export async function invokeTool(def: ToolDef, env: ToolEnv, args: unknown): Promise<unknown> {
  const a = args as z.infer<ToolDef['input']>;
  def.check?.(a);
  const kind = typeof def.kind === 'function' ? def.kind(a) : def.kind;
  const ctx = await env.context();
  return runTool(env, kind, ctx, () => def.run(ctx, a, env));
}

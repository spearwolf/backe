/**
 * Form eines Tools im adapterneutralen Katalog (backe.md §2.19, ui.md §3.3): Name, Schema, Art
 * und Ausführung. MCP und `backe ui` registrieren daraus dieselben Tools mit denselben
 * Parametern und Ergebnissen; `surfaces` sagt, welche Tür ein Tool anbietet.
 */
import type { z } from 'zod';
import type { ResolvedContext } from '../context/resolve.ts';
import type { ToolEnv, ToolKind } from './run.ts';

export type ToolSurface = 'mcp' | 'ui';

/** Beide Türen; der Normalfall. */
export const ALL_SURFACES: readonly ToolSurface[] = ['mcp', 'ui'];

export type ToolDef<S extends z.ZodObject = z.ZodObject> = {
  name: string;
  /** Kurz und englisch wie alle Texte des MCP-Modus; die UI zeigt sie nicht. */
  description: string;
  input: S;
  /** Darf von den Argumenten abhängen (`issue_next` mit `claim` ist ein Sync-Tool). */
  kind: ToolKind | ((args: z.infer<S>) => ToolKind);
  /** Prüft die Argumente vor allem anderen; scheitert es, wird weder aufgelöst noch synchronisiert. */
  check?: (args: z.infer<S>) => void;
  surfaces: readonly ToolSurface[];
  /** Nur MCP: das Tool gibt es dort nur mit `--allow-delete`. */
  gate?: 'allowDelete';
  run(ctx: ResolvedContext, args: z.infer<S>, env: ToolEnv): Promise<unknown>;
};

/**
 * Typ-Helfer: prüft eine Definition gegen ihr eigenes Schema und gibt sie ungenerisch zurück,
 * damit der Katalog Tools mit verschiedenen Schemas in einer Liste führen kann.
 */
export function tool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef {
  return def as unknown as ToolDef;
}

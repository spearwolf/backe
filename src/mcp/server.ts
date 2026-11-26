/**
 * `backe mcp` (backe.md §2.19): Start-Prüfung, Zustand je Prozess und die Server-Factory. Der
 * Adapter ruft dieselben Services und Ansichten wie die CLI; jeder Tool-Aufruf löst den Kontext
 * mit den Start-Eingaben neu auf (backe.md §2.14).
 */
import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../../package.json' with { type: 'json' };
import type { Env } from '../context/paths.ts';
import { type ResolvedContext, requireWriter, resolveContext } from '../context/resolve.ts';
import { toolsFor } from '../tools/catalog.ts';
import { pendingStarts, type ToolDeps, type ToolEnv, writeQueue } from '../tools/run.ts';
import { startPeriodicSync } from '../tools/sync.ts';
import { registerIssueResource } from './resource.ts';
import { registerTool } from './tool.ts';

export type McpDeps = ToolDeps;
export type McpOptions = {
  cwd: string;
  env: Env;
  flags: { backlog?: string; as?: string };
  allowDelete: boolean;
  deps?: McpDeps;
};

/**
 * Hinweise bleiben wörtlich CLI-Befehle und -Flags; die Abbildung auf Tools und Parameter steht
 * einmal hier statt in einer Übersetzungstabelle, die neben den Befehlen driften würde.
 */
export const INSTRUCTIONS =
  'Results are compact JSON. Errors come as {"error":{code,message,hint}}; hints name backe CLI commands and flags: a tool corresponds to the command of the same name (issue_move ↔ backe issue move), a flag to the parameter in snake_case (--add-dep ↔ add_deps, --blocked-by ↔ blocked_by).';

const resolve = (opts: McpOptions): Promise<ResolvedContext> =>
  resolveContext({ cwd: opts.cwd, env: opts.env, flags: opts.flags });

/** Start-Prüfung: Kontext auflösen, `requireWriter`; wirft den `BackeError` der CLI. */
export async function prepareMcp(opts: McpOptions): Promise<ResolvedContext> {
  const ctx = await resolve(opts);
  requireWriter(ctx);
  return ctx;
}

/**
 * Zustand je Prozess (Warteschlange, Timer) plus `build`, die Factory für `serveStdio`:
 * baut bei jedem Aufruf ein frisches `McpServer` mit allen Tools, ohne Nebenwirkung. `close`
 * baut den Timer ab und lässt laufende Tool-Aufrufe zu Ende laufen (backe.md §2.19 Ende): die
 * Writes der Warteschlange, laufende Sync-Tools (Claim, `sync_now`) und die Hintergrund-Starts
 * nach Writes.
 */
export type BackeMcp = { build(): McpServer; close(): Promise<void> };

function registerTools(server: McpServer, env: ToolEnv): void {
  for (const def of toolsFor('mcp', { allowDelete: env.allowDelete })) {
    registerTool(server, env, def);
  }
  registerIssueResource(server, env);
}

/**
 * Zustand je Prozess aufbauen: Warteschlange und den periodischen Hintergrund-Sync mit
 * `pull_interval` aus der Arbeitskopie von `start`. Asynchron, weil das Intervall aus `HEAD` kommt;
 * steht das Objekt, läuft der Timer.
 */
export async function createBackeMcp(opts: McpOptions, start: ResolvedContext): Promise<BackeMcp> {
  const env: ToolEnv = {
    context: () => resolve(opts),
    cwd: opts.cwd,
    allowDelete: opts.allowDelete,
    ...(opts.deps === undefined ? {} : { deps: opts.deps }),
    queue: writeQueue(),
    pending: pendingStarts(),
  };
  const stopTimer = await startPeriodicSync(start, opts.deps?.sync);
  return {
    build() {
      const server = new McpServer(
        { name: 'backe', version: pkg.version },
        { instructions: INSTRUCTIONS },
      );
      registerTools(server, env);
      return server;
    },
    async close() {
      stopTimer();
      await env.queue.run(async () => {});
      await env.pending.settled();
    },
  };
}

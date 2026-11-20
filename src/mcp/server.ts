/**
 * `backe mcp` (backe.md §2.19): Start-Prüfung, Zustand je Prozess und die Server-Factory. Der
 * Adapter ruft dieselben Services und Ansichten wie die CLI; jeder Tool-Aufruf löst den Kontext
 * mit den Start-Eingaben neu auf (backe.md §2.14).
 */
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import pkg from '../../package.json' with { type: 'json' };
import type { Env } from '../context/paths.ts';
import { type ResolvedContext, requireWriter, resolveContext } from '../context/resolve.ts';
import type { ClaimDeps } from '../services/claim.ts';
import { contextInfo } from '../services/context-info.ts';
import type { SyncDeps } from '../services/sync.ts';
import { contextJson } from '../services/views.ts';
import type { WriteDeps } from '../services/write.ts';
import { registerIssueResource, registerReadTools } from './read-tools.ts';
import { defineTool, type ToolEnv, writeQueue } from './tool.ts';
import { registerWriteTools } from './write-tools.ts';

export type McpDeps = { sync?: SyncDeps; write?: WriteDeps; claim?: ClaimDeps };
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
  'Ergebnisse sind kompaktes JSON. Fehler kommen als {"error":{code,message,hint}}; Hinweise nennen CLI-Befehle und -Flags von backe: ein Tool entspricht dem gleichnamigen Befehl (issue_move ↔ backe issue move), ein Flag dem Parameter in snake_case (--add-dep ↔ add_deps, --blocked-by ↔ blocked_by).';

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
 * baut bei jedem Aufruf ein frisches `McpServer` mit allen Tools, ohne Nebenwirkung.
 */
export type BackeMcp = { build(): McpServer; close(): Promise<void> };

function registerTools(server: McpServer, env: ToolEnv): void {
  defineTool(
    server,
    env,
    'context_get',
    {
      description:
        'Aufgelösten Kontext mit Herkunft jedes Werts zeigen (wie backe context); mit props die Property-Deklarationen des Backlogs',
      input: z.object({ props: z.boolean().optional() }),
      kind: 'read',
    },
    async (ctx, args) => contextJson(await contextInfo(ctx, { props: args.props === true })),
  );
  registerReadTools(server, env);
  registerWriteTools(server, env);
  registerIssueResource(server, env);
}

export function createBackeMcp(opts: McpOptions, _start: ResolvedContext): BackeMcp {
  const env: ToolEnv = { context: () => resolve(opts), opts, queue: writeQueue() };
  return {
    build() {
      const server = new McpServer(
        { name: 'backe', version: pkg.version },
        { instructions: INSTRUCTIONS },
      );
      registerTools(server, env);
      return server;
    },
    async close() {},
  };
}

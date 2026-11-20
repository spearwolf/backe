import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';
import {
  type BackeMcp,
  createBackeMcp,
  type McpDeps,
  type McpOptions,
  prepareMcp,
} from '../../src/mcp/server.ts';
import type { TestBacklog } from './git.ts';

/** Die Tools der Tabelle in backe.md §2.19; `issue_delete` kommt nur mit `--allow-delete` dazu. */
export const SPEC_TOOLS = [
  'context_get',
  'issue_list',
  'issue_get',
  'issue_create',
  'issue_update',
  'issue_move',
  'issue_resume',
  'issue_reopen',
  'issue_claim',
  'issue_next',
  'comment_add',
  'attachment_add',
  'attachment_get',
  'project_list',
  'sprint_list',
  'sprint_get',
  'repo_locate',
  'issue_rank',
  'batch',
  'sync_now',
] as const;

export type ToolError = {
  error: { code: string; message: string; hint?: string; details?: unknown };
};
// biome-ignore lint/suspicious/noExplicitAny: Tests greifen ohne Narrowing in das Ergebnis.
export type CallResult = { ok: any } | ToolError;

export type McpConnection = {
  client: Client;
  /**
   * Ruft ein Tool und parst `content[0].text`: Erfolg als `{ok}`, ein Fehler-Ergebnis als
   * `{error}`. Fehler, die das SDK vor dem Handler abfängt (Klartext wie
   * `Input validation error: …`, kein JSON), kommen als
   * `{error:{code:'protocol', message:<text>}}`.
   */
  call(name: string, args?: object): Promise<CallResult>;
  close(): Promise<void>;
};

/**
 * Verbindet einen Client über ein In-Memory-Paar mit `server`. Beide Hälften kommen aus
 * `@modelcontextprotocol/server`; das Client-Paket bündelt eine eigene Klasse, ein gemischtes
 * Paar funktioniert nicht. Der Weg spricht nur die `initialize`-Generation.
 */
export async function connectServer(server: McpServer): Promise<McpConnection> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'backe-test', version: '0.0.0' });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return {
    client,
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args as Record<string, unknown> });
      const text = (r.content as { type: string; text?: string }[])[0]?.text ?? '';
      if (r.isError !== true) return { ok: JSON.parse(text) };
      try {
        return JSON.parse(text) as ToolError;
      } catch {
        return { error: { code: 'protocol', message: text } };
      }
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** `backe mcp` als `spw` (bzw. `flags.as`) auf dem Test-Backlog, über den In-Memory-Transport. */
export async function connectMcp(
  b: TestBacklog,
  opts: { allowDelete?: boolean; deps?: McpDeps; flags?: McpOptions['flags'] } = {},
): Promise<McpConnection & { mcp: BackeMcp }> {
  const options: McpOptions = {
    cwd: b.root,
    env: b.env,
    flags: opts.flags ?? { as: b.handle },
    allowDelete: opts.allowDelete ?? false,
    ...(opts.deps === undefined ? {} : { deps: opts.deps }),
  };
  const mcp = await createBackeMcp(options, await prepareMcp(options));
  const conn = await connectServer(mcp.build());
  return {
    ...conn,
    mcp,
    async close() {
      await conn.close();
      await mcp.close();
    },
  };
}

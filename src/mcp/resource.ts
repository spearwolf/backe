/**
 * Die Resource `backe://issue/{id}` (backe.md §2.19): die Issue-Datei als Markdown, gelesen über
 * denselben Weg wie ein lesendes Tool.
 */
import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import { BackeError } from '../core/errors.ts';
import { readIssueFile } from '../services/issues.ts';
import { runTool, type ToolEnv } from '../tools/run.ts';

/**
 * `{id}` aus der URI: der erste Wert der Template-Variable, prozent-dekodiert; ohne Wert leer.
 * Eine kaputte Kodierung ist `validation`.
 */
export function issueRefOf(value: string | string[] | undefined): string {
  return decodeId([value ?? []].flat()[0] ?? '');
}

function decodeId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new BackeError('validation', `Invalid issue ID in the URI: '${raw}'`);
  }
}

/** `backe://issue/{id}`: die Issue-Datei als Markdown; `{id}` darf eine Kurz-ID sein. */
export function registerIssueResource(server: McpServer, env: ToolEnv): void {
  server.registerResource(
    'issue',
    // Ohne `list`: ein Backlog kann zehntausende Issues haben.
    new ResourceTemplate('backe://issue/{id}', { list: undefined }),
    {
      description: 'Issue file (frontmatter and Markdown) by ID or short ID',
      mimeType: 'text/markdown',
    },
    async (_uri, variables) => {
      const ref = issueRefOf(variables.id);
      const ctx = await env.context();
      const f = await runTool(env, 'read', ctx, () => readIssueFile(ctx, ref));
      return {
        contents: [{ uri: `backe://issue/${f.id}`, mimeType: 'text/markdown', text: f.text }],
      };
    },
  );
}

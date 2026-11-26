/**
 * Schreibende API von `backe ui` (ui.md §2.3.2): Tools des Katalogs über HTTP. Die Reihenfolge
 * ist Teil des Schutzes (ui.md §2.15): erst der Medientyp, dann das Tool, dann der Body, dann das
 * Schema, zuletzt Kontext und Ausführung. So liest eine abgelehnte Anfrage keinen Body, und ein
 * unbekanntes Tool löst keinen Kontext auf.
 */
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { BackeError } from '../core/errors.ts';
import { invokeTool, toolsFor } from '../tools/catalog.ts';
import type { ToolDef } from '../tools/define.ts';
import { mediaType, readJsonBody, TOOL_BODY_LIMIT } from './body.ts';
import { deniedJson, sendError, sendJson } from './http.ts';
import type { WriteRoute } from './routes.ts';
import { m as serverMessages } from './server.messages.ts';
import type { UiTools } from './tools.ts';
import { m } from './write-api.messages.ts';

/** Was die schreibende API vom Server braucht; die Uploads kommen mit ihrem Endpunkt dazu. */
export type WriteEnv = { tools: UiTools };

const MEDIA_TYPE: Readonly<Record<WriteRoute['kind'], string>> = {
  tool: 'application/json',
  upload: 'application/octet-stream',
};

/** Die Tools der UI-Tür nach Name; in der UI braucht `issue_delete` kein Freischalten. */
const UI_TOOLS: ReadonlyMap<string, ToolDef> = new Map(
  toolsFor('ui', { allowDelete: true }).map((def) => [def.name, def]),
);

/**
 * Ist der Body nicht ganz gelesen, endet die Verbindung mit der Antwort: Sonst läse Node den Rest
 * für die nächste Anfrage auf derselben Verbindung noch ein, wie groß er auch ist.
 */
function closeUnread(req: IncomingMessage): OutgoingHttpHeaders {
  return req.complete ? {} : { Connection: 'close' };
}

/** Schemafehler als `usage` mit `details.issues: [{path, message}]`; `path` leer für die Wurzel. */
function parseArgs(def: ToolDef, body: unknown): unknown {
  const parsed = def.input.safeParse(body);
  if (parsed.success) return parsed.data;
  const issues = parsed.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
  throw new BackeError('usage', m.invalidArguments(def.name), { details: { issues } });
}

/**
 * Bedient eine Schreibroute; jeder Fehler geht als Fehler-JSON hinaus, nach gesendeten Headern
 * endet stattdessen die Verbindung. Erfolg: 200 mit dem Ergebnis-JSON des Tools wie in MCP,
 * `undefined` als `null`.
 */
export async function handleWrite(
  route: WriteRoute,
  req: IncomingMessage,
  res: ServerResponse,
  env: WriteEnv,
): Promise<void> {
  try {
    const expected = MEDIA_TYPE[route.kind];
    if (mediaType(req.headers['content-type']) !== expected) {
      sendJson(
        res,
        403,
        deniedJson('forbidden', m.contentTypeRequired(expected)),
        closeUnread(req),
      );
      return;
    }
    if (route.kind === 'upload') {
      const path = (req.url ?? '').split('?')[0] ?? '';
      throw new BackeError('not_found', serverMessages.noEndpoint(path));
    }
    const def = UI_TOOLS.get(route.tool);
    if (def === undefined) throw new BackeError('not_found', m.unknownTool(route.tool));
    const args = parseArgs(def, await readJsonBody(req, TOOL_BODY_LIMIT));
    const value = await invokeTool(def, env.tools.envFor(route.backlog), args);
    sendJson(res, 200, value === undefined ? null : value);
  } catch (err) {
    if (res.headersSent) res.destroy();
    else sendError(res, err, closeUnread(req));
  }
}

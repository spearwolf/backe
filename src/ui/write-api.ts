/**
 * Schreibende API von `backe ui` (ui.md §2.3.2): Tools des Katalogs und Uploads über HTTP. Die
 * Reihenfolge ist Teil des Schutzes (ui.md §2.15): erst der Medientyp, dann das Tool bzw. der
 * Anhangsname, dann der Body, dann das Schema, zuletzt Kontext und Ausführung. So liest eine
 * abgelehnte Anfrage keinen Body, und ein unbekanntes Tool löst keinen Kontext auf.
 */
import { rm } from 'node:fs/promises';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { ATTACHMENT_NAME_RE } from '../core/names.ts';
import { attachmentTooLarge } from '../ops/comment-ops.ts';
import { m as attachmentMessages } from '../services/attachments.messages.ts';
import { addAttachment, attachmentLimits, loadAttachmentSource } from '../services/attachments.ts';
import { outcomeJson } from '../services/views.ts';
import { invokeTool, toolsFor } from '../tools/catalog.ts';
import type { ToolDef } from '../tools/define.ts';
import { runTool } from '../tools/run.ts';
import { mediaType, readJsonBody, TOOL_BODY_LIMIT } from './body.ts';
import { deniedJson, sendError, sendJson } from './http.ts';
import type { WriteRoute } from './routes.ts';
import type { UiTools } from './tools.ts';
import { receiveUpload, type UploadDir } from './upload.ts';
import { m } from './write-api.messages.ts';

/** Was die schreibende API vom Server braucht: die Tools je Backlog und das Upload-Verzeichnis. */
export type WriteEnv = { tools: UiTools; uploads: UploadDir };

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

/** Ein Upload über `attachments.max_bytes`; die Verbindung endet mit der Antwort. */
class TooLarge {
  readonly error: BackeError;
  constructor(error: BackeError) {
    this.error = error;
  }
}

/** `attachmentTooLarge` als Wurf; `undefined` heißt: innerhalb der Grenze. */
function checkSize(name: string, size: number, maxBytes: number | null, lfs: boolean): void {
  const error = attachmentTooLarge(name, size, { max_bytes: maxBytes, lfs });
  if (error !== undefined) throw new TooLarge(error);
}

/**
 * Upload (ui.md §2.3.2 »Upload«): der Name vor dem Kontext und vor dem ersten Byte, dann Kontext
 * mit Schreibrecht und Grenze, `Content-Length` vor dem Lesen, beim Streamen gezählt. Die Bytes
 * landen in einer Temp-Datei, die in jedem Fall wieder verschwindet; Laden und Schreiben laufen
 * über dieselbe Warteschlange wie die Tools. Der Name bestimmt nie einen Pfad.
 */
async function upload(
  route: Extract<WriteRoute, { kind: 'upload' }>,
  req: IncomingMessage,
  env: WriteEnv,
): Promise<unknown> {
  const { name } = route;
  // Dieselbe Meldung wie `attach add <datei> --name` (`attachmentFileName`): Ohne Punkt im Namen
  // ist der Dateiname der Name selbst, die Temp-Datei hat keine Endung.
  if (!ATTACHMENT_NAME_RE.test(name)) {
    throw new BackeError('validation', attachmentMessages.invalidAttachmentName(name), {
      hint: attachmentMessages.attachmentNameHint,
    });
  }
  const toolEnv = env.tools.envFor(route.backlog);
  const ctx = await toolEnv.context();
  const { maxBytes, lfs } = await attachmentLimits(ctx);
  const declared = req.headers['content-length'];
  if (declared !== undefined) checkSize(name, Number(declared), maxBytes, lfs);
  const path = await env.uploads.file();
  try {
    const received = await receiveUpload(req, path, maxBytes);
    if ('tooLarge' in received) checkSize(name, received.tooLarge, maxBytes, lfs);
    return await runTool(toolEnv, 'write', ctx, async () => {
      const source = await loadAttachmentSource(
        { name, path },
        { base: dirname(path), home: ctx.homes.home, maxBytes, lfs, confine: true },
      );
      const outcome = await addAttachment(ctx, route.id, { name, source }, toolEnv.deps?.write);
      return outcomeJson(outcome);
    });
  } finally {
    await rm(path, { force: true });
  }
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
    let value: unknown;
    if (route.kind === 'upload') {
      value = await upload(route, req, env);
    } else {
      const def = UI_TOOLS.get(route.tool);
      if (def === undefined) throw new BackeError('not_found', m.unknownTool(route.tool));
      const args = parseArgs(def, await readJsonBody(req, TOOL_BODY_LIMIT));
      value = await invokeTool(def, env.tools.envFor(route.backlog), args);
    }
    sendJson(res, 200, value === undefined ? null : value);
  } catch (err) {
    if (res.headersSent) res.destroy();
    else if (err instanceof TooLarge) sendError(res, err.error, { Connection: 'close' });
    else sendError(res, err, closeUnread(req));
  }
}

/** Handler der lesenden API von `backe ui` (ui.md §2.3); Fehler gehen über `sendError`. */
import type { ServerResponse } from 'node:http';
import { BackeError } from '../core/errors.ts';
import { backlogsJson, type StartInput } from './context.ts';
import { sendError, sendJson } from './http.ts';
import { m } from './read-api.messages.ts';
import type { ReadRoute } from './routes.ts';

export type ReadEnv = { input: StartInput; start: string | undefined };

/** Bedient eine Leseroute. Bis die übrigen Arten folgen, antworten sie mit 404 `not_found`. */
export async function handleRead(
  route: ReadRoute,
  env: ReadEnv,
  res: ServerResponse,
): Promise<void> {
  if (route.kind === 'backlogs') {
    sendJson(res, 200, await backlogsJson(env.input, env.start));
    return;
  }
  sendError(res, new BackeError('not_found', m.noEndpoint(route.kind)));
}

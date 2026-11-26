/** Handler der lesenden API von `backe ui` (ui.md §2.3); Fehler gehen über `sendError`. */
import type { ServerResponse } from 'node:http';
import { BackeError } from '../core/errors.ts';
import { getAttachment } from '../services/attachments.ts';
import { listIssues } from '../services/issue-list.ts';
import { showIssue } from '../services/issue-show.ts';
import { requireRoot } from '../services/read.ts';
import { issueListResultJson, issueShowJson } from '../services/views.ts';
import { m as attachmentMessages } from './attachment.messages.ts';
import { sendAttachment } from './attachment.ts';
import { backlogsJson, type StartInput, uiContext } from './context.ts';
import { serveEvents, writeEventHead } from './events.ts';
import { sendError, sendJson } from './http.ts';
import type { LiveHub } from './live.ts';
import { m } from './read-api.messages.ts';
import type { ReadRoute } from './routes.ts';
import { stateJson } from './state.ts';

export type ReadEnv = { input: StartInput; start: string | undefined; hub: LiveHub };

/** Bedient eine Leseroute; jeder Fehler geht als Fehler-JSON hinaus. */
export async function handleRead(
  route: ReadRoute,
  env: ReadEnv,
  res: ServerResponse,
): Promise<void> {
  if (route.kind === 'backlogs') {
    sendJson(res, 200, await backlogsJson(env.input, env.start));
    return;
  }
  try {
    if (route.kind === 'events') {
      if (res.req.method === 'HEAD') {
        // Nur die Header; ein HEAD startet keinen Watcher, prüft aber die Arbeitskopie wie GET.
        requireRoot(await uiContext(env.input, env.start, route.backlog));
        writeEventHead(res);
        res.end();
        return;
      }
      const live = await env.hub.acquire(route.backlog, () =>
        uiContext(env.input, env.start, route.backlog),
      );
      serveEvents(res, live);
      return;
    }
    const ctx = await uiContext(env.input, env.start, route.backlog);
    if (route.kind === 'state') {
      // `rev` vor dem Laden: Der Zustand ist dann mindestens so neu wie `rev` (ui.md §2.4.3).
      const rev = env.hub.revOf(route.backlog);
      sendJson(res, 200, await stateJson(ctx, rev));
    } else if (route.kind === 'issue') {
      sendJson(res, 200, issueShowJson(await showIssue(ctx, route.id, { comments: 'all' })));
    } else if (route.kind === 'attachment') {
      // Der Name aus der URL ist nur ein Schlüssel für die Anhangsliste des Issues; der Pfad
      // entsteht in `getAttachment` aus der gespeicherten Datei, nie aus der URL.
      const a = await getAttachment(ctx, route.id, route.name);
      if ('url' in a) {
        throw new BackeError('not_found', attachmentMessages.linkAttachment(route.id, route.name));
      }
      await sendAttachment(res, { name: a.name, path: a.path }, res.req.method === 'HEAD');
    } else {
      if (route.q === undefined || route.q === '') {
        throw new BackeError('usage', m.searchNeedsQuery, { hint: '?q=<text>' });
      }
      sendJson(
        res,
        200,
        issueListResultJson(await listIssues(ctx, { text: route.q, states: ['all'] })),
      );
    }
  } catch (err) {
    if (res.headersSent) res.destroy();
    else sendError(res, err);
  }
}

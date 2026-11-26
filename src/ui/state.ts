/** Gesamtzustand eines Backlogs für `GET /api/b/<b>/state` (ui.md §2.3.1). */
import { join } from 'node:path';
import type { ResolvedContext } from '../context/resolve.ts';
import { resolveCommit } from '../git/history.ts';
import { syncStatus } from '../services/background.ts';
import { contextInfo } from '../services/context-info.ts';
import { openSnapshot } from '../services/read.ts';
import { contextJson, syncStatusJson } from '../services/views.ts';
import { exists } from '../store/files.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import type { StateJson } from './api.ts';
import { entityLists } from './delta.ts';

export { userJson } from './delta.ts';

/** JSON von `sync status` der eigenen Arbeitskopie; ohne eine `null`. */
export async function syncJson(ctx: ResolvedContext): Promise<Record<string, unknown> | null> {
  const wc = ctx.backlog.workingCopy;
  const ownCopy = wc !== undefined && (await exists(join(wc, BACKLOG_CONFIG)));
  return ownCopy ? syncStatusJson(await syncStatus(ctx)) : null;
}

/**
 * Metadaten aller Entitäten ohne Issue-Bodies. `rev` liest der Aufrufer, bevor der Zustand geladen
 * wird: So ist der Zustand mindestens so neu wie `rev` (ui.md §2.4.3).
 */
export async function stateJson(ctx: ResolvedContext, rev = 0): Promise<StateJson> {
  const { root, snapshot: s } = await openSnapshot(ctx);
  return {
    rev,
    head: await resolveCommit(root, 'HEAD'),
    context: contextJson(await contextInfo(ctx)),
    ...entityLists(s),
    problems: s.problems,
    sync: await syncJson(ctx),
  };
}

/**
 * Tools, die selbst mit dem Remote sprechen (backe.md §2.16.5, §2.19): `issue_claim` und
 * `sync_now` laufen neben der Warteschlange der lokalen Writes und warten selbst auf `sync.lock`.
 * Dazu der periodische Hintergrund-Sync des Servers (§2.16.1, §2.16.3).
 */
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { ResolvedContext } from '../context/resolve.ts';
import { BacklogConfigSchema } from '../core/schemas.ts';
import { scheduleSync } from '../services/background.ts';
import { claimIssue } from '../services/claim.ts';
import { type SyncDeps, type SyncOutcome, syncNow } from '../services/sync.ts';
import { nonEmpty, noticeJson, outcomeJson, syncJson } from '../services/views.ts';
import { requireHeadConfig } from '../services/write.ts';
import { exists } from '../store/files.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { defineTool, type ToolEnv } from './tool.ts';

/** Ergebnis von `sync_now`: wie `sync --json`, die Hinweise aber als Objekte `{message}`. */
export function syncResult(out: SyncOutcome): Record<string, unknown> {
  return { ...syncJson(out), notices: nonEmpty(out.notices.map(noticeJson)) };
}

export function registerSyncTools(server: McpServer, env: ToolEnv): void {
  defineTool(
    server,
    env,
    'issue_claim',
    {
      description:
        'Claim an issue, synchronously with the remote (like backe issue claim); if someone else got it meanwhile → conflict',
      input: z.strictObject({ id: z.string() }),
      kind: 'sync',
    },
    async (ctx, a) => outcomeJson(await claimIssue(ctx, a.id, env.opts.deps?.claim)),
  );

  defineTool(
    server,
    env,
    'sync_now',
    {
      description: 'One sync round with the remote now, blocking (like backe sync)',
      input: z.strictObject({}),
      kind: 'sync',
    },
    async (ctx) => syncResult(await syncNow(ctx, env.opts.deps?.sync)),
  );
}

/** `sync.pull_interval` aus `HEAD` der Arbeitskopie; ohne Arbeitskopie der Default des Schemas. */
async function pullInterval(ctx: ResolvedContext): Promise<number> {
  const wc = ctx.backlog.workingCopy;
  if (wc === undefined || !(await exists(join(wc, BACKLOG_CONFIG)))) {
    return BacklogConfigSchema.shape.sync.parse(undefined).pull_interval;
  }
  return (await requireHeadConfig(wc)).sync.pull_interval;
}

/**
 * Der periodische Hintergrund-Sync: alle `pull_interval` Sekunden (Stand beim Start) ein Start,
 * ohne den Abstand zum letzten Versuch zu prüfen (`periodic`); `pull_interval: 0` → kein Timer,
 * jeder lesende Aufruf prüft ohnehin. Der Timer hält den Prozess nicht am Leben. Liefert die
 * Abbau-Funktion.
 */
export async function startPeriodicSync(
  ctx: ResolvedContext,
  deps?: SyncDeps,
): Promise<() => void> {
  const seconds = await pullInterval(ctx);
  if (seconds === 0) return () => {};
  // `scheduleSync` wirft nie; ein Tick, der beim Abbau noch läuft, startet höchstens einen
  // Hintergrund-Sync, dessen Debounce über `sync.lock` einen laufenden abfängt.
  const timer = setInterval(() => void scheduleSync(ctx, 'periodic', deps), seconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

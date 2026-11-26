/**
 * Ausführung eines Tools, gemeinsam für alle Adapter (backe.md §2.19, ui.md §2.3.2): Frische vor
 * dem Lesen, lokale Writes nacheinander über eine Warteschlange, Hintergrund-Sync nach einem
 * Commit, synchrone Tools daneben, aber verfolgt.
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { scheduleSync } from '../services/background.ts';
import type { ClaimDeps } from '../services/claim.ts';
import type { SyncDeps } from '../services/sync.ts';
import type { WriteDeps } from '../services/write.ts';
import type { ToolSurface } from './define.ts';

/**
 * `read`: Frische vorher wie bei einem lesenden Befehl. `write`: lokaler Write über die
 * Warteschlange, danach Hintergrund-Sync, wenn ein Commit entstand. `sync`: spricht selbst mit
 * dem Remote (Claim, `sync_now`), daher weder Warteschlange noch Nachlauf.
 */
export type ToolKind = 'read' | 'write' | 'sync';

/** Lokale Writes eines Prozesses nacheinander; ein gescheiterter hält die folgenden nicht auf. */
export type WriteQueue = { run<T>(fn: () => Promise<T>): Promise<T> };

/**
 * Was neben der Warteschlange läuft und vor dem Ende fertig werden muss: laufende Sync-Tools und
 * die Hintergrund-Starts nach Writes, die das Tool-Ergebnis nicht abwartet. `settled` wartet, bis
 * nichts mehr läuft — auch auf das, was währenddessen dazukommt.
 */
export type Pending = { add(p: Promise<unknown>): void; settled(): Promise<void> };

/** Test-Hooks der Services, die Tools aufrufen. */
export type ToolDeps = { sync?: SyncDeps; write?: WriteDeps; claim?: ClaimDeps };

/**
 * Zustand, den ein Adapter für seine Tools hält: Kontext je Aufruf, Warteschlange, Laufendes.
 * `cwd` ist das Arbeitsverzeichnis, gegen das `attachment_add` einen `path` auflöst; ohne `cwd`
 * (`backe ui`, ui.md §2.15: Uploads bestimmen nie einen Pfad) gibt es keinen `path`.
 * `allowDelete` öffnet `issue.delete` im `batch`.
 */
export type ToolEnv = {
  context(): Promise<ResolvedContext>;
  cwd?: string;
  allowDelete: boolean;
  /** Die Tür, durch die der Adapter Tools anbietet; Meldungen nennen sie beim Namen. */
  surface: ToolSurface;
  deps?: ToolDeps;
  queue: WriteQueue;
  pending: Pending;
};

export function writeQueue(): WriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = tail.then(fn);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

export function pendingStarts(): Pending {
  const running = new Set<Promise<unknown>>();
  return {
    add(p) {
      const done = () => {
        running.delete(p);
      };
      running.add(p);
      p.then(done, done);
    },
    async settled() {
      while (running.size > 0) await Promise.allSettled([...running]);
    },
  };
}

/** Hat das Ergebnis eines Writes einen Commit (`commit` ist ein SHA, nicht `null`)? */
function committed(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { commit?: unknown }).commit === 'string'
  );
}

/**
 * Führt `run` nach seiner Art aus (siehe {@link ToolKind}); derselbe Weg für alle Tools und die
 * MCP-Resource, damit Frische, Warteschlange und Nachlauf nur hier stehen.
 */
export async function runTool<T>(
  env: ToolEnv,
  kind: ToolKind,
  ctx: ResolvedContext,
  run: () => Promise<T>,
): Promise<T> {
  const sync = env.deps?.sync;
  if (kind === 'read') {
    await scheduleSync(ctx, 'read', sync);
    return run();
  }
  if (kind === 'sync') {
    // Neben der Warteschlange, aber verfolgt: `close()` lässt einen laufenden Claim oder
    // `sync_now` zu Ende laufen. Ablehnungen bekommt der Aufrufer, `pending` ignoriert sie.
    const running = run();
    env.pending.add(running);
    return running;
  }
  return env.queue.run(async () => {
    const value = await run();
    // Nicht abgewartet: Das Ergebnis des Writes steht fest; `scheduleSync` wirft nie. Gemerkt
    // noch im Job, damit `close()` nach dem Leeren der Warteschlange auch darauf wartet — sonst
    // ginge der Push des letzten Writes mit dem Prozess verloren.
    if (committed(value)) env.pending.add(scheduleSync(ctx, 'write', sync));
    return value;
  });
}

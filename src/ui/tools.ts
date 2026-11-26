/**
 * Tool-Zustand von `backe ui` je Backlog (ui.md §2.3.2): ein `ToolEnv` je Name, angelegt beim
 * ersten Aufruf und gehalten bis zum Ende, mit eigener Warteschlange und eigenen Hintergrund-Starts.
 */
import { requireWriter } from '../context/resolve.ts';
import { pendingStarts, type ToolDeps, type ToolEnv, writeQueue } from '../tools/run.ts';
import { type StartInput, uiContext } from './context.ts';

export class UiTools {
  readonly #input: StartInput;
  readonly #start: string | undefined;
  readonly #deps: ToolDeps | undefined;
  readonly #envs = new Map<string, ToolEnv>();

  constructor(input: StartInput, start: string | undefined, deps?: ToolDeps) {
    this.#input = input;
    this.#start = start;
    this.#deps = deps;
  }

  /**
   * Das `ToolEnv` von `backlog`. Sein Kontext wird bei jedem Aufruf neu aufgelöst und verlangt eine
   * schreibende Identität — auch für lesende Tools, wie MCP, das ohne sie nicht startet; gelesen
   * wird über die GET-Endpunkte. Kein `cwd`: Ein Upload bestimmt nie einen Pfad (ui.md §2.15).
   */
  envFor(backlog: string): ToolEnv {
    let env = this.#envs.get(backlog);
    if (env === undefined) {
      const input = this.#input;
      const start = this.#start;
      env = {
        context: async () => {
          const ctx = await uiContext(input, start, backlog);
          requireWriter(ctx);
          return ctx;
        },
        allowDelete: true,
        surface: 'ui',
        ...(this.#deps === undefined ? {} : { deps: this.#deps }),
        queue: writeQueue(),
        pending: pendingStarts(),
      };
      this.#envs.set(backlog, env);
    }
    return env;
  }

  /** Wartet, bis die Warteschlange jedes Backlogs leer ist und nichts mehr nebenher läuft. */
  async settled(): Promise<void> {
    await Promise.all(
      [...this.#envs.values()].map(async (env) => {
        await env.queue.run(async () => {});
        await env.pending.settled();
      }),
    );
  }
}

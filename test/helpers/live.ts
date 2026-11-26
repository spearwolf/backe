/** Client-Modell und Abonnent für die Live-Tests von `backe ui`. */
import type { PatchJson, ServerEvent, StateJson } from '../../src/ui/api.ts';
import { LIVE_TIMING, type LiveBacklog } from '../../src/ui/live.ts';

export type Received = { event: ServerEvent['event']; data: unknown; id: string };

/** Meldet einen Abonnenten an und sammelt, was er bekommt. */
export function collect(live: LiveBacklog, lastEventId?: string) {
  const events: Received[] = [];
  const off = live.subscribe(
    (e, id) => events.push({ event: e.event, data: e.data, id }),
    lastEventId,
  );
  return {
    events,
    off,
    patches: () => events.filter((e) => e.event === 'patch').map((e) => e.data as PatchJson),
    names: () => events.map((e) => e.event),
  };
}

type Keyed = Record<string, unknown>;
const KEYS = {
  issues: 'id',
  projects: 'path',
  sprints: 'slug',
  repos: 'name',
  users: 'handle',
} as const;

/** Wendet einen Patch an, wie es der Client tut (ui.md §2.5). */
export function applyPatch(state: StateJson, patch: PatchJson): StateJson {
  const next = { ...state, rev: patch.rev, head: patch.head } as StateJson & Keyed;
  for (const [kind, key] of Object.entries(KEYS)) {
    const list = new Map(
      ((next as Keyed)[kind] as Keyed[]).map((e) => [e[key] as string, e] as const),
    );
    for (const id of ((patch.remove as Keyed)[kind] as string[] | undefined) ?? []) list.delete(id);
    for (const e of ((patch.upsert as Keyed)[kind] as Keyed[] | undefined) ?? []) {
      list.set(e[key] as string, e);
    }
    (next as Keyed)[kind] = [...list.values()];
  }
  if (patch.upsert.config !== undefined) next.config = patch.upsert.config;
  if (patch.problems !== undefined) next.problems = patch.problems;
  return next;
}

/** Was ein Patch abbilden muss: alles außer `rev`, `context`, `sync`, Listen nach Key sortiert. */
export function comparable(state: StateJson): Keyed {
  const out: Keyed = { head: state.head, config: state.config, problems: state.problems };
  for (const [kind, key] of Object.entries(KEYS)) {
    out[kind] = [...((state as unknown as Keyed)[kind] as Keyed[])].sort((a, b) =>
      String(a[key]) < String(b[key]) ? -1 : 1,
    );
  }
  return out;
}

/**
 * Lässt ausstehende `fs.watch`-Ereignisse ankommen, spult die Entprellung vor und wartet die
 * Runden ab. Ereignisse, die später kommen, würden nichts Neues mehr zeigen.
 */
export async function settle(live: LiveBacklog): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(LIVE_TIMING.debounceMs);
    await live.idle();
  }
}

/** Fake-Timer für die Live-Tests: Timer sind fake, Git und `fs.watch` laufen echt. */
export function fakeTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
}

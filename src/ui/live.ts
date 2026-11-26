/**
 * Live-Zustand eines Backlogs für den Event-Stream von `backe ui` (ui.md §2.4): Watcher auf die
 * Arbeitskopie, Snapshot per Delta fortschreiben, Patches mit fortlaufendem `rev` an die
 * Abonnenten, Puffer für das Nachholen. Ereignisse setzen nur Flags; eine einzige Schleife arbeitet
 * sie nacheinander ab (Single-Flight mit Nachlauf). So verschmelzen Bursts, und kein Patch
 * überholt einen anderen.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolvedContext } from '../context/resolve.ts';
import { git } from '../git/exec.ts';
import { resolveCommit } from '../git/history.ts';
import { stateDir } from '../git/local-state.ts';
import { requireRoot } from '../services/read.ts';
import type { SyncDeps } from '../services/sync.ts';
import {
  type BacklogSnapshot,
  loadSnapshot,
  orphanedProjectPaths,
  snapshotAt,
} from '../store/snapshot.ts';
import { startPeriodicSync } from '../tools/sync.ts';
import type { PatchJson, ServerEvent } from './api.ts';
import {
  diffTables,
  type EntityTable,
  entityTable,
  needsFullReload,
  touchedIssues,
  watchedPath,
} from './delta.ts';
import { syncJson } from './state.ts';
import { type Watched, type WatchFn, watchWorkingCopy } from './watch.ts';

/** Zeitkonstanten und Puffergröße aus ui.md §2.4.1 und §2.4.3. */
export const LIVE_TIMING = {
  debounceMs: 150,
  safetyMs: 10_000,
  heartbeatMs: 15_000,
  lingerMs: 30_000,
  buffer: 200,
} as const;

export type LiveListener = (event: ServerEvent, id: string) => void;

export type LiveDeps = {
  /** Test-Hook: Ersatz für `fs.watch`, etwa um Ereignisse zu unterdrücken. */
  watch?: WatchFn;
  sync?: SyncDeps;
};

/** `<boot>:<rev>` → Teile; alles andere `undefined`. */
export function parseEventId(id: string | undefined): { boot: string; rev: number } | undefined {
  const m = /^([0-9a-f]{8}):(0|[1-9]\d*)$/.exec(id ?? '');
  if (m === null) return undefined;
  const rev = Number(m[2]);
  return Number.isSafeInteger(rev) ? { boot: m[1] as string, rev } : undefined;
}

const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EISDIR']);

/** Inhalt der Pfade im Arbeitsbaum; eine fehlende Datei (oder ein Verzeichnis) ist `null`. */
async function readPaths(
  root: string,
  paths: readonly string[],
): Promise<{ path: string; content: string | null }[]> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        return { path, content: await readFile(join(root, path), 'utf8') };
      } catch (err) {
        if (MISSING.has((err as NodeJS.ErrnoException).code ?? '')) return { path, content: null };
        throw err;
      }
    }),
  );
}

/** Pfade, die zwischen zwei Commits geändert sind; `-z`, damit kein Pfad gequotet ankommt. */
async function changedPaths(root: string, from: string, to: string): Promise<string[]> {
  const { stdout } = await git(['diff', '--name-only', '--no-renames', '-z', from, to], {
    cwd: root,
  });
  return stdout.split('\0').filter((p) => p !== '');
}

type LiveInit = {
  ctx: ResolvedContext;
  root: string;
  boot: string;
  rev: number;
  snapshot: BacklogSnapshot;
  head: string;
  sync: Record<string, unknown> | null;
  onEnd: (rev: number) => void;
};

export class LiveBacklog {
  readonly #ctx: ResolvedContext;
  readonly #root: string;
  readonly #boot: string;
  readonly #onEnd: (rev: number) => void;
  #snapshot: BacklogSnapshot;
  #table: EntityTable;
  #head: string;
  #rev: number;
  #buffer: PatchJson[] = [];
  #sync: { json: Record<string, unknown>; text: string } | undefined;
  readonly #listeners = new Set<LiveListener>();

  /** Offene Arbeit: Pfade aus dem Arbeitsbaum, vollständiges Neuladen, Ref, Sync-Zustand. */
  readonly #paths = new Set<string>();
  #full = false;
  #treeReady = false;
  #refDirty = false;
  #syncDirty = false;
  #running: Promise<void> | undefined;

  #watched: Watched | undefined;
  #stopPeriodic: () => void = () => {};
  #treeTimer: ReturnType<typeof setTimeout> | undefined;
  #syncTimer: ReturnType<typeof setTimeout> | undefined;
  #lingerTimer: ReturnType<typeof setTimeout> | undefined;
  #safety: ReturnType<typeof setInterval> | undefined;
  #stopped = false;

  private constructor(init: LiveInit) {
    this.#ctx = init.ctx;
    this.#root = init.root;
    this.#boot = init.boot;
    this.#onEnd = init.onEnd;
    this.#snapshot = init.snapshot;
    this.#table = entityTable(init.snapshot);
    this.#head = init.head;
    this.#rev = init.rev;
    this.#sync =
      init.sync === null ? undefined : { json: init.sync, text: JSON.stringify(init.sync) };
  }

  /**
   * Lädt den Stand von `root` des Kontexts und beginnt zu beobachten. Ohne Arbeitskopie oder mit
   * kaputter Backlog-Config wirft es wie `/state`. `rev` ist der erste `rev`; `onEnd` erfährt den
   * letzten, wenn der Watcher endet (ohne Abonnenten nach `lingerMs`, oder per `stop`).
   */
  static async start(
    ctx: ResolvedContext,
    opts: { boot: string; rev: number; deps?: LiveDeps; onEnd?: (rev: number) => void },
  ): Promise<LiveBacklog> {
    const root = requireRoot(ctx);
    const snapshot = await loadSnapshot(root);
    const head = await resolveCommit(root, 'HEAD');
    const sync = await syncJson(ctx);
    const live = new LiveBacklog({
      ctx,
      root,
      boot: opts.boot,
      rev: opts.rev,
      snapshot,
      head,
      sync,
      onEnd: opts.onEnd ?? (() => {}),
    });
    await live.#begin(sync !== null, opts.deps ?? {});
    return live;
  }

  async #begin(ownCopy: boolean, deps: LiveDeps): Promise<void> {
    const syncDir = ownCopy ? await stateDir(this.#root) : undefined;
    this.#watched = await watchWorkingCopy(
      this.#root,
      {
        ...(syncDir === undefined ? {} : { syncDir }),
        ...(deps.watch === undefined ? {} : { watch: deps.watch }),
      },
      {
        ref: () => {
          this.#refDirty = true;
          this.#kick();
        },
        paths: (paths) => {
          if (paths === 'all') this.#full = true;
          else for (const p of paths) this.#paths.add(p);
          clearTimeout(this.#treeTimer);
          this.#treeTimer = setTimeout(() => {
            this.#treeReady = true;
            this.#kick();
          }, LIVE_TIMING.debounceMs);
        },
        sync: () => {
          clearTimeout(this.#syncTimer);
          this.#syncTimer = setTimeout(() => {
            this.#syncDirty = true;
            this.#kick();
          }, LIVE_TIMING.debounceMs);
        },
      },
    );
    // Sicherheitsnetz: `fs.watch` kann Ereignisse verlieren; `HEAD` wird regelmäßig verglichen.
    this.#safety = setInterval(() => {
      this.#refDirty = true;
      this.#kick();
    }, LIVE_TIMING.safetyMs);
    if (ownCopy) this.#stopPeriodic = await startPeriodicSync(this.#ctx, deps.sync);
    this.#linger();
  }

  get rev(): number {
    return this.#rev;
  }

  get head(): string {
    return this.#head;
  }

  #id(): string {
    return `${this.#boot}:${this.#rev}`;
  }

  /**
   * Meldet `listener` an: zuerst `hello`, dann mit `lastEventId` die verpassten Patches oder `reset`
   * (fremder Prozess, außerhalb des Puffers, ungültig), danach der Sync-Zustand, falls es einen
   * gibt. Liefert die Abmeldung; mit dem letzten Abonnenten beginnt die Frist bis zum Ende.
   */
  subscribe(listener: LiveListener, lastEventId?: string): () => void {
    clearTimeout(this.#lingerTimer);
    listener({ event: 'hello', data: { rev: this.#rev, head: this.#head } }, this.#id());
    if (lastEventId !== undefined) {
      const missed = this.#since(lastEventId);
      if (missed === undefined) listener({ event: 'reset', data: {} }, this.#id());
      else for (const p of missed) listener({ event: 'patch', data: p }, `${this.#boot}:${p.rev}`);
    }
    if (this.#sync !== undefined) listener({ event: 'sync', data: this.#sync.json }, this.#id());
    this.#listeners.add(listener);
    return () => {
      if (this.#listeners.delete(listener) && this.#listeners.size === 0) this.#linger();
    };
  }

  subscribers(): number {
    return this.#listeners.size;
  }

  /** Patches nach der Event-ID; `undefined`, wenn sie nicht aus diesem Puffer nachholbar sind. */
  #since(lastEventId: string): PatchJson[] | undefined {
    const parsed = parseEventId(lastEventId);
    if (parsed === undefined || parsed.boot !== this.#boot || parsed.rev > this.#rev) {
      return undefined;
    }
    if (parsed.rev === this.#rev) return [];
    const first = this.#buffer[0]?.rev ?? this.#rev + 1;
    if (parsed.rev + 1 < first) return undefined;
    return this.#buffer.filter((p) => p.rev > parsed.rev);
  }

  #linger(): void {
    clearTimeout(this.#lingerTimer);
    if (this.#stopped) return;
    this.#lingerTimer = setTimeout(() => {
      if (this.#listeners.size === 0) void this.stop();
    }, LIVE_TIMING.lingerMs);
  }

  #emit(event: ServerEvent, id: string): void {
    for (const l of [...this.#listeners]) {
      try {
        l(event, id);
      } catch {
        // Ein Abonnent, der nicht mehr schreiben kann, verliert nur sich selbst.
        this.#listeners.delete(l);
      }
    }
  }

  #kick(): void {
    if (this.#stopped || this.#running !== undefined) return;
    this.#running = (async () => {
      try {
        while (!this.#stopped && (this.#refDirty || this.#treeReady || this.#syncDirty)) {
          await this.#round();
        }
      } finally {
        this.#running = undefined;
      }
    })();
  }

  /** Wartet, bis keine Runde mehr läuft. */
  async idle(): Promise<void> {
    while (this.#running !== undefined) await this.#running;
  }

  async #round(): Promise<void> {
    const tree = this.#refDirty || this.#treeReady;
    this.#refDirty = false;
    this.#treeReady = false;
    let syncDue = this.#syncDirty;
    this.#syncDirty = false;
    if (tree && (await this.#refresh())) syncDue = true;
    if (syncDue) await this.#refreshSync();
  }

  /** Schreibt den Snapshot fort; liefert, ob `HEAD` sich bewegt hat. */
  async #refresh(): Promise<boolean> {
    const paths = new Set(this.#paths);
    this.#paths.clear();
    let full = this.#full;
    this.#full = false;
    let head: string;
    try {
      head = await resolveCommit(this.#root, 'HEAD');
    } catch {
      head = this.#head;
    }
    const moved = head !== this.#head;
    if (moved) {
      try {
        for (const p of await changedPaths(this.#root, this.#head, head)) {
          if (watchedPath(p)) paths.add(p);
        }
      } catch {
        full = true;
      }
    }
    this.#head = head;
    for (const p of paths) if (needsFullReload(p)) full = true;
    const touched = touchedIssues(paths);
    let next: BacklogSnapshot;
    try {
      if (full) {
        next = await loadSnapshot(this.#root);
      } else {
        // Kommentare und Anhänge liest der Snapshot nicht; sie stehen nur in `touched`.
        const entityPaths = [...paths].filter(
          (p) => p.endsWith('.md') && touchedIssues([p]).length === 0,
        );
        const reread = [...new Set([...entityPaths, ...orphanedProjectPaths(this.#snapshot)])];
        next = snapshotAt(this.#snapshot, await readPaths(this.#root, reread));
      }
    } catch {
      // Kaputte Config oder ein Lesefehler: Der Stand bleibt; die nächste Runde lädt ganz neu.
      this.#full = true;
      for (const p of paths) this.#paths.add(p);
      return moved;
    }
    const table = entityTable(next);
    const diff = diffTables(this.#table, table, touched);
    this.#snapshot = next;
    this.#table = table;
    if (diff !== undefined) {
      this.#rev += 1;
      const patch: PatchJson = { rev: this.#rev, head, ...diff };
      this.#buffer.push(patch);
      if (this.#buffer.length > LIVE_TIMING.buffer) this.#buffer.shift();
      this.#emit({ event: 'patch', data: patch }, this.#id());
    }
    return moved;
  }

  async #refreshSync(): Promise<void> {
    let json: Record<string, unknown> | null;
    try {
      json = await syncJson(this.#ctx);
    } catch {
      return;
    }
    if (json === null) return;
    const text = JSON.stringify(json);
    if (text === this.#sync?.text) return;
    this.#sync = { json, text };
    this.#emit({ event: 'sync', data: json }, this.#id());
  }

  /** Beendet Watcher und Timer, wartet die laufende Runde ab; meldet den letzten `rev`. Idempotent. */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    clearTimeout(this.#treeTimer);
    clearTimeout(this.#syncTimer);
    clearTimeout(this.#lingerTimer);
    clearInterval(this.#safety);
    this.#watched?.close();
    this.#stopPeriodic();
    this.#listeners.clear();
    await this.idle();
    this.#onEnd(this.#rev);
  }
}

/**
 * Alle `LiveBacklog`s eines Serverprozesses. `boot` sind 8 Hex-Zeichen Zufall je Prozess. Der Hub
 * merkt sich je Backlog den letzten `rev`: Ein neuer Watcher beginnt dahinter mit leerem Puffer,
 * sodass jede ältere Event-ID ein `reset` ergibt.
 */
export class LiveHub {
  readonly boot: string;
  readonly #deps: LiveDeps;
  readonly #live = new Map<string, Promise<LiveBacklog>>();
  readonly #current = new Map<string, LiveBacklog>();
  readonly #lastRev = new Map<string, number>();
  #closed = false;

  constructor(opts: { boot?: string; deps?: LiveDeps } = {}) {
    this.boot = opts.boot ?? Buffer.from(randomBytes(4)).toString('hex');
    this.#deps = opts.deps ?? {};
  }

  /** Der laufende Watcher des Backlogs, sonst ein neu gestarteter; ein Startfehler geht weiter. */
  acquire(backlog: string, context: () => Promise<ResolvedContext>): Promise<LiveBacklog> {
    const running = this.#live.get(backlog);
    if (running !== undefined) return running;
    const last = this.#lastRev.get(backlog);
    const started = (async () => {
      const live = await LiveBacklog.start(await context(), {
        boot: this.boot,
        rev: last === undefined ? 0 : last + 1,
        deps: this.#deps,
        onEnd: (rev) => {
          this.#lastRev.set(backlog, rev);
          if (this.#current.get(backlog) === live) {
            this.#current.delete(backlog);
            this.#live.delete(backlog);
          }
        },
      });
      if (this.#closed) {
        await live.stop();
      } else {
        this.#current.set(backlog, live);
      }
      return live;
    })();
    this.#live.set(backlog, started);
    started.catch(() => {
      if (this.#live.get(backlog) === started) this.#live.delete(backlog);
    });
    return started;
  }

  /** `rev` des laufenden Watchers, sonst der letzte gemerkte, sonst 0. */
  revOf(backlog: string): number {
    return this.#current.get(backlog)?.rev ?? this.#lastRev.get(backlog) ?? 0;
  }

  /** Beendet alle Watcher; spätere `acquire` beenden ihren Watcher sofort wieder. */
  async close(): Promise<void> {
    this.#closed = true;
    const all = [...this.#live.values()];
    await Promise.all(all.map(async (p) => (await p.catch(() => undefined))?.stop()));
  }
}

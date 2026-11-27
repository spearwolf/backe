/**
 * Live-Zustand eines Backlogs für den Event-Stream von `backe ui` (ui.md §2.4): Watcher auf die
 * Arbeitskopie, Snapshot per Delta fortschreiben, Patches mit fortlaufendem `rev` an die
 * Abonnenten, Puffer für das Nachholen. Ereignisse setzen nur Flags; eine einzige Schleife arbeitet
 * sie nacheinander ab (Single-Flight mit Nachlauf). So verschmelzen Bursts, und kein Patch
 * überholt einen anderen.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ResolvedContext } from '../context/resolve.ts';
import { compareCodeUnits } from '../core/compare.ts';
import { git } from '../git/exec.ts';
import { resolveCommit } from '../git/history.ts';
import { stateDir } from '../git/local-state.ts';
import { requireRoot } from '../services/read.ts';
import { scheduleSync, spawnDetached } from '../services/schedule.ts';
import type { SyncDeps } from '../services/sync.ts';
import { requireHeadConfig } from '../services/write.ts';
import {
  type BacklogSnapshot,
  loadSnapshot,
  orphanedProjectPaths,
  snapshotAt,
} from '../store/snapshot.ts';
import { pendingStarts } from '../tools/run.ts';
import { startPeriodicSync } from '../tools/sync.ts';
import { issueActors, mergeActors } from './actors.ts';
import type { PatchJson, ServerEvent } from './api.ts';
import {
  BACKLOG_DIRS,
  diffTables,
  type EntityTable,
  entityTable,
  needsFullReload,
  touchedIssue,
  watchedPath,
} from './delta.ts';
import { NeighborWatch } from './neighbors.ts';
import { hasOwnCopy, syncJson } from './state.ts';
import { type Watched, type WatchFn, watchWorkingCopy } from './watch.ts';

/** Zeitkonstanten und Puffergröße aus ui.md §2.4.1 und §2.4.3. */
export const LIVE_TIMING = {
  debounceMs: 150,
  neighborMs: 250,
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

/** Die gesammelten Actors, beschränkt auf die Issues des Patches; `undefined`, wenn keine bleiben. */
function patchActors(
  patch: PatchJson,
  actors: Map<string, Set<string>>,
): Record<string, string[]> | undefined {
  const ids = new Set<string>(patch.touched);
  for (const issue of patch.upsert.issues ?? []) ids.add(issue.id);
  for (const id of patch.remove.issues ?? []) ids.add(id);
  const out: Record<string, string[]> = {};
  for (const id of [...ids].sort(compareCodeUnits)) {
    const handles = actors.get(id);
    if (handles !== undefined) out[id] = [...handles].sort(compareCodeUnits);
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

/**
 * Signatur eines Pfads für `touched`: Inhalts-Hash einer Datei, `dir` für ein Verzeichnis, `gone`
 * für einen fehlenden. Nach Inhalt, nicht nach mtime: `backe commit` schreibt unveränderte Dateien
 * neu, und das ist keine Änderung.
 */
async function signature(root: string, path: string): Promise<string> {
  try {
    return createHash('sha256')
      .update(await readFile(join(root, path)))
      .digest('hex');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    if (code === 'EISDIR') return 'dir';
    if (MISSING.has(code)) return 'gone';
    throw err;
  }
}

export type LiveStartOptions = {
  boot: string;
  /** Der erste `rev`. */
  rev: number;
  deps?: LiveDeps;
  /**
   * Synchron, sobald der Watcher endet (ohne Abonnenten nach `lingerMs`, oder per `stop`), mit dem
   * letzten `rev`: Danach entsteht kein Patch mehr.
   */
  onStop?: (rev: number) => void;
};

export class LiveBacklog {
  readonly #ctx: ResolvedContext;
  readonly #root: string;
  readonly #boot: string;
  readonly #onStop: (rev: number) => void;
  #snapshot!: BacklogSnapshot;
  #table!: EntityTable;
  #head = '';
  /** Handles der Commits seit dem letzten Vergleich je Issue; der nächste Patch hängt sie an. */
  #actors = new Map<string, Set<string>>();
  #rev: number;
  #buffer: PatchJson[] = [];
  #sync: { json: Record<string, unknown>; text: string } | undefined;
  readonly #listeners = new Set<LiveListener>();
  /** Zuletzt gesehene Signatur je Kommentar- oder Anhangspfad; nur eine Änderung ergibt `touched`. */
  readonly #touchSigs = new Map<string, string>();
  /** Inhalts-Signatur je geänderter Datei im Arbeitsbaum beim letzten Blick des Sicherheitsnetzes. */
  #dirtySigs = new Map<string, string>();
  #scanDue = false;

  /** Offene Arbeit: Pfade aus dem Arbeitsbaum, vollständiges Neuladen, Ref, Sync-Zustand. */
  readonly #paths = new Set<string>();
  #full = false;
  #treeReady = false;
  #refDirty = false;
  #syncDirty = false;
  #running: Promise<void> | undefined;
  /** Erst nach dem Laden des Stands laufen Runden; Ereignisse davor bleiben als Flags liegen. */
  #ready = false;

  #watched: Watched | undefined;
  #neighbors: NeighborWatch | undefined;
  /** Erfüllt sich, wenn die Nachbar-Watch zu ist und ihr laufender `check` fertig. */
  #neighborsClosed: Promise<void> = Promise.resolve();
  /** Laufende `scheduleSync` nach einer Bewegung der Nachbarn; `stop` wartet sie ab. */
  readonly #starts = pendingStarts();
  #stopPeriodic: () => void = () => {};
  #treeTimer: ReturnType<typeof setTimeout> | undefined;
  #syncTimer: ReturnType<typeof setTimeout> | undefined;
  #lingerTimer: ReturnType<typeof setTimeout> | undefined;
  #safety: ReturnType<typeof setInterval> | undefined;
  #stopped = false;

  private constructor(ctx: ResolvedContext, root: string, opts: LiveStartOptions) {
    this.#ctx = ctx;
    this.#root = root;
    this.#boot = opts.boot;
    this.#rev = opts.rev;
    this.#onStop = opts.onStop ?? (() => {});
  }

  /**
   * Beginnt zu beobachten und lädt danach den Stand von `root` des Kontexts: erst die Watcher, dann
   * `HEAD`, dann der Snapshot. Was sich dazwischen ändert, liegt als Ereignis vor und läuft nach dem
   * Laden als Runde; nichts fällt in eine Lücke. Ohne Arbeitskopie oder mit kaputter Backlog-Config
   * wirft es wie `/state` und hinterlässt weder Watcher noch Timer.
   */
  static async start(ctx: ResolvedContext, opts: LiveStartOptions): Promise<LiveBacklog> {
    const live = new LiveBacklog(ctx, requireRoot(ctx), opts);
    try {
      await live.#open(opts.deps ?? {});
    } catch (err) {
      // Wie `stop`: Schon der erste Blick der Nachbar-Watch kann eine Prüfung für einen Sync
      // angestoßen haben; auch sie überlebt einen gescheiterten Start nicht.
      live.#teardown();
      await live.#neighborsClosed;
      await live.#starts.settled();
      throw err;
    }
    return live;
  }

  async #open(deps: LiveDeps): Promise<void> {
    const ownCopy = await hasOwnCopy(this.#ctx);
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
    if (ownCopy) await this.#watchNeighbors(deps);
    // Sicherheitsnetz: `fs.watch` kann Ereignisse verlieren. Regelmäßig werden `HEAD` und die im
    // Arbeitsbaum geänderten Dateien mit dem letzten Blick verglichen, dazu die Refs der Nachbarn.
    this.#safety = setInterval(() => {
      this.#refDirty = true;
      this.#scanDue = true;
      this.#kick();
      // `check` lehnt nur Programmierfehler ab; die kosten hier nur diesen Blick. Geloggt wird
      // nicht: `backe ui` hat keinen Logger und gibt außer seiner Startzeile nichts aus.
      void this.#neighbors?.check().catch(() => {});
    }, LIVE_TIMING.safetyMs);
    this.#head = await resolveCommit(this.#root, 'HEAD');
    this.#dirtySigs = await this.#dirtyFiles();
    this.#snapshot = await loadSnapshot(this.#root);
    this.#table = entityTable(this.#snapshot);
    if (ownCopy) await this.#openSync(deps);
    this.#ready = true;
    this.#linger();
    this.#kick();
  }

  /**
   * Nur bei eigener Arbeitskopie, nach ihren Watchern und vor dem Laden von `HEAD`: die
   * Nachbar-Watch. Liegt ein Nachbar schon beim Start vorn, startet ihr erster Durchlauf sofort
   * einen Sync; dessen Pull bewegt `HEAD` dann nach dem Laden und ergibt einen Patch.
   */
  async #watchNeighbors(deps: LiveDeps): Promise<void> {
    // Pusht ein Nachbar (ui.md §2.4.1 Punkt 3), holt ein Hintergrund-Sync den Stand, statt bis zum
    // nächsten `pull_interval` zu warten; der Pull bewegt dann `HEAD` und ergibt den Patch.
    // `sync.remote` und `sync.branch` gelten, wie sie beim Start in `HEAD` stehen: Eine Änderung
    // wirkt erst mit dem nächsten Start des Watchers.
    const { remote, branch } = (await requireHeadConfig(this.#root)).sync;
    this.#neighbors = await NeighborWatch.start({
      backlogDir: join(this.#ctx.homes.backeHome, 'backlogs', this.#ctx.backlog.value),
      own: this.#root,
      remote,
      branch,
      debounceMs: LIVE_TIMING.neighborMs,
      ...(deps.watch === undefined ? {} : { watch: deps.watch }),
      onMove: () => this.#neighborMoved(deps.sync),
    });
  }

  /**
   * Nur bei eigener Arbeitskopie, erst nach `HEAD` und Snapshot: Sync-Zustand und periodischer
   * Sync. Die Reihenfolge zählt: Ein Commit nach dem Lesen von `HEAD` bewegt den Ref, die nächste
   * Runde liest dann auch den Sync-Zustand neu. Läse der Start `unpushed` vor `HEAD`, stünde ein
   * Commit dazwischen schon in `hello`, und keine Runde holte `unpushed` nach.
   */
  async #openSync(deps: LiveDeps): Promise<void> {
    const sync = await syncJson(this.#ctx);
    if (sync !== null) this.#sync = { json: sync, text: JSON.stringify(sync) };
    this.#stopPeriodic = await startPeriodicSync(this.#ctx, deps.sync);
  }

  /**
   * Ein Nachbar hat sich auf einen unbekannten Stand bewegt: Hintergrund-Sync wie ein Takt des
   * periodischen, ob er läuft, entscheidet `scheduleSync`. Nach dem Ende startet nichts mehr, auch
   * kein `scheduleSync`, der beim Ende noch prüfte.
   */
  #neighborMoved(sync: SyncDeps | undefined): void {
    // Vertragswache: `NeighborWatch` ruft `onMove` nach `close` nie, und `#teardown` schließt sie
    // im selben Schritt, in dem es `#stopped` setzt; erreichbar ist das also heute nicht. Die
    // Prüfung bleibt, damit ein geänderter Vertrag der Watch keinen Sync nach dem Ende startet.
    if (this.#stopped) return;
    const spawn = sync?.spawn ?? spawnDetached;
    this.#starts.add(
      scheduleSync(this.#ctx, 'periodic', {
        ...sync,
        spawn: (args) => {
          if (!this.#stopped) spawn(args);
        },
      }),
    );
  }

  /** Watcher, Timer und periodischen Sync abbauen. */
  #teardown(): void {
    this.#stopped = true;
    clearTimeout(this.#treeTimer);
    clearTimeout(this.#syncTimer);
    clearTimeout(this.#lingerTimer);
    clearInterval(this.#safety);
    this.#watched?.close();
    this.#neighborsClosed = this.#neighbors?.close() ?? Promise.resolve();
    this.#stopPeriodic();
    this.#listeners.clear();
  }

  get rev(): number {
    return this.#rev;
  }

  get head(): string {
    return this.#head;
  }

  /** Ob der Watcher beendet ist; ein beendeter liefert keine Patches mehr. */
  get stopped(): boolean {
    return this.#stopped;
  }

  /** Event-ID des aktuellen Stands, `<boot>:<rev>`. */
  get eventId(): string {
    return this.#id();
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

  #due(): boolean {
    return !this.#stopped && (this.#refDirty || this.#treeReady || this.#syncDirty);
  }

  #kick(): void {
    if (!this.#ready || this.#running !== undefined || !this.#due()) return;
    const run = (async () => {
      while (this.#due()) {
        try {
          await this.#round();
        } catch {
          // Ein unerwarteter Fehler kostet nur diese Runde; die nächste lädt vollständig.
          this.#full = true;
        }
      }
    })();
    // Erst zuweisen, dann abmelden: Auch eine Schleife, die sofort fertig wäre, bleibt nicht hängen.
    this.#running = run;
    void run.finally(() => {
      if (this.#running === run) this.#running = undefined;
    });
  }

  /** Wartet, bis keine Runde mehr läuft. */
  async idle(): Promise<void> {
    while (this.#running !== undefined) await this.#running;
  }

  /**
   * Geänderte, neue und gelöschte Dateien der Backlog-Verzeichnisse gegenüber `HEAD` samt
   * Inhalts-Signatur. `--no-optional-locks`: Der Blick schreibt den Index nicht und kommt so keinem
   * Write in die Quere.
   */
  async #dirtyFiles(): Promise<Map<string, string>> {
    const { stdout } = await git(
      [
        '--no-optional-locks',
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--no-renames',
        '--',
        ...BACKLOG_DIRS,
      ],
      { cwd: this.#root },
    );
    const sigs = new Map<string, string>();
    for (const entry of stdout.split('\0')) {
      const path = entry.slice(3);
      if (path === '' || !watchedPath(path)) continue;
      sigs.set(path, await signature(this.#root, path));
    }
    return sigs;
  }

  /** Dateien im Arbeitsbaum, die sich seit dem letzten Blick geändert haben. */
  async #scan(): Promise<string[]> {
    const now = await this.#dirtyFiles();
    const changed: string[] = [];
    for (const [path, sig] of now) if (this.#dirtySigs.get(path) !== sig) changed.push(path);
    // Nicht mehr geändert heißt: wieder gleich `HEAD`; auch das kann sichtbar sein.
    for (const path of this.#dirtySigs.keys()) if (!now.has(path)) changed.push(path);
    this.#dirtySigs = now;
    return changed;
  }

  /**
   * Ob ein Pfad aus dem Arbeitsbaum keine Datei nennt: ein Verzeichnis (FSEvents fasst Änderungen
   * so zusammen, inotify meldet ein neues) oder einen verschwundenen Pfad, der eines gewesen sein
   * kann. Welche Dateien darunter sich geändert haben, sagt erst der Blick des Sicherheitsnetzes.
   */
  async #vague(paths: Iterable<string>): Promise<boolean> {
    for (const p of paths) {
      try {
        if ((await stat(join(this.#root, p))).isDirectory()) return true;
      } catch (err) {
        if (MISSING.has((err as NodeJS.ErrnoException).code ?? '')) return true;
        throw err;
      }
    }
    return false;
  }

  async #round(): Promise<void> {
    if (this.#scanDue) {
      this.#scanDue = false;
      for (const p of await this.#scan()) this.#paths.add(p);
    }
    const tree = this.#refDirty || this.#treeReady;
    this.#refDirty = false;
    this.#treeReady = false;
    let syncDue = this.#syncDirty;
    this.#syncDirty = false;
    if (tree && (await this.#refresh())) syncDue = true;
    if (syncDue) await this.#refreshSync();
  }

  /**
   * Issues, deren Kommentar- oder Anhangspfade sich seit dem letzten Blick geändert haben. Ein
   * Verzeichnis zählt nicht selbst; seine geänderten Dateien kommen aus dem Diff oder dem Blick auf
   * den Arbeitsbaum.
   */
  async #touched(paths: Iterable<string>): Promise<string[]> {
    const ids = new Set<string>();
    for (const p of paths) {
      const id = touchedIssue(p);
      if (id === undefined) continue;
      const sig = await signature(this.#root, p);
      if (sig === 'dir') continue;
      if (this.#touchSigs.get(p) !== sig) ids.add(id);
      this.#touchSigs.set(p, sig);
    }
    return [...ids];
  }

  /** Schreibt den Snapshot fort; liefert, ob `HEAD` sich bewegt hat. */
  async #refresh(): Promise<boolean> {
    const paths = new Set(this.#paths);
    this.#paths.clear();
    let full = this.#full;
    this.#full = false;
    let head: string;
    try {
      // Nennt ein Ereignis keine Datei, findet der Blick auf den Arbeitsbaum die geänderten;
      // sonst gingen Kommentare und Anhänge ohne Commit bis zum Sicherheitsnetz verloren.
      if (full || (await this.#vague(paths))) for (const p of await this.#scan()) paths.add(p);
    } catch {
      full = true;
    }
    try {
      head = await resolveCommit(this.#root, 'HEAD');
    } catch {
      head = this.#head;
    }
    const moved = head !== this.#head;
    if (!moved && !full && paths.size === 0) return false;
    if (moved) {
      try {
        for (const p of await changedPaths(this.#root, this.#head, head)) {
          if (watchedPath(p)) paths.add(p);
        }
      } catch {
        full = true;
      }
    }
    if (moved) {
      try {
        mergeActors(this.#actors, await issueActors(this.#root, this.#head, head));
      } catch {
        // Ohne Actors bleibt der Patch, was er war: ein Hinweis fehlt, keine Änderung.
      }
    }
    this.#head = head;
    for (const p of paths) if (needsFullReload(p)) full = true;
    let next: BacklogSnapshot;
    let touched: string[];
    try {
      touched = await this.#touched(paths);
      if (full) {
        next = await loadSnapshot(this.#root);
      } else {
        // Kommentare und Anhänge liest der Snapshot nicht; sie stehen nur in `touched`.
        const entityPaths = [...paths].filter(
          (p) => p.endsWith('.md') && touchedIssue(p) === undefined,
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
    // Ein Ende während der Runde friert `rev` ein; der Rest der Runde verwirft sein Ergebnis.
    if (this.#stopped) return moved;
    const table = entityTable(next);
    const diff = diffTables(this.#table, table, touched);
    this.#snapshot = next;
    this.#table = table;
    const actors = this.#actors;
    this.#actors = new Map();
    if (diff !== undefined) {
      this.#rev += 1;
      const patch: PatchJson = { rev: this.#rev, head, ...diff };
      const named = patchActors(patch, actors);
      if (named !== undefined) patch.actors = named;
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
    if (json === null || this.#stopped) return;
    const text = JSON.stringify(json);
    if (text === this.#sync?.text) return;
    this.#sync = { json, text };
    this.#emit({ event: 'sync', data: json }, this.#id());
  }

  /**
   * Beendet Watcher und Timer und meldet den letzten `rev` sofort an `onStop`; wartet danach die
   * laufende Runde ab, die nichts mehr sendet, den laufenden Blick der Nachbar-Watch und die
   * Prüfungen nach einer Bewegung der Nachbarn, die nichts mehr starten. So ist nach `stop` (und
   * nach `LiveHub.close`) weder ein Git-Prozess der Nachbar-Watch noch eine Prüfung mehr offen, die
   * dieser Watcher für einen Sync angestoßen hat. Idempotent.
   */
  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#teardown();
    this.#onStop(this.#rev);
    await this.idle();
    await this.#neighborsClosed;
    await this.#starts.settled();
  }
}

/**
 * Alle `LiveBacklog`s eines Serverprozesses. `boot` sind 8 Hex-Zeichen Zufall je Prozess. Der Hub
 * merkt sich je Backlog den letzten `rev`: Ein neuer Watcher beginnt dahinter mit leerem Puffer,
 * sodass jede ältere Event-ID ein `reset` ergibt. Ein endender Watcher verlässt den Hub sofort; wer
 * danach `acquire` ruft, bekommt einen neuen.
 */
export class LiveHub {
  readonly boot: string;
  readonly #deps: LiveDeps;
  readonly #live = new Map<string, Promise<LiveBacklog>>();
  readonly #current = new Map<string, LiveBacklog>();
  readonly #lastRev = new Map<string, number>();
  #closed = false;

  constructor(opts: { boot?: string; deps?: LiveDeps } = {}) {
    this.boot = opts.boot ?? randomBytes(4).toString('hex');
    this.#deps = opts.deps ?? {};
  }

  /** Der laufende Watcher des Backlogs, sonst ein neu gestarteter; ein Startfehler geht weiter. */
  acquire(backlog: string, context: () => Promise<ResolvedContext>): Promise<LiveBacklog> {
    const running = this.#live.get(backlog);
    if (running !== undefined) return running;
    const last = this.#lastRev.get(backlog);
    // `started` steht vor dem ersten `await` fest; die Rückfragen darauf laufen erst danach.
    let started!: Promise<LiveBacklog>;
    started = (async () => {
      const live = await LiveBacklog.start(await context(), {
        boot: this.boot,
        rev: last === undefined ? 0 : last + 1,
        deps: this.#deps,
        onStop: (rev) => {
          this.#lastRev.set(backlog, rev);
          if (this.#live.get(backlog) === started) {
            this.#live.delete(backlog);
            this.#current.delete(backlog);
          }
        },
      });
      if (this.#closed) await live.stop();
      else if (this.#live.get(backlog) === started) this.#current.set(backlog, live);
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

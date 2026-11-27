/**
 * Nachbarn der eigenen Arbeitskopie für `backe ui` (ui.md §2.4.1 Punkt 3): der lokale Hub
 * `hub.git` und die übrigen Arbeitskopien desselben Backlogs, alle als direkte Unterverzeichnisse
 * von `<BACKE_HOME>/backlogs/<backlog>/`. Beobachtet wird beim Hub `refs/heads/<branch>`, bei einer
 * Arbeitskopie `refs/remotes/<remote>/<branch>` — der Stand, den sie zuletzt gepusht oder geholt
 * hat. Eine Bewegung meldet nur, wer auf einen Commit zeigt, den die eigene Arbeitskopie noch nicht
 * hat; der eigene Push in den Hub zählt so nicht. Ein Watch-Ereignis ist nur der Anlass zum
 * Vergleich, die Werte der Refs entscheiden. Der Blick beim Start ist die Grundlinie; ein später
 * entdeckter Nachbar zählt schon mit dem ersten Blick, denn eine frische Arbeitskopie pusht oft in
 * derselben Ruhephase, in der sie entsteht. Nachbarn sind eine Optimierung: Nichts hier wirft.
 */
import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { physicalPath } from '../context/paths.ts';
import { git } from '../git/exec.ts';
import { isAncestor } from '../git/history.ts';
import { exists } from '../store/files.ts';
import { fsWatch, gitDirs, PACKED_FILES, slashed, type WatchFn } from './watch.ts';

export type NeighborOptions = {
  /** `<BACKE_HOME>/backlogs/<backlog>` */
  backlogDir: string;
  /** Die eigene Arbeitskopie; zählt nie als Nachbar und entscheidet, was schon bekannt ist. */
  own: string;
  remote: string;
  branch: string;
  /** Ruhe nach dem letzten Ereignis, bevor `check` läuft (`LIVE_TIMING.neighborMs`). */
  debounceMs: number;
  watch?: WatchFn;
  /** Höchstens einmal je `check`, wenn sich ein Nachbar-Ref auf einen unbekannten Stand bewegt hat. */
  onMove: () => void;
};

const HUB = 'hub.git';

type Handle = { close(): void };

type Neighbor = {
  ref: string;
  handles: Handle[];
  /** Letzter Blick: `undefined` vor dem ersten, `null`, solange der Ref fehlt. */
  last: string | null | undefined;
};

export class NeighborWatch {
  readonly #opts: NeighborOptions;
  readonly #watch: WatchFn;
  /** Physischer Pfad der eigenen Arbeitskopie; bis er sich auflösen lässt, fällt jeder Durchlauf aus. */
  #own: string | undefined;
  readonly #neighbors = new Map<string, Neighbor>();
  #dirHandle: Handle | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #running: Promise<void> | undefined;
  #again = false;
  #closed = false;
  /** Nach dem ersten Blick beim Start: Neue Nachbarn zählen dann schon mit ihrem ersten Blick. */
  #started = false;

  private constructor(opts: NeighborOptions) {
    this.#opts = opts;
    this.#watch = opts.watch ?? fsWatch;
  }

  /**
   * Öffnet die Watches und liest den ersten Blick; wirft nie. Was dabei nicht aufgeht (ein
   * fehlendes Backlog-Verzeichnis, ein Watch-Fehler), versucht der nächste `check` erneut.
   */
  static async start(opts: NeighborOptions): Promise<NeighborWatch> {
    const nw = new NeighborWatch(opts);
    await nw.#watchDir();
    await nw.check();
    nw.#started = true;
    return nw;
  }

  /** Nachbarn neu lesen, Refs vergleichen; Single-Flight mit Nachlauf. Wirft nie. */
  check(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#running !== undefined) {
      this.#again = true;
      return this.#running;
    }
    const run = async () => {
      do {
        this.#again = false;
        try {
          await this.#round();
        } catch {
          // Ein Fehler beim Lesen des Backlog-Verzeichnisses kostet nur diesen Durchlauf.
        }
      } while (this.#again && !this.#closed);
    };
    this.#running = run().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  /** Watches und Debounce-Timer abbauen; danach meldet `onMove` nie mehr. */
  close(): void {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#dirHandle?.close();
    this.#dirHandle = undefined;
    for (const n of this.#neighbors.values()) for (const h of n.handles) h.close();
    this.#neighbors.clear();
  }

  #schedule(): void {
    if (this.#closed) return;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.check();
    }, this.#opts.debounceMs);
  }

  /**
   * Beobachtet das Backlog-Verzeichnis, sobald es existiert: Entsteht oder verschwindet ein
   * Nachbar, liest der nächste `check` die Einträge neu. Ein fehlendes Verzeichnis bekommt keinen
   * (stummen) Watch, damit ein späterer Durchlauf ihn öffnet.
   */
  async #watchDir(): Promise<void> {
    try {
      if (!(await exists(this.#opts.backlogDir))) return;
      const h = this.#watch(this.#opts.backlogDir, { recursive: false }, () => this.#schedule());
      if (this.#closed) h.close();
      else this.#dirHandle = h;
    } catch {
      // Der nächste Durchlauf versucht es erneut.
    }
  }

  async #round(): Promise<void> {
    if (this.#dirHandle === undefined) await this.#watchDir();
    this.#own ??= await physicalPath(this.#opts.own);
    const found = await this.#candidates(this.#own);
    for (const [dir, n] of this.#neighbors) {
      if (found.has(dir)) continue;
      for (const h of n.handles) h.close();
      this.#neighbors.delete(dir);
    }
    let moved = false;
    for (const [dir, hub] of found) {
      if (this.#closed) return;
      try {
        const n = this.#neighbors.get(dir) ?? (await this.#open(dir, hub));
        if (n === undefined) continue;
        const value = await this.#read(dir, n.ref);
        const before = n.last;
        n.last = value;
        if (value === null || value === before) continue;
        // Der Blick beim Start ist die Grundlinie, keine Bewegung.
        if (before === undefined && !this.#started) continue;
        if (!(await this.#known(value))) moved = true;
      } catch {
        // Ein verschwundener oder kaputter Nachbar fällt aus diesem Durchlauf; der nächste versucht
        // es erneut.
      }
    }
    if (moved && !this.#closed) this.#opts.onMove();
  }

  /** Die Nachbarn im Backlog-Verzeichnis, Pfad → ist der Hub; die eigene Arbeitskopie nie. */
  async #candidates(own: string): Promise<Map<string, boolean>> {
    const found = new Map<string, boolean>();
    let entries: Dirent[];
    try {
      entries = await readdir(this.#opts.backlogDir, { withFileTypes: true });
    } catch {
      return found;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(this.#opts.backlogDir, e.name);
      const hub = e.name === HUB;
      try {
        if (!hub && !(await exists(join(dir, '.git')))) continue;
        if (!this.#neighbors.has(dir) && (await physicalPath(dir)) === own) continue;
      } catch {
        // Unlesbar: kein Nachbar, solange es so bleibt.
        continue;
      }
      found.set(dir, hub);
    }
    return found;
  }

  /**
   * Watches eines neu entdeckten Nachbarn; nach `close` keine. Beobachtet wird nur der Nachbar
   * selbst: Ist er kein Repository, fände git über die Elternverzeichnisse ein fremdes (etwa ein
   * Repo, in dem `BACKE_HOME` liegt). Beim Hub muss das Common-Dir der Hub sein, bei einer
   * Arbeitskopie das Git-Dir `<dir>/.git`.
   */
  async #open(dir: string, hub: boolean): Promise<Neighbor | undefined> {
    const { gitDir, commonDir } = await gitDirs(dir);
    const expected = await physicalPath(hub ? dir : join(dir, '.git'));
    if ((await physicalPath(hub ? commonDir : gitDir)) !== expected) return undefined;
    if (this.#closed) return undefined;
    const { remote, branch } = this.#opts;
    const top = hub ? 'heads' : 'remotes';
    const n: Neighbor = {
      ref: hub ? `refs/heads/${branch}` : `refs/remotes/${remote}/${branch}`,
      handles: [],
      last: undefined,
    };
    try {
      n.handles.push(
        this.#watch(join(commonDir, 'refs'), { recursive: true }, (name) => {
          const path = name === null ? null : slashed(name);
          if (path === null || path === top || path.startsWith(`${top}/`)) this.#schedule();
        }),
      );
      n.handles.push(
        this.#watch(commonDir, { recursive: false }, (name) => {
          if (name === null || PACKED_FILES.has(name)) this.#schedule();
        }),
      );
    } catch (err) {
      for (const h of n.handles) h.close();
      throw err;
    }
    this.#neighbors.set(dir, n);
    return n;
  }

  /** Wert von `ref` im Nachbarn; `null`, wenn der Ref fehlt. */
  async #read(dir: string, ref: string): Promise<string | null> {
    const { stdout, exitCode } = await git(['rev-parse', '--verify', '-q', ref], {
      cwd: dir,
      okExitCodes: [1],
    });
    return exitCode === 0 ? stdout.trim() : null;
  }

  /** Hat die eigene Arbeitskopie `sha` schon? Fehlt das Objekt dort, ist er unbekannt. */
  async #known(sha: string): Promise<boolean> {
    try {
      return await isAncestor(this.#opts.own, sha, 'HEAD');
    } catch {
      return false;
    }
  }
}

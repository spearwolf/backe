/**
 * Nachbarn der eigenen Arbeitskopie für `backe ui` (ui.md §2.4.1 Punkt 3): der lokale Hub
 * `hub.git` und die übrigen Arbeitskopien desselben Backlogs, alle als direkte Unterverzeichnisse
 * von `<BACKE_HOME>/backlogs/<backlog>/`. Beobachtet wird beim Hub `refs/heads/<branch>`, bei einer
 * Arbeitskopie `refs/remotes/<remote>/<branch>` — der Stand, den sie zuletzt gepusht oder geholt
 * hat. Eine Bewegung meldet nur, wer auf einen Commit zeigt, den die eigene Arbeitskopie noch nicht
 * hat; der eigene Push in den Hub zählt so nicht. Ein Watch-Ereignis ist nur der Anlass zum
 * Vergleich, die Werte der Refs entscheiden.
 *
 * Grundlinie ist genau, was der erste vollständige Durchlauf gelesen hat; diese Werte sind keine
 * Bewegung. Jeder spätere Durchlauf zählt, auch ein Nachlauf noch innerhalb von `start`: Ein
 * Nachbar, den der erste Durchlauf nicht lesen konnte oder der danach entsteht, ist neu, und sein
 * erster Wert zählt, wenn die eigene Arbeitskopie ihn nicht kennt — eine frische Arbeitskopie
 * pusht oft in derselben Ruhephase, in der sie entsteht. Ein gelöschter und neu angelegter Nachbar
 * ist ebenfalls neu, erkannt an Gerät und Inode seines Verzeichnisses und seines Git-Dirs. Vergibt
 * das Dateisystem dieselben Inodes neu, bleiben die alten, toten Watches, bis sich die Identität
 * ändert; das kostet nur Ereignisse, keine Bewegungen, denn jeder Durchlauf liest die Werte über
 * den Pfad, und das Sicherheitsnetz prüft alle 10 s.
 *
 * Nachbarn sind eine Optimierung: Git- und Dateisystemfehler kosten nur den betroffenen Nachbarn
 * oder Durchlauf. Durch kommen nur Fehler von `onMove` und Programmierfehler, und auch die nur bei
 * einem direkten Aufruf von `check`; bei einem selbst gestarteten verwirft die Watch sie.
 */
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { physicalPath } from '../context/paths.ts';
import { BackeError } from '../core/errors.ts';
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

type Candidate = { hub: boolean; id: string };

type Neighbor = {
  ref: string;
  /** Gerät und Inode von Verzeichnis und Git-Dir; ändert sich das, ist er neu. */
  id: string;
  handles: Handle[];
  /** Letzter Blick: `undefined` vor dem ersten, `null`, solange der Ref fehlt. */
  last: string | null | undefined;
};

/**
 * Fehler, die nur einen Nachbarn oder Durchlauf kosten: Git (`BackeError`) und Systemaufrufe (mit
 * numerischem `errno`). Fehler wie `ERR_INVALID_ARG_TYPE` haben nur einen `code`; sie sind
 * Programmierfehler.
 */
function skippable(err: unknown): boolean {
  return (
    err instanceof BackeError ||
    (err instanceof Error && typeof (err as NodeJS.ErrnoException).errno === 'number')
  );
}

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
  /** Der erste vollständige Durchlauf ist vorbei; ab jetzt zählt auch der erste Wert eines Nachbarn. */
  #baselined = false;

  private constructor(opts: NeighborOptions) {
    this.#opts = opts;
    this.#watch = opts.watch ?? fsWatch;
  }

  /**
   * Öffnet die Watches und liest die Grundlinie; wirft nie. Was dabei nicht aufgeht (ein
   * fehlendes Backlog-Verzeichnis, ein Watch-, Git- oder Dateisystemfehler, ein Fehler von
   * `onMove` in einem Nachlauf), versucht das nächste Ereignis oder der nächste `check` erneut.
   */
  static async start(opts: NeighborOptions): Promise<NeighborWatch> {
    const nw = new NeighborWatch(opts);
    try {
      await nw.#watchDir();
      await nw.check();
    } catch {
      // Ein unerwarteter Fehler kostet nur diese Runde; die Watch bleibt brauchbar, und das
      // nächste Ereignis prüft erneut. Geloggt wird nicht, weil `backe ui` außer seiner Startzeile
      // nichts ausgibt.
    }
    return nw;
  }

  /**
   * Nachbarn neu lesen, Refs vergleichen; Single-Flight mit Nachlauf. Git- und
   * Dateisystemfehler schluckt er; was `onMove` wirft und Programmierfehler lehnt er ab, nachdem
   * ein angeforderter Nachlauf noch gelaufen ist (mit dem ersten Fehler).
   */
  check(): Promise<void> {
    if (this.#closed) return Promise.resolve();
    if (this.#running !== undefined) {
      this.#again = true;
      return this.#running;
    }
    const run = async () => {
      let failure: { err: unknown } | undefined;
      try {
        do {
          this.#again = false;
          try {
            const moved = await this.#round();
            if (moved && !this.#closed) this.#opts.onMove();
          } catch (err) {
            // Ein angeforderter Nachlauf läuft trotzdem; abgelehnt wird mit dem ersten Fehler.
            failure ??= { err };
          }
        } while (this.#again && !this.#closed);
        if (failure !== undefined) throw failure.err;
      } finally {
        // Im selben Schritt wie die letzte Prüfung von `#again`: Ein `check` danach startet einen
        // eigenen Lauf statt sich an einen anzuhängen, der schon fertig ist. `#round` wartet immer,
        // darum ist `#running` hier schon gesetzt.
        this.#running = undefined;
      }
    };
    this.#running = run();
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
      this.check().catch(() => {
        // Ein unerwarteter Fehler kostet nur diese Runde; das nächste Ereignis prüft erneut. Ohne
        // Handler beendete die Ablehnung den Prozess und mit ihm den Server. Geloggt wird nicht,
        // weil `backe ui` außer seiner Startzeile nichts ausgibt.
      });
    }, this.#opts.debounceMs);
  }

  /**
   * Beobachtet das Backlog-Verzeichnis, sobald es existiert: Entsteht oder verschwindet ein
   * Nachbar, liest der nächste `check` die Einträge neu. Ein fehlendes Verzeichnis bekommt keinen
   * (stummen) Watch, damit ein späterer Durchlauf ihn öffnet.
   */
  async #watchDir(): Promise<void> {
    try {
      if (!(await exists(this.#opts.backlogDir)) || this.#closed) return;
      this.#dirHandle = this.#watch(this.#opts.backlogDir, { recursive: false }, () =>
        this.#schedule(),
      );
    } catch (err) {
      if (!skippable(err)) throw err;
      // Der nächste Durchlauf versucht es erneut.
    }
  }

  /** Ein Durchlauf; `true`, wenn sich ein Nachbar auf einen unbekannten Stand bewegt hat. */
  async #round(): Promise<boolean> {
    if (this.#closed) return false;
    if (this.#dirHandle === undefined) await this.#watchDir();
    try {
      this.#own ??= await physicalPath(this.#opts.own);
    } catch (err) {
      if (!skippable(err)) throw err;
      // Ohne eigene Arbeitskopie ließe sie sich nicht von den Nachbarn trennen; der Durchlauf fällt
      // aus und zählt nicht als Grundlinie.
      return false;
    }
    const found = await this.#candidates(this.#own);
    for (const [dir, n] of this.#neighbors) {
      if (found.get(dir)?.id === n.id) continue;
      for (const h of n.handles) h.close();
      this.#neighbors.delete(dir);
    }
    const baseline = !this.#baselined;
    let moved = false;
    // Neue Werte gelten erst, wenn der ganze Durchlauf gelungen ist: Bricht ein Programmierfehler
    // ihn ab, sieht der nächste dieselben Bewegungen noch einmal.
    const seen: [Neighbor, string | null][] = [];
    for (const [dir, c] of found) {
      if (this.#closed) return false;
      try {
        const n = this.#neighbors.get(dir) ?? (await this.#open(dir, c));
        if (n === undefined) continue;
        const value = await this.#read(dir, n.ref);
        const before = n.last;
        if (value !== null && value !== before && !(before === undefined && baseline)) {
          if (!(await this.#known(value))) moved = true;
        }
        seen.push([n, value]);
      } catch (err) {
        if (!skippable(err)) throw err;
        // Ein verschwundener oder kaputter Nachbar fällt aus diesem Durchlauf; der nächste versucht
        // es erneut.
      }
    }
    for (const [n, value] of seen) n.last = value;
    this.#baselined = true;
    return moved;
  }

  /** Die Nachbarn im Backlog-Verzeichnis nach Pfad; die eigene Arbeitskopie nie. */
  async #candidates(own: string): Promise<Map<string, Candidate>> {
    const found = new Map<string, Candidate>();
    let entries: Dirent[];
    try {
      entries = await readdir(this.#opts.backlogDir, { withFileTypes: true });
    } catch (err) {
      if (!skippable(err)) throw err;
      return found;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const dir = join(this.#opts.backlogDir, e.name);
      const hub = e.name === HUB;
      try {
        if (!hub && !(await exists(join(dir, '.git')))) continue;
        if (!this.#neighbors.has(dir) && (await physicalPath(dir)) === own) continue;
        const st = await stat(dir);
        const git = hub ? st : await stat(join(dir, '.git'));
        found.set(dir, { hub, id: `${st.dev}:${st.ino}:${git.dev}:${git.ino}` });
      } catch (err) {
        if (!skippable(err)) throw err;
        // Unlesbar: kein Nachbar, solange es so bleibt.
      }
    }
    return found;
  }

  /**
   * Watches eines neu entdeckten Nachbarn; nach `close` keine. Beobachtet wird nur der Nachbar
   * selbst: Ist er kein Repository, fände git über die Elternverzeichnisse ein fremdes (etwa ein
   * Repo, in dem `BACKE_HOME` liegt). Beim Hub muss das Common-Dir der Hub sein, bei einer
   * Arbeitskopie das Git-Dir `<dir>/.git`.
   */
  async #open(dir: string, { hub, id }: Candidate): Promise<Neighbor | undefined> {
    const { gitDir, commonDir } = await gitDirs(dir);
    const expected = await physicalPath(hub ? dir : join(dir, '.git'));
    if ((await physicalPath(hub ? commonDir : gitDir)) !== expected) return undefined;
    if (this.#closed) return undefined;
    const { remote, branch } = this.#opts;
    const top = hub ? 'heads' : 'remotes';
    const n: Neighbor = {
      ref: hub ? `refs/heads/${branch}` : `refs/remotes/${remote}/${branch}`,
      id,
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
    } catch (err) {
      if (!skippable(err)) throw err;
      return false;
    }
  }
}

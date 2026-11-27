/**
 * Steuerbarer Ersatz für `fs.watch` (`WatchFn`): Tests des Live-Kerns und der Nachbarn bekommen
 * ihre Datei-Ereignisse von hier, nie vom Betriebssystem. Jeder Watch merkt sich beim Öffnen den
 * Stand seines Verzeichnisses; `flush` vergleicht mit dem Stand auf der Platte und meldet, was sich
 * seither geändert hat, geformt nach dem Profil eines Systems. `emit` meldet ein einzelnes Ereignis
 * von Hand. Nichts davon hängt an Zeit: Ein Ereignis kommt genau dann, wenn der Test es auslöst.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import type { WatchFn } from '../../src/ui/watch.ts';

/**
 * Wie ein System die Änderungen seit dem letzten Blick meldet:
 *
 * - `inotify` (Linux): je geändertem Eintrag ein Ereignis mit seinem Namen relativ zum Watch, in
 *   der Reihenfolge, in der die Watches geöffnet wurden.
 * - `fsevents` (macOS): zusammengefasst zu einem Ereignis je Watch, das nur ein Verzeichnis nennt —
 *   das gemeinsame Elternverzeichnis der Änderungen, und wenn die direkt im beobachteten Verzeichnis
 *   liegen, dessen eigenen Namen (so meldet libuv ein Ereignis auf dem Verzeichnis selbst). Die
 *   Temp-Namen von `writeFileAtomic` tauchen dabei nie auf. Die Watches melden sich in umgekehrter
 *   Reihenfolge.
 * - `null`: ein Ereignis je Watch ohne Namen, wie auf Systemen, die keinen nennen; ebenfalls in
 *   umgekehrter Reihenfolge.
 */
export type WatchProfile = 'inotify' | 'fsevents' | 'null';

export const PROFILES: readonly WatchProfile[] = ['inotify', 'fsevents', 'null'];

export type FakeWatch = {
  readonly path: string;
  readonly recursive: boolean;
  readonly closed: boolean;
};

export type FakeWatcher = {
  watch: WatchFn;
  /** Alle je geöffneten Watches, in der Reihenfolge des Öffnens. */
  readonly watches: readonly FakeWatch[];
  /**
   * Meldet `name` an jeden offenen, lebenden Watch auf `path`, ohne Profil und ohne
   * Stummschaltung; der gemerkte Stand bleibt. Für Ereignisse, die ein Test genau so haben will.
   */
  emit(path: string, name: string | null): void;
  /**
   * Meldet an jeden offenen Watch, was sich unter ihm seit seinem letzten Blick geändert hat, und
   * merkt sich den neuen Stand. Mit `only` blicken nur die Watches, deren Pfad passt; die übrigen
   * melden ihre Änderungen erst beim nächsten `flush` (ein verspätetes Ereignis). Liefert die Zahl
   * der gemeldeten Ereignisse.
   */
  flush(only?: (path: string) => boolean): number;
  /**
   * Watches, deren Pfad `match` erfüllt, melden ab jetzt nichts mehr (ein verlorenes Ereignis);
   * ihr Blick wandert bei `flush` trotzdem weiter. Gilt auch für Watches, die später öffnen.
   */
  mute(match: (path: string) => boolean): void;
};

type Entry = {
  path: string;
  recursive: boolean;
  listener: (name: string | null) => void;
  closed: boolean;
  /**
   * Ein Watch auf ein fehlendes Verzeichnis meldet nie etwas, wie `fsWatch`; ebenso einer, dessen
   * Verzeichnis verschwunden oder ersetzt ist (anderer Inode).
   */
  dead: boolean;
  ino: number | undefined;
  seen: Map<string, string>;
};

/** Signatur eines Eintrags: Art, Inode und bei Dateien der Inhalt. */
function signature(abs: string): string | undefined {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(abs);
  } catch {
    return undefined;
  }
  if (st.isSymbolicLink()) return `l:${readlinkSync(abs)}`;
  if (st.isDirectory()) return `d:${st.ino}`;
  const hash = createHash('sha1').update(readFileSync(abs)).digest('hex');
  return `f:${st.ino}:${hash}`;
}

function inode(path: string): number | undefined {
  try {
    return lstatSync(path).ino;
  } catch {
    return undefined;
  }
}

/** Stand unter `root`: relativer Pfad (mit `sep`) → Signatur; flach oder rekursiv. */
function look(root: string, recursive: boolean): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (rel: string) => {
    let names: string[];
    try {
      names = readdirSync(rel === '' ? root : join(root, rel));
    } catch {
      return;
    }
    for (const name of names.sort()) {
      const child = rel === '' ? name : `${rel}${sep}${name}`;
      const sig = signature(join(root, child));
      if (sig === undefined) continue;
      out.set(child, sig);
      if (recursive && sig.startsWith('d:')) walk(child);
    }
  };
  walk('');
  return out;
}

/** Geänderte, neue und verschwundene Einträge zwischen zwei Blicken, sortiert. */
function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const out = new Set<string>();
  for (const [rel, sig] of after) if (before.get(rel) !== sig) out.add(rel);
  for (const rel of before.keys()) if (!after.has(rel)) out.add(rel);
  return [...out].sort();
}

/** Gemeinsames Elternverzeichnis der Einträge, relativ; `''` für das beobachtete selbst. */
function commonParent(rels: readonly string[]): string {
  const parents = rels.map((rel) => rel.split(sep).slice(0, -1));
  const first = parents[0] ?? [];
  let n = first.length;
  for (const p of parents) {
    let i = 0;
    while (i < n && p[i] === first[i]) i += 1;
    n = i;
  }
  return first.slice(0, n).join(sep);
}

export function fakeWatcher(profile: WatchProfile = 'inotify'): FakeWatcher {
  const entries: Entry[] = [];
  const muted: ((path: string) => boolean)[] = [];
  const silent = (path: string) => muted.some((m) => m(path));
  const open = (path: string) => entries.filter((e) => e.path === path && !e.closed && !e.dead);

  const watch: WatchFn = (path, opts, listener) => {
    const ino = inode(path);
    const dead = ino === undefined;
    const e: Entry = {
      path,
      recursive: opts.recursive,
      listener,
      closed: false,
      dead,
      ino,
      seen: dead ? new Map() : look(path, opts.recursive),
    };
    entries.push(e);
    return {
      close() {
        e.closed = true;
      },
    };
  };

  /** Was `e` für die Änderungen `rels` meldet. */
  const shape = (e: Entry, rels: readonly string[]): (string | null)[] => {
    if (profile === 'inotify') return [...rels];
    if (profile === 'null') return [null];
    const parent = e.recursive ? commonParent(rels) : '';
    return [parent === '' ? basename(e.path) : parent];
  };

  return {
    watch,
    get watches() {
      return entries.map(({ path, recursive, closed }) => ({ path, recursive, closed }));
    },
    emit(path, name) {
      for (const e of open(path)) e.listener(name);
    },
    flush(only) {
      const due: [Entry, string[]][] = [];
      for (const e of entries) {
        if (e.closed || e.dead || (only !== undefined && !only(e.path))) continue;
        const now = look(e.path, e.recursive);
        const rels = changes(e.seen, now);
        e.seen = now;
        if (inode(e.path) !== e.ino) e.dead = true;
        if (rels.length > 0 && !silent(e.path)) due.push([e, rels]);
      }
      if (profile !== 'inotify') due.reverse();
      let n = 0;
      for (const [e, rels] of due) {
        for (const name of shape(e, rels)) {
          // Ein Listener kann Watches schließen, etwa beim Neu-Öffnen eines Verzeichnisses.
          if (e.closed) break;
          e.listener(name);
          n += 1;
        }
      }
      return n;
    },
    mute(match) {
      muted.push(match);
    },
  };
}

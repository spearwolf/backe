/**
 * Änderungsquellen einer Arbeitskopie für `backe ui` (ui.md §2.4.1): Refs, Arbeitsbaum und
 * Sync-Zustand per `fs.watch`. Git schreibt Refs über Lock-Datei und Umbenennen; beobachtet werden
 * darum Verzeichnisse, nie die Ref-Datei selbst. `WatchFn` ist der Test-Hook: Tests reichen eine
 * Funktion durch, die Ereignisse unterdrückt, um verlorene Ereignisse nachzustellen.
 */
import { watch } from 'node:fs';
import { join } from 'node:path';
import { git } from '../git/exec.ts';
import { watchedPath } from './delta.ts';

/** Beobachtet `path`; `filename` ist relativ zu `path` oder `null`, wenn das System keinen nennt. */
export type WatchFn = (
  path: string,
  opts: { recursive: boolean },
  listener: (filename: string | null) => void,
) => { close(): void };

const MISSING = new Set(['ENOENT', 'ENOTDIR']);

/**
 * `fs.watch`, ohne den Prozess am Leben zu halten. Ein fehlendes Verzeichnis ergibt einen Handle,
 * der nichts meldet; ein Fehler des laufenden Watchers (etwa ein gelöschtes Verzeichnis) beendet
 * nur ihn — das Sicherheitsnetz fängt auf, was danach verloren geht.
 */
export const fsWatch: WatchFn = (path, opts, listener) => {
  try {
    const w = watch(path, { recursive: opts.recursive, persistent: false }, (_event, name) =>
      listener(name === null ? null : String(name)),
    );
    w.on('error', () => w.close());
    return { close: () => w.close() };
  } catch (err) {
    if (MISSING.has((err as NodeJS.ErrnoException).code ?? '')) return { close() {} };
    throw err;
  }
};

/** Was eine Arbeitskopie meldet: Ref bewegt, Pfade im Arbeitsbaum (`all` = unbekannt), Sync-Zustand. */
export type WatchSignals = {
  ref(): void;
  paths(paths: string[] | 'all'): void;
  sync(): void;
};

export type Watched = { close(): void };

/** Git-Dir (`HEAD`) und Common-Dir (Refs, `packed-refs`), absolut; bei einem Worktree verschieden. */
export async function gitDirs(root: string): Promise<{ gitDir: string; commonDir: string }> {
  const { stdout } = await git(
    ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'],
    { cwd: root },
  );
  const [gitDir = '', commonDir = ''] = stdout.split('\n');
  return { gitDir, commonDir };
}

const HEAD_FILES = new Set(['HEAD', 'HEAD.lock']);
const PACKED_FILES = new Set(['packed-refs', 'packed-refs.lock']);

const slashed = (name: string): string => name.replaceAll('\\', '/');

/**
 * Beobachtet `root`: `refs/heads/` (rekursiv) und `packed-refs` unter dem Common-Dir, `HEAD` unter
 * dem Git-Dir, den Arbeitsbaum ohne `.git/` (gefiltert per `watchedPath`) und, falls angegeben,
 * `syncDir` (`sync.json`, `conflicts/`). `close` schließt alle Handles.
 */
export async function watchWorkingCopy(
  root: string,
  opts: { syncDir?: string; watch?: WatchFn },
  on: WatchSignals,
): Promise<Watched> {
  const w = opts.watch ?? fsWatch;
  const { gitDir, commonDir } = await gitDirs(root);
  const handles: { close(): void }[] = [];
  const add = (h: { close(): void }) => handles.push(h);
  try {
    add(w(join(commonDir, 'refs', 'heads'), { recursive: true }, () => on.ref()));
    const dirs = gitDir === commonDir ? [gitDir] : [gitDir, commonDir];
    for (const dir of dirs) {
      const names = new Set([
        ...(dir === gitDir ? HEAD_FILES : []),
        ...(dir === commonDir ? PACKED_FILES : []),
      ]);
      add(
        w(dir, { recursive: false }, (name) => {
          if (name === null || names.has(name)) on.ref();
        }),
      );
    }
    add(
      w(root, { recursive: true }, (name) => {
        if (name === null) {
          on.paths('all');
          return;
        }
        const path = slashed(name);
        if (path === '.git' || path.startsWith('.git/')) return;
        if (watchedPath(path)) on.paths([path]);
      }),
    );
    if (opts.syncDir !== undefined) {
      add(w(opts.syncDir, { recursive: true }, () => on.sync()));
    }
  } catch (err) {
    for (const h of handles) h.close();
    throw err;
  }
  return {
    close() {
      for (const h of handles.splice(0)) h.close();
    },
  };
}

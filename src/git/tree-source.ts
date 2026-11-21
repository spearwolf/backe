import { compareCodeUnits } from '../core/compare.ts';
import { parseIssuePath } from '../store/layout.ts';
import type { SourceEntry, TreeSource } from '../store/source.ts';
import { git } from './exec.ts';
import { readBlobs } from './history.ts';

/** Was `loadSnapshotFrom` fast immer liest; kommt in einem einzigen `cat-file --batch` vorab. */
const PRELOAD_DIRS = ['.backe/', 'users/', 'projects/', 'sprints/', 'repos/'];
/** Wie `readBlobs`: Replace-Refs schieben keine anderen Objekte unter. */
const ENV = { GIT_NO_REPLACE_OBJECTS: '1' } as const;

function wanted(path: string): boolean {
  return (
    path === '.gitattributes' ||
    PRELOAD_DIRS.some((d) => path.startsWith(d)) ||
    parseIssuePath(path) !== undefined
  );
}

/**
 * Quelle über den Baum von `rev`, ohne Arbeitsbaum. Ein `ls-tree` liefert die Struktur, die
 * Entitätsdateien (alles, was `loadSnapshotFrom` liest) kommen gesammelt in einem Aufruf; alle
 * übrigen Pfade bei Bedarf und danach aus dem Cache. `rev` wird einmal zum Baum aufgelöst, ein
 * später bewegter Ref ändert die Quelle nicht.
 */
export async function gitTreeSource(wc: string, rev: string): Promise<TreeSource> {
  const tree = (
    await git(['rev-parse', '--verify', '--end-of-options', `${rev}^{tree}`], { cwd: wc, env: ENV })
  ).stdout.trim();
  const { stdout } = await git(['ls-tree', '-r', '-z', '--full-tree', '--end-of-options', tree], {
    cwd: wc,
    env: ENV,
  });

  const dirs = new Map<string, Map<string, boolean>>([['', new Map()]]);
  const files: string[] = [];
  for (const entry of stdout.split('\0')) {
    if (entry === '') continue;
    const tab = entry.indexOf('\t');
    const [mode = '', type = ''] = entry.slice(0, tab).split(' ');
    // Symlinks und Submodule sieht auch ein Dateisystem-Lauf nicht als Dateien.
    if (type !== 'blob' || mode === '120000') continue;
    const path = entry.slice(tab + 1);
    files.push(path);
    const segments = path.split('/');
    let dir = '';
    for (const [i, name] of segments.entries()) {
      const isDir = i < segments.length - 1;
      const children = dirs.get(dir) ?? new Map<string, boolean>();
      dirs.set(dir, children);
      children.set(name, isDir);
      dir = dir === '' ? name : `${dir}/${name}`;
    }
  }

  const spec = (path: string) => `${tree}:${path}`;
  const cache = new Map<string, Buffer | null>();
  const preload = files.filter(wanted);
  for (const [s, content] of await readBlobs(wc, preload.map(spec))) cache.set(s, content);
  const known = new Set(files);

  return {
    async list(dir) {
      const children = dirs.get(dir);
      if (!children) return [];
      return [...children]
        .map(([name, isDir]): SourceEntry => ({ name, dir: isDir }))
        .sort((a, b) => compareCodeUnits(a.name, b.name));
    },
    async read(path) {
      if (!known.has(path)) return undefined;
      const key = spec(path);
      if (!cache.has(key)) {
        for (const [s, content] of await readBlobs(wc, [key])) cache.set(s, content);
      }
      return cache.get(key) ?? undefined;
    },
  };
}

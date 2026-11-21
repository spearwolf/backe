import { compareCodeUnits } from '../core/compare.ts';
import { git } from './exec.ts';

/**
 * Alle Pfade, die gegenüber `HEAD` geändert, neu (nicht ignoriert) oder gelöscht sind — Index
 * und Arbeitsbaum zusammen, ohne Umbenennungen zu paaren; sortiert, nie unter `.git/`.
 * `untracked`: weder in `HEAD` noch im Index.
 */
export async function changedEntries(wc: string): Promise<{ path: string; untracked: boolean }[]> {
  const { stdout } = await git(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'],
    { cwd: wc },
  );
  const out = new Map<string, boolean>();
  for (const entry of stdout.split('\0')) {
    if (entry.length <= 3) continue;
    const path = entry.slice(3);
    if (path.split('/').some((s) => s.toLowerCase() === '.git')) continue;
    out.set(path, entry.startsWith('??'));
  }
  return [...out]
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([path, untracked]) => ({ path, untracked }));
}

/** Die Pfade aus `changedEntries`. */
export async function changedPaths(wc: string): Promise<string[]> {
  return (await changedEntries(wc)).map((e) => e.path);
}

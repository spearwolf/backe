import { git } from './exec.ts';

/**
 * Alle Pfade, die gegenüber `HEAD` geändert, neu (nicht ignoriert) oder gelöscht sind — Index
 * und Arbeitsbaum zusammen, ohne Umbenennungen zu paaren; sortiert, nie unter `.git/`.
 */
export async function changedPaths(wc: string): Promise<string[]> {
  const { stdout } = await git(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'],
    { cwd: wc },
  );
  const out = new Set<string>();
  for (const entry of stdout.split('\0')) {
    if (entry.length <= 3) continue;
    const path = entry.slice(3);
    if (path.split('/').some((s) => s.toLowerCase() === '.git')) continue;
    out.add(path);
  }
  return [...out].sort();
}

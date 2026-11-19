import { git } from './exec.ts';

const USER_FILE = /^users\/([^/]+)\.md$/;

/** Handles, deren `users/<handle>.md` in der Historie bis `rev` irgendwann gelöscht wurde. */
export async function removedHandles(wc: string, rev: string): Promise<Set<string>> {
  const { stdout } = await git(
    ['log', '--format=', '--name-only', '-z', '--diff-filter=D', rev, '--', 'users/'],
    { cwd: wc },
  );
  const handles = new Set<string>();
  for (const entry of stdout.split('\0')) {
    const handle = USER_FILE.exec(entry.trim())?.[1];
    if (handle !== undefined) handles.add(handle);
  }
  return handles;
}

/**
 * Wer hat ein Issue geändert: die `Backe-Actor`-Trailer der Commits zwischen zwei Ständen, je Issue
 * gesammelt. Der Browser vergleicht sie mit dem eigenen Handle und unterscheidet so Änderungen
 * anderer von seinen eigenen.
 */
import { git } from '../git/exec.ts';
import { TRAILER_ACTOR } from '../git/message.ts';
import { issueOfPath } from './delta.ts';

/**
 * Issue → Handles aus `Backe-Actor` der Commits in `from..to` unter `issues/`; leer bei
 * `from === to`. Die Ausgabe je Commit ist `\x01<actors>\0\n<pfad>\0<pfad>\0…`, die Actors eines
 * Commits sind durch `\x02` getrennt.
 */
export async function issueActors(
  root: string,
  from: string,
  to: string,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (from === to) return out;
  const { stdout } = await git(
    [
      '-c',
      'log.showSignature=false',
      'log',
      '-z',
      '--no-renames',
      '--name-only',
      `--format=%x01%(trailers:key=${TRAILER_ACTOR},valueonly,separator=%x02)`,
      '--end-of-options',
      `${from}..${to}`,
      '--',
      'issues/',
    ],
    { cwd: root },
  );
  for (const record of stdout.split('\x01')) {
    const [actorField = '', ...paths] = record.split('\0');
    const handles = actorField
      .split('\x02')
      .map((h) => h.trim())
      .filter((h) => h !== '');
    if (handles.length === 0) continue;
    for (const path of paths) {
      const id = issueOfPath(path.replace(/^\n/, ''));
      if (id !== undefined) addActors(out, id, handles);
    }
  }
  return out;
}

/** Fügt `handles` beim Issue `id` in `into` ein. */
function addActors(into: Map<string, Set<string>>, id: string, handles: Iterable<string>): void {
  let set = into.get(id);
  if (set === undefined) {
    set = new Set<string>();
    into.set(id, set);
  }
  for (const h of handles) set.add(h);
}

/** Fügt die Handles aus `from` je Issue in `into` ein. */
export function mergeActors(into: Map<string, Set<string>>, from: Map<string, Set<string>>): void {
  for (const [id, handles] of from) addActors(into, id, handles);
}

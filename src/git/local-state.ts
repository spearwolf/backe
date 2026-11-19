import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '../store/files.ts';
import { git } from './exec.ts';

export type LocalStateName = 'anchor' | 'verified' | 'identity';

/** Zustandsverzeichnis unter dem Git-Dir (auch hinter einer `.git`-Datei); wird bei Bedarf angelegt. */
export async function stateDir(wc: string): Promise<string> {
  const { stdout } = await git(['rev-parse', '--path-format=absolute', '--git-path', 'backe'], {
    cwd: wc,
  });
  const dir = stdout.replace(/\n$/, '');
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function readLocalState(
  wc: string,
  name: LocalStateName,
): Promise<string | undefined> {
  try {
    return (await readFile(join(await stateDir(wc), name), 'utf8')).replace(/\r?\n$/, '');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/** Schreibt atomar eine Zeile mit abschließendem `\n`. */
export async function writeLocalState(
  wc: string,
  name: LocalStateName,
  value: string,
): Promise<void> {
  await writeFileAtomic(join(await stateDir(wc), name), `${value}\n`);
}

/** Entfernt einen Eintrag; ein fehlender ist kein Fehler. */
export async function clearLocalState(wc: string, name: LocalStateName): Promise<void> {
  await rm(join(await stateDir(wc), name), { force: true });
}

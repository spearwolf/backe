import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isMissing, writeFileAtomic } from '../store/files.ts';
import { git } from './exec.ts';

/**
 * `upstream` ist der zuletzt verifizierte Stand des Remotes; anders als `verified` zeigt er nie auf
 * einen ungepushten lokalen Commit. `clean` ist der letzte Stand, den `verify` selbst ohne
 * ungültigen Commit aufgezeichnet hat (oder der Init-Commit); anders als `verified`, das ein Clone
 * mit seiner Abstammungsbasis vorbelegt, ist der Stand dort nie eingefroren.
 */
export type LocalStateName = 'anchor' | 'verified' | 'clean' | 'identity' | 'upstream';

/**
 * Zustandsverzeichnis unter dem Git-Dir (auch hinter einer `.git`-Datei). `create: true` (Default)
 * legt es an; wer nur liest (`doctor`, `readLocalState`), lässt es mit `create: false` fehlen.
 */
export async function stateDir(
  wc: string,
  opts: { create: boolean } = { create: true },
): Promise<string> {
  const { stdout } = await git(['rev-parse', '--path-format=absolute', '--git-path', 'backe'], {
    cwd: wc,
  });
  const dir = stdout.replace(/\n$/, '');
  if (opts.create) await mkdir(dir, { recursive: true });
  return dir;
}

export async function readLocalState(
  wc: string,
  name: LocalStateName,
): Promise<string | undefined> {
  try {
    return (await readFile(join(await stateDir(wc, { create: false }), name), 'utf8')).replace(
      /\r?\n$/,
      '',
    );
  } catch (err) {
    if (isMissing(err)) return undefined;
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
  await rm(join(await stateDir(wc, { create: false }), name), { force: true });
}

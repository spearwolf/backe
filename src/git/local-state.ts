import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isMissing, writeFileAtomic } from '../store/files.ts';
import { git } from './exec.ts';

/**
 * `upstream` ist der zuletzt verifizierte Stand des Remotes; anders als `verified` zeigt er nie auf
 * einen ungepushten lokalen Commit. `clean` ist der letzte Stand, den `verify` selbst ohne
 * ungültigen Commit aufgezeichnet hat (oder der Init-Commit); anders als `verified`, das ein Clone
 * mit seiner Abstammungsbasis vorbelegt, ist der Stand dort nie eingefroren. `warned` nennt,
 * durch Leerzeichen getrennt, die ungültigen eingehenden Commits, deren Warnung der Sync im Modus
 * `warn` schon gemeldet hat — nur die, die der letzte Bericht noch als ungültig trug.
 */
export type LocalStateName = 'anchor' | 'verified' | 'clean' | 'identity' | 'upstream' | 'warned';

/**
 * Kennung von `<wc>/.git`, an der ein Cache-Eintrag hängt: dasselbe Verzeichnis liefert immer
 * dasselbe Git-Dir; eine `.git`-Datei (Worktree, `--separate-git-dir`) kann git an Ort und Stelle
 * umschreiben, deshalb zählt dort auch die mtime. Die mtime eines Verzeichnisses ändert sich bei
 * jedem Commit und taugt dort nicht.
 */
async function dotGitId(wc: string): Promise<string | undefined> {
  try {
    const st = await stat(join(wc, '.git'));
    return st.isFile() ? `f:${st.dev}:${st.ino}:${st.mtimeMs}` : `d:${st.dev}:${st.ino}`;
  } catch {
    // Kein `.git` direkt unter `wc` (Unterverzeichnis, kein Repo) oder nicht lesbar: git fragen.
    return undefined;
  }
}

/**
 * Zuletzt aufgelöstes Zustandsverzeichnis je Arbeitskopie. Fast jeder Zugriff auf den lokalen
 * Zustand fragt danach; ohne Cache startete jeder ein eigenes `git rev-parse`. Ein Eintrag gilt nur,
 * solange `<wc>/.git` dieselbe Kennung trägt — ersetzt ein Klon am selben Pfad einen Worktree,
 * fragt der nächste Aufruf git neu.
 */
const stateDirs = new Map<string, { id: string; dir: string }>();

async function resolveStateDir(wc: string): Promise<string> {
  const key = resolve(wc);
  const id = await dotGitId(key);
  const cached = stateDirs.get(key);
  if (id !== undefined && cached?.id === id) return cached.dir;
  const { stdout } = await git(['rev-parse', '--path-format=absolute', '--git-path', 'backe'], {
    cwd: wc,
  });
  const dir = stdout.replace(/\n$/, '');
  if (id === undefined) stateDirs.delete(key);
  else stateDirs.set(key, { id, dir });
  return dir;
}

/**
 * Zustandsverzeichnis unter dem Git-Dir (auch hinter einer `.git`-Datei). `create: true` (Default)
 * legt es an; wer nur liest (`doctor`, `readLocalState`), lässt es mit `create: false` fehlen.
 */
export async function stateDir(
  wc: string,
  opts: { create: boolean } = { create: true },
): Promise<string> {
  const dir = await resolveStateDir(wc);
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

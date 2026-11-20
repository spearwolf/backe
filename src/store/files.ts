/**
 * Atomares Schreiben und Löschen von Dateien unter der Backlog-Wurzel.
 */
import { randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { isIssueId, shardOf } from '../core/ids.ts';

/**
 * `recursive` gilt nur zusammen mit `content: null` und nur für ein Issue-Verzeichnis
 * `issues/<shard>/<id>`; es löscht das Verzeichnis samt Inhalt. `executable` setzt (oder löscht)
 * die Ausführungsbits einer geschriebenen Datei, Git-Modus 100755 statt 100644; ohne bleibt der
 * Modus einer bestehenden Datei, wie er ist.
 */
export type FileChange = {
  path: string;
  content: string | Uint8Array | null;
  recursive?: true;
  executable?: boolean;
};

/** Fehlt der Pfad (oder ist ein Vorfahr kein Verzeichnis)? Nur `ENOENT` und `ENOTDIR` zählen so. */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Macht aus einem unerwarteten Dateisystemfehler eine `unexpected`-Meldung `<pfad>: <code>`. */
export function fsFailure(path: string, error: unknown): BackeError {
  if (error instanceof BackeError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return new BackeError('unexpected', `${path}: ${code ?? String(error)}`, { details: { path } });
}

/** Gibt es `path`? `false` nur bei `ENOENT`/`ENOTDIR`; jeder andere Fehler ist `unexpected`. */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw fsFailure(path, error);
  }
}

/** Verzeichnisse, die beim Aufräumen nie entfernt werden. */
const PROTECTED_DIRS: ReadonlySet<string> = new Set([
  'issues',
  'projects',
  'sprints',
  'repos',
  'users',
  '.backe',
]);

export function assertRelative(path: string): void {
  const segments = path.split('/');
  if (
    path === '' ||
    path === '.' ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    segments.includes('..') ||
    posix.normalize(path) !== path
  ) {
    throw new BackeError('validation', `Ungültiger Pfad im Backlog: »${path}«`, {
      hint: 'Erlaubt sind nur normalisierte, relative Pfade ohne "..", ".", "//" und Schrägstrich am Ende.',
    });
  }
  // Groß-/Kleinschreibung egal, weil APFS und NTFS `.GIT` auf `.git` abbilden. Die NTFS-Aliase
  // (`git~1`, `.git::$INDEX_ALLOCATION`) sind Aufgabe des Windows-Supports (backe.md §4.2).
  if (segments.some((s) => s.toLowerCase() === '.git')) {
    throw new BackeError('validation', `Pfad unter .git im Backlog: »${path}«`, {
      hint: 'Unter ".git" liegen Git-Interna; dorthin schreibt und löscht backe nie.',
    });
  }
}

/** `issues/<shard>/<id>` mit gültiger ID im passenden Shard: das einzige rekursiv löschbare Ziel. */
export function isIssueDirPath(path: string): boolean {
  const [dir, shard, id, ...rest] = path.split('/');
  return (
    dir === 'issues' &&
    rest.length === 0 &&
    id !== undefined &&
    isIssueId(id) &&
    shardOf(id) === shard
  );
}

export function assertRecursiveAllowed(change: FileChange): void {
  if (change.recursive !== true) return;
  if (change.content !== null || !isIssueDirPath(change.path)) {
    throw new BackeError('validation', `Rekursives Löschen nicht erlaubt: »${change.path}«`, {
      hint: 'Rekursiv gelöscht wird nur ein Issue-Verzeichnis "issues/<shard>/<id>" (content: null).',
    });
  }
}

/**
 * Schreibt per Temp-Datei + `rename`. Ein Symlink bleibt erhalten, ersetzt wird sein Ziel; eine
 * bestehende Datei behält ihren Modus. Scheitert das Aufräumen, fliegt der ursprüngliche Fehler.
 */
export async function writeFileAtomic(abs: string, content: string | Uint8Array): Promise<void> {
  let target = abs;
  try {
    target = await realpath(abs);
  } catch {
    // Datei fehlt (noch): es gibt nichts aufzulösen.
  }
  const tmp = join(
    dirname(target),
    `.${basename(target)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  try {
    const existing = await stat(target).catch(() => undefined);
    await writeFile(tmp, content);
    if (existing?.isFile()) await chmod(tmp, existing.mode & 0o7777);
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Wirft, wenn eine vorhandene Pfadkomponente unterhalb von `root` ein Symlink ist. */
async function assertNoSymlinks(root: string, path: string): Promise<void> {
  let current = root;
  for (const segment of path.split('/')) {
    current = join(current, segment);
    let isLink: boolean;
    try {
      isLink = (await lstat(current)).isSymbolicLink();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return;
      throw err;
    }
    if (isLink) {
      throw new BackeError('validation', `Symlink im Backlog: ${path}`, {
        hint: 'backe schreibt nicht durch Symlinks; den Link durch eine Datei oder ein Verzeichnis ersetzen.',
      });
    }
  }
}

/** Entfernt leer gewordene Verzeichnisse aufwärts, bis zum ersten nicht leeren oder geschützten. */
async function pruneEmptyDirs(root: string, relFile: string): Promise<void> {
  let dir = dirname(relFile);
  while (dir !== '.' && !PROTECTED_DIRS.has(dir)) {
    try {
      await rmdir(join(root, dir));
    } catch {
      return; // nicht leer oder schon weg
    }
    dir = dirname(dir);
  }
}

/**
 * Wendet die Änderungen der Reihe nach an: Schreiben per Temp-Datei + `rename`, `null` löscht.
 * Bei einem Fehler bleiben bereits angewendete Änderungen bestehen; Rollback ist Sache des Aufrufers.
 */
export async function applyFileChanges(
  root: string,
  changes: readonly FileChange[],
): Promise<void> {
  for (const change of changes) {
    assertRelative(change.path);
    assertRecursiveAllowed(change);
  }
  for (const change of changes) await assertNoSymlinks(root, change.path);
  for (const { path, content, recursive, executable } of changes) {
    const abs = join(root, path);
    if (content === null) {
      await rm(abs, recursive ? { recursive: true, force: true } : { force: true });
      await pruneEmptyDirs(root, path);
    } else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFileAtomic(abs, content);
      if (executable !== undefined) {
        const mode = (await stat(abs)).mode & 0o7777;
        await chmod(abs, executable ? mode | 0o111 : mode & ~0o111);
      }
    }
  }
}

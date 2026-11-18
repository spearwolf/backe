/**
 * Atomares Schreiben und Löschen von Dateien unter der Backlog-Wurzel.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, posix } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { isIssueId, shardOf } from '../core/ids.ts';

/**
 * `recursive` gilt nur zusammen mit `content: null` und nur für ein Issue-Verzeichnis
 * `issues/<shard>/<id>`; es löscht das Verzeichnis samt Inhalt.
 */
export type FileChange = { path: string; content: string | Uint8Array | null; recursive?: true };

/** Verzeichnisse, die beim Aufräumen nie entfernt werden. */
const PROTECTED_DIRS: ReadonlySet<string> = new Set([
  'issues',
  'projects',
  'sprints',
  'repos',
  'users',
  '.backe',
]);

function assertRelative(path: string): void {
  const segments = path.split('/');
  if (
    path === '' ||
    path === '.' ||
    path.startsWith('/') ||
    path.endsWith('/') ||
    segments.includes('..') ||
    posix.normalize(path) !== path
  ) {
    throw new BackeError('validation', `Ungültiger Pfad im Backlog: "${path}"`, {
      hint: 'Erlaubt sind nur normalisierte, relative Pfade ohne "..", ".", "//" und Schrägstrich am Ende.',
    });
  }
  // Groß-/Kleinschreibung egal, weil APFS und NTFS `.GIT` auf `.git` abbilden. Die NTFS-Aliase
  // (`git~1`, `.git::$INDEX_ALLOCATION`) sind Aufgabe des Windows-Supports (backe.md §4.2).
  if (segments.some((s) => s.toLowerCase() === '.git')) {
    throw new BackeError('validation', `Pfad unter .git im Backlog: "${path}"`, {
      hint: 'Unter ".git" liegen Git-Interna; dorthin schreibt und löscht backe nie.',
    });
  }
}

function assertRecursiveAllowed(change: FileChange): void {
  if (change.recursive !== true) return;
  const [dir, shard, id, ...rest] = change.path.split('/');
  if (
    change.content !== null ||
    dir !== 'issues' ||
    rest.length > 0 ||
    id === undefined ||
    !isIssueId(id) ||
    shardOf(id) !== shard
  ) {
    throw new BackeError('validation', `Rekursives Löschen nicht erlaubt: "${change.path}"`, {
      hint: 'Rekursiv gelöscht wird nur ein Issue-Verzeichnis "issues/<shard>/<id>" (content: null).',
    });
  }
}

async function writeAtomic(abs: string, content: string | Uint8Array): Promise<void> {
  const tmp = join(
    dirname(abs),
    `.${basename(abs)}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
  try {
    await writeFile(tmp, content);
    await rename(tmp, abs);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
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
  for (const { path, content, recursive } of changes) {
    const abs = join(root, path);
    if (content === null) {
      await rm(abs, recursive ? { recursive: true, force: true } : { force: true });
      await pruneEmptyDirs(root, path);
    } else {
      await mkdir(dirname(abs), { recursive: true });
      await writeAtomic(abs, content);
    }
  }
}

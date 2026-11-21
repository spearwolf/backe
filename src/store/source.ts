/**
 * Lesbare Sicht auf einen Backlog-Baum, unabhängig davon, woher er kommt: Arbeitsbaum, Commit
 * oder ein Stand mit aufgelegten Änderungen. `store` kennt Git nicht; die Git-Quelle steht in
 * `git/tree-source.ts`.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { compareCodeUnits } from '../core/compare.ts';
import type { FileChange } from './files.ts';

export type SourceEntry = { name: string; dir: boolean };

/**
 * Pfade relativ zur Wurzel, mit `/` getrennt. `list` sortiert nach Code-Units; ein fehlendes
 * Verzeichnis ist leer. `read` liefert für eine fehlende Datei `undefined`.
 */
export type TreeSource = {
  list(dir: string): Promise<SourceEntry[]>;
  read(path: string): Promise<Buffer | undefined>;
};

const MISSING = new Set(['ENOENT', 'ENOTDIR', 'EISDIR']);

function byName(a: SourceEntry, b: SourceEntry): number {
  return compareCodeUnits(a.name, b.name);
}

/** Quelle über ein Verzeichnis im Dateisystem; Einträge, die weder Datei noch Verzeichnis sind, fehlen. */
export function fsSource(root: string): TreeSource {
  return {
    async list(dir) {
      try {
        const entries = await readdir(join(root, dir), { withFileTypes: true });
        return entries
          .filter((e) => e.isDirectory() || e.isFile())
          .map((e) => ({ name: e.name, dir: e.isDirectory() }))
          .sort(byName);
      } catch (err) {
        if (MISSING.has((err as NodeJS.ErrnoException | undefined)?.code ?? '')) return [];
        throw err;
      }
    },
    async read(path) {
      try {
        return await readFile(join(root, path));
      } catch (err) {
        if (MISSING.has((err as NodeJS.ErrnoException | undefined)?.code ?? '')) return undefined;
        throw err;
      }
    },
  };
}

/**
 * `base` mit den `changes` darüber: Die jeweils letzte Änderung, die einen Pfad betrifft, gewinnt.
 * Eine rekursive Löschung blendet alles unter ihrem Pfad aus, was nicht später neu geschrieben
 * wird. Ein Verzeichnis ohne sichtbare Einträge gibt es nicht (wie in Git).
 */
export function overlaySource(base: TreeSource, changes: readonly FileChange[]): TreeSource {
  const ops = changes.map((c) => ({
    path: c.path,
    recursive: c.recursive === true,
    content: c.content === null ? null : Buffer.from(c.content),
  }));
  const covers = (op: (typeof ops)[number], path: string): boolean =>
    op.path === path || (op.recursive && path.startsWith(`${op.path}/`));
  const lastOp = (path: string) => ops.findLast((op) => covers(op, path));
  /** Ob irgendeine Änderung den Pfad oder etwas darunter betrifft. */
  const touched = (dir: string): boolean =>
    ops.some((op) => op.path.startsWith(`${dir}/`) || covers(op, dir));

  const source: TreeSource = {
    async read(path) {
      const op = lastOp(path);
      if (op === undefined) return base.read(path);
      return op.content === null ? undefined : op.content;
    },
    async list(dir) {
      const prefix = dir === '' ? '' : `${dir}/`;
      const candidates = new Map<string, boolean>(
        (await base.list(dir)).map((e) => [e.name, e.dir]),
      );
      for (const op of ops) {
        if (op.content === null || !op.path.startsWith(prefix)) continue;
        const [name = '', ...deeper] = op.path.slice(prefix.length).split('/');
        if (!candidates.has(name)) candidates.set(name, deeper.length > 0);
      }
      const out: SourceEntry[] = [];
      for (const [name, isDir] of candidates) {
        const path = `${prefix}${name}`;
        const op = lastOp(path);
        const exists = isDir
          ? !touched(path) && (await base.list(path)).length > 0
            ? true
            : (await source.list(path)).length > 0
          : op === undefined || op.content !== null;
        if (exists) out.push({ name, dir: isDir });
      }
      return out.sort(byName);
    },
  };
  return source;
}

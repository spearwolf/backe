/**
 * Hand-Edits für den Schreibpfad (backe.md §2.13 »Hand-Edits«): liest die geänderten Pfade der
 * Arbeitskopie gegen `HEAD`, übersetzt sie und trennt den `manual`-Anteil (kanonisch
 * serialisiert) von den Operationen. Geschrieben wird hier nichts; das tut `executeWrite`.
 */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { type Comment, type EntityKind, validateEntity } from '../core/schemas.ts';
import { readBlobs } from '../git/history.ts';
import { changedEntries } from '../git/status.ts';
import type { Operation } from '../ops/operation.ts';
import { type TranslateResult, translateEdits } from '../ops/translate.ts';
import type { FileChange } from '../store/files.ts';
import { entriesInFileOrder, parseEntityFile, serializeEntityFile } from '../store/frontmatter.ts';
import { classifyPath, isJunkFile } from '../store/layout.ts';
import {
  type BacklogSnapshot,
  listComments,
  orphanedProjectPaths,
  type StoredEntity,
  snapshotAt,
} from '../store/snapshot.ts';

export type HandEdits = {
  /** Alle geänderten Pfade (`changedEntries`), sortiert. */
  edited: string[];
  /** Inhalt in `HEAD` und in der Arbeitskopie je bearbeitetem Pfad; `null` = fehlt. */
  before: ReadonlyMap<string, Buffer | null>;
  after: ReadonlyMap<string, Buffer | null>;
  /** Der Stand von `HEAD`. */
  base: BacklogSnapshot;
  /** Der Stand nach dem `manual`-Anteil; gegen ihn laufen die Operationen. */
  afterManual: BacklogSnapshot;
  /** Der `manual`-Anteil, kanonisch; ohne Pfade, deren Inhalt schon in `HEAD` steht. */
  manual: FileChange[];
  ops: Operation[];
  warnings: TranslateResult['warnings'];
};

export type Rewritten = { path: string; reason: 'canonical' | 'no_effect' };

const ENTITY_KINDS: ReadonlySet<string> = new Set<EntityKind>([
  'issue',
  'comment',
  'user',
  'project',
  'sprint',
  'repo',
]);

function entityKind(path: string): EntityKind | undefined {
  const { kind } = classifyPath(path);
  return ENTITY_KINDS.has(kind) ? (kind as EntityKind) : undefined;
}

function utf8(b: Buffer | null): string | null {
  return b === null ? null : b.toString('utf8');
}

function sameBytes(a: string | Uint8Array | null, b: string | Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  return Buffer.from(a).equals(Buffer.from(b));
}

/**
 * Inhalt eines bearbeiteten Pfads; `null`, wenn er fehlt. Ein Symlink oder sonst keine reguläre
 * Datei ist `validation`, bevor etwas gelesen wird: Sonst ginge der Inhalt des Linkziels, auch
 * außerhalb des Repos, als Hand-Edit durch.
 */
async function readWorktree(wc: string, path: string): Promise<Buffer | null> {
  const abs = join(wc, path);
  try {
    if (!(await lstat(abs)).isFile()) {
      throw new BackeError('validation', `${path} ist keine reguläre Datei`, {
        hint: 'Symlinks und Verzeichnisse fremder Repos gehören nicht ins Backlog; entfernen oder durch eine Datei ersetzen.',
      });
    }
    return await readFile(abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

/**
 * Der Hand-Edit einer Datei, wie `serializeEntityFile` ihn schreibt: Entitätsdateien geparst und
 * kanonisch samt unbekannter Keys, alle anderen Dateien roh. Wirft bei kaputten Dateien mit
 * `datei:zeile`.
 */
export function canonicalEdit(path: string, after: Buffer | null): string | Buffer | null {
  if (after === null) return null;
  const kind = entityKind(path);
  if (kind === undefined) return after;
  const parsed = parseEntityFile(after.toString('utf8'), path);
  const { data, unknownKeys } = validateEntity(kind, parsed.data, path);
  return serializeEntityFile(
    kind,
    data as Record<string, unknown>,
    parsed.body,
    entriesInFileOrder(parsed, unknownKeys),
  );
}

/**
 * Liest die Hand-Edits unter dem Lock: `before` aus `head`, `after` aus der Arbeitskopie. Die
 * `HEAD`-Basis entsteht aus `wcSnapshot` mit den Vorher-Inhalten plus den Projektdateien, die nur
 * mangels (von Hand gelöschtem) Elternprojekt fehlen; `wcSnapshot.config` muss schon die Config
 * aus `HEAD` sein (`snapshotAt` liest die Config nicht). `undefined`, wenn nichts geändert ist.
 */
export async function readHandEdits(
  wc: string,
  wcSnapshot: BacklogSnapshot,
  head: string,
  actor: string,
): Promise<HandEdits | undefined> {
  const entries = await changedEntries(wc);
  if (entries.length === 0) return undefined;
  // Swap-, Backup- und Systemdateien committet backe nicht still, auch ohne `.gitignore`.
  const junk = entries.filter((e) => e.untracked && isJunkFile(e.path)).map((e) => e.path);
  if (junk.length > 0) {
    throw new BackeError('validation', `Editor- oder Systemdateien: ${junk.join(', ')}`, {
      hint: 'löschen oder in .gitignore aufnehmen',
      details: { paths: junk },
    });
  }
  const edited = entries.map((e) => e.path);
  const editedSet = new Set(edited);
  const specs = edited.map((p) => `${head}:${p}`);
  const blobs = await readBlobs(wc, specs);
  const before = new Map(edited.map((p, i) => [p, blobs.get(specs[i] as string) ?? null]));
  const after = new Map<string, Buffer | null>();
  for (const p of edited) after.set(p, await readWorktree(wc, p));

  const orphans: { path: string; content: string | null }[] = [];
  for (const path of orphanedProjectPaths(wcSnapshot)) {
    if (!editedSet.has(path)) orphans.push({ path, content: utf8(await readWorktree(wc, path)) });
  }
  const base = snapshotAt(wcSnapshot, [
    ...edited.map((path) => ({ path, content: utf8(before.get(path) ?? null) })),
    ...orphans,
  ]);

  // Fremde Dateien und Anhänge vergleicht `translateEdits` nur auf Gleichheit; latin1 bildet
  // Bytes eins zu eins ab, auch wenn sie kein gültiges UTF-8 sind.
  const text = (path: string, b: Buffer | null) =>
    b === null ? null : b.toString(entityKind(path) === undefined ? 'latin1' : 'utf8');
  const translated = translateEdits(
    base,
    edited.map((path) => ({
      path,
      before: text(path, before.get(path) ?? null),
      after: text(path, after.get(path) ?? null),
    })),
    { actor },
  );

  const manual: FileChange[] = [];
  for (const path of translated.manual) {
    const content = canonicalEdit(path, after.get(path) ?? null);
    if (!sameBytes(content, before.get(path) ?? null)) manual.push({ path, content });
  }
  const afterManual = snapshotAt(
    base,
    manual.map(({ path, content }) => ({
      path,
      content: content === null ? null : Buffer.from(content).toString('utf8'),
    })),
  );
  return {
    edited,
    before,
    after,
    base,
    afterManual,
    manual,
    ops: translated.ops,
    warnings: translated.warnings,
  };
}

/**
 * Die Kommentare der Issues `ids` im Stand nach dem `manual`-Anteil: von der Platte, aber jeder
 * bearbeitete Kommentar mit seinem Inhalt aus `HEAD` bzw. aus dem `manual`-Anteil.
 */
export async function commentsAfterManual(
  wc: string,
  edits: HandEdits,
  ids: readonly string[],
): Promise<Map<string, StoredEntity<Comment>[]>> {
  const manual = new Map(edits.manual.map((c) => [c.path, c.content]));
  const editedSet = new Set(edits.edited);
  const out = new Map<string, StoredEntity<Comment>[]>();
  for (const id of new Set(ids)) {
    const list = (await listComments(wc, id)).filter((c) => !editedSet.has(c.path));
    for (const path of edits.edited) {
      const cls = classifyPath(path);
      if (cls.kind !== 'comment' || cls.id !== id) continue;
      const content = manual.has(path) ? manual.get(path) : edits.before.get(path);
      if (content == null) continue;
      const parsed = parseEntityFile(Buffer.from(content).toString('utf8'), path);
      const { data, unknownKeys } = validateEntity('comment', parsed.data, path);
      list.push({
        data: data as Comment,
        extra: entriesInFileOrder(parsed, unknownKeys),
        body: parsed.body,
        path,
      });
    }
    out.set(
      id,
      list.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    );
  }
  return out;
}

/**
 * Wie jeder bearbeitete Pfad nach den Commits dasteht (Festlegung »Arbeitskopie nach
 * `backe commit`«): `rewritten` nennt Pfade, deren committeter Inhalt vom kanonischen Hand-Edit
 * abweicht, und Pfade ohne wirksame Änderung; `reset` sind die Pfade, die auf `HEAD` zurückgehen.
 * `changes` sind alle geschriebenen Änderungen in Schreibreihenfolge.
 */
export function settleEdits(
  edits: HandEdits,
  changes: readonly FileChange[],
): { rewritten: Rewritten[]; reset: string[] } {
  const rewritten: Rewritten[] = [];
  const reset: string[] = [];
  for (const path of edits.edited) {
    const last = changes.findLast((c) => c.path === path || path.startsWith(`${c.path}/`));
    const after = edits.after.get(path) ?? null;
    if (last === undefined) {
      reset.push(path);
      if (!sameBytes(after, edits.before.get(path) ?? null)) {
        rewritten.push({ path, reason: 'no_effect' });
      }
      continue;
    }
    const committed = last.path === path ? last.content : null;
    if (!sameBytes(committed, canonicalEdit(path, after))) {
      rewritten.push({ path, reason: 'canonical' });
    }
  }
  return { rewritten, reset };
}

/**
 * Anhänge eines Issues (backe.md §2.8): als Datei, URL oder JSON hinzufügen, auflisten, holen und
 * entfernen. `loadAttachmentSource` ist der einzige Lader für die Quelle, geteilt von CLI und MCP.
 */
import { constants, type FileHandle, open, stat } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import { expandPath, physicalPath } from '../context/paths.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { ATTACHMENT_NAME_RE } from '../core/names.ts';
import { attachmentTooLarge } from '../ops/comment-ops.ts';
import { exists, fsFailure, isMissing } from '../store/files.ts';
import { attachmentsDir, BACKLOG_CONFIG } from '../store/layout.ts';
import { type WriteOutcome, writeOp } from './outcome.ts';
import { openSnapshot, resolveIssueRef } from './read.ts';
import { headConfig, type WriteDeps } from './write.ts';

/** `fileName` ist der Basename der Quelle. */
export type AttachmentSource =
  | { kind: 'file'; fileName: string; content: Uint8Array }
  | { kind: 'url'; url: string }
  | { kind: 'json'; text: string };

/**
 * Dateiname des Anhangs: Enthält `name` einen Punkt, ist er der Dateiname; sonst `name` plus die
 * kleingeschriebene Endung der Quelle. JSON heißt `<name>.json`, außer `name` endet schon darauf.
 * URL-Anhänge haben keine Datei; dort ist das Ergebnis `name`.
 */
export function attachmentFileName(name: string, source: AttachmentSource): string {
  let file = name;
  if (source.kind === 'json') {
    file = name.endsWith('.json') ? name : `${name}.json`;
  } else if (source.kind === 'file' && !name.includes('.')) {
    file = `${name}${extname(source.fileName).toLowerCase()}`;
  }
  if (source.kind !== 'url' && !ATTACHMENT_NAME_RE.test(file)) {
    throw new BackeError('validation', `Ungültiger Dateiname für den Anhang: »${file}«`, {
      hint: '--name <n>.<ext> angeben; erlaubt sind [a-z0-9][a-z0-9._-]{0,63}',
    });
  }
  return file;
}

/** Genau eins von `path`, `url`, `json`, `text`; die Adapter prüfen das mit ihren eigenen Namen. */
export type AttachmentInput = {
  name: string;
  path?: string | undefined;
  url?: string | undefined;
  json?: string | undefined;
  text?: string | undefined;
};

/**
 * `base`: Basis relativer Pfade. `confine`: nur Dateien, die physisch in `base` liegen (MCP,
 * backe.md §2.19). `maxBytes`/`lfs`: `attachments.*` der Backlog-Config; `null` heißt ohne Grenze.
 */
export type AttachmentLoadOptions = {
  base: string;
  home: string;
  maxBytes: number | null;
  lfs: boolean;
  confine: boolean;
};

export type AttachmentLoadDeps = {
  /** Läuft nach der Begrenzung, vor dem ersten `stat`; Test-Hook für den Austausch eines Verzeichnisses. */
  afterConfine?: (real: string) => Promise<void>;
  /** Läuft nach Prüfung und `stat`, vor dem Öffnen; Test-Hook für den Austausch der Datei. */
  beforeOpen?: (real: string) => Promise<void>;
  /** Liest den Inhalt über das Handle (Default `handle.readFile()`). */
  read?: (handle: FileHandle) => Promise<Uint8Array>;
};

/** Liegt `path` in `root` oder ist es `root` selbst? Beide physisch; verglichen wird je Segment. */
function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

/** Fehler beim Zugriff auf die Quelldatei: fehlt → `not_found`, nicht lesbar → `validation`. */
function fileError(raw: string, path: string, error: unknown): BackeError {
  if (isMissing(error)) return new BackeError('not_found', `Datei »${raw}« nicht gefunden`);
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'EACCES' || code === 'EPERM' || code === 'ELOOP') {
    return new BackeError('validation', `Datei »${raw}« lässt sich nicht lesen (${code})`, {
      details: { path },
    });
  }
  return fsFailure(path, error);
}

/**
 * Liest eine Quelldatei mit Schutz gegen Austausch: `realpath` und Begrenzung, `stat` des realen
 * Pfads, Öffnen ohne Symlink-Folgen in der letzten Komponente, `fstat` am Handle. Danach wird der
 * Pfad erneut aufgelöst: Er muss derselbe reale Pfad sein, weiter in `base` liegen (`confine`), und
 * `stat` dort muss die Inode des Handles liefern. Sonst ist das `validation`. Größe und Inhalt
 * kommen nur über das Handle; über der Grenze wird nichts gelesen.
 *
 * Restfenster: Node hat kein `openat`/`O_BENEATH`, das Öffnen folgt daher Symlinks in
 * Zwischenverzeichnissen. Ein Angreifer, der ein Zwischenverzeichnis zum Öffnen nach außen und
 * zwischen der erneuten Auflösung und dem letzten `stat` wieder hin und her tauscht, kann die
 * Prüfung noch schlagen; ein einmaliger Austausch nicht.
 */
async function loadFile(
  name: string,
  raw: string,
  opts: AttachmentLoadOptions,
  deps: AttachmentLoadDeps,
): Promise<AttachmentSource> {
  const path = expandPath(raw, { home: opts.home, base: opts.base });
  let real: string;
  try {
    real = await physicalPath(path);
  } catch (error) {
    throw fileError(raw, path, error);
  }
  if (opts.confine && !within(await physicalPath(opts.base), real)) {
    throw new BackeError('validation', `Datei »${raw}« liegt außerhalb des Arbeitsverzeichnisses`, {
      hint: 'Inhalt per text oder json übergeben',
    });
  }
  await deps.afterConfine?.(real);
  let checked: Awaited<ReturnType<typeof stat>>;
  try {
    checked = await stat(real);
  } catch (error) {
    throw fileError(raw, path, error);
  }
  if (!checked.isFile()) throw new BackeError('validation', `${path} ist keine Datei`);
  const fileName = basename(path);
  await deps.beforeOpen?.(real);
  let handle: FileHandle;
  try {
    handle = await open(real, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    throw fileError(raw, path, error);
  }
  try {
    const opened = await handle.stat();
    const swapped = () =>
      new BackeError('validation', `Datei »${raw}« wurde während des Lesens ausgetauscht`, {
        details: { path },
      });
    if (opened.dev !== checked.dev || opened.ino !== checked.ino) throw swapped();
    // Ein Zwischenverzeichnis, das jetzt nach außen zeigt, ändert die Auflösung des Pfads.
    let again: string;
    let now: Awaited<ReturnType<typeof stat>>;
    try {
      again = await physicalPath(path);
      now = await stat(real);
    } catch {
      throw swapped();
    }
    if (
      again !== real ||
      (opts.confine && !within(await physicalPath(opts.base), again)) ||
      now.dev !== opened.dev ||
      now.ino !== opened.ino
    ) {
      throw swapped();
    }
    const file = attachmentFileName(name, { kind: 'file', fileName, content: new Uint8Array() });
    const tooLarge = attachmentTooLarge(file, opened.size, {
      max_bytes: opts.maxBytes,
      lfs: opts.lfs,
    });
    if (tooLarge !== undefined) throw tooLarge;
    const content = await (deps.read ?? ((h) => h.readFile()))(handle);
    return { kind: 'file', fileName, content };
  } finally {
    await handle.close();
  }
}

/**
 * Die Quelle eines Anhangs aus genau einer Angabe: `url`, `json` (Text, geprüft beim Schreiben),
 * `text` (UTF-8-Inhalt, Dateiname ist `name`) oder `path` (Datei, siehe `loadFile`).
 */
export async function loadAttachmentSource(
  input: AttachmentInput,
  opts: AttachmentLoadOptions,
  deps: AttachmentLoadDeps = {},
): Promise<AttachmentSource> {
  if (input.url !== undefined) return { kind: 'url', url: input.url };
  if (input.json !== undefined) return { kind: 'json', text: input.json };
  if (input.text !== undefined) {
    return { kind: 'file', fileName: input.name, content: new TextEncoder().encode(input.text) };
  }
  if (input.path === undefined) throw new BackeError('usage', 'Keine Quelle für den Anhang');
  return loadFile(input.name, input.path, opts, deps);
}

/**
 * `attachments.max_bytes` und `.lfs` aus `HEAD` der Arbeitskopie für den Lader. Ohne Arbeitskopie
 * (sie entsteht erst beim Write) ohne Grenze; der Write prüft die Größe dann selbst.
 */
export async function attachmentLimits(
  ctx: ResolvedContext,
): Promise<{ maxBytes: number | null; lfs: boolean }> {
  const root = ctx.backlog.root;
  const config =
    root === undefined || !(await exists(join(root, BACKLOG_CONFIG)))
      ? undefined
      : await headConfig(root);
  return config === undefined
    ? { maxBytes: null, lfs: false }
    : { maxBytes: config.attachments.max_bytes, lfs: config.attachments.lfs };
}

function jsonContent(text: string): Uint8Array<ArrayBuffer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new BackeError('validation', `Ungültiges JSON: ${(e as Error).message}`);
  }
  return new TextEncoder().encode(`${JSON.stringify(parsed, null, 2)}\n`);
}

export async function addAttachment(
  ctx: ResolvedContext,
  ref: string,
  input: { name: string; source: AttachmentSource },
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  const { name, source } = input;
  const file = attachmentFileName(name, source);
  const content =
    source.kind === 'file'
      ? new Uint8Array(source.content)
      : source.kind === 'json'
        ? jsonContent(source.text)
        : undefined;
  return writeOp(
    ctx,
    (s) => {
      const id = resolveIssueRef(s, ref);
      return source.kind === 'url'
        ? { op: 'attach.add', id, name, url: source.url }
        : { op: 'attach.add', id, name, file, content };
    },
    deps,
  );
}

export type AttachmentView = { name: string; file?: string; url?: string; size?: number };

async function sizeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch {
    return undefined;
  }
}

export async function listAttachments(
  ctx: ResolvedContext,
  ref: string,
): Promise<AttachmentView[]> {
  const { root, snapshot: s } = await openSnapshot(ctx);
  const id = resolveIssueRef(s, ref);
  const list = s.issues.get(id)?.data.attachments ?? [];
  const dir = join(root, attachmentsDir(id));
  return Promise.all(
    list.map(async (a) => {
      const size = a.file === undefined ? undefined : await sizeOf(join(dir, a.file));
      return {
        name: a.name,
        ...(a.file === undefined ? {} : { file: a.file }),
        ...(a.url === undefined ? {} : { url: a.url }),
        ...(size === undefined ? {} : { size }),
      };
    }),
  );
}

const LFS_POINTER = Buffer.from('version https://git-lfs.github.com/spec/v1');

/** Beginnt die Datei mit der Kopfzeile eines git-lfs-Pointers? */
async function isLfsPointer(path: string): Promise<boolean> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(LFS_POINTER.length);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return bytesRead === head.length && head.equals(LFS_POINTER);
  } finally {
    await handle.close();
  }
}

export async function getAttachment(
  ctx: ResolvedContext,
  ref: string,
  name: string,
): Promise<
  { name: string; url: string } | { name: string; file: string; path: string; size: number }
> {
  const { root, snapshot: s } = await openSnapshot(ctx);
  const id = resolveIssueRef(s, ref);
  const entry = s.issues.get(id)?.data.attachments?.find((a) => a.name === name);
  if (entry === undefined) {
    throw new BackeError('not_found', `${id}: Anhang »${name}« nicht gefunden`);
  }
  if (entry.url !== undefined) return { name, url: entry.url };
  const path = join(root, attachmentsDir(id), entry.file);
  const size = await sizeOf(path);
  if (size === undefined) {
    throw new BackeError('not_found', `${path} existiert nicht`);
  }
  // Ein Clone ohne `git lfs pull` hat statt der Bytes den Pointer im Arbeitsbaum.
  if ((await headConfig(root))?.attachments.lfs === true && (await isLfsPointer(path))) {
    throw new BackeError('sync', `Anhang »${name}« ist nicht geladen (LFS)`, {
      hint: `git -C ${root} lfs pull`,
    });
  }
  return { name, file: entry.file, path, size };
}

export function removeAttachment(
  ctx: ResolvedContext,
  ref: string,
  name: string,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  return writeOp(ctx, (s) => ({ op: 'attach.rm', id: resolveIssueRef(s, ref), name }), deps);
}

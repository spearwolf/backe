/**
 * Anhänge eines Issues (backe.md §2.8): als Datei, URL oder JSON hinzufügen, auflisten, holen und
 * entfernen. Den Inhalt liest die CLI und reicht ihn hinein; der Service prüft nur Dateinamen.
 */
import { stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { ATTACHMENT_NAME_RE } from '../core/names.ts';
import { attachmentsDir } from '../store/layout.ts';
import { type WriteOutcome, writeOp } from './outcome.ts';
import { openSnapshot, resolveIssueRef } from './read.ts';
import type { WriteDeps } from './write.ts';

/** `fileName` ist der Basename der Quelle. */
export type AttachSource =
  | { kind: 'file'; fileName: string; content: Uint8Array }
  | { kind: 'url'; url: string }
  | { kind: 'json'; text: string };

/**
 * Dateiname des Anhangs: Enthält `name` einen Punkt, ist er der Dateiname; sonst `name` plus die
 * kleingeschriebene Endung der Quelle. JSON heißt `<name>.json`, außer `name` endet schon darauf.
 * URL-Anhänge haben keine Datei; dort ist das Ergebnis `name`.
 */
export function attachmentFileName(name: string, source: AttachSource): string {
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

function jsonContent(text: string): Uint8Array<ArrayBuffer> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new BackeError('validation', `Ungültiges JSON: ${(e as Error).message}`);
  }
  return new TextEncoder().encode(`${JSON.stringify(parsed, null, 2)}\n`);
}

export function addAttachment(
  ctx: ResolvedContext,
  ref: string,
  input: { name: string; source: AttachSource },
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
  if (entry.file === undefined) return { name, url: entry.url as string };
  const path = join(root, attachmentsDir(id), entry.file);
  const size = await sizeOf(path);
  if (size === undefined) {
    throw new BackeError('not_found', `${path} existiert nicht`);
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

import { ATTACHMENT_TEXT_LIMIT } from '@backe/tools/limits.ts';
import type { AttachmentListJson } from '@backe/ui/api.ts';

export type AttachmentKind = 'image' | 'markdown' | 'text' | 'download' | 'url' | 'not-loaded';

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg']);

/** Kleingeschriebene Dateiendung ohne Punkt, `''` ohne Endung. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/**
 * Art der Darstellung eines Anhangs. Text und Markdown gibt es nur bis `ATTACHMENT_TEXT_LIMIT`
 * (so viel liefert der Server inline); die Bytes entscheiden am Ende über den `Content-Type`.
 */
export function attachmentKind(a: AttachmentListJson[number]): AttachmentKind {
  if (a.url !== undefined) return 'url';
  if (a.not_loaded === true) return 'not-loaded';
  const ext = extensionOf(a.name);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (a.size === undefined || a.size > ATTACHMENT_TEXT_LIMIT) return 'download';
  return ext === 'md' || ext === 'markdown' ? 'markdown' : 'text';
}

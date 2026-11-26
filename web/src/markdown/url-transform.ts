import { isIssueId } from '@backe/core/ids.ts';
import type { Attachment } from '@backe/core/schemas.ts';
import { defaultUrlTransform } from 'react-markdown';
import { routeHref } from '../app/routes.ts';
import { attachmentUrl } from '../data/issue-api.ts';

export type UrlContext = {
  backlog: string;
  /** ID-Präfix des Backlogs; ohne ihn genügt jede wohlgeformte Issue-ID. */
  prefix?: string;
  /** Ohne Issue-Kontext (Projekt, Sprint, Repo) gibt es keine Anhänge. */
  issue?: { id: string; attachments: readonly Attachment[] };
  /** `file` → `blob:`-URL für Bilder, die der Editor noch nicht hochgeladen hat (Vorschau). */
  local?: ReadonlyMap<string, string>;
};

const ATTACHMENT_PATH = /^(?:\.\/)?attachments\/([^/]+)$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * URL-Filter für `react-markdown`, läuft nach der Bereinigung. Absolute http(s)/mailto-URLs und
 * Fragmente bleiben; relative `attachments/<file>`-Pfade zeigen auf den Anhang des Issues mit
 * genau dieser `file`; die Issue-Routen des eigenen Backlogs bleiben; alles andere fällt weg.
 */
export function issueUrlTransform(
  ctx: UrlContext,
): (url: string, key: string) => string | null | undefined {
  return (url) => {
    const safe = defaultUrlTransform(url);
    if (safe === '') return null;
    if (safe.startsWith('#')) return safe;
    if (SCHEME.test(safe)) return safe;
    // Nur Issue-Routen des eigenen Backlogs, in der Form, die der Issue-Link-Plugin erzeugt.
    const own = routeHref({ kind: 'issue', backlog: ctx.backlog, id: '' });
    if (safe.startsWith(own)) {
      return isIssueId(safe.slice(own.length), ctx.prefix) ? safe : null;
    }
    return attachmentTarget(ctx, safe);
  };
}

function attachmentTarget(ctx: UrlContext, url: string): string | null {
  const { issue, local } = ctx;
  if (issue === undefined && local === undefined) return null;
  const match = ATTACHMENT_PATH.exec(url);
  if (match === null) return null;
  let file: string;
  try {
    file = decodeURIComponent(match[1] as string);
  } catch {
    return null;
  }
  if (/[/\\]/.test(file) || file === '.' || file === '..') return null;
  // Lokale Vorschauen gehen vor und brauchen keinen Issue-Kontext (Anlegen-Dialog).
  const preview = local?.get(file);
  if (preview !== undefined) return preview;
  if (issue === undefined) return null;
  const hit = issue.attachments.find((a) => 'file' in a && a.file === file);
  return hit === undefined ? null : attachmentUrl(ctx.backlog, issue.id, hit.name);
}

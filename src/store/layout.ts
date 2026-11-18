/**
 * Pfade innerhalb eines Backlogs (backe.md §2.2). Alle relativ zur Backlog-Wurzel, mit `/` getrennt.
 */
import { CROCKFORD, shardOf } from '../core/ids.ts';
import { isHandle } from '../core/names.ts';
import { IssueSchema } from '../core/schemas.ts';

export const BACKLOG_CONFIG = '.backe/backlog.jsonc';
export const QUARANTINE = '.backe/quarantine.jsonc';
/** Lokaler, nie eingecheckter Zustand (allowed_signers, Caches, Locks). */
export const localStateDir = '.git/backe';

export function issueDir(id: string): string {
  return `issues/${shardOf(id)}/${id}`;
}

export function issueFile(id: string): string {
  return `${issueDir(id)}/issue.md`;
}

export function commentsDir(id: string): string {
  return `${issueDir(id)}/comments`;
}

export function attachmentsDir(id: string): string {
  return `${issueDir(id)}/attachments`;
}

/** `<created als YYYYMMDDTHHMMSSZ>-<author>-<rnd>.md` (backe.md §2.7). */
export function commentFileName(created: string, author: string, rnd: string): string {
  return `${created.replace(/[-:]/g, '')}-${author}-${rnd}.md`;
}

const COMMENT_FILE_RE = new RegExp(`^(\\d{8}T\\d{6}Z)-(.+)-([${CROCKFORD}]{3})\\.md$`);
const Timestamp = IssueSchema.shape.created;

/**
 * Umkehrung von `commentFileName`; `undefined` bei falschem Format, ungültigem Handle oder
 * unmöglichem Zeitstempel.
 */
export function parseCommentFileName(
  name: string,
): { created: string; author: string; rnd: string } | undefined {
  const m = COMMENT_FILE_RE.exec(name);
  if (m === null) return undefined;
  const [, t = '', author = '', rnd = ''] = m;
  const created = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`;
  if (!isHandle(author) || !Timestamp.safeParse(created).success) return undefined;
  return { created, author, rnd };
}

export function userFile(handle: string): string {
  return `users/${handle}.md`;
}

export function projectFile(path: string): string {
  return `projects/${path}.md`;
}

export function sprintFile(slug: string): string {
  return `sprints/${slug}.md`;
}

export function repoFile(name: string): string {
  return `repos/${name}.md`;
}

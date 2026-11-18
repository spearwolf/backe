/**
 * Pfade innerhalb eines Backlogs (backe.md §2.2). Alle relativ zur Backlog-Wurzel, mit `/` getrennt.
 */
import { shardOf } from '../core/ids.ts';

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

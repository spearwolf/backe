/**
 * Pfade innerhalb eines Backlogs (backe.md §2.2). Alle relativ zur Backlog-Wurzel, mit `/` getrennt.
 */
import { CROCKFORD, isIssueId, shardOf } from '../core/ids.ts';
import { isHandle, isProjectPath, isRepoName, isSprintSlug } from '../core/names.ts';
import { IssueSchema } from '../core/schemas.ts';

export const BACKLOG_CONFIG = '.backe/backlog.jsonc';
export const QUARANTINE = '.backe/quarantine.jsonc';
export const GITATTRIBUTES = '.gitattributes';
/** Zeile in `.gitattributes`, die Datei-Anhänge an Git LFS gibt (backe.md §2.8). */
export const LFS_RULE = 'issues/*/*/attachments/** filter=lfs diff=lfs merge=lfs -text';

/** Ob `attributes` (Inhalt von `.gitattributes`) `LFS_RULE` trägt; Leerraum am Zeilenrand zählt nicht. */
export function hasLfsRule(attributes: string | undefined): boolean {
  return attributes?.split('\n').some((line) => line.trim() === LFS_RULE) ?? false;
}

/** Pfad, den `LFS_RULE` an Git LFS gibt: eine Datei im `attachments`-Verzeichnis eines Issues. */
export function isLfsPath(path: string): boolean {
  const [top, shard, id, dir, ...rest] = path.split('/');
  return (
    top === 'issues' &&
    shard !== '' &&
    id !== '' &&
    dir === 'attachments' &&
    rest.length > 0 &&
    !rest.includes('')
  );
}
/**
 * Editor- und Systemdateien als `.gitignore`-Muster auf den Dateinamen: `backe init` schreibt sie
 * in die `.gitignore` des Backlogs, `backe commit` lehnt neue, ungetrackte Dateien mit solchen
 * Namen ab. `#` steht maskiert, weil es am Zeilenanfang sonst einen Kommentar beginnt.
 */
export const JUNK_PATTERNS = ['.*.swp', '.*.swo', '*~', '\\#*#', '.DS_Store'] as const;

const JUNK_RES = JUNK_PATTERNS.map(
  (pattern) =>
    new RegExp(
      `^${pattern
        .replace(/^\\/, '')
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replaceAll('*', '.*')}$`,
    ),
);

/** Ob der Dateiname von `path` auf eines der `JUNK_PATTERNS` passt. */
export function isJunkFile(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return JUNK_RES.some((re) => re.test(name));
}

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

/** Was eine Datei im Backlog ist, allein nach ihrem Pfad (backe.md §2.2). */
export type PathClass =
  | { kind: 'issue'; id: string }
  | { kind: 'comment'; id: string; file: string }
  | { kind: 'attachment'; id: string; file: string }
  | { kind: 'user' | 'project' | 'sprint' | 'repo'; key: string }
  | { kind: 'config' }
  | { kind: 'other' };

const NAMED_DIRS = {
  users: { kind: 'user', valid: isHandle },
  projects: { kind: 'project', valid: isProjectPath },
  sprints: { kind: 'sprint', valid: isSprintSlug },
  repos: { kind: 'repo', valid: isRepoName },
} as const;

function classifyIssuePath(parts: readonly string[]): PathClass {
  const [, shard, id = '', sub, file, ...rest] = parts;
  if (!isIssueId(id) || shardOf(id) !== shard || rest.length > 0) return { kind: 'other' };
  if (sub === 'issue.md' && file === undefined) return { kind: 'issue', id };
  if (sub === 'comments' && file !== undefined && parseCommentFileName(file) !== undefined) {
    return { kind: 'comment', id, file };
  }
  if (sub === 'attachments' && file !== undefined && file !== '') {
    return { kind: 'attachment', id, file };
  }
  return { kind: 'other' };
}

/** Shard und Verzeichnisname, wenn `path` die Form `issues/<shard>/<dir>/issue.md` hat (beide nicht leer). */
export function parseIssuePath(path: string): { shard: string; dir: string } | undefined {
  const [top, shard, dir, file, ...rest] = path.split('/');
  if (top !== 'issues' || file !== 'issue.md' || rest.length > 0) return undefined;
  if (shard === undefined || shard === '' || dir === undefined || dir === '') return undefined;
  return { shard, dir };
}

/**
 * Für ein `issues/<x>/<id>/issue.md`, das nicht dem Layout entspricht: `expected` ist der Pfad,
 * an den das Issue gehört, oder `undefined`, wenn `<id>` keine Issue-ID ist. Für jeden anderen
 * Pfad, auch ein richtig liegendes Issue, `undefined`.
 */
export function misplacedIssueFile(path: string): { expected: string | undefined } | undefined {
  const parsed = parseIssuePath(path);
  if (parsed === undefined) return undefined;
  const { shard, dir: id } = parsed;
  if (!isIssueId(id)) return { expected: undefined };
  return shardOf(id) === shard ? undefined : { expected: issueFile(id) };
}

/**
 * Ordnet einen Pfad relativ zur Backlog-Wurzel ein. `.backe/**` ist Config; was nicht genau dem
 * Layout entspricht (falscher Shard, ungültiger Name, fremde Datei), ist `other`.
 */
export function classifyPath(path: string): PathClass {
  if (path.startsWith('.backe/')) return { kind: 'config' };
  const parts = path.split('/');
  const [top = ''] = parts;
  if (top === 'issues') return classifyIssuePath(parts);
  if (Object.hasOwn(NAMED_DIRS, top) && path.endsWith('.md')) {
    const { kind, valid } = NAMED_DIRS[top as keyof typeof NAMED_DIRS];
    const key = path.slice(top.length + 1, -'.md'.length);
    if (valid(key)) return { kind, key };
  }
  return { kind: 'other' };
}

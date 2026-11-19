import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fixture } from '../../test/helpers/backlog.ts';
import { type EntityKind, validateEntity } from '../core/schemas.ts';
import { entriesInFileOrder, parseEntityFile, serializeEntityFile } from './frontmatter.ts';
import {
  attachmentsDir,
  BACKLOG_CONFIG,
  classifyPath,
  commentFileName,
  commentsDir,
  hasLfsRule,
  isJunkFile,
  isLfsPath,
  issueDir,
  issueFile,
  LFS_RULE,
  localStateDir,
  parseCommentFileName,
  projectFile,
  QUARANTINE,
  repoFile,
  sprintFile,
  userFile,
} from './layout.ts';

test('layout paths', () => {
  expect(issueFile('bk-7f3k2')).toBe('issues/7f/bk-7f3k2/issue.md');
  expect(projectFile('web/auth')).toBe('projects/web/auth.md');
  expect(commentFileName('2026-11-18T10:04:00Z', 'spw', 'q8x')).toBe('20261118T100400Z-spw-q8x.md');
});

test('remaining layout paths and constants', () => {
  expect(BACKLOG_CONFIG).toBe('.backe/backlog.jsonc');
  expect(QUARANTINE).toBe('.backe/quarantine.jsonc');
  expect(localStateDir).toBe('.git/backe');
  expect(issueDir('bk-7f3k2')).toBe('issues/7f/bk-7f3k2');
  expect(commentsDir('bk-7f3k2')).toBe('issues/7f/bk-7f3k2/comments');
  expect(attachmentsDir('bk-7f3k2')).toBe('issues/7f/bk-7f3k2/attachments');
  expect(userFile('spw')).toBe('users/spw.md');
  expect(sprintFile('2026-w47')).toBe('sprints/2026-w47.md');
  expect(repoFile('webapp')).toBe('repos/webapp.md');
});

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

function kindOf(rel: string): EntityKind | undefined {
  if (rel.startsWith('users/')) return 'user';
  if (rel.startsWith('projects/')) return 'project';
  if (rel.startsWith('sprints/')) return 'sprint';
  if (rel.startsWith('repos/')) return 'repo';
  if (rel.endsWith('/issue.md')) return 'issue';
  if (rel.includes('/comments/')) return 'comment';
  return undefined;
}

test('the backlog-basic fixture is canonical (serializer roundtrip is byte-identical)', () => {
  const root = fixture('backlog-basic');
  let checked = 0;
  for (const file of walk(root)) {
    const rel = relative(root, file);
    const kind = kindOf(rel);
    if (!kind) continue;
    const text = readFileSync(file, 'utf8');
    const parsed = parseEntityFile(text, rel);
    const { data, unknownKeys } = validateEntity(kind, parsed.data, rel);
    const extra = entriesInFileOrder(parsed, unknownKeys);
    expect(
      serializeEntityFile(kind, data as Record<string, unknown>, parsed.body, extra),
      rel,
    ).toBe(text);
    checked++;
  }
  expect(checked).toBe(10);
});

describe('parseCommentFileName', () => {
  test('inverts commentFileName', () => {
    expect(parseCommentFileName('20261118T100400Z-claude-1-q8x.md')).toEqual({
      created: '2026-11-18T10:04:00Z',
      author: 'claude-1',
      rnd: 'q8x',
    });
    const name = commentFileName('2026-01-02T03:04:05Z', 'spw', 'abc');
    expect(parseCommentFileName(name)).toEqual({
      created: '2026-01-02T03:04:05Z',
      author: 'spw',
      rnd: 'abc',
    });
  });

  test.each([
    ['wrong extension', '20261118T100400Z-spw-q8x.txt'],
    ['no random part', '20261118T100400Z-spw.md'],
    ['random part with a non-Crockford letter', '20261118T100400Z-spw-q8u.md'],
    ['random part of the wrong length', '20261118T100400Z-spw-q8xx.md'],
    ['impossible timestamp', '20261340T100400Z-spw-q8x.md'],
    ['invalid handle', '20261118T100400Z-Spw-q8x.md'],
    ['empty', ''],
  ])('rejects %s', (_, name) => {
    expect(parseCommentFileName(name)).toBeUndefined();
  });
});

describe('classifyPath', () => {
  const dir = 'issues/7f/bk-7f3k2';

  test.each([
    [`${dir}/issue.md`, { kind: 'issue', id: 'bk-7f3k2' }],
    [
      `${dir}/comments/20261118T100400Z-spw-q8x.md`,
      { kind: 'comment', id: 'bk-7f3k2', file: '20261118T100400Z-spw-q8x.md' },
    ],
    [`${dir}/attachments/shot.png`, { kind: 'attachment', id: 'bk-7f3k2', file: 'shot.png' }],
    ['users/claude-1.md', { kind: 'user', key: 'claude-1' }],
    ['projects/web/auth.md', { kind: 'project', key: 'web/auth' }],
    ['sprints/2026-w47.md', { kind: 'sprint', key: '2026-w47' }],
    ['repos/web.app.md', { kind: 'repo', key: 'web.app' }],
    ['.backe/backlog.jsonc', { kind: 'config' }],
    ['.backe/schemas/props.json', { kind: 'config' }],
  ])('%s', (path, expected) => {
    expect(classifyPath(path)).toEqual(expected);
  });

  test.each([
    ['a file next to issue.md', `${dir}/notes.txt`],
    ['a nested file in the issue directory', `${dir}/sub/issue.md`],
    ['an issue in the wrong shard', 'issues/7g/bk-7f3k2/issue.md'],
    ['an issue directory that is no id', 'issues/7f/nope/issue.md'],
    ['a comment with an invalid name', `${dir}/comments/note.md`],
    ['a nested comment', `${dir}/comments/x/20261118T100400Z-spw-q8x.md`],
    ['a nested attachment', `${dir}/attachments/x/shot.png`],
    ['an empty attachment name', `${dir}/attachments/`],
    ['an invalid handle', 'users/Spw.md'],
    ['a nested user file', 'users/a/spw.md'],
    ['a user file without .md', 'users/spw.txt'],
    ['an invalid project path', 'projects/Web.md'],
    ['an invalid sprint slug', 'sprints/W47.md'],
    ['an invalid repo name', 'repos/-x.md'],
    ['a top-level file', 'README.md'],
    ['an unknown directory', 'docs/x.md'],
    ['.backe itself', '.backe'],
    ['an empty path', ''],
  ])('%s is other', (_, path) => {
    expect(classifyPath(path)).toEqual({ kind: 'other' });
  });
});

test('isJunkFile matches editor and system files by name only', () => {
  for (const p of ['a/.issue.md.swp', '.x.swo', 'issue.md~', 'a/#issue.md#', 'x/.DS_Store']) {
    expect([p, isJunkFile(p)]).toEqual([p, true]);
  }
  for (const p of ['notes.swp', 'a.swp/issue.md', '#a', 'a#', 'DS_Store', '.DS_Store.md']) {
    expect([p, isJunkFile(p)]).toEqual([p, false]);
  }
});

test('isLfsPath and hasLfsRule follow LFS_RULE', () => {
  expect(isLfsPath('issues/01/bk-01234/attachments/a.txt')).toBe(true);
  expect(isLfsPath('issues/01/bk-01234/attachments/sub/a.txt')).toBe(true);
  expect(isLfsPath('issues/01/bk-01234/attachments')).toBe(false);
  expect(isLfsPath('issues/01/bk-01234/issue.md')).toBe(false);
  expect(isLfsPath('issues//bk-01234/attachments/a')).toBe(false);
  expect(hasLfsRule(undefined)).toBe(false);
  expect(hasLfsRule(`* text=auto\r\n ${LFS_RULE}\r\n`)).toBe(true);
  expect(hasLfsRule(`#${LFS_RULE}\n`)).toBe(false);
});

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fixture } from '../../test/helpers/backlog.ts';
import { type EntityKind, validateEntity } from '../core/schemas.ts';
import { entriesInFileOrder, parseEntityFile, serializeEntityFile } from './frontmatter.ts';
import {
  attachmentsDir,
  BACKLOG_CONFIG,
  commentFileName,
  commentsDir,
  issueDir,
  issueFile,
  localStateDir,
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

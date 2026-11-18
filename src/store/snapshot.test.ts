import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { copyFixture, fixture, tempDir } from '../../test/helpers/backlog.ts';
import { catchErr, catchErrAsync } from '../../test/helpers/catch.ts';
import { serializeEntityFile } from './frontmatter.ts';
import { readJsonc } from './jsonc.ts';
import { BACKLOG_CONFIG, issueFile } from './layout.ts';
import { listComments, listIssueIds, loadSnapshot } from './snapshot.ts';

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(join(root, path, '..'), { recursive: true });
  await writeFile(join(root, path), content);
}

test('loadSnapshot reads every entity kind', async () => {
  const s = await loadSnapshot(fixture('backlog-basic'));
  expect([...s.issues.keys()].sort()).toEqual(['bk-7f3k2', 'bk-a91c0', 'bk-x2c8d']);
  expect(s.projects.has('web/auth')).toBe(true);
  expect(s.config.id_prefix).toBe('bk');
  expect(s.problems).toEqual([]);
  expect([...s.users.keys()]).toEqual(['claude-1', 'spw']);
  expect([...s.projects.keys()]).toEqual(['web', 'web/auth']);
  expect([...s.sprints.keys()]).toEqual(['2026-w47']);
  expect([...s.repos.keys()]).toEqual(['webapp']);
  const issue = s.issues.get('bk-7f3k2');
  expect(issue?.path).toBe('issues/7f/bk-7f3k2/issue.md');
  expect(issue?.body).toBe('Beschreibung.\n');
  expect(issue?.data.title).toBe('SSO-Login bricht ab');
  expect(s.users.get('spw')?.path).toBe('users/spw.md');
  expect(s.projects.get('web/auth')?.path).toBe('projects/web/auth.md');
});

test('loadSnapshot reports broken files as problems', async () => {
  const root = await copyFixture('backlog-basic');
  await writeFile(join(root, issueFile('bk-a91c0')), '---\nid: [\n---\n');
  const s = await loadSnapshot(root);
  expect(s.issues.has('bk-a91c0')).toBe(false);
  expect(s.issues.size).toBe(2);
  expect(s.problems).toEqual([
    {
      path: 'issues/a9/bk-a91c0/issue.md',
      message: expect.stringMatching(/issue\.md:\d+/),
      kind: 'issue',
      key: 'bk-a91c0',
    },
  ]);
});

test('problems name kind and key of every broken entity kind', async () => {
  const root = await copyFixture('backlog-basic');
  const broken = '---\ntitle: [\n---\n';
  for (const path of [
    'users/spw.md',
    'projects/web/auth.md',
    'sprints/2026-w47.md',
    'repos/webapp.md',
    issueFile('bk-x2c8d'),
  ])
    await writeFile(join(root, path), broken);
  // Schema-Verstoß statt Syntaxfehler: auch dann zählt die Identität aus dem Pfad.
  await put(root, 'users/bad.md', '---\nname: X\nkind: agent\nkeys: []\n---\n');
  const s = await loadSnapshot(root);
  expect(s.problems.map(({ path, kind, key }) => ({ path, kind, key }))).toEqual([
    { path: 'users/bad.md', kind: 'user', key: 'bad' },
    { path: 'users/spw.md', kind: 'user', key: 'spw' },
    { path: 'projects/web/auth.md', kind: 'project', key: 'web/auth' },
    { path: 'sprints/2026-w47.md', kind: 'sprint', key: '2026-w47' },
    { path: 'repos/webapp.md', kind: 'repo', key: 'webapp' },
    { path: 'issues/x2/bk-x2c8d/issue.md', kind: 'issue', key: 'bk-x2c8d' },
  ]);
});

test('schema violations become problems', async () => {
  const root = await copyFixture('backlog-basic');
  await put(root, 'users/bad.md', '---\nname: X\nkind: agent\nkeys: [ssh-ed25519 AAAA]\n---\n');
  const s = await loadSnapshot(root);
  expect(s.users.has('bad')).toBe(false);
  expect(s.problems).toHaveLength(1);
  expect(s.problems[0]?.path).toBe('users/bad.md');
  expect(s.problems[0]?.message).toContain('users/bad.md: operator');
});

test('issue id must match its directory', async () => {
  const root = await copyFixture('backlog-basic');
  const text = `---\nid: bk-zzzzz\ntitle: Falsch\nstate: todo\ncreator: spw\ncreated: 2026-11-18T10:04:00Z\n---\n`;
  await writeFile(join(root, issueFile('bk-a91c0')), text);
  const s = await loadSnapshot(root);
  expect(s.issues.has('bk-a91c0')).toBe(false);
  expect(s.issues.has('bk-zzzzz')).toBe(false);
  expect(s.problems).toHaveLength(1);
  expect(s.problems[0]?.path).toBe('issues/a9/bk-a91c0/issue.md');
  expect(s.problems[0]?.message).toContain('bk-a91c0');
  expect(s.problems[0]).toMatchObject({ kind: 'issue', key: 'bk-a91c0' });
});

test('issue directory and shard must be well-formed', async () => {
  const root = await copyFixture('backlog-basic');
  const ok = (id: string) =>
    `---\nid: ${id}\ntitle: T\nstate: todo\ncreator: spw\ncreated: 2026-11-18T10:04:00Z\n---\n`;
  await put(root, 'issues/7f/not-an-id/issue.md', ok('bk-7f3k3'));
  await put(root, 'issues/aa/bk-7f3k3/issue.md', ok('bk-7f3k3'));
  const s = await loadSnapshot(root);
  expect(s.issues.size).toBe(3);
  expect(s.problems.map(({ path, kind, key }) => ({ path, kind, key }))).toEqual([
    // Kein gültiger Name, also keine Identität — nur die Art steht fest.
    { path: 'issues/7f/not-an-id/issue.md', kind: 'issue', key: undefined },
    { path: 'issues/aa/bk-7f3k3/issue.md', kind: 'issue', key: 'bk-7f3k3' },
  ]);
  expect(s.problems[0]).not.toHaveProperty('key');
});

test('names derived from paths are checked', async () => {
  const root = await copyFixture('backlog-basic');
  await put(
    root,
    'users/Bad_Name.md',
    '---\nname: X\nkind: human\nkeys: [ssh-ed25519 AAAA]\n---\n',
  );
  await put(root, 'sprints/Bad Slug.md', '---\ntitle: X\n---\n');
  await put(root, 'repos/-bad.md', '---\nurl: gh:a/b\n---\n');
  await put(root, 'projects/Bad.md', '---\ntitle: X\n---\n');
  const s = await loadSnapshot(root);
  expect(s.problems.map((p) => p.path).sort()).toEqual([
    'projects/Bad.md',
    'repos/-bad.md',
    'sprints/Bad Slug.md',
    'users/Bad_Name.md',
  ]);
  expect(s.problems.map(({ kind }) => kind).sort()).toEqual(['project', 'repo', 'sprint', 'user']);
  for (const p of s.problems) expect(p).not.toHaveProperty('key');
  expect(s.users.size).toBe(2);
});

test('a subproject without its parent is a problem', async () => {
  const root = await copyFixture('backlog-basic');
  await put(root, 'projects/ops/infra.md', '---\ntitle: Infra\n---\n');
  const s = await loadSnapshot(root);
  expect(s.projects.has('ops/infra')).toBe(false);
  expect(s.problems).toHaveLength(1);
  expect(s.problems[0]?.path).toBe('projects/ops/infra.md');
  expect(s.problems[0]?.message).toContain('ops');
  expect(s.problems[0]).toMatchObject({ kind: 'project', key: 'ops/infra' });
});

test('unrelated files are neither loaded nor reported', async () => {
  const root = await copyFixture('backlog-basic');
  await put(root, '.gitattributes', '* text=auto\n');
  await put(root, 'users/notes.txt', 'x');
  await put(root, 'issues/7f/bk-7f3k2/attachments/trace.json', '{}');
  await put(root, 'issues/README.md', 'x');
  await put(root, 'issues/7f/stray.md', 'x');
  const s = await loadSnapshot(root);
  expect(s.problems).toEqual([]);
  expect(s.issues.size).toBe(3);
});

test('a missing backlog config is not_found', async () => {
  const root = await tempDir();
  const err = await catchErrAsync(() => loadSnapshot(root));
  expect(err.code).toBe('not_found');
});

test('a broken backlog config is a validation error with file', async () => {
  const root = await copyFixture('backlog-basic');
  await writeFile(join(root, BACKLOG_CONFIG), '{\n  "version": ,\n}');
  const syntax = await catchErrAsync(() => loadSnapshot(root));
  expect(syntax.code).toBe('validation');
  expect(syntax.message).toContain('.backe/backlog.jsonc:2');

  await writeFile(join(root, BACKLOG_CONFIG), '{"version": 1}');
  const schema = await catchErrAsync(() => loadSnapshot(root));
  expect(schema.code).toBe('validation');
  expect(schema.message).toContain('.backe/backlog.jsonc');
});

test('a snapshot without entity directories is empty', async () => {
  const root = await copyFixture('backlog-basic');
  for (const d of ['users', 'projects', 'sprints', 'repos', 'issues'])
    await rm(join(root, d), { recursive: true });
  const s = await loadSnapshot(root);
  expect(s.issues.size + s.users.size + s.projects.size + s.sprints.size + s.repos.size).toBe(0);
  expect(s.problems).toEqual([]);
});

test('unknown keys survive a load/serialize cycle with values and file order', async () => {
  const root = fixture('backlog-unknown-key');
  const s = await loadSnapshot(root);
  expect(s.problems).toEqual([]);
  const issue = s.issues.get('bk-7f3k2');
  if (!issue) throw new Error('Issue fehlt');
  // "2" steht in der Datei hinter "legacy", obwohl JS-Objekte integer-artige Keys voranstellen.
  expect(issue.extra).toEqual([
    ['legacy', 'yes'],
    ['2', 'x'],
  ]);
  expect(issue.data).not.toHaveProperty('legacy');
  const text = await readFile(join(root, issue.path), 'utf8');
  expect(serializeEntityFile('issue', issue.data, issue.body, issue.extra)).toBe(text);
});

test('listIssueIds by shard', async () => {
  expect(await listIssueIds(fixture('backlog-basic'), '7f')).toEqual(['bk-7f3k2']);
});

test('listIssueIds without shard spans all shards, sorted; missing dirs give []', async () => {
  expect(await listIssueIds(fixture('backlog-basic'))).toEqual([
    'bk-7f3k2',
    'bk-a91c0',
    'bk-x2c8d',
  ]);
  expect(await listIssueIds(fixture('backlog-basic'), 'zz')).toEqual([]);
  expect(await listIssueIds(await tempDir())).toEqual([]);
});

test('listIssueIds skips directories that are no ids or sit in the wrong shard', async () => {
  const root = await copyFixture('backlog-basic');
  await mkdir(join(root, 'issues/7f/junk'), { recursive: true });
  await mkdir(join(root, 'issues/aa/bk-7f3k3'), { recursive: true });
  await put(root, 'issues/7f/file.txt', 'x');
  expect(await listIssueIds(root, '7f')).toEqual(['bk-7f3k2']);
  expect(await listIssueIds(root, 'aa')).toEqual([]);
  expect(await listIssueIds(root)).toEqual(['bk-7f3k2', 'bk-a91c0', 'bk-x2c8d']);
});

test('listComments is chronological and parsed', async () => {
  const root = await copyFixture('backlog-basic');
  await put(
    root,
    'issues/7f/bk-7f3k2/comments/20261118T090000Z-spw-aaa.md',
    '---\nauthor: spw\ncreated: 2026-11-18T09:00:00Z\n---\nFrüher.\n',
  );
  await put(root, 'issues/7f/bk-7f3k2/comments/notes.txt', 'ignored');
  const list = await listComments(root, 'bk-7f3k2');
  expect(list.map((c) => c.path)).toEqual([
    'issues/7f/bk-7f3k2/comments/20261118T090000Z-spw-aaa.md',
    'issues/7f/bk-7f3k2/comments/20261118T100400Z-claude-1-q8x.md',
  ]);
  expect(list[0]?.body).toBe('Früher.\n');
  expect(list[1]?.data.author).toBe('claude-1');
});

test('listComments: missing dir gives [], broken comment throws validation', async () => {
  const root = await copyFixture('backlog-basic');
  expect(await listComments(root, 'bk-a91c0')).toEqual([]);
  await put(
    root,
    'issues/a9/bk-a91c0/comments/20261118T090000Z-spw-aaa.md',
    '---\nauthor: [\n---\n',
  );
  const err = await catchErrAsync(() => listComments(root, 'bk-a91c0'));
  expect(err.code).toBe('validation');
  expect(err.message).toContain('20261118T090000Z-spw-aaa.md');
});

test('readJsonc reports syntax errors with line', () => {
  expect(catchErr(() => readJsonc('{\n  "a": ,\n}', 'x.jsonc')).message).toContain('x.jsonc:2');
});

test('readJsonc accepts comments and trailing commas', () => {
  expect(readJsonc('{\n  // c\n  "a": [1, 2,],\n}', 'x.jsonc')).toEqual({ a: [1, 2] });
});

test('readJsonc rejects an empty document', () => {
  const err = catchErr(() => readJsonc('', 'x.jsonc'));
  expect(err.code).toBe('validation');
  expect(err.message).toContain('x.jsonc:1');
});

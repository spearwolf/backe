import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { copyFixture, fixture, tempDir } from '../../test/helpers/backlog.ts';
import { catchErr, catchErrAsync } from '../../test/helpers/catch.ts';
import { I, snap } from '../../test/helpers/snapshot.ts';
import { serializeEntityFile } from './frontmatter.ts';
import { readJsonc } from './jsonc.ts';
import { BACKLOG_CONFIG, issueFile } from './layout.ts';
import {
  listComments,
  listIssueIds,
  loadRepoRegistry,
  loadSnapshot,
  snapshotAt,
} from './snapshot.ts';

const readHook = vi.hoisted(() => ({
  fn: undefined as undefined | ((path: unknown, ...rest: unknown[]) => Promise<unknown>),
}));
vi.mock('node:fs/promises', async (orig) => {
  const actual = await orig<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) =>
      readHook.fn ? readHook.fn(...args) : actual.readFile(...args),
  };
});

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

test('problems are sorted by path regardless of load order', async () => {
  const root = await copyFixture('backlog-basic');
  await writeFile(join(root, issueFile('bk-x2c8d')), '---\nid: [\n---\n');
  await writeFile(join(root, issueFile('bk-a91c0')), '---\nid: [\n---\n');
  const s = await loadSnapshot(root);
  expect(s.problems.map((p) => p.path)).toEqual([issueFile('bk-a91c0'), issueFile('bk-x2c8d')]);
});

test('issue.md that is a directory is skipped', async () => {
  const root = await copyFixture('backlog-basic');
  await rm(join(root, issueFile('bk-7f3k2')));
  await mkdir(join(root, issueFile('bk-7f3k2')));
  const s = await loadSnapshot(root);
  expect(s.issues.has('bk-7f3k2')).toBe(false);
  expect(s.issues.size).toBe(2);
  expect(s.problems).toEqual([]);
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

test('a user with an unparseable key is a problem of that user, not an error', async () => {
  const root = await copyFixture('backlog-basic');
  await put(
    root,
    'users/bob.md',
    '---\nname: Bob\nkind: human\nkeys: [ssh-ed25519 AAAAbob bob]\n---\n',
  );
  const s = await loadSnapshot(root);
  expect(s.users.has('bob')).toBe(false);
  expect(s.problems).toHaveLength(1);
  expect(s.problems[0]).toMatchObject({ path: 'users/bob.md', kind: 'user', key: 'bob' });
  expect(s.problems[0]?.message).toContain('keys');
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

test('loadRepoRegistry loads only repos and skips broken files', async () => {
  const root = await copyFixture('backlog-basic');
  await writeFile(join(root, 'repos/broken.md'), '---\nurl: [\n---\n');
  await rm(join(root, '.backe/backlog.jsonc'));
  expect([...(await loadRepoRegistry(root)).keys()]).toEqual(['webapp']);
});

test('loading stops reading after the first failure', async () => {
  const root = await copyFixture('backlog-basic');
  for (let n = 0; n < 60; n++) {
    await put(root, `issues/zz/bk-zz${String(n).padStart(3, '0')}/issue.md`, 'x');
  }
  const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const reads: string[] = [];
  readHook.fn = async (path, ...rest) => {
    if (String(path).endsWith('/issue.md')) {
      reads.push(String(path));
      throw Object.assign(new Error('nope'), { code: 'EACCES' });
    }
    return real.readFile(path as never, ...(rest as []));
  };
  try {
    const err = await loadSnapshot(root).then(
      () => undefined,
      (e: unknown) => e as NodeJS.ErrnoException,
    );
    expect(err?.code).toBe('EACCES');
    expect(reads.length).toBeLessThanOrEqual(32);
  } finally {
    readHook.fn = undefined;
  }
});

test('listIssueIds and listComments refuse malformed input', async () => {
  const root = fixture('backlog-basic');
  for (const shard of ['../x', 'a', 'abc', 'IL']) {
    expect((await catchErrAsync(() => listIssueIds(root, shard))).code).toBe('validation');
  }
  for (const id of ['../x', 'bk-../../etc', '']) {
    expect((await catchErrAsync(() => listComments(root, id))).code).toBe('validation');
  }
});

/** Kanonischer Inhalt einer Issue-Datei mit Test-Defaults. */
function issueText(data: { id: string; title?: string; parent?: string }): string {
  return serializeEntityFile(
    'issue',
    { title: data.id, state: 'todo', creator: 'spw', created: '2026-11-18T10:00:00Z', ...data },
    '',
  );
}

describe('snapshotAt', () => {
  test('snapshotAt replaces, adds and removes entities by path', () => {
    const s0 = snap({
      issues: [{ id: I(1), title: 'alt' }],
      repos: { webapp: 'https://github.com/acme/webapp' },
    });
    const s1 = snapshotAt(s0, [
      { path: issueFile(I(1)), content: issueText({ id: I(1), title: 'neu' }) },
      { path: issueFile(I(2)), content: issueText({ id: I(2) }) },
      { path: 'repos/webapp.md', content: null },
    ]);
    expect(s1.issues.get(I(1))?.data.title).toBe('neu');
    expect([...s1.issues.keys()]).toEqual([I(1), I(2)]);
    expect(s1.repos.size).toBe(0);
    expect(s0.issues.get(I(1))?.data.title).toBe('alt');
    expect([...s0.issues.keys()]).toEqual([I(1)]);
    expect(s0.repos.size).toBe(1);
  });

  test('snapshotAt turns a broken file into a problem and drops the problem of a repaired one', () => {
    const s0 = snap({ issues: [{ id: I(1) }] });
    const broken = snapshotAt(s0, [{ path: issueFile(I(1)), content: '---\nid: [\n---\n' }]);
    expect(broken.issues.has(I(1))).toBe(false);
    expect(broken.problems).toEqual([
      {
        path: issueFile(I(1)),
        message: expect.stringMatching(/issue\.md:\d+/),
        kind: 'issue',
        key: I(1),
      },
    ]);
    const repaired = snapshotAt(broken, [
      { path: issueFile(I(1)), content: issueText({ id: I(1) }) },
    ]);
    expect([repaired.problems, repaired.issues.has(I(1))]).toEqual([[], true]);
  });

  test('snapshotAt parses like loadSnapshot', async () => {
    const root = await copyFixture('backlog-basic');
    await put(root, 'users/Bad_Name.md', '---\nname: X\nkind: human\n---\n');
    const s0 = await loadSnapshot(root);
    const files: { path: string; content: string | null }[] = [
      { path: issueFile('bk-a91c0'), content: '---\nid: [\n---\n' },
      { path: 'issues/aa/bk-7f3k3/issue.md', content: issueText({ id: 'bk-7f3k3' }) },
      { path: 'issues/7f/not-an-id/issue.md', content: issueText({ id: 'bk-7f3k4' }) },
      { path: issueFile('bk-7f3k5'), content: issueText({ id: 'bk-7f3k6' }) },
      { path: 'users/Bad_Name.md', content: null },
      { path: 'users/Also_Bad.md', content: '---\nname: X\nkind: human\n---\n' },
      { path: 'projects/web.md', content: null },
      { path: 'sprints/2026-w48.md', content: '---\ntitle: W48\n---\n' },
      { path: 'repos/api.md', content: '---\nurl: https://github.com/acme/api\n---\n' },
      { path: '.gitattributes', content: '* text=auto\n' },
      // Was loadSnapshot nicht liest, ändert auch hier nichts.
      { path: 'issues/7f/bk-7f3k2/comments/20261118T100400Z-claude-1-q8x.md', content: null },
      { path: 'issues/7f/bk-7f3k2/attachments/log.txt', content: 'x' },
      { path: 'users/sub/nested.md', content: '---\nname: X\nkind: human\n---\n' },
      { path: BACKLOG_CONFIG, content: 'kaputt' },
      { path: 'README.md', content: 'x' },
    ];
    for (const f of files) {
      if (f.path === BACKLOG_CONFIG) continue;
      if (f.content === null) await rm(join(root, f.path));
      else await put(root, f.path, f.content);
    }
    expect(snapshotAt(s0, files)).toEqual(await loadSnapshot(root));
  });

  test('snapshotAt keeps the order of keys sorted', () => {
    const s0 = snap({ issues: [{ id: I(2) }], projects: ['b'] });
    const s1 = snapshotAt(s0, [
      { path: issueFile(I(1)), content: issueText({ id: I(1) }) },
      { path: issueFile(I(3)), content: issueText({ id: I(3) }) },
      { path: 'projects/a.md', content: '---\ntitle: A\n---\n' },
    ]);
    expect([...s1.issues.keys()]).toEqual([I(1), I(2), I(3)]);
    expect([...s1.projects.keys()]).toEqual(['a', 'b']);
  });
});

test('loadSnapshot reads .gitattributes', async () => {
  const root = await copyFixture('backlog-basic');
  expect((await loadSnapshot(root)).attributes).toBeUndefined();
  await put(root, '.gitattributes', '*.png binary\n');
  expect((await loadSnapshot(root)).attributes).toBe('*.png binary\n');
});

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testBacklog } from '../../test/helpers/git.ts';
import { connectMcp } from '../../test/helpers/mcp.ts';
import { addAttachment } from '../services/attachments.ts';
import { addComment } from '../services/comments.ts';
import { listIssues } from '../services/issue-list.ts';
import { createIssue, rankIssue } from '../services/issues.ts';
import { listProjects } from '../services/projects.ts';
import { listSprints, showSprint } from '../services/sprints.ts';
import { issueListResultJson, sprintShowJson } from '../services/views.ts';
import { executeWrite } from '../services/write.ts';
import { BACKLOG_CONFIG, issueFile } from '../store/layout.ts';

const listSpy = vi.hoisted(() => vi.fn());
const nextSpy = vi.hoisted(() => vi.fn());
vi.mock('../services/issue-list.ts', async (orig) => {
  const actual = await orig<typeof import('../services/issue-list.ts')>();
  return {
    ...actual,
    listIssues: (...a: Parameters<typeof actual.listIssues>) => {
      listSpy(...a);
      return actual.listIssues(...a);
    },
  };
});
vi.mock('../services/next.ts', async (orig) => {
  const actual = await orig<typeof import('../services/next.ts')>();
  return {
    ...actual,
    nextIssue: (...a: Parameters<typeof actual.nextIssue>) => {
      nextSpy(...a);
      return actual.nextIssue(...a);
    },
  };
});

async function withMcp<T>(
  fn: (
    m: Awaited<ReturnType<typeof connectMcp>>,
    b: Awaited<ReturnType<typeof testBacklog>>,
  ) => Promise<T>,
): Promise<T> {
  const b = await testBacklog();
  const m = await connectMcp(b);
  try {
    return await fn(m, b);
  } finally {
    await m.close();
  }
}

const id = async (p: Promise<{ id?: string }>): Promise<string> => {
  const r = await p;
  if (r.id === undefined) throw new Error('kein id im Ergebnis');
  return r.id;
};

test('issue_list matches backe issue list --json', () =>
  withMcp(async (m, b) => {
    const ctx = await b.context();
    await createIssue(ctx, { title: 'A' });
    await createIssue(ctx, { title: 'B' });
    expect(await m.call('issue_list')).toEqual({
      ok: issueListResultJson(await listIssues(ctx, {})),
    });
    const r = await m.call('issue_list', { fields: ['id', 'state'] });
    const issues = (r as { ok: { issues: Record<string, unknown>[] } }).ok.issues;
    expect(issues.length).toBe(2);
    for (const i of issues) expect(Object.keys(i).sort()).toEqual(['id', 'state']);
  }));

test('unknown fields are usage before any service runs', () =>
  withMcp(async (m, b) => {
    const i = await id(createIssue(await b.context(), { title: 'A' }));
    listSpy.mockClear();
    nextSpy.mockClear();
    const usage = { error: { code: 'usage', message: 'Unbekannte Felder für --fields: »bogus«' } };
    expect(await m.call('issue_list', { fields: ['bogus'] })).toMatchObject(usage);
    expect(await m.call('issue_next', { fields: ['bogus'] })).toMatchObject(usage);
    expect(await m.call('issue_get', { id: i, fields: ['bogus'] })).toMatchObject(usage);
    expect(listSpy).not.toHaveBeenCalled();
    expect(nextSpy).not.toHaveBeenCalled();
  }));

test('issue_list sorts by rank then created', () =>
  withMcp(async (m, b) => {
    const ctx = await b.context();
    await createIssue(ctx, { title: 'A' });
    await createIssue(ctx, { title: 'B' });
    const c = await id(createIssue(ctx, { title: 'C' }));
    await rankIssue(ctx, c, { top: true });
    const r = await m.call('issue_list');
    expect((r as { ok: { issues: { id: string }[] } }).ok.issues[0]?.id).toBe(c);
  }));

test('issue_get with comments last carries exactly one comment', () =>
  withMcp(async (m, b) => {
    const ctx = await b.context();
    const i = await id(createIssue(ctx, { title: 'A' }));
    await addComment(ctx, i, 'eins');
    await addComment(ctx, i, 'zwei');
    const last = await m.call('issue_get', { id: i, comments: 'last' });
    expect(last).toHaveProperty('ok.comments.length', 1);
    const none = (await m.call('issue_get', { id: i })) as { ok: Record<string, unknown> };
    expect(none.ok).not.toHaveProperty('comments');
    expect(none.ok.comments_count).toBe(2);
  }));

test('issue_get with comments last on an issue without comments has none', () =>
  withMcp(async (m, b) => {
    const i = await id(createIssue(await b.context(), { title: 'A' }));
    const r = (await m.call('issue_get', { id: i, comments: 'last' })) as {
      ok: Record<string, unknown>;
    };
    expect(r.ok).not.toHaveProperty('comments');
    expect(r.ok.comments_count).toBe(0);
  }));

test('issue_get resolves a short id', () =>
  withMcp(async (m, b) => {
    const i = await id(createIssue(await b.context(), { title: 'A' }));
    expect(await m.call('issue_get', { id: i.slice(-8) })).toHaveProperty('ok.id', i);
  }));

test('issue_next without candidate is not_found', () =>
  withMcp(async (m) => {
    expect(await m.call('issue_next')).toHaveProperty('error.code', 'not_found');
  }));

test('issue_next returns the next issue', () =>
  withMcp(async (m, b) => {
    const i = await id(createIssue(await b.context(), { title: 'A' }));
    expect(await m.call('issue_next', { fields: ['id'] })).toHaveProperty('ok.issue.id', i);
  }));

test('project_list, sprint_list, sprint_get and repo_locate match the CLI views', () =>
  withMcp(async (m, b) => {
    const ctx = await b.context();
    await executeWrite(ctx, {
      kind: 'batch',
      ops: [
        { op: 'project.create', path: 'web', title: 'Web' },
        { op: 'sprint.create', slug: 's1', title: 'Eins' },
      ] as never,
    });
    expect(await m.call('project_list')).toEqual({ ok: await listProjects(ctx) });
    expect(await m.call('sprint_list')).toEqual({ ok: await listSprints(ctx) });
    expect(await m.call('sprint_get', { slug: 's1' })).toEqual({
      ok: sprintShowJson('s1', await showSprint(ctx, 's1')),
    });
    expect(await m.call('sprint_get', { slug: 'nope' })).toHaveProperty('error.code', 'not_found');
    expect(await m.call('repo_locate', { name: 'nope' })).toHaveProperty('error.code', 'not_found');
  }));

test('attachment_get returns text for a small utf-8 file and none for binary', () =>
  withMcp(async (m, b) => {
    const ctx = await b.context();
    const i = await id(createIssue(ctx, { title: 'A' }));
    const utf8 = (s: string) => new TextEncoder().encode(s);
    await addAttachment(ctx, i, {
      name: 'n.md',
      source: { kind: 'file', fileName: 'n.md', content: utf8('# hi') },
    });
    await addAttachment(ctx, i, {
      name: 'b.bin',
      source: { kind: 'file', fileName: 'b.bin', content: Uint8Array.of(0xff, 0xfe) },
    });
    expect(await m.call('attachment_get', { id: i, name: 'n.md' })).toHaveProperty(
      'ok.text',
      '# hi',
    );
    const bin = (await m.call('attachment_get', { id: i, name: 'b.bin' })) as {
      ok: Record<string, unknown>;
    };
    expect(bin.ok).not.toHaveProperty('text');
    expect(bin.ok.size).toBe(2);
  }));

test('the issue resource serves the file as markdown', () =>
  withMcp(async (m, b) => {
    const ctx = await b.context();
    const i = await id(createIssue(ctx, { title: 'A', body: 'Text' }));
    const r = await m.client.readResource({ uri: `backe://issue/${i.slice(-8)}` });
    const file = await readFile(join(b.root, issueFile(i)), 'utf8');
    expect(r.contents[0]).toMatchObject({ uri: `backe://issue/${i}`, mimeType: 'text/markdown' });
    expect((r.contents[0] as { text: string }).text).toBe(file);
    expect((r.contents[0] as { text: string }).text).toContain('Text');
    await expect(m.client.readResource({ uri: 'backe://issue/zzzzzzzz' })).rejects.toThrow(
      /Keine Issue-ID passt zu »zzzzzzzz«/,
    );
  }));

test('a malformed percent encoding in the resource URI is a German validation error', () =>
  withMcp(async (m) => {
    await expect(m.client.readResource({ uri: 'backe://issue/bk-%E0%A4%A' })).rejects.toThrow(
      'Ungültige Issue-ID in der URI: »bk-%E0%A4%A«',
    );
  }));

test('reads schedule a background sync', async () => {
  const b = await testBacklog({ remote: true });
  const calls: unknown[] = [];
  const config = await readFile(join(b.root, BACKLOG_CONFIG), 'utf8');
  await executeWrite(await b.context(), {
    kind: 'manual',
    subject: 'pull_interval: 0',
    changes: [
      {
        path: BACKLOG_CONFIG,
        content: config.replace(/\n}\n$/, `,\n  "sync": { "pull_interval": 0 }\n}\n`),
      },
    ],
  });
  const m = await connectMcp(b, { deps: { sync: { spawn: (a) => void calls.push(a) } } });
  try {
    await m.call('issue_list');
    expect(calls).toHaveLength(1);
  } finally {
    await m.close();
  }
});

test('unknown fields and a malformed resource URI schedule no read sync', async () => {
  const b = await testBacklog({ remote: true });
  const calls: unknown[] = [];
  const config = await readFile(join(b.root, BACKLOG_CONFIG), 'utf8');
  await executeWrite(await b.context(), {
    kind: 'manual',
    subject: 'pull_interval: 0',
    changes: [
      {
        path: BACKLOG_CONFIG,
        content: config.replace(/\n}\n$/, `,\n  "sync": { "pull_interval": 0 }\n}\n`),
      },
    ],
  });
  const i = await id(createIssue(await b.context(), { title: 'A' }));
  const m = await connectMcp(b, { deps: { sync: { spawn: (a) => void calls.push(a) } } });
  try {
    for (const tool of ['issue_list', 'issue_get', 'issue_next']) {
      const r = await m.call(tool, { ...(tool === 'issue_get' ? { id: i } : {}), fields: ['x'] });
      expect(r).toMatchObject({ error: { code: 'usage' } });
    }
    await expect(m.client.readResource({ uri: 'backe://issue/bk-%E0%A4%A' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
    await m.client.readResource({ uri: `backe://issue/${i}` });
    expect(calls).toHaveLength(1);
  } finally {
    await m.close();
  }
});

test('issue_list maps every parameter onto its query field', () =>
  withMcp(async (m, b) => {
    await createIssue(await b.context(), { title: 'A' });
    const params = {
      state: ['open', 'done'],
      project: ['web'],
      exact: true,
      sprint: ['s1'],
      repo: ['r'],
      assignee: 'none',
      creator: 'me',
      mode: 'ready',
      parent: 'abc',
      top_level: true,
      prop: ['p=1'],
      has_prop: ['q'],
      query: 'A',
      tree: true,
      sort: 'created',
      all: true,
      limit: 3,
    };
    listSpy.mockClear();
    await m.call('issue_list', params);
    expect(listSpy.mock.calls[0]?.[1]).toEqual({
      states: ['open', 'done'],
      projects: ['web'],
      exact: true,
      sprints: ['s1'],
      repos: ['r'],
      assignee: 'none',
      creator: 'me',
      mode: 'ready',
      parent: 'abc',
      topLevel: true,
      props: ['p=1'],
      hasProps: ['q'],
      text: 'A',
      tree: true,
      sort: 'created',
      all: true,
      limit: 3,
    });
    listSpy.mockClear();
    await m.call('issue_list', { exact: false, top_level: false, tree: false, all: false });
    expect(listSpy.mock.calls[0]?.[1]).toEqual({});
  }));

test('issue_next, sprint_get and issue_get accept their optional parameters', () =>
  withMcp(async (m, b) => {
    const ctx = await b.context();
    const i = await id(createIssue(ctx, { title: 'A' }));
    await addComment(ctx, i, 'eins');
    await addComment(ctx, i, 'zwei');
    await executeWrite(ctx, {
      kind: 'op',
      op: { op: 'sprint.create', slug: 's1', title: 'Eins' },
    });
    expect(await m.call('issue_next', { level: 'top', all: true })).toHaveProperty(
      'ok.issue.id',
      i,
    );
    nextSpy.mockClear();
    await m.call('issue_next', {
      level: 'top',
      project: 'web',
      sprint: 's1',
      repo: 'r',
      all: true,
    });
    expect(nextSpy.mock.calls[0]?.[1]).toEqual({
      level: 'top',
      project: 'web',
      sprint: 's1',
      repo: 'r',
      all: true,
    });
    expect(
      await m.call('sprint_get', {
        slug: 's1',
        project: ['x'],
        repo: ['r'],
        all: true,
        sort: 'created',
      }),
    ).toHaveProperty('ok.slug', 's1');
    expect(
      await m.call('issue_get', { id: i, comments: 'all', fields: ['id', 'comments'] }),
    ).toHaveProperty('ok.comments.length', 2);
    expect(await m.call('issue_get', { id: i, comments: 'none' })).not.toHaveProperty(
      'ok.comments',
    );
  }));

test('attachment_get returns url attachments without text and skips large files', () =>
  withMcp(async (m, b) => {
    const ctx = await b.context();
    const i = await id(createIssue(ctx, { title: 'A' }));
    await addAttachment(ctx, i, {
      name: 'link',
      source: { kind: 'url', url: 'https://example.org/x' },
    });
    await addAttachment(ctx, i, {
      name: 'big.txt',
      source: { kind: 'file', fileName: 'big.txt', content: new Uint8Array(262_145).fill(97) },
    });
    expect(await m.call('attachment_get', { id: i, name: 'link' })).toEqual({
      ok: { name: 'link', url: 'https://example.org/x' },
    });
    const big = (await m.call('attachment_get', { id: i, name: 'big.txt' })) as {
      ok: Record<string, unknown>;
    };
    expect(big.ok.size).toBe(262_145);
    expect(big.ok).not.toHaveProperty('text');
    expect(await m.call('attachment_get', { id: i, name: 'gone' })).toHaveProperty(
      'error.code',
      'not_found',
    );
  }));

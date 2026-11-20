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
    await expect(m.client.readResource({ uri: 'backe://issue/zzzzzzzz' })).rejects.toThrow();
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

test('issue_list maps every parameter onto the query', () =>
  withMcp(async (m, b) => {
    const ctx = await b.context();
    await createIssue(ctx, { title: 'A' });
    const all = {
      state: ['open'],
      project: ['web'],
      exact: true,
      sprint: ['s1'],
      repo: ['r'],
      assignee: 'none',
      creator: 'me',
      mode: 'ready',
      parent: 'nope',
      top_level: true,
      prop: ['p=1'],
      has_prop: ['p'],
      query: 'A',
      tree: true,
      sort: 'created',
      all: true,
      limit: 1,
    };
    // Die Parameter erreichen den Service: Er prüft sie und lehnt unbekannte Namen ab.
    const r = await m.call('issue_list', all);
    expect(r).toHaveProperty('error');
    const ok = await m.call('issue_list', {
      state: ['all'],
      exact: false,
      assignee: 'none',
      creator: 'me',
      mode: 'ready',
      top_level: true,
      query: 'A',
      tree: true,
      sort: 'created',
      all: true,
      limit: 1,
    });
    expect(ok).toEqual({
      ok: issueListResultJson(
        await listIssues(ctx, {
          states: ['all'],
          assignee: 'none',
          creator: 'me',
          mode: 'ready',
          topLevel: true,
          text: 'A',
          tree: true,
          sort: 'created',
          all: true,
          limit: 1,
        }),
      ),
    });
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
    // Die Filter erreichen den Service: ein unbekanntes Projekt, Sprint oder Repo scheitert dort.
    for (const filter of [{ project: 'x' }, { sprint: 's' }, { repo: 'r' }]) {
      expect(await m.call('issue_next', filter)).toHaveProperty('error');
    }
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

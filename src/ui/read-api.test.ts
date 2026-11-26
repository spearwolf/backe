import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { writeOp } from '../../test/helpers/context.ts';
import { setAttachmentsLfs, testBacklog } from '../../test/helpers/git.ts';
import { rawRequest, startUi, type UiHarness } from '../../test/helpers/ui.ts';
import { addAttachment, listAttachments } from '../services/attachments.ts';
import { listIssues } from '../services/issue-list.ts';
import { showIssue } from '../services/issue-show.ts';
import { issueListResultJson, issueShowJson } from '../services/views.ts';
import { attachmentsDir } from '../store/layout.ts';
import { backlogsJson, type StartInput } from './context.ts';

let ui: UiHarness;
let input: StartInput;
let backlog: Awaited<ReturnType<typeof testBacklog>>;

beforeEach(async () => {
  const t = await testBacklog();
  backlog = t;
  input = { cwd: await tempDir(), env: t.env, flags: { as: 'spw' } };
  ui = await startUi({ ...input, start: 'acme' });
});
afterEach(() => ui.close());

test('GET /api/backlogs lists the backlogs', async () => {
  const res = await ui.get('/api/backlogs');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(res.json()).toEqual(await backlogsJson(input, 'acme'));
});

test('an unknown api path answers not_found', async () => {
  const res = await ui.get('/api/b/acme/nope');
  expect([res.status, res.json().error.code]).toEqual([404, 'not_found']);
});

const SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
);

async function seedIssue(): Promise<string> {
  const ctx = await backlog.context();
  const id = await writeOp(ctx, {
    op: 'issue.create',
    title: 'Mit Anhang',
    state: 'todo',
    body: 'Der Body\n',
  });
  await writeOp(ctx, { op: 'comment.add', id, body: 'Ein Kommentar\n' });
  await addAttachment(ctx, id, {
    name: 'logo.svg',
    source: { kind: 'file', fileName: 'logo.svg', content: SVG_BYTES },
  });
  return id;
}

test('issue matches issue show with all comments', async () => {
  const id = await seedIssue();
  const ctx = await backlog.context();
  const short = id.slice(id.indexOf('-') + 1);
  const res = await ui.get(`/api/b/acme/issues/${short}`);
  expect(res.status).toBe(200);
  expect(res.json()).toEqual(
    JSON.parse(JSON.stringify(issueShowJson(await showIssue(ctx, id, { comments: 'all' })))),
  );
  expect(res.text()).toContain('Ein Kommentar');
});

test('unknown issues are 404', async () => {
  const res = await ui.get('/api/b/acme/issues/zzzzzz');
  expect([res.status, res.json().error.code]).toEqual([404, 'not_found']);
});

test('attachment bytes come with sandbox headers', async () => {
  const id = await seedIssue();
  const r = await ui.get(`/api/b/acme/issues/${id}/attachments/logo.svg`);
  expect(r.status).toBe(200);
  expect(r.body.equals(SVG_BYTES)).toBe(true);
  expect(r.headers['content-type']).toBe('image/svg+xml');
  expect(r.headers['content-security-policy']).toBe('sandbox');
  expect(r.headers['x-content-type-options']).toBe('nosniff');
  expect(r.headers['referrer-policy']).toBe('no-referrer');
  expect(r.headers['cache-control']).toBe('no-store');
  expect(r.headers['content-length']).toBe(String(SVG_BYTES.length));
  expect(r.headers['content-disposition']).toBe("inline; filename*=UTF-8''logo.svg");
});

test('a large attachment streams as a download', async () => {
  const ctx = await backlog.context();
  const id = await writeOp(ctx, { op: 'issue.create', title: 'Groß', state: 'todo' });
  const big = Buffer.alloc(300_000, 0x61);
  await addAttachment(ctx, id, {
    name: 'big.log',
    source: { kind: 'file', fileName: 'big.log', content: big },
  });
  const r = await ui.get(`/api/b/acme/issues/${id}/attachments/big.log`);
  expect(r.body.equals(big)).toBe(true);
  expect(r.headers['content-type']).toBe('application/octet-stream');
  expect(r.headers['content-disposition']).toBe("attachment; filename*=UTF-8''big.log");
});

test('an html attachment goes out as a sandboxed download', async () => {
  const ctx = await backlog.context();
  const id = await writeOp(ctx, { op: 'issue.create', title: 'Seite', state: 'todo' });
  const html = Buffer.from('<p>hallo</p><script>alert(1)</script>');
  await addAttachment(ctx, id, {
    name: 'page.html',
    source: { kind: 'file', fileName: 'page.html', content: html },
  });
  const r = await ui.get(`/api/b/acme/issues/${id}/attachments/page.html`);
  expect(r.status).toBe(200);
  expect(r.body.equals(html)).toBe(true);
  expect(r.headers['content-type']).toBe('application/octet-stream');
  expect(r.headers['content-disposition']).toBe("attachment; filename*=UTF-8''page.html");
  expect(r.headers['content-security-policy']).toBe('sandbox');
  expect(r.headers['x-content-type-options']).toBe('nosniff');
});

test('an attachment that is only an lfs pointer is 502 with a pull hint', async () => {
  const ctx = await backlog.context();
  const id = await writeOp(ctx, { op: 'issue.create', title: 'LFS', state: 'todo' });
  await addAttachment(ctx, id, {
    name: 'log',
    source: { kind: 'file', fileName: 'log.txt', content: Buffer.from('viele Bytes\n') },
  });
  // Erst danach `attachments.lfs`: So braucht der Test kein git-lfs.
  await setAttachmentsLfs(backlog);
  // Ein Clone ohne `git lfs pull` hat statt der Bytes den Pointer im Arbeitsbaum.
  await writeFile(
    join(backlog.root, attachmentsDir(id), 'log.txt'),
    'version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 12\n',
  );
  const r = await ui.get(`/api/b/acme/issues/${id}/attachments/log`);
  expect([r.status, r.json().error.code]).toEqual([502, 'sync']);
  expect(r.json().error.hint).toContain('lfs pull');
});

test('HEAD on an attachment sends headers only', async () => {
  const id = await seedIssue();
  const r = await rawRequest(ui.port, {
    method: 'HEAD',
    path: `/api/b/acme/issues/${id}/attachments/logo.svg`,
    headers: { cookie: ui.cookie },
  });
  expect(r.status).toBe(200);
  expect(r.body.length).toBe(0);
  expect(r.headers['content-length']).toBe(String(SVG_BYTES.length));
  expect(r.headers['content-security-policy']).toBe('sandbox');
});

test('attachment names never become paths', async () => {
  const id = await seedIssue();
  for (const up of ['..%2F..%2F', '..%2F..%2F..%2F..%2F']) {
    const r = await ui.get(`/api/b/acme/issues/${id}/attachments/${up}.backe%2Fbacklog.jsonc`);
    expect(r.status).toBe(404);
    expect(r.text()).not.toContain('"id_prefix"');
  }
  // Eine Datei, die im Anhangsverzeichnis liegt, aber nicht in der Anhangsliste steht.
  const dir = join(backlog.root, attachmentsDir(id));
  await writeFile(join(dir, 'stray.txt'), 'nicht gelistet');
  const stray = await ui.get(`/api/b/acme/issues/${id}/attachments/stray.txt`);
  expect(stray.status).toBe(404);
  expect(stray.text()).not.toContain('nicht gelistet');
});

test('a link attachment is 404', async () => {
  const ctx = await backlog.context();
  const id = await writeOp(ctx, { op: 'issue.create', title: 'Link', state: 'todo' });
  await addAttachment(ctx, id, {
    name: 'spec',
    source: { kind: 'url', url: 'https://example.com/spec' },
  });
  const r = await ui.get(`/api/b/acme/issues/${id}/attachments/spec`);
  expect([r.status, r.json().error.code]).toEqual([404, 'not_found']);
});

test('attachment list equals attach list --format json', async () => {
  const id = await seedIssue();
  const ctx = await backlog.context();
  await addAttachment(ctx, id, {
    name: 'spec',
    source: { kind: 'url', url: 'https://example.com/spec' },
  });
  const short = id.slice(id.indexOf('-') + 1);
  const res = await ui.get(`/api/b/acme/issues/${short}/attachments`);
  expect(res.status).toBe(200);
  expect(res.json()).toEqual([
    { name: 'logo.svg', file: 'logo.svg', size: SVG_BYTES.length },
    { name: 'spec', url: 'https://example.com/spec' },
  ]);
  expect(res.json()).toEqual(JSON.parse(JSON.stringify(await listAttachments(ctx, id))));
});

test('attachment list of an unknown issue is 404', async () => {
  const res = await ui.get('/api/b/acme/issues/zzzzzz/attachments');
  expect([res.status, res.json().error.code]).toEqual([404, 'not_found']);
});

test('search finds body text in settled issues', async () => {
  const ctx = await backlog.context();
  const id = await writeOp(ctx, {
    op: 'issue.create',
    title: 'Erledigt',
    state: 'done',
    body: 'Zebrastreifen im Body\n',
  });
  const res = await ui.get('/api/b/acme/search?q=Zebrastreifen');
  expect(res.status).toBe(200);
  expect(res.json()).toEqual(
    JSON.parse(
      JSON.stringify(
        issueListResultJson(await listIssues(ctx, { text: 'Zebrastreifen', states: ['all'] })),
      ),
    ),
  );
  expect(res.json().issues.map((i: { id: string }) => i.id)).toEqual([id]);
});

test('search ignores the project bound by the start context', async () => {
  const ctx = await backlog.context();
  await writeOp(ctx, { op: 'project.create', path: 'web', title: 'Web' });
  const outside = await writeOp(ctx, {
    op: 'issue.create',
    title: 'Ohne Projekt',
    body: 'Zebrastreifen im Body\n',
  });
  await ui.close();
  ui = await startUi({ ...input, env: { ...input.env, BACKE_PROJECT: 'web' }, start: 'acme' });
  const res = await ui.get('/api/b/acme/search?q=Zebrastreifen');
  expect(res.json().issues.map((i: { id: string }) => i.id)).toEqual([outside]);
});

test('search without q is 400', async () => {
  expect((await ui.get('/api/b/acme/search')).json().error.code).toBe('usage');
  expect((await ui.get('/api/b/acme/search?q=')).json().error.code).toBe('usage');
});

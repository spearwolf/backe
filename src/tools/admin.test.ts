import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { setLocale } from '../i18n/locale.ts';
import { addAttachment, removeAttachment } from '../services/attachments.ts';
import { addComment, deleteComment, editComment, listIssueComments } from '../services/comments.ts';
import { createIssue, linkIssue, unlinkIssue } from '../services/issues.ts';
import { createProject, moveProject, removeProject } from '../services/projects.ts';
import { addRepo } from '../services/repos.ts';
import { closeSprint, createSprint } from '../services/sprints.ts';
import { outcomeJson } from '../services/views.ts';
import { ADMIN_TOOLS } from './admin.ts';
import { invokeTool } from './catalog.ts';
import { pendingStarts, type ToolEnv, writeQueue } from './run.ts';

beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

const defOf = (name: string) => {
  const def = ADMIN_TOOLS.find((t) => t.name === name);
  if (def === undefined) throw new Error(`${name} fehlt in ADMIN_TOOLS`);
  return def;
};

const envOf = (b: TestBacklog): ToolEnv => ({
  context: () => b.context(),
  allowDelete: true,
  surface: 'ui',
  queue: writeQueue(),
  pending: pendingStarts(),
});

/** Zwei Backlogs mit gleichem Aufbau: auf dem einen läuft das Tool, auf dem anderen der Service. */
type Twin = { tool: TestBacklog; service: TestBacklog; env: ToolEnv; ctx: ResolvedContext };

async function twin(): Promise<Twin> {
  const tool = await testBacklog();
  const service = await testBacklog();
  return { tool, service, env: envOf(tool), ctx: await service.context() };
}

/** Der Aufbau auf einem Backlog liefert Issue-IDs, die sich zwischen den Zwillingen unterscheiden. */
async function seed(b: TestBacklog): Promise<string> {
  const ctx = await b.context();
  const r = await createIssue(ctx, { title: 'Erstes' });
  if (r.id === undefined) throw new Error('keine Issue-ID');
  return r.id;
}

/** Ohne `commit` (hängt von Zeit und Autor ab), mit vereinheitlichten Issue-IDs und Kommentar-Dateinamen. */
function normalized(value: unknown, ids: readonly string[]): unknown {
  let text = JSON.stringify(value);
  for (const id of ids) text = text.replaceAll(id, '<id>');
  // Kommentar-Dateinamen tragen ein zufälliges Suffix: `<zeit>-<handle>-<zufall>.md`.
  text = text.replace(/(\d{8}T\d{6}Z-[a-z]+)-[a-z0-9]+\.md/g, '$1-<x>.md');
  const { commit: _commit, ...rest } = JSON.parse(text) as Record<string, unknown>;
  return rest;
}

async function parity(
  t: Twin,
  name: string,
  args: unknown,
  service: () => Promise<Parameters<typeof outcomeJson>[0]>,
  ids: readonly string[] = [],
) {
  const viaTool = await invokeTool(defOf(name), t.env, args);
  const viaService = outcomeJson(await service());
  expect(normalized(viaTool, ids)).toEqual(normalized(viaService, ids));
  return viaTool;
}

test('issue_link and issue_unlink match the cli', async () => {
  const t = await twin();
  const a = await seed(t.tool);
  const b = await seed(t.service);
  await addRepo(await t.tool.context(), { url: 'https://example.com/acme/web.git', name: 'web' });
  await addRepo(t.ctx, { url: 'https://example.com/acme/web.git', name: 'web' });
  await parity(
    t,
    'issue_link',
    { id: a, target: 'web@main' },
    () => linkIssue(t.ctx, b, 'web@main'),
    [a, b],
  );
  await parity(t, 'issue_unlink', { id: a, repo: 'web' }, () => unlinkIssue(t.ctx, b, 'web'), [
    a,
    b,
  ]);
});

test('comment_edit and comment_delete match the cli', async () => {
  const t = await twin();
  const a = await seed(t.tool);
  const b = await seed(t.service);
  await addComment(await t.tool.context(), a, 'alt');
  await addComment(t.ctx, b, 'alt');
  await parity(
    t,
    'comment_edit',
    { id: a, comment: '1', body: 'neu' },
    () => editComment(t.ctx, b, '1', 'neu'),
    [a, b],
  );
  const stored = await listIssueComments(await t.tool.context(), a);
  expect(stored.map((c) => c.body.trim())).toEqual(['neu']);
  await parity(t, 'comment_delete', { id: a, comment: '1' }, () => deleteComment(t.ctx, b, '1'), [
    a,
    b,
  ]);
  expect(await listIssueComments(await t.tool.context(), a)).toEqual([]);
});

test('attachment_rm matches the cli', async () => {
  const t = await twin();
  const a = await seed(t.tool);
  const b = await seed(t.service);
  const source = {
    kind: 'file',
    fileName: 'notiz.txt',
    content: new TextEncoder().encode('hallo'),
  } as const;
  await addAttachment(await t.tool.context(), a, { name: 'notiz', source });
  await addAttachment(t.ctx, b, { name: 'notiz', source });
  await parity(
    t,
    'attachment_rm',
    { id: a, name: 'notiz' },
    () => removeAttachment(t.ctx, b, 'notiz'),
    [a, b],
  );
});

test('project_create, project_mv and project_rm match the cli', async () => {
  const t = await twin();
  await parity(t, 'project_create', { path: 'web', title: 'Web', body: 'Text' }, () =>
    createProject(t.ctx, { path: 'web', title: 'Web', body: 'Text' }),
  );
  await parity(t, 'project_create', { path: 'web/ui' }, () =>
    createProject(t.ctx, { path: 'web/ui' }),
  );
  await parity(t, 'project_mv', { from: 'web/ui', to: 'web/frontend' }, () =>
    moveProject(t.ctx, 'web/ui', 'web/frontend'),
  );
  await parity(t, 'project_rm', { path: 'web/frontend', detach: true }, () =>
    removeProject(t.ctx, 'web/frontend', { detach: true }),
  );
});

test('project_rm refuses reassign with detach', async () => {
  const t = await twin();
  const err = await catchErrAsync(() =>
    invokeTool(defOf('project_rm'), t.env, { path: 'x', reassign: 'y', detach: true }),
  );
  expect(err.code).toBe('usage');
});

test('sprint_create and sprint_close match the cli', async () => {
  const t = await twin();
  const create = { slug: '2026-w47', title: 'W47', start: '2026-11-16', end: '2026-11-22' };
  await parity(t, 'sprint_create', create, () => createSprint(t.ctx, create));
  await parity(t, 'sprint_create', { slug: '2026-w48' }, () =>
    createSprint(t.ctx, { slug: '2026-w48' }),
  );
  await parity(t, 'sprint_close', { slug: '2026-w47', carry_over: '2026-w48' }, () =>
    closeSprint(t.ctx, '2026-w47', { carryOver: '2026-w48' }),
  );
});

test('unknown parameters are rejected by the schema', () => {
  for (const def of ADMIN_TOOLS) {
    expect(def.input.safeParse({ x: 1 }).success).toBe(false);
  }
});

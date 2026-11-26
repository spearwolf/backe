import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog, testKey } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { setLocale } from '../i18n/locale.ts';
import { createAgent } from '../services/agent.ts';
import { addAttachment, removeAttachment } from '../services/attachments.ts';
import { addComment, deleteComment, editComment, listIssueComments } from '../services/comments.ts';
import { createIssue, linkIssue, unlinkIssue } from '../services/issues.ts';
import { createProject, moveProject, removeProject } from '../services/projects.ts';
import { checkRepoResult } from '../services/repo-check.ts';
import { addRepo, removeRepo } from '../services/repos.ts';
import { closeSprint, createSprint } from '../services/sprints.ts';
import { addUser, removeUser, revokeKey, showUser } from '../services/users.ts';
import { outcomeJson, repoCheckJson } from '../services/views.ts';
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
  await parity(t, 'project_create', { path: 'web/ui', lead: 'spw' }, () =>
    createProject(t.ctx, { path: 'web/ui', lead: 'spw' }),
  );
  await parity(t, 'project_mv', { from: 'web/ui', to: 'web/frontend' }, () =>
    moveProject(t.ctx, 'web/ui', 'web/frontend'),
  );
  await parity(t, 'project_rm', { path: 'web/frontend', detach: true }, () =>
    removeProject(t.ctx, 'web/frontend', { detach: true }),
  );
});

test('project_rm with reassign matches the cli', async () => {
  const t = await twin();
  for (const path of ['alt', 'neu']) {
    await parity(t, 'project_create', { path }, () => createProject(t.ctx, { path }));
  }
  await parity(t, 'project_rm', { path: 'alt', reassign: 'neu' }, () =>
    removeProject(t.ctx, 'alt', { reassign: 'neu' }),
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
  const withBody = { slug: '2026-w48', body: 'Ziel' };
  await parity(t, 'sprint_create', withBody, () => createSprint(t.ctx, withBody));
  await parity(t, 'sprint_close', { slug: '2026-w47', carry_over: '2026-w48' }, () =>
    closeSprint(t.ctx, '2026-w47', { carryOver: '2026-w48' }),
  );
  await parity(t, 'sprint_close', { slug: '2026-w48' }, () => closeSprint(t.ctx, '2026-w48', {}));
});

const VALID: Record<string, unknown> = {
  issue_link: { id: 'a', target: 'b' },
  issue_unlink: { id: 'a', repo: 'b' },
  comment_edit: { id: 'a', comment: '1', body: 'b' },
  comment_delete: { id: 'a', comment: '1' },
  attachment_rm: { id: 'a', name: 'b' },
  project_create: { path: 'a' },
  project_mv: { from: 'a', to: 'b' },
  project_rm: { path: 'a' },
  sprint_create: { slug: 'a' },
  sprint_close: { slug: 'a' },
  repo_add: { url: 'https://example.com/a/b.git' },
  repo_rm: { name: 'a' },
  repo_check: {},
  user_add: { handle: 'a', key: 'ssh-ed25519 AAAA' },
  user_create_agent: { handle: 'a' },
  user_revoke_key: { handle: 'a', fingerprint: 'SHA256:abcdefgh' },
  user_rm: { handle: 'a' },
};

test('unknown parameters are rejected by the schema', () => {
  for (const def of ADMIN_TOOLS) {
    const valid = VALID[def.name];
    expect(valid, def.name).toBeDefined();
    expect(def.input.safeParse(valid).success, `${def.name} valid`).toBe(true);
    expect(def.input.safeParse({ ...(valid as object), x: 1 }).success, def.name).toBe(false);
  }
});

test('repo_add and repo_rm match the cli', async () => {
  const t = await twin();
  const add = { url: 'https://example.com/acme/web.git', name: 'web', ref: 'main', body: 'Doku' };
  await parity(t, 'repo_add', add, () =>
    addRepo(t.ctx, { url: add.url, name: 'web', defaultRef: 'main', body: 'Doku' }),
  );
  await parity(t, 'repo_rm', { name: 'web' }, () => removeRepo(t.ctx, 'web'));
});

test('repo_check reports errors without failing', async () => {
  const b = await testBacklog();
  await addRepo(await b.context(), { url: 'https://example.com/acme/web.git', name: 'web' });
  await writeFile(
    join(b.root, 'repos', 'badref.md'),
    '---\nurl: https://example.org/x/y\ndefault_ref: a..b\n---\n',
  );
  const result = (await invokeTool(defOf('repo_check'), envOf(b), {})) as {
    repos: { name: string; findings: { level: string }[] }[];
  };
  const bad = result.repos.find((r) => r.name === 'badref');
  expect(bad?.findings).toContainEqual(expect.objectContaining({ level: 'error' }));
  const expected = repoCheckJson(await checkRepoResult(await b.context(), {}));
  expect(JSON.parse(JSON.stringify(result))).toEqual(JSON.parse(JSON.stringify(expected)));
  const only = (await invokeTool(defOf('repo_check'), envOf(b), { names: ['web'] })) as {
    repos: unknown[];
  };
  expect(only.repos).toHaveLength(1);
});

test('user_add takes the public key line', async () => {
  const t = await twin();
  const k = await testKey('anna');
  const input = { handle: 'anna', key: k.line, name: 'Anna', agent: true, operator: 'spw' };
  await parity(t, 'user_add', input, () => addUser(t.ctx, input));
  const shown = await showUser(await t.tool.context(), 'anna');
  expect(shown.fingerprints).toEqual((await showUser(t.ctx, 'anna')).fingerprints);
  expect(shown.fingerprints).toHaveLength(1);
});

test('user_add rejects a broken key line', async () => {
  const t = await twin();
  const err = await catchErrAsync(() =>
    invokeTool(defOf('user_add'), t.env, { handle: 'anna', key: 'kein key' }),
  );
  expect(err.code).toBe('validation');
});

test('user_create_agent writes the key and answers like the cli', async () => {
  const b = await testBacklog();
  const r = (await invokeTool(defOf('user_create_agent'), envOf(b), {
    handle: 'bot',
    name: 'Bot',
  })) as { handle: string; key_path: string; commit: string };
  expect(Object.keys(r).sort()).toEqual(['commit', 'handle', 'key_path']);
  expect(r.handle).toBe('bot');
  expect(existsSync(r.key_path)).toBe(true);
  expect(r.commit).toMatch(/^[0-9a-f]{7,40}$/);
  const other = await testBacklog();
  const viaService = await createAgent(await other.context(), { handle: 'bot', name: 'Bot' });
  const tail = (p: string) => p.replace(/.*\/keys\/[^/]+\//, '');
  expect(tail(r.key_path)).toBe(tail(viaService.keyPath));
});

test('user_revoke_key and user_rm match the cli', async () => {
  const t = await twin();
  const k = await testKey('anna');
  const spare = await testKey('anna-spare');
  for (const ctx of [await t.tool.context(), t.ctx]) {
    await addUser(ctx, { handle: 'anna', key: k.line });
    await addUser(ctx, { handle: 'bert', key: spare.line });
  }
  const fingerprint = (await showUser(t.ctx, 'anna')).fingerprints[0] as string;
  await parity(t, 'user_revoke_key', { handle: 'anna', fingerprint }, () =>
    revokeKey(t.ctx, 'anna', fingerprint),
  );
  await parity(t, 'user_rm', { handle: 'bert' }, () => removeUser(t.ctx, 'bert'));
});

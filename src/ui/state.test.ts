import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { writeOp } from '../../test/helpers/context.ts';
import { revParse, testBacklog, testKey } from '../../test/helpers/git.ts';
import { startUi } from '../../test/helpers/ui.ts';
import { registerBacklog, setIdentity } from '../context/registry.ts';
import { sshFingerprint } from '../core/fingerprint.ts';
import type { User } from '../core/schemas.ts';
import { listIssues } from '../services/issue-list.ts';
import { executeWrite } from '../services/write.ts';
import { BACKLOG_CONFIG, issueFile } from '../store/layout.ts';
import { stateJson, userJson } from './state.ts';

async function seeded() {
  const b = await testBacklog();
  const ctx = await b.context();
  await executeWrite(ctx, {
    kind: 'batch',
    ops: [
      { op: 'project.create', path: 'web', title: 'Web' },
      { op: 'sprint.create', slug: '2026-w47', title: 'W47' },
      { op: 'repo.add', url: 'git@example.com:acme/webapp.git', name: 'webapp' },
      {
        op: 'issue.create',
        ref: '$A',
        title: 'Mit Body',
        state: 'todo',
        projects: ['web'],
        body: 'Geheimer Body\n',
      },
      { op: 'issue.create', ref: '$B', title: 'Zweites', state: 'backlog' },
    ],
  });
  return { b, ctx };
}

test('state has the keys of the spec', async () => {
  const { ctx } = await seeded();
  expect(Object.keys(await stateJson(ctx))).toEqual([
    'rev',
    'head',
    'context',
    'config',
    'issues',
    'projects',
    'sprints',
    'repos',
    'users',
    'problems',
    'sync',
  ]);
});

test('lists are present and shaped like the entities', async () => {
  const { ctx } = await seeded();
  const s = await stateJson(ctx);
  expect(s.rev).toBe(0);
  expect(s.projects.map((p) => p.path)).toEqual(['web']);
  expect(s.sprints.map((p) => p.slug)).toEqual(['2026-w47']);
  expect(s.repos.map((p) => p.name)).toEqual(['webapp']);
  expect(s.problems).toEqual([]);
  expect(s.config).not.toHaveProperty('$schema');
  expect(s.sync).not.toBeNull();
});

test('issues carry frontmatter without body', async () => {
  const { ctx } = await seeded();
  const s = await stateJson(ctx);
  expect(s.issues).toHaveLength(2);
  for (const i of s.issues) expect(i).not.toHaveProperty('body');
  expect(JSON.stringify(s)).not.toContain('Geheimer Body');
  const listed = (await listIssues(ctx, { states: ['all'] })).items.map((i) => i.issue);
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  expect([...s.issues].sort(byId)).toEqual([...listed].sort(byId));
});

test('users carry fingerprints, never keys', async () => {
  const { b, ctx } = await seeded();
  const s = await stateJson(ctx);
  expect(JSON.stringify(s)).not.toContain(b.key.line.split(' ')[1]);
  expect(s.users[0]?.fingerprints?.[0]).toMatch(/^SHA256:/);
});

test('userJson omits empty lists and body', () => {
  const user: User = { name: 'X', kind: 'human' };
  expect(userJson('x', user, ['y'])).toEqual({
    handle: 'x',
    name: 'X',
    kind: 'human',
    admin: false,
  });
});

test('userJson lists revoked keys as fingerprint and date', async () => {
  const key = await testKey('old');
  const user: User = {
    name: 'X',
    kind: 'agent',
    operator: 'spw',
    revoked_keys: [{ key: key.line, revoked: '2026-11-01T10:00:00Z' }],
  };
  const fingerprint = sshFingerprint(key.line);
  expect(fingerprint).toMatch(/^SHA256:/);
  expect(userJson('x', user, ['x'])).toEqual({
    handle: 'x',
    name: 'X',
    kind: 'agent',
    operator: 'spw',
    admin: true,
    revoked: [{ fingerprint, revoked: '2026-11-01T10:00:00Z' }],
  });
});

test('head is the commit of the working copy', async () => {
  const { b, ctx } = await seeded();
  expect((await stateJson(ctx)).head).toBe(await revParse(b.root, 'HEAD'));
});

test('state of a backlog without own working copy', async () => {
  const { b, ctx } = await seeded();
  const key = await testKey('claude-1');
  await executeWrite(ctx, {
    kind: 'op',
    op: {
      op: 'user.add',
      handle: 'claude-1',
      name: 'Claude',
      kind: 'agent',
      operator: 'spw',
      keys: [key.line],
    },
  });
  await setIdentity(b.homes, 'acme', 'claude-1', key.priv);
  const ui = await startUi({
    cwd: await tempDir(),
    env: b.env,
    flags: { as: 'claude-1' },
    start: 'acme',
  });
  try {
    const res = await ui.get('/api/b/acme/state');
    expect(res.status).toBe(200);
    expect(res.json().issues).toHaveLength(2);
    expect(res.json().sync).toBeNull();
  } finally {
    await ui.close();
  }
});

test('a backlog without any working copy is 404 with a clone hint', async () => {
  const { b } = await seeded();
  await registerBacklog(b.homes, { name: 'other', remote: '/nowhere/remote.git' });
  const ui = await startUi({
    cwd: await tempDir(),
    env: b.env,
    flags: { as: 'spw' },
    start: 'acme',
  });
  try {
    const res = await ui.get('/api/b/other/state');
    expect([res.status, res.json().error.code]).toEqual([404, 'not_found']);
    expect(res.json().error.hint).toContain('backe backlog clone');
  } finally {
    await ui.close();
  }
});

test('a broken backlog config is an error, the server keeps serving', async () => {
  const { b } = await seeded();
  await writeFile(join(b.root, BACKLOG_CONFIG), '{');
  const ui = await startUi({
    cwd: await tempDir(),
    env: b.env,
    flags: { as: 'spw' },
    start: 'acme',
  });
  try {
    const res = await ui.get('/api/b/acme/state');
    expect([res.status, res.json().error.code]).toEqual([400, 'validation']);
    expect((await ui.get('/api/backlogs')).status).toBe(200);
  } finally {
    await ui.close();
  }
});

test('a broken hand edit shows up in problems', async () => {
  const { b, ctx } = await seeded();
  const id = await writeOp(ctx, { op: 'issue.create', title: 'Kaputt', state: 'todo' });
  await writeFile(join(b.root, issueFile(id)), '---\n: [\n---\n');
  const s = await stateJson(ctx);
  expect(s.problems).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'issue', key: id })]),
  );
});

test('state carries sprint goals', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  await executeWrite(ctx, {
    kind: 'batch',
    ops: [
      { op: 'sprint.create', slug: '2026-w47', title: 'W47', body: 'Ziel: Release\n' },
      { op: 'sprint.create', slug: '2026-w48', title: 'W48' },
    ],
  });
  const s = await stateJson(ctx);
  expect(s.sprints[0]?.body).toBe('Ziel: Release\n');
  expect(s.sprints[1]).not.toHaveProperty('body');
});

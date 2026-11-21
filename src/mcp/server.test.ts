import { readFile } from 'node:fs/promises';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { revParse, setPullInterval, statusShort, testBacklog } from '../../test/helpers/git.ts';
import { connectMcp, connectServer } from '../../test/helpers/mcp.ts';
import { updateUserConfig, userConfigPath } from '../context/user-config.ts';
import { contextInfo } from '../services/context-info.ts';
import { contextJson } from '../services/views.ts';
import { createBackeMcp, INSTRUCTIONS, prepareMcp } from './server.ts';

test('context_get returns the same object as backe context --json', async () => {
  const b = await testBacklog();
  const m = await connectMcp(b);
  try {
    const r = await m.call('context_get');
    expect(r).toEqual({ ok: contextJson(await contextInfo(await b.context())) });
  } finally {
    await m.close();
  }
});

test('context_get with props appends the property declarations', async () => {
  const b = await testBacklog();
  const m = await connectMcp(b);
  try {
    const r = await m.call('context_get', { props: true });
    const info = await contextInfo(await b.context(), { props: true });
    expect(r).toEqual({ ok: contextJson(info) });
    expect(r).toHaveProperty('ok.props');
  } finally {
    await m.close();
  }
});

test('the server reports its identity and the instructions', async () => {
  const b = await testBacklog();
  const m = await connectMcp(b);
  try {
    const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(m.client.getServerVersion()).toMatchObject({ name: 'backe', version: pkg.version });
    expect(m.client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toBe(
      'Ergebnisse sind kompaktes JSON. Fehler kommen als {"error":{code,message,hint}}; Hinweise nennen CLI-Befehle und -Flags von backe: ein Tool entspricht dem gleichnamigen Befehl (issue_move ↔ backe issue move), ein Flag dem Parameter in snake_case (--add-dep ↔ add_deps, --blocked-by ↔ blocked_by).',
    );
    const { tools } = await m.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'attachment_add',
        'attachment_get',
        'batch',
        'comment_add',
        'context_get',
        'issue_create',
        'issue_get',
        'issue_claim',
        'issue_list',
        'issue_move',
        'issue_next',
        'issue_rank',
        'issue_reopen',
        'issue_resume',
        'issue_update',
        'project_list',
        'repo_locate',
        'sprint_get',
        'sprint_list',
        'sync_now',
      ].sort(),
    );
  } finally {
    await m.close();
  }
});

test('each tool call resolves the context anew', async () => {
  const b = await testBacklog();
  const m = await connectMcp(b);
  try {
    await updateUserConfig(b.homes.backeHome, () => [
      { path: ['backlogs', 'acme', 'project'], value: 'web' },
    ]);
    const r = await m.call('context_get');
    expect(r).toHaveProperty('ok.project.value', 'web');
  } finally {
    await m.close();
  }
});

test('prepareMcp returns the resolved context of a writer', async () => {
  const b = await testBacklog();
  const ctx = await prepareMcp({
    cwd: b.root,
    env: b.env,
    flags: { as: b.handle },
    allowDelete: false,
  });
  expect(ctx.user.value).toBe('spw');
  expect(ctx.backlog.workingCopy).toBe(b.root);
});

test('prepareMcp rejects a missing key', async () => {
  const b = await testBacklog();
  await updateUserConfig(b.homes.backeHome, () => [
    { path: ['identities', 'acme', 'spw'], value: undefined },
  ]);
  const err = await catchErrAsync(() =>
    prepareMcp({ cwd: b.root, env: b.env, flags: { as: b.handle }, allowDelete: false }),
  );
  expect(err.code).toBe('usage');
  expect(err.hint).toContain('identities.acme.spw');
  expect(err.hint).toContain(userConfigPath(b.homes.backeHome));
});

test('prepareMcp rejects a foreign working copy', async () => {
  const b = await testBacklog();
  const err = await catchErrAsync(() =>
    prepareMcp({
      cwd: b.root,
      env: b.env,
      flags: { backlog: b.root, as: 'claude-1' },
      allowDelete: false,
    }),
  );
  expect(err.code).toBe('usage');
  expect(err.message).toContain('gehört »spw«');
});

test.each([
  { pullInterval: undefined, timers: 1 },
  { pullInterval: 0, timers: 0 },
])('build is side-effect free (pull_interval $pullInterval)', async ({ pullInterval, timers }) => {
  const b = await testBacklog();
  if (pullInterval !== undefined) await setPullInterval(b, pullInterval);
  const opts = { cwd: b.root, env: b.env, flags: { as: b.handle }, allowDelete: false };
  const head = await revParse(b.root, 'HEAD');
  const config = await readFile(userConfigPath(b.homes.backeHome), 'utf8');
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  try {
    const mcp = await createBackeMcp(opts, await prepareMcp(opts));
    mcp.build();
    mcp.build();
    // Der Timer lebt je Prozess in `createBackeMcp`, nicht je `build`.
    expect(vi.getTimerCount()).toBe(timers);
    await mcp.close();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
  expect(await revParse(b.root, 'HEAD')).toBe(head);
  expect(await statusShort(b.root)).toEqual([]);
  expect(await readFile(userConfigPath(b.homes.backeHome), 'utf8')).toBe(config);
});

test('build returns independent servers over the same backlog', async () => {
  const b = await testBacklog();
  const opts = { cwd: b.root, env: b.env, flags: { as: b.handle }, allowDelete: false };
  const mcp = await createBackeMcp(opts, await prepareMcp(opts));
  const first = mcp.build();
  const second = mcp.build();
  expect(second).not.toBe(first);
  const one = await connectServer(first);
  const two = await connectServer(second);
  try {
    const both = await Promise.all([
      one.call('issue_create', { title: 'Über den ersten' }),
      two.call('issue_create', { title: 'Über den zweiten' }),
    ]);
    const ids = both.map((r) => {
      if (!('ok' in r)) throw new Error(JSON.stringify(r));
      return r.ok.id as string;
    });
    // Geschlossen wird nur die erste Verbindung; die zweite sieht beide Writes und bleibt offen.
    await one.close();
    for (const [i, title] of ['Über den ersten', 'Über den zweiten'].entries()) {
      expect(await two.call('issue_get', { id: ids[i] })).toHaveProperty('ok.title', title);
    }
  } finally {
    await two.close();
    await mcp.close();
  }
});

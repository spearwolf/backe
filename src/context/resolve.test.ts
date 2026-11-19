import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { contextTree, gitInit } from '../../test/helpers/context.ts';
import type { Env } from './paths.ts';
import {
  type ContextFlags,
  classifyBacklogRef,
  readBacklogName,
  requireWriter,
  resolveContext,
  type SourceKind,
} from './resolve.ts';

const CFG = `{ "current": "acme", "user": "spw",
  "identities": { "acme": { "spw": { "key": "~/.ssh/id.pub" } } },
  "backlogs": { "acme": { "remote": "gh:acme/backlog", "user": "spw" }, "beta": { "remote": "gh:acme/beta" } } }`;
const BACKLOG = (name: string) =>
  `{ "version": 1, "name": "${name}", "id_prefix": "bk", "admins": ["spw"] }`;
async function setup(extra: Record<string, string> = {}) {
  const t = await contextTree({ 'home/.backe/config.jsonc': CFG, 'work/.keep': '', ...extra });
  return {
    ...t,
    home: t.at('home'),
    run: (flags: ContextFlags = {}, env: Env = {}, cwd = t.at('work')) =>
      resolveContext({ cwd, env: { ...t.env, ...env }, flags }),
  };
}

test.each<[string, ContextFlags, Env, string, SourceKind]>([
  ['flag beats env', { backlog: 'beta' }, { BACKE_BACKLOG: 'acme' }, 'beta', 'flag'],
  ['env beats current', {}, { BACKE_BACKLOG: 'beta' }, 'beta', 'env'],
  ['current as fallback', {}, {}, 'acme', 'user-current'],
  ['empty env vars count as unset', {}, { BACKE_BACKLOG: '' }, 'acme', 'user-current'],
])('backlog: %s', async (_n, flags, env, name, kind) => {
  const ctx = await (await setup()).run(flags, env);
  expect([ctx.backlog.value, ctx.backlog.source.kind]).toEqual([name, kind]);
});

test('env source names the variable', async () => {
  const ctx = await (await setup()).run({}, { BACKE_BACKLOG: 'beta' });
  expect(ctx.backlog.source).toEqual({ kind: 'env', detail: 'BACKE_BACKLOG' });
});

test('project config level beats current, local beats shared', async () => {
  const s = await setup({
    'work/.backlog.jsonc': '{ "backlog": "acme" }',
    'work/.backlog.local.jsonc': '{ "backlog": "beta" }',
  });
  const ctx = await s.run();
  expect([ctx.backlog.value, ctx.backlog.source]).toEqual([
    'beta',
    { kind: 'project-local', detail: s.at('work/.backlog.local.jsonc') },
  ]);
});

test('shared project config is used without a local file', async () => {
  const s = await setup({ 'work/.backlog.jsonc': '{ "backlog": "beta" }' });
  const ctx = await s.run();
  expect(ctx.backlog.source).toEqual({ kind: 'project', detail: s.at('work/.backlog.jsonc') });
});

test('a project config level without a backlog key falls through to current', async () => {
  const s = await setup({ 'work/.backlog.jsonc': '{ "project": "web" }' });
  expect((await s.run()).backlog.source.kind).toBe('user-current');
});

test('a backlog URL in the project config maps to the registered name', async () => {
  const s = await setup({
    'work/.backlog.jsonc': '{ "backlog": "https://github.com/acme/beta.git" }',
  });
  expect((await s.run()).backlog.value).toBe('beta');
});

test('an unregistered backlog URL hints at backlog clone', async () => {
  const s = await setup({ 'work/.backlog.jsonc': '{ "backlog": "gh:acme/unknown" }' });
  const err = await catchErrAsync(() => s.run());
  expect([err.code, err.hint]).toEqual([
    'not_found',
    expect.stringContaining('backe backlog clone'),
  ]);
});

test('an unusable backlog value names its source', async () => {
  const s = await setup();
  const err = await catchErrAsync(() => s.run({}, { BACKE_BACKLOG: 'not a ref' }));
  expect([err.code, err.message]).toEqual(['usage', expect.stringContaining('BACKE_BACKLOG')]);
});

test('cwd inside a backlog repo binds that working copy', async () => {
  const s = await setup({ 'repo/.backe/backlog.jsonc': BACKLOG('acme'), 'repo/issues/.keep': '' });
  await gitInit(s.at('repo'));
  const ctx = await s.run({}, {}, s.at('repo/issues'));
  expect(ctx.backlog).toMatchObject({
    value: 'acme',
    source: { kind: 'backlog-repo' },
    root: s.at('repo'),
    workingCopy: s.at('repo'),
  });
});

test('backlog repo with a newer format still resolves', async () => {
  const s = await setup({
    'repo/.backe/backlog.jsonc': '{ "version": 2, "name": "acme", "future": true }',
  });
  await gitInit(s.at('repo'));
  expect((await s.run({}, {}, s.at('repo'))).backlog.value).toBe('acme');
});

test('a git repo without a backlog falls through', async () => {
  const s = await setup();
  await gitInit(s.at('work'));
  expect((await s.run()).backlog.source.kind).toBe('user-current');
});

test('a path flag binds the working copy without registration', async () => {
  const s = await setup({ 'other/.backe/backlog.jsonc': BACKLOG('gamma') });
  await gitInit(s.at('other'));
  const ctx = await s.run({ backlog: '../other' });
  expect([ctx.backlog.value, ctx.backlog.root]).toEqual(['gamma', s.at('other')]);
});

test.each([
  ['a missing directory', '../missing'],
  ['a directory that is no backlog', '.'],
])('a path flag to %s is not_found', async (_n, path) => {
  const s = await setup();
  expect((await catchErrAsync(() => s.run({ backlog: path }))).code).toBe('not_found');
});

test.each([
  [{ backlog: 'nope' }, 'not_found'],
  [{ backlog: '' }, 'usage'],
  [{ as: 'Bad' }, 'usage'],
])('flags %o fail with %s', async (flags, code) =>
  expect((await catchErrAsync(async () => (await setup()).run(flags))).code).toBe(code),
);

test('no backlog anywhere is a usage error with hint', async () => {
  const t = await contextTree({ 'work/.keep': '' });
  const err = await catchErrAsync(() =>
    resolveContext({ cwd: t.at('work'), env: t.env, flags: {} }),
  );
  expect([err.code, err.hint]).toEqual(['usage', expect.stringContaining('backe backlog use')]);
});

test.each<[string, ContextFlags, Env, Record<string, string>, string | undefined, SourceKind]>([
  ['flag', { as: 'claude-1' }, { BACKE_USER: 'x-1' }, {}, 'claude-1', 'flag'],
  ['env', {}, { BACKE_USER: 'x-1' }, {}, 'x-1', 'env'],
  [
    'local project config',
    {},
    {},
    { 'work/.backlog.local.jsonc': '{ "user": "loc" }' },
    'loc',
    'project-local',
  ],
  ['backlog entry', {}, {}, {}, 'spw', 'user-backlog'],
  ['backlog entry when BACKE_USER is empty', {}, { BACKE_USER: '' }, {}, 'spw', 'user-backlog'],
  ['global default', { backlog: 'beta' }, {}, {}, 'spw', 'user-default'],
])('user from %s', async (_n, flags, env, files, handle, kind) => {
  const ctx = await (await setup(files)).run(flags, env);
  expect([ctx.user.value, ctx.user.source.kind]).toEqual([handle, kind]);
});

test('no user anywhere resolves to none and cannot write', async () => {
  const s = await setup({
    'home/.backe/config.jsonc': '{ "current": "acme", "backlogs": { "acme": {} } }',
  });
  const ctx = await s.run();
  expect([ctx.user.value, ctx.user.source, ctx.backlog.workingCopy]).toEqual([
    undefined,
    { kind: 'none' },
    undefined,
  ]);
  const err = await catchErrAsync(async () => requireWriter(ctx));
  expect([err.code, err.hint]).toEqual([
    'usage',
    `--as <handle>, BACKE_USER oder "user" in ${join(s.home, '.backe/config.jsonc')}`,
  ]);
});

test('identity maps to an expanded key, a handle without identity may only read', async () => {
  const s = await setup();
  const ctx = await s.run();
  expect(ctx.user.key).toBe(join(s.home, '.ssh/id.pub'));
  expect(requireWriter(ctx)).toEqual({
    handle: 'spw',
    key: ctx.user.key,
    workingCopy: join(s.home, '.backe/backlogs/acme/spw'),
  });
  const other = await s.run({ as: 'claude-1' });
  expect(other.user.key).toBeUndefined();
  const err = await catchErrAsync(async () => requireWriter(other));
  expect([err.code, err.hint]).toEqual([
    'usage',
    `identities.acme.claude-1 in ${join(s.home, '.backe/config.jsonc')} eintragen oder backe user create-agent`,
  ]);
});

test('a bound path of the user wins over the managed clone', async () => {
  const s = await setup({
    'home/.backe/config.jsonc': `{ "current": "acme", "user": "spw", "backlogs": { "acme": { "paths": { "spw": "~/code/acme" } } } }`,
    'home/code/acme/.backe/backlog.jsonc': BACKLOG('acme'),
  });
  const ctx = await s.run();
  expect([ctx.backlog.workingCopy, ctx.backlog.root]).toEqual([
    join(s.home, 'code/acme'),
    join(s.home, 'code/acme'),
  ]);
});

test('read root falls back to another working copy of the same backlog', async () => {
  const s = await setup({
    'home/.backe/backlogs/acme/claude-1/.backe/backlog.jsonc': BACKLOG('acme'),
  });
  const ctx = await s.run();
  expect([ctx.backlog.workingCopy, ctx.backlog.root]).toEqual([
    join(s.home, '.backe/backlogs/acme/spw'),
    join(s.home, '.backe/backlogs/acme/claude-1'),
  ]);
});

test('read root falls back to another bound path before managed clones', async () => {
  const s = await setup({
    'home/.backe/config.jsonc': `{ "current": "acme", "user": "spw", "backlogs": { "acme": { "paths": { "zed": "~/code/zed" } } } }`,
    'home/code/zed/.backe/backlog.jsonc': BACKLOG('acme'),
    'home/.backe/backlogs/acme/aaa/.backe/backlog.jsonc': BACKLOG('acme'),
  });
  expect((await s.run()).backlog.root).toBe(join(s.home, 'code/zed'));
});

test('read root is undefined without any working copy', async () => {
  const s = await setup();
  const ctx = await s.run();
  expect([ctx.backlog.root, ctx.backlog.workingCopy === undefined]).toEqual([undefined, false]);
});

test('a working copy of another backlog is a validation error', async () => {
  const s = await setup({ 'home/.backe/backlogs/acme/spw/.backe/backlog.jsonc': BACKLOG('beta') });
  expect((await catchErrAsync(() => s.run())).code).toBe('validation');
});

test('project, sprint and repo resolve to none without any source', async () => {
  const ctx = await (await setup()).run();
  const none = { value: undefined, source: { kind: 'none' } };
  expect([ctx.project, ctx.sprint, ctx.repo]).toEqual([none, none, none]);
});

test.each([
  ['acme', { kind: 'name', value: 'acme' }],
  ['./x', { kind: 'path', value: './x' }],
  ['..', { kind: 'path', value: '..' }],
  ['~/x', { kind: 'path', value: '~/x' }],
  ['/abs', { kind: 'path', value: '/abs' }],
  ['gh:acme/beta', { kind: 'url', value: 'github.com/acme/beta' }],
])('classifyBacklogRef(%s, path allowed)', (value, expected) => {
  expect(classifyBacklogRef(value, true)).toEqual(expected);
});

test('classifyBacklogRef reads /… as a file URL when paths are not allowed', () => {
  expect(classifyBacklogRef('/srv/backlog.git', false)).toEqual({
    kind: 'url',
    value: 'file:/srv/backlog',
  });
});

test('readBacklogName reads only the name', async () => {
  const t = await contextTree({
    'a/.backe/backlog.jsonc': '{ "version": 9, "name": "zed" }',
    'b/.backe/backlog.jsonc': '{ "name": "Bad Name" }',
    'c/.backe/backlog.jsonc': '[]',
  });
  expect(await readBacklogName(t.at('a'))).toBe('zed');
  expect(await readBacklogName(t.at('missing'))).toBeUndefined();
  expect((await catchErrAsync(() => readBacklogName(t.at('b')))).code).toBe('validation');
  expect((await catchErrAsync(() => readBacklogName(t.at('c')))).code).toBe('validation');
});

const WC = 'home/.backe/backlogs/acme/spw';
const REPO = '---\nurl: git@github.com:acme/webapp.git\n---\n';
const withBacklog = (extra: Record<string, string> = {}) =>
  setup({
    [`${WC}/.backe/backlog.jsonc`]: BACKLOG('acme'),
    [`${WC}/repos/webapp.md`]: REPO,
    ...extra,
  });

test.each<[string, ContextFlags, Env, Record<string, string>, string | undefined, SourceKind]>([
  ['flag', { project: 'web' }, { BACKE_PROJECT: 'api' }, {}, 'web', 'flag'],
  ['env', {}, { BACKE_PROJECT: 'api' }, {}, 'api', 'env'],
  [
    'local beats shared',
    {},
    {},
    {
      'work/.backlog.jsonc': '{ "project": "a" }',
      'work/.backlog.local.jsonc': '{ "project": "b" }',
    },
    'b',
    'project-local',
  ],
  ['shared', {}, {}, { 'work/.backlog.jsonc': '{ "project": "a" }' }, 'a', 'project'],
  ['empty env vars count as unset', {}, { BACKE_PROJECT: '' }, {}, undefined, 'none'],
])('project from %s', async (_n, flags, env, files, value, kind) => {
  const ctx = await (await setup(files)).run(flags, env);
  expect([ctx.project.value, ctx.project.source.kind]).toEqual([value, kind]);
});
test('sprint from the backlog entry, then the global default', async () => {
  const s = await setup({
    'home/.backe/config.jsonc': CFG.replace(
      '"user": "spw" }',
      '"user": "spw", "sprint": "w47" }',
    ).replace('"current"', '"sprint": "w1", "current"'),
  });
  expect((await s.run()).sprint).toEqual({ value: 'w47', source: { kind: 'user-backlog' } });
  expect((await s.run({ backlog: 'beta' })).sprint).toEqual({
    value: 'w1',
    source: { kind: 'user-default' },
  });
});
test('invalid project from env names the source', async () => {
  const err = await catchErrAsync(async () => (await setup()).run({}, { BACKE_PROJECT: 'Web' }));
  expect([err.code, err.message]).toEqual(['usage', expect.stringContaining('BACKE_PROJECT')]);
});
test('invalid sprint from a flag is a usage error', async () => {
  const err = await catchErrAsync(async () => (await setup()).run({ sprint: 'No Sprint' }));
  expect([err.code, err.message]).toEqual(['usage', expect.stringContaining('flag')]);
});

test('repo context from a registered remote', async () => {
  const s = await withBacklog({ 'code/webapp/src/.keep': '' });
  await gitInit(s.at('code/webapp'), { upstream: 'https://github.com/acme/webapp' });
  const ctx = await s.run({}, {}, s.at('code/webapp/src'));
  expect(ctx.repo).toEqual({ value: 'webapp', source: { kind: 'remote', detail: 'upstream' } });
});
test('repo context through a symlinked checkout', async () => {
  const s = await withBacklog({ 'code/webapp/.keep': '' });
  await gitInit(s.at('code/webapp'), { origin: 'gh:acme/webapp' });
  await symlink(s.at('code/webapp'), s.at('wa'));
  expect((await s.run({}, {}, s.at('wa'))).repo.value).toBe('webapp');
});
test('repo from the project config, null switches it off', async () => {
  const s = await withBacklog({ 'code/webapp/.backlog.jsonc': '{ "repo": null }' });
  await gitInit(s.at('code/webapp'), { origin: 'gh:acme/webapp' });
  expect((await s.run({}, {}, s.at('code/webapp'))).repo).toEqual({
    value: null,
    source: { kind: 'project', detail: s.at('code/webapp/.backlog.jsonc') },
  });
});
test('a known repo name in the project config resolves with its source', async () => {
  const s = await withBacklog({ 'work/.backlog.local.jsonc': '{ "repo": "webapp" }' });
  expect((await s.run()).repo).toEqual({
    value: 'webapp',
    source: { kind: 'project-local', detail: s.at('work/.backlog.local.jsonc') },
  });
});
test('an unknown repo name in the project config is not found', async () => {
  const s = await withBacklog({ 'work/.backlog.jsonc': '{ "repo": "nope" }' });
  const err = await catchErrAsync(() => s.run());
  expect([err.code, err.hint]).toEqual(['not_found', 'backe repo list']);
});
test('no git repo means no repo context', async () => {
  const s = await withBacklog();
  expect((await s.run()).repo).toEqual({ value: undefined, source: { kind: 'none' } });
});
test('unregistered remote means no repo context', async () => {
  const s = await withBacklog({ 'code/other/.keep': '' });
  await gitInit(s.at('code/other'), { origin: 'gh:acme/other' });
  expect((await s.run({}, {}, s.at('code/other'))).repo.value).toBeUndefined();
});
test('unparsable remotes are skipped, later ones still match', async () => {
  const s = await withBacklog({ 'code/webapp/.keep': '' });
  await gitInit(s.at('code/webapp'), { origin: 'not a url', upstream: 'gh:acme/webapp' });
  expect((await s.run({}, {}, s.at('code/webapp'))).repo.source).toEqual({
    kind: 'remote',
    detail: 'upstream',
  });
});
test('a checkout of the backlog itself yields no repo context', async () => {
  const s = await withBacklog();
  await gitInit(s.at(WC), { origin: 'gh:acme/webapp' });
  expect((await s.run({}, {}, s.at(WC))).repo.value).toBeUndefined();
});
test('without a backlog root there is no repo context', async () => {
  const s = await setup({ 'code/webapp/.keep': '' });
  await gitInit(s.at('code/webapp'), { origin: 'gh:acme/webapp' });
  expect((await s.run({}, {}, s.at('code/webapp'))).repo.value).toBeUndefined();
});

test('a project config level for another backlog does not apply', async () => {
  const s = await setup({
    'home/.backe/backlogs/beta/spw/.backe/backlog.jsonc': BACKLOG('beta'),
    'code/.backlog.jsonc': '{ "backlog": "acme", "project": "web", "repo": "webapp" }',
    'code/.backlog.local.jsonc': '{ "user": "loc", "sprint": "w47" }',
  });
  const ctx = await s.run({ backlog: 'beta' }, {}, s.at('code'));
  const none = { value: undefined, source: { kind: 'none' } };
  expect([ctx.backlog.value, ctx.project, ctx.sprint, ctx.repo]).toEqual([
    'beta',
    none,
    none,
    none,
  ]);
  expect(ctx.user).toMatchObject({ value: 'spw', source: { kind: 'user-default' } });
});

test('a project config level naming the backlog by its URL applies to it', async () => {
  const s = await setup({
    'code/.backlog.jsonc': '{ "backlog": "gh:acme/beta", "project": "web" }',
    'code/.backlog.local.jsonc': '{ "user": "loc" }',
  });
  const ctx = await s.run({ backlog: 'beta' }, {}, s.at('code'));
  expect([ctx.project.value, ctx.user.value]).toEqual(['web', 'loc']);
  const other = await s.run({ backlog: 'acme' }, {}, s.at('code'));
  expect([other.project.value, other.user.value]).toEqual([undefined, 'spw']);
});

describe('a bound working copy that belongs to another handle', () => {
  const OWN = (home: string) => join(home, '.backe/backlogs/acme/spw');

  test('a managed clone of another handle is refused with the own working copy', async () => {
    const s = await setup({
      'home/.backe/backlogs/acme/claude-1/.backe/backlog.jsonc': BACKLOG('acme'),
    });
    await gitInit(s.at('home/.backe/backlogs/acme/claude-1'));
    const ctx = await s.run({}, {}, s.at('home/.backe/backlogs/acme/claude-1'));
    const err = await catchErrAsync(async () => requireWriter(ctx));
    expect([err.code, err.message]).toEqual(['usage', expect.stringContaining(OWN(s.at('home')))]);
  });

  test('a bound path of another handle is refused, also through a symlink', async () => {
    const s = await setup({
      'home/.backe/config.jsonc': CFG.replace(
        '"user": "spw" }',
        '"user": "spw", "paths": { "bob": "~/link" } }',
      ),
      'home/code/bob/.backe/backlog.jsonc': BACKLOG('acme'),
    });
    await gitInit(s.at('home/code/bob'));
    await symlink(s.at('home/code/bob'), s.at('home/link'));
    const ctx = await s.run({ backlog: s.at('home/code/bob') });
    const err = await catchErrAsync(async () => requireWriter(ctx));
    expect([err.code, err.message]).toEqual(['usage', expect.stringContaining(OWN(s.at('home')))]);
  });

  test('the own managed clone may be written', async () => {
    const s = await setup({
      'home/.backe/backlogs/acme/spw/.backe/backlog.jsonc': BACKLOG('acme'),
    });
    await gitInit(s.at('home/.backe/backlogs/acme/spw'));
    const ctx = await s.run({}, {}, s.at('home/.backe/backlogs/acme/spw'));
    expect(requireWriter(ctx).workingCopy).toBe(OWN(s.at('home')));
  });

  test('a working copy not assigned to any handle may be written', async () => {
    const s = await setup({ 'repo/.backe/backlog.jsonc': BACKLOG('acme') });
    await gitInit(s.at('repo'));
    const ctx = await s.run({}, { BACKE_BACKLOG: s.at('repo') });
    expect(requireWriter(ctx).workingCopy).toBe(s.at('repo'));
  });
});

test('the resolved context carries its input env', async () => {
  const t = await setup();
  const env = { ...t.env };
  expect((await resolveContext({ cwd: t.at('work'), env, flags: {} })).env).toBe(env);
});

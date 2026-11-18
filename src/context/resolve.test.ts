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
    `--as <handle>, BACKE_USER oder "user" in ${join(s.env.HOME!, '.backe/config.jsonc')}`,
  ]);
});

test('identity maps to an expanded key, a handle without identity may only read', async () => {
  const s = await setup();
  const ctx = await s.run();
  expect(ctx.user.key).toBe(join(s.env.HOME!, '.ssh/id.pub'));
  expect(requireWriter(ctx)).toEqual({
    handle: 'spw',
    key: ctx.user.key,
    workingCopy: join(s.env.HOME!, '.backe/backlogs/acme/spw'),
  });
  const other = await s.run({ as: 'claude-1' });
  expect(other.user.key).toBeUndefined();
  const err = await catchErrAsync(async () => requireWriter(other));
  expect([err.code, err.hint]).toEqual([
    'usage',
    `identities.acme.claude-1 in ${join(s.env.HOME!, '.backe/config.jsonc')} eintragen oder backe user create-agent`,
  ]);
});

test('a bound path of the user wins over the managed clone', async () => {
  const s = await setup({
    'home/.backe/config.jsonc': `{ "current": "acme", "user": "spw", "backlogs": { "acme": { "paths": { "spw": "~/code/acme" } } } }`,
    'home/code/acme/.backe/backlog.jsonc': BACKLOG('acme'),
  });
  const ctx = await s.run();
  expect([ctx.backlog.workingCopy, ctx.backlog.root]).toEqual([
    join(s.env.HOME!, 'code/acme'),
    join(s.env.HOME!, 'code/acme'),
  ]);
});

test('read root falls back to another working copy of the same backlog', async () => {
  const s = await setup({
    'home/.backe/backlogs/acme/claude-1/.backe/backlog.jsonc': BACKLOG('acme'),
  });
  const ctx = await s.run();
  expect([ctx.backlog.workingCopy, ctx.backlog.root]).toEqual([
    join(s.env.HOME!, '.backe/backlogs/acme/spw'),
    join(s.env.HOME!, '.backe/backlogs/acme/claude-1'),
  ]);
});

test('read root falls back to another bound path before managed clones', async () => {
  const s = await setup({
    'home/.backe/config.jsonc': `{ "current": "acme", "user": "spw", "backlogs": { "acme": { "paths": { "zed": "~/code/zed" } } } }`,
    'home/code/zed/.backe/backlog.jsonc': BACKLOG('acme'),
    'home/.backe/backlogs/acme/aaa/.backe/backlog.jsonc': BACKLOG('acme'),
  });
  expect((await s.run()).backlog.root).toBe(join(s.env.HOME!, 'code/zed'));
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

test('project, sprint and repo are unresolved for now', async () => {
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

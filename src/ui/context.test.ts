import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import * as resolveModule from '../context/resolve.ts';
import { updateUserConfig } from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import { git } from '../git/exec.ts';
import { initBacklog } from '../services/init.ts';
import * as writeModule from '../services/write.ts';
import { backlogsJson, resolveStart, type StartInput, uiContext } from './context.ts';

async function freshEnv() {
  const tmp = await tempDir();
  return { cwd: tmp, env: { HOME: join(tmp, 'home'), BACKE_HOME: join(tmp, 'backe') } };
}

test('the start backlog falls back to none when nothing names one', async () => {
  const t = await testBacklog();
  await updateUserConfig(t.homes.backeHome, () => [{ path: ['current'], value: undefined }]);
  const cwd = await tempDir();
  const input: StartInput = { cwd, env: t.env, flags: {} };
  expect(await resolveStart(input)).toBeUndefined();
  const json = await backlogsJson(input, undefined);
  expect(json.backlogs.map((b) => [b.name, b.current])).toEqual([['acme', false]]);
});

test('the start backlog is the current one', async () => {
  const t = await testBacklog();
  const input: StartInput = { cwd: await tempDir(), env: t.env, flags: {} };
  expect(await resolveStart(input)).toBe('acme');
});

test('no registered backlog keeps the cli error', async () => {
  const f = await freshEnv();
  const err = await catchErrAsync(() => resolveStart({ cwd: f.cwd, env: f.env, flags: {} }));
  expect([err.code, err.exitCode]).toEqual(['usage', 2]);
});

test('an unregistered backlog flag fails the start', async () => {
  const t = await testBacklog();
  const input: StartInput = { cwd: await tempDir(), env: t.env, flags: { backlog: 'nope' } };
  const err = await catchErrAsync(() => resolveStart(input));
  expect([err.code, err.exitCode]).toEqual(['not_found', 3]);
});

test('a bound working copy outside the registry is the start backlog', async () => {
  const t = await testBacklog();
  const f = await freshEnv();
  const clone = join(f.cwd, 'clone');
  await git(['clone', '-q', t.root, clone], { cwd: f.cwd });
  const input: StartInput = { cwd: clone, env: f.env, flags: {} };
  expect(await resolveStart(input)).toBe('acme');
  const json = await backlogsJson(input, 'acme');
  expect(json.backlogs).toEqual([
    { name: 'acme', current: true, can_write: false, user: null, prefix: 'bk' },
  ]);
  expect((await uiContext(input, 'acme', 'acme')).backlog.root).toBe(clone);
});

test('another backlog is resolved by name with the start identity', async () => {
  const t = await testBacklog();
  const input: StartInput = { cwd: await tempDir(), env: t.env, flags: { as: 'spw' } };
  const ctx = await uiContext(input, undefined, 'acme');
  expect([ctx.backlog.value, ctx.user.value]).toEqual(['acme', 'spw']);
});

test('a start backlog that resolves differently falls back to the name', async () => {
  const t = await testBacklog();
  const { root: other } = await initBacklog({
    homes: t.homes,
    env: t.env,
    name: 'other',
    prefix: 'ot',
    handle: 'spw',
    key: t.key.priv,
  });
  // Gestartet mit `other` als aktuellem Backlog; inzwischen ist es wieder `acme`.
  await updateUserConfig(t.homes.backeHome, () => [{ path: ['current'], value: 'acme' }]);
  const input: StartInput = { cwd: await tempDir(), env: t.env, flags: { as: 'spw' } };
  expect((await resolveModule.resolveContext(input)).backlog.value).toBe('acme');
  const ctx = await uiContext(input, 'other', 'other');
  expect([ctx.backlog.value, ctx.backlog.root, ctx.user.value]).toEqual(['other', other, 'spw']);
});

test('a start backlog that is gone by name stays not_found', async () => {
  const t = await testBacklog();
  const input: StartInput = { cwd: await tempDir(), env: t.env, flags: { as: 'spw' } };
  const err = await catchErrAsync(() => uiContext(input, 'gone', 'gone'));
  expect(err.code).toBe('not_found');
});

test('backlogs reports can_write per identity', async () => {
  const t = await testBacklog();
  const cwd = await tempDir();
  const spw = await backlogsJson({ cwd, env: t.env, flags: { as: 'spw' } }, 'acme');
  expect(spw).toEqual({
    backlogs: [{ name: 'acme', current: true, can_write: true, user: 'spw', prefix: 'bk' }],
    lang: 'de',
  });
  const reader = await backlogsJson({ cwd, env: t.env, flags: { as: 'reader' } }, 'acme');
  expect(reader.backlogs).toEqual([
    { name: 'acme', current: true, can_write: false, user: 'reader', prefix: 'bk' },
  ]);
});

test('a start name that fails to resolve is listed without write access', async () => {
  const t = await testBacklog();
  const json = await backlogsJson(
    { cwd: await tempDir(), env: t.env, flags: { as: 'spw' } },
    'ghost',
  );
  expect(json.backlogs.map((b) => [b.name, b.current, b.can_write, b.user])).toEqual([
    ['acme', false, true, 'spw'],
    ['ghost', true, false, null],
  ]);
});

test('a programming error while listing backlogs is not swallowed', async () => {
  const t = await testBacklog();
  const input: StartInput = { cwd: await tempDir(), env: t.env, flags: { as: 'spw' } };
  const writer = vi.spyOn(resolveModule, 'requireWriter').mockImplementation(() => {
    throw new TypeError('boom');
  });
  try {
    await expect(backlogsJson(input, 'acme')).rejects.toThrow(TypeError);
  } finally {
    writer.mockRestore();
  }
  const resolve = vi.spyOn(resolveModule, 'resolveContext').mockRejectedValue(new TypeError('x'));
  try {
    await expect(backlogsJson(input, 'acme')).rejects.toThrow(TypeError);
  } finally {
    resolve.mockRestore();
  }
  expect((await backlogsJson(input, 'acme')).backlogs).toHaveLength(1);
});

test('backlog list carries the id prefix', async () => {
  const t = await testBacklog();
  await initBacklog({
    homes: t.homes,
    env: t.env,
    name: 'other',
    prefix: 'sm',
    handle: 'spw',
    key: t.key.priv,
  });
  const input: StartInput = { cwd: await tempDir(), env: t.env, flags: { as: 'spw' } };
  const json = await backlogsJson(input, 'acme');
  expect(json.backlogs.map((b) => [b.name, b.prefix])).toEqual([
    ['acme', 'bk'],
    ['other', 'sm'],
  ]);
});

test('a backlog without a working copy has no prefix', async () => {
  const t = await testBacklog();
  const input: StartInput = { cwd: await tempDir(), env: t.env, flags: {} };
  const json = await backlogsJson(input, 'ghost');
  expect(json.backlogs.find((b) => b.name === 'ghost')?.prefix).toBeNull();
});

test('an unreadable backlog config leaves the prefix empty, other errors propagate', async () => {
  const t = await testBacklog();
  const input: StartInput = { cwd: await tempDir(), env: t.env, flags: { as: 'spw' } };
  const spy = vi
    .spyOn(writeModule, 'headConfig')
    .mockRejectedValue(new BackeError('validation', 'kaputt'));
  try {
    expect((await backlogsJson(input, 'acme')).backlogs[0]?.prefix).toBeNull();
    spy.mockRejectedValue(new TypeError('boom'));
    await expect(backlogsJson(input, 'acme')).rejects.toThrow(TypeError);
  } finally {
    spy.mockRestore();
  }
});

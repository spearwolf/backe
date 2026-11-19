import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import {
  findBacklogByRemote,
  listBacklogs,
  registerBacklog,
  registerBacklogTracked,
  revertBinding,
  setIdentity,
  unregisterBacklog,
  useBacklog,
  workingCopyPath,
} from './registry.ts';

const homes = async () => {
  const r = await tempDir();
  return { home: join(r, 'h'), backeHome: join(r, 'b') };
};

test('first registration becomes current, list is sorted', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'zeta', remote: 'gh:acme/zeta' });
  const cfg = await registerBacklog(h, { name: 'alpha' });
  expect(listBacklogs(cfg).map((b) => [b.name, b.current])).toEqual([
    ['alpha', false],
    ['zeta', true],
  ]);
});

test('list exposes remote and paths', async () => {
  const h = await homes();
  const cfg = await registerBacklog(h, {
    name: 'acme',
    remote: 'gh:acme/backlog',
    handle: 'spw',
    path: '/x',
  });
  expect(listBacklogs(cfg)).toEqual([
    { name: 'acme', remote: 'gh:acme/backlog', current: true, paths: { spw: '/x' } },
  ]);
  expect(listBacklogs({})).toEqual([]);
});

test('remote lookup is canonical', async () => {
  const cfg = await registerBacklog(await homes(), {
    name: 'acme',
    remote: 'git@github.com:acme/backlog.git',
  });
  expect(findBacklogByRemote(cfg, 'https://github.com/acme/backlog')).toBe('acme');
  expect(findBacklogByRemote(cfg, 'gh:acme/other')).toBeUndefined();
  expect(findBacklogByRemote({}, 'gh:acme/other')).toBeUndefined();
});

test('remote lookup rejects an unparsable url', async () => {
  const cfg = await registerBacklog(await homes(), { name: 'acme', remote: 'gh:acme/backlog' });
  expect(() => findBacklogByRemote(cfg, 'not a url')).toThrow(
    expect.objectContaining({ code: 'validation' }),
  );
});

test.each([
  [{ name: 'acme', remote: 'gh:acme/other' }, 'conflict'],
  [{ name: 'beta', remote: 'https://github.com/acme/backlog' }, 'conflict'],
  [{ name: 'acme', path: '/x' }, 'usage'],
])('register %o fails with %s', async (entry, code) => {
  const h = await homes();
  await registerBacklog(h, { name: 'acme', remote: 'gh:acme/backlog' });
  expect((await catchErrAsync(() => registerBacklog(h, entry))).code).toBe(code);
});

test('register adds to an existing entry and keeps current', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'acme' });
  await registerBacklog(h, { name: 'beta' });
  const cfg = await registerBacklog(h, {
    name: 'beta',
    remote: 'gh:acme/beta',
    handle: 'spw',
    path: '~/b',
  });
  expect(cfg.current).toBe('acme');
  expect(cfg.backlogs?.beta).toEqual({ remote: 'gh:acme/beta', paths: { spw: '~/b' } });
  const same = await registerBacklog(h, { name: 'beta', remote: 'https://github.com/acme/beta' });
  expect(same.backlogs?.beta?.remote).toBe('gh:acme/beta');
});

test('working copy: bound path or managed clone', async () => {
  const h = await homes();
  const cfg = await registerBacklog(h, { name: 'acme', handle: 'spw', path: '~/code/acme' });
  expect(workingCopyPath(cfg, h, 'acme', 'spw')).toBe(join(h.home, 'code/acme'));
  expect(workingCopyPath(cfg, h, 'acme', 'claude-1')).toBe(
    join(h.backeHome, 'backlogs/acme/claude-1'),
  );
});

test('relative bound path resolves against backeHome', async () => {
  const h = await homes();
  const cfg = await registerBacklog(h, { name: 'acme', handle: 'spw', path: 'wc/acme' });
  expect(workingCopyPath(cfg, h, 'acme', 'spw')).toBe(join(h.backeHome, 'wc/acme'));
});

test('use switches current', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'acme' });
  await registerBacklog(h, { name: 'beta' });
  expect((await useBacklog(h, 'beta')).current).toBe('beta');
});

test('unregister clears current but keeps identities', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'acme' });
  await setIdentity(h, 'acme', 'spw', '~/.ssh/id_ed25519.pub');
  const { config, managedDir } = await unregisterBacklog(h, 'acme');
  expect([config.current, config.backlogs?.acme, config.identities?.acme?.spw?.key]).toEqual([
    undefined,
    undefined,
    '~/.ssh/id_ed25519.pub',
  ]);
  expect(managedDir).toBe(join(h.backeHome, 'backlogs/acme'));
});

test('unregister keeps current when another backlog was removed', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'acme' });
  await registerBacklog(h, { name: 'beta' });
  const { config } = await unregisterBacklog(h, 'beta');
  expect(config.current).toBe('acme');
});

test('use and unregister of an unknown backlog', async () => {
  const h = await homes();
  const err = await catchErrAsync(() => useBacklog(h, 'nope'));
  expect(err.code).toBe('not_found');
  expect(err.hint).toBe('backe backlog list');
  expect((await catchErrAsync(() => unregisterBacklog(h, 'nope'))).code).toBe('not_found');
});

test('revertBinding drops the binding and the remote but keeps the entry', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'acme' });
  await registerBacklog(h, {
    name: 'acme',
    remote: 'gh:acme/backlog',
    handle: 'spw',
    path: '/p/a',
  });
  await registerBacklog(h, { name: 'acme', handle: 'bot', path: '/p/b' });
  const cfg = await revertBinding(h, 'acme', { handle: 'spw', remote: true });
  expect(cfg.backlogs?.acme?.remote).toBeUndefined();
  expect(cfg.backlogs?.acme?.paths).toEqual({ bot: '/p/b' });
});

test('revertBinding keeps the remote unless asked and ignores unknown entries', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'acme', remote: 'gh:acme/backlog' });
  const cfg = await revertBinding(h, 'acme', { handle: 'spw' });
  expect(cfg.backlogs?.acme?.remote).toBe('gh:acme/backlog');
  await revertBinding(h, 'nope', { handle: 'spw', remote: true });
});

test('revertBinding resets a current it set', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'acme', handle: 'spw', path: '/p/a' });
  const cfg = await revertBinding(h, 'acme', { handle: 'spw', current: true });
  expect(cfg.current).toBeUndefined();
  expect(cfg.backlogs?.acme?.paths?.spw).toBeUndefined();
});

test('revertBinding leaves a current that points elsewhere', async () => {
  const h = await homes();
  await registerBacklog(h, { name: 'other' });
  await registerBacklog(h, { name: 'acme', handle: 'spw', path: '/p/a' });
  const cfg = await revertBinding(h, 'acme', { handle: 'spw', current: true });
  expect(cfg.current).toBe('other');
});

test('registerBacklogTracked reports the state it found under the lock', async () => {
  const h = await homes();
  const first = await registerBacklogTracked(h, { name: 'acme' });
  expect(first.before).toEqual({});
  const second = await registerBacklogTracked(h, { name: 'acme', remote: 'gh:acme/backlog' });
  expect(second.before.backlogs?.acme).toEqual({});
  expect(second.before.current).toBe('acme');
  expect(second.config.backlogs?.acme?.remote).toBe('gh:acme/backlog');
});

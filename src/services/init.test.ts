import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import {
  bareRemote,
  logTrailers,
  revParse,
  sigOf,
  testBacklog,
  testKey,
} from '../../test/helpers/git.ts';
import { resolveHomes } from '../context/paths.ts';
import { readUserConfig } from '../context/user-config.ts';
import { git, sshKeygen } from '../git/exec.ts';
import { readLocalState } from '../git/local-state.ts';
import { loadSnapshot } from '../store/snapshot.ts';
import { authorOf, isoNow } from './env.ts';
import { initBacklog } from './init.ts';

async function inputFor() {
  const tmp = await tempDir();
  const env = { HOME: join(tmp, 'home'), BACKE_HOME: join(tmp, 'backe') };
  const key = await testKey('spw');
  return {
    tmp,
    input: {
      homes: resolveHomes(env, tmp),
      env,
      name: 'acme',
      prefix: 'bk',
      handle: 'spw',
      key: key.priv,
    },
  };
}

test('init writes config and admin user in one signed anchor commit', async () => {
  const b = await testBacklog({ handle: 'spw', name: 'acme' });
  expect(await logTrailers(b.root)).toEqual([{ subject: 'init acme', actor: 'spw', op: 'init' }]);
  expect(await sigOf(b.root, 'HEAD', { spw: b.key })).toEqual(['G', 'spw']);
  expect(await readFile(join(b.root, '.backe/backlog.jsonc'), 'utf8')).toBe(
    '{\n  "version": 1,\n  "name": "acme",\n  "id_prefix": "bk",\n  "admins": [\n    "spw"\n  ]\n}\n',
  );
  const s = await loadSnapshot(b.root);
  expect(s.users.get('spw')?.data).toEqual({ name: 'spw', kind: 'human', keys: [b.key.line] });
  expect(s.problems).toEqual([]);
});

test('anchor, verified and identity are recorded', async () => {
  const b = await testBacklog();
  const head = await revParse(b.root, 'HEAD');
  expect(await readLocalState(b.root, 'anchor')).toBe(head);
  expect(await readLocalState(b.root, 'verified')).toBe(head);
  expect(await readLocalState(b.root, 'identity')).toBe('spw');
});

test('the backlog is registered with identity; a managed init needs no paths entry', async () => {
  const b = await testBacklog({ handle: 'spw', name: 'acme' });
  const cfg = await readUserConfig(b.homes.backeHome);
  expect(cfg.current).toBe('acme');
  expect(cfg.backlogs?.acme).toEqual({});
  expect(cfg.identities?.acme?.spw?.key).toBe(b.key.priv);
  expect(b.root).toBe(join(b.homes.backeHome, 'backlogs', 'acme', 'spw'));
});

test('init into a given dir registers paths.<handle>', async () => {
  const { tmp, input } = await inputFor();
  const dir = join(tmp, 'work', 'acme');
  const { root } = await initBacklog({ ...input, dir });
  expect(root).toBe(dir);
  const cfg = await readUserConfig(input.homes.backeHome);
  expect(cfg.backlogs?.acme?.paths?.spw).toBe(dir);
});

test('a non-empty target dir is a conflict', async () => {
  const { tmp, input } = await inputFor();
  const dir = join(tmp, 'full');
  await mkdir(dir);
  await writeFile(join(dir, 'x'), 'x');
  const err = await catchErrAsync(() => initBacklog({ ...input, dir }));
  expect(err.code).toBe('conflict');
});

test('an already registered name is a conflict', async () => {
  const { tmp, input } = await inputFor();
  await initBacklog({ ...input, dir: join(tmp, 'one') });
  const err = await catchErrAsync(() => initBacklog({ ...input, dir: join(tmp, 'two') }));
  expect(err.code).toBe('conflict');
});

test('invalid name, prefix and handle are usage errors', async () => {
  const { input } = await inputFor();
  for (const over of [{ name: 'Bad Name' }, { prefix: 'B' }, { handle: 'me' }]) {
    const err = await catchErrAsync(() => initBacklog({ ...input, ...over }));
    expect(err.code).toBe('usage');
  }
});

test('init with remote pushes the anchor to the bare remote', async () => {
  const b = await testBacklog({ remote: true });
  const remote = b.remote as string;
  expect(await revParse(remote, 'main')).toBe(await revParse(b.root, 'HEAD'));
  const cfg = await readUserConfig(b.homes.backeHome);
  expect(cfg.backlogs?.acme?.remote).toBe(remote);
});

test('a failed push keeps the local backlog and reports a sync error with hint', async () => {
  const { tmp, input } = await inputFor();
  const remote = join(tmp, 'missing.git');
  const err = await catchErrAsync(() => initBacklog({ ...input, remote }));
  const root = join(input.homes.backeHome, 'backlogs', 'acme', 'spw');
  expect(err.code).toBe('sync');
  expect(err.message).toContain(`Push nach ${remote} fehlgeschlagen`);
  expect(err.hint).toBe(`git -C ${root} push -u origin main`);
  expect((await git(['rev-parse', 'HEAD'], { cwd: root })).stdout.trim()).toMatch(/^[0-9a-f]{40}$/);
  const cfg = await readUserConfig(input.homes.backeHome);
  expect(cfg.backlogs?.acme?.remote).toBe(remote);
  expect(cfg.identities?.acme?.spw?.key).toBe(input.key);
});

test('an rsa key is refused before anything is written', async () => {
  const { tmp, input } = await inputFor();
  const rsa = join(tmp, 'rsa');
  await sshKeygen(['-q', '-t', 'rsa', '-b', '2048', '-N', '', '-f', rsa], { cwd: tmp });
  const dir = join(tmp, 'target');
  const err = await catchErrAsync(() => initBacklog({ ...input, key: rsa, dir }));
  expect(err.code).toBe('validation');
  await expect(readFile(join(dir, '.backe/backlog.jsonc'))).rejects.toThrow();
  expect((await readUserConfig(input.homes.backeHome)).backlogs).toBeUndefined();
});

test('authorOf and isoNow format as specified', () => {
  expect(authorOf('spw', 'Wolfger')).toEqual({ name: 'Wolfger', email: 'spw@backe.invalid' });
  expect(isoNow(new Date('2026-11-19T10:20:30.456Z'))).toBe('2026-11-19T10:20:30Z');
});

test('bareRemote creates an empty bare repository', async () => {
  const remote = await bareRemote();
  const out = await git(['rev-parse', '--is-bare-repository'], { cwd: remote });
  expect(out.stdout.trim()).toBe('true');
});

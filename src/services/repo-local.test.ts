import { mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { gitInit } from '../../test/helpers/context.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import { type ResolvedContext, resolveContext } from '../context/resolve.ts';
import { updateUserConfig } from '../context/user-config.ts';
import { locateRepo, scanRepos } from './repo-local.ts';
import { addRepo } from './repos.ts';

let b: TestBacklog;
let ctx: ResolvedContext;

beforeEach(async () => {
  b = await testBacklog();
  await addRepo(await b.context(), { url: 'https://github.com/acme/webapp', defaultRef: 'main' });
  ctx = await b.context();
});

const setPath = async (canonical: string, path: string) => {
  await updateUserConfig(b.homes.backeHome, () => [{ path: ['repos', canonical], value: path }]);
  ctx = await b.context();
};

describe('locateRepo', () => {
  test('where resolves name to the configured local path, expanding ~', async () => {
    const dir = join(b.homes.home, 'code', 'webapp');
    await mkdir(dir, { recursive: true });
    await setPath('github.com/acme/webapp', '~/code/webapp');
    expect(await locateRepo(ctx, 'webapp')).toEqual({
      name: 'webapp',
      url: 'https://github.com/acme/webapp',
      canonical: 'github.com/acme/webapp',
      defaultRef: 'main',
      path: dir,
    });
  });

  test('where without a local path names url and scan hint', async () => {
    const err = await catchErrAsync(() => locateRepo(ctx, 'webapp'));
    expect(err.code).toBe('not_found');
    expect(err.message).toBe('Kein lokaler Pfad für »webapp«');
    expect(err.details).toEqual({
      url: 'https://github.com/acme/webapp',
      canonical: 'github.com/acme/webapp',
      default_ref: 'main',
    });
    expect(err.hint).toContain('backe repo scan <verzeichnis>');
    expect(err.hint).toContain('backe config set repos.github.com/acme/webapp <pfad>');
  });

  test('where without default ref omits it from the details', async () => {
    await addRepo(ctx, { url: 'https://example.org/team/api', name: 'api' });
    const err = await catchErrAsync(() => locateRepo(ctx, 'api'));
    expect(err.details).toEqual({
      url: 'https://example.org/team/api',
      canonical: 'example.org/team/api',
    });
  });

  test('where reports a configured path that is gone, and an unknown name', async () => {
    const gone = join(b.homes.home, 'nowhere');
    await setPath('github.com/acme/webapp', gone);
    const err = await catchErrAsync(() => locateRepo(ctx, 'webapp'));
    expect(err.code).toBe('not_found');
    expect(err.message).toBe(`${gone} existiert nicht`);
    expect((await catchErrAsync(() => locateRepo(ctx, 'nope'))).code).toBe('not_found');
  });
});

describe('scanRepos', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await tempDir();
    await addRepo(ctx, { url: 'https://example.org/team/api', name: 'api' });
    ctx = await b.context();
  });

  test('scan registers clones of registered repos and skips the rest', async () => {
    await gitInit(join(dir, 'a'), { origin: 'git@github.com:Acme/WebApp.git' });
    await gitInit(join(dir, 'b'), { origin: 'https://github.com/other/thing' });
    await gitInit(join(dir, '.hidden', 'c'), { origin: 'https://github.com/acme/webapp' });
    await gitInit(join(dir, 'node_modules', 'd'), { origin: 'https://github.com/acme/webapp' });
    await symlink(join(dir, 'a'), join(dir, 'link'));
    await gitInit(join(dir, 'x', 'y', 'z', 'w', 'deep'), {
      origin: 'https://example.org/team/api',
    });
    expect(await scanRepos(ctx, dir, {})).toEqual([
      { name: 'webapp', path: await realpath(join(dir, 'a')), status: 'new' },
    ]);
    const cfg = await readFile(join(b.homes.backeHome, 'config.jsonc'), 'utf8');
    expect(cfg).toContain(await realpath(join(dir, 'a')));
    const again = await scanRepos(await b.context(), dir, {});
    expect(again.map((e) => e.status)).toEqual(['unchanged']);
  });

  test('scan descends to depth 4 and not into found repos', async () => {
    await gitInit(join(dir, 'x', 'y', 'z', 'api'), { origin: 'https://example.org/team/api' });
    await gitInit(join(dir, 'a'), { origin: 'https://github.com/acme/webapp' });
    await gitInit(join(dir, 'a', 'sub'), { origin: 'https://example.org/team/api' });
    const entries = await scanRepos(ctx, dir, { dryRun: true });
    expect(entries.map((e) => [e.name, e.path.slice(dir.length)])).toEqual([
      ['api', '/x/y/z/api'],
      ['webapp', '/a'],
    ]);
  });

  test('scan keeps a differing path unless forced; dry-run writes nothing', async () => {
    const other = join(await tempDir(), 'old');
    await mkdir(other);
    await setPath('github.com/acme/webapp', other);
    await gitInit(join(dir, 'a'), { origin: 'https://github.com/acme/webapp' });
    const a = await realpath(join(dir, 'a'));
    const cfgFile = join(b.homes.backeHome, 'config.jsonc');
    const before = await readFile(cfgFile, 'utf8');

    expect(await scanRepos(ctx, dir, {})).toEqual([
      { name: 'webapp', path: a, status: 'differs', previous: other },
    ]);
    expect(await readFile(cfgFile, 'utf8')).toBe(before);

    expect((await scanRepos(ctx, dir, { force: true, dryRun: true }))[0]?.status).toBe(
      'overwritten',
    );
    expect(await readFile(cfgFile, 'utf8')).toBe(before);

    expect(await scanRepos(ctx, dir, { force: true })).toEqual([
      { name: 'webapp', path: a, status: 'overwritten', previous: other },
    ]);
    const fresh = await resolveContext({ cwd: b.root, env: b.env, flags: { as: b.handle } });
    expect(fresh.userConfig.repos?.['github.com/acme/webapp']).toBe(a);
  });

  test('scan makes one config change per run and sorts by name, then path', async () => {
    await gitInit(join(dir, 'z'), { origin: 'https://example.org/team/api' });
    await gitInit(join(dir, 'm'), { origin: 'https://github.com/acme/webapp' });
    await gitInit(join(dir, 'n'), { origin: 'https://github.com/acme/webapp' });
    const entries = await scanRepos(ctx, dir, {});
    const real = (p: string) => realpath(join(dir, p));
    expect(entries).toEqual([
      { name: 'api', path: await real('z'), status: 'new' },
      { name: 'webapp', path: await real('m'), status: 'new' },
      { name: 'webapp', path: await real('n'), status: 'differs', previous: await real('m') },
    ]);
  });

  test('scan skips broken repos and rejects a missing directory', async () => {
    await mkdir(join(dir, 'fake'));
    await writeFile(join(dir, 'fake', '.git'), 'not a repo');
    expect(await scanRepos(ctx, dir, {})).toEqual([]);
    const err = await catchErrAsync(() => scanRepos(ctx, join(dir, 'missing'), {}));
    expect(err.code).toBe('not_found');
  });

  test('scan rejects a file as root and a second clone never overwrites in one run', async () => {
    const file = join(dir, 'plain');
    await writeFile(file, 'x');
    const err = await catchErrAsync(() => scanRepos(ctx, file, {}));
    expect(err.code).toBe('validation');
    expect(err.message).toContain(file);

    await gitInit(join(dir, 'm'), { origin: 'https://github.com/acme/webapp' });
    await gitInit(join(dir, 'n'), { origin: 'https://github.com/acme/webapp' });
    const m = await realpath(join(dir, 'm'));
    const n = await realpath(join(dir, 'n'));
    for (const force of [false, true]) {
      const entries = await scanRepos(ctx, dir, { force, dryRun: true });
      expect(entries).toEqual([
        { name: 'webapp', path: m, status: 'new' },
        { name: 'webapp', path: n, status: 'differs', previous: m },
      ]);
    }
    await scanRepos(ctx, dir, { force: true });
    const forced = await scanRepos(await b.context(), dir, { force: true });
    expect(forced.map((e) => e.status)).toEqual(['unchanged', 'differs']);
  });
});

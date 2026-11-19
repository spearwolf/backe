import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { rawCommit, revParse, type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import { type Env, type Homes, resolveHomes } from '../context/paths.ts';
import { managedClonePath, registerBacklog, unregisterBacklog } from '../context/registry.ts';
import { resolveContext } from '../context/resolve.ts';
import { readUserConfig, userConfigPath } from '../context/user-config.ts';
import { git } from '../git/exec.ts';
import { readLocalState } from '../git/local-state.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { cloneBacklog, ensureWorkingCopy } from './working-copy.ts';
import { executeWrite } from './write.ts';

type Home = { homes: Homes; env: Env };

let b: TestBacklog;
let other: Home;

async function freshHome(): Promise<Home> {
  const tmp = await tempDir();
  const env: Env = { HOME: join(tmp, 'home'), BACKE_HOME: join(tmp, 'backe') };
  return { homes: resolveHomes(env, tmp), env };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Einträge unter `<BACKE_HOME>/tmp` (fehlt das Verzeichnis: keine). */
async function tempEntries(homes: Homes): Promise<string[]> {
  return readdir(join(homes.backeHome, 'tmp')).catch(() => []);
}

async function push(): Promise<void> {
  await git(['push', '-q', 'origin', 'main'], { cwd: b.root });
}

/** Ein gültiger Admin-Commit von spw setzt `verify` in der Backlog-Config. */
async function setVerify(mode: 'warn' | 'off'): Promise<void> {
  const config = await readFile(join(b.root, BACKLOG_CONFIG), 'utf8');
  await executeWrite(await b.context(), {
    kind: 'manual',
    subject: `verify: ${mode}`,
    changes: [
      { path: BACKLOG_CONFIG, content: config.replace(/\n}\n$/, `,\n  "verify": "${mode}"\n}\n`) },
    ],
  });
}

/** Ein unsignierter, sonst unauffälliger Commit von spw. */
const unsigned = (files: Record<string, string>) =>
  rawCommit(b.root, { files, actor: 'spw', op: 'manual' });

beforeEach(async () => {
  b = await testBacklog({ remote: true });
  other = await freshHome();
});

test('cloneBacklog registers the remote and clones verified for the handle', async () => {
  const r = await cloneBacklog({
    homes: other.homes,
    env: other.env,
    url: b.remote as string,
    handle: 'spw',
  });
  expect(r).toMatchObject({ name: 'acme', root: managedClonePath(other.homes, 'acme', 'spw') });
  expect(r.notices).toEqual([]);
  expect(await readLocalState(r.root, 'anchor')).toBe(await readLocalState(b.root, 'anchor'));
  expect(await readLocalState(r.root, 'identity')).toBe('spw');
  expect(await readLocalState(r.root, 'verified')).toBe(await revParse(b.root, 'HEAD'));
  expect((await readUserConfig(other.homes.backeHome)).backlogs?.acme?.remote).toBe(b.remote);
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('a clone with a wrong --name is refused and leaves nothing', async () => {
  const err = await catchErrAsync(() =>
    cloneBacklog({
      homes: other.homes,
      env: other.env,
      url: b.remote as string,
      handle: 'spw',
      name: 'other',
    }),
  );
  expect(err.code).toBe('validation');
  expect(err.message).toBe('Der Backlog heißt "acme", nicht "other"');
  expect(await readUserConfig(other.homes.backeHome)).toEqual({});
  expect(await exists(join(other.homes.backeHome, 'backlogs'))).toBe(false);
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('a remote with an invalid commit is refused in strict mode and leaves no clone', async () => {
  await rawCommit(b.root, { files: { 'notes.md': 'x\n' }, actor: 'spw', op: 'manual' });
  await push();
  const err = await catchErrAsync(() =>
    cloneBacklog({ homes: other.homes, env: other.env, url: b.remote as string, handle: 'spw' }),
  );
  expect(err.code).toBe('verify');
  expect(await exists(join(other.homes.backeHome, 'backlogs'))).toBe(false);
  expect(await readUserConfig(other.homes.backeHome)).toEqual({});
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('in warn mode the clone stays and reports the reasons', async () => {
  await setVerify('warn');
  const bad = await unsigned({ 'notes.md': 'x\n' });
  await push();
  const r = await cloneBacklog({
    homes: other.homes,
    env: other.env,
    url: b.remote as string,
    handle: 'spw',
  });
  expect(r.notices).toEqual([`${bad.slice(0, 7)}: unsigniert`]);
  expect(await revParse(r.root, 'HEAD')).toBe(bad);
  expect(await readLocalState(r.root, 'verified')).toBeUndefined();
});

test('an unsigned tip that turns verify off is judged by the mode of its parent', async () => {
  const config = await readFile(join(b.root, BACKLOG_CONFIG), 'utf8');
  await unsigned({ [BACKLOG_CONFIG]: config.replace(/\n}\n$/, ',\n  "verify": "off"\n}\n') });
  await push();
  const err = await catchErrAsync(() =>
    cloneBacklog({ homes: other.homes, env: other.env, url: b.remote as string, handle: 'spw' }),
  );
  expect(err.code).toBe('verify');
  expect(await exists(join(other.homes.backeHome, 'backlogs'))).toBe(false);
  expect(await readUserConfig(other.homes.backeHome)).toEqual({});
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('an unreachable remote is a sync error and leaves nothing', async () => {
  const gone = join(await tempDir(), 'gone.git');
  const err = await catchErrAsync(() =>
    cloneBacklog({ homes: other.homes, env: other.env, url: gone, handle: 'spw' }),
  );
  expect(err.code).toBe('sync');
  expect(err.message).toMatch(new RegExp(`^Clone von ${gone} fehlgeschlagen: .+`));
  expect(await exists(join(other.homes.backeHome, 'backlogs'))).toBe(false);
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('a clone of another history under a known name is refused', async () => {
  const local = await testBacklog({ userName: 'Lokal' }); // eigene Historie, eigener Anker
  const anchor = (await readLocalState(local.root, 'anchor')) as string;
  expect(anchor).not.toBe(await readLocalState(b.root, 'anchor'));
  const err = await catchErrAsync(() =>
    cloneBacklog({
      homes: local.homes,
      env: local.env,
      url: b.remote as string,
      handle: 'claude-1',
    }),
  );
  expect(err.code).toBe('verify');
  expect(err.message).toBe(
    `${b.remote} ist kein Nachfahre des zuletzt verifizierten Stands ${anchor.slice(0, 7)}`,
  );
  expect((await readUserConfig(local.homes.backeHome)).backlogs?.acme?.remote).toBeUndefined();
  expect(await exists(managedClonePath(local.homes, 'acme', 'claude-1'))).toBe(false);
  expect(await tempEntries(local.homes)).toEqual([]);
});

test('a remote rewritten behind the verified state is refused', async () => {
  const anchor = await revParse(b.root, 'HEAD');
  await executeWrite(await b.context(), { kind: 'op', op: { op: 'issue.create', title: 'A' } });
  await push();
  const first = await cloneBacklog({
    homes: other.homes,
    env: other.env,
    url: b.remote as string,
    handle: 'spw',
  });
  const verified = (await readLocalState(first.root, 'verified')) as string;
  await git(['reset', '-q', '--hard', anchor], { cwd: b.root });
  await executeWrite(await b.context(), { kind: 'op', op: { op: 'issue.create', title: 'B' } });
  await git(['push', '-q', '-f', 'origin', 'main'], { cwd: b.root });

  const ctx = await resolveContext({
    cwd: await tempDir(),
    env: other.env,
    flags: { as: 'claude-1', backlog: 'acme' },
  });
  const err = await catchErrAsync(() => ensureWorkingCopy(ctx, 'claude-1'));
  expect(err.code).toBe('verify');
  expect(err.message).toBe(
    `${b.remote} ist kein Nachfahre des zuletzt verifizierten Stands ${verified.slice(0, 7)}`,
  );
  expect(await exists(managedClonePath(other.homes, 'acme', 'claude-1'))).toBe(false);
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('a remote whose HEAD is another branch is checked out on the sync branch', async () => {
  await git(['push', '-q', 'origin', 'main:side'], { cwd: b.root });
  await git(['symbolic-ref', 'HEAD', 'refs/heads/side'], { cwd: b.remote as string });
  const r = await cloneBacklog({
    homes: other.homes,
    env: other.env,
    url: b.remote as string,
    handle: 'spw',
  });
  const branch = await git(['symbolic-ref', '--short', 'HEAD'], { cwd: r.root });
  expect(branch.stdout.trim()).toBe('main');
});

test('a backlog removed while cloning is a conflict and leaves no directory', async () => {
  const err = await catchErrAsync(() =>
    cloneBacklog(
      { homes: other.homes, env: other.env, url: b.remote as string, handle: 'spw' },
      {
        beforeFinish: async () => {
          await unregisterBacklog(other.homes, 'acme');
        },
      },
    ),
  );
  expect(err.code).toBe('conflict');
  expect(err.message).toBe('Backlog acme wurde während des Klonens entfernt');
  expect(await exists(join(other.homes.backeHome, 'backlogs'))).toBe(false);
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('a clone onto an existing working copy takes that one', async () => {
  const first = await cloneBacklog({
    homes: other.homes,
    env: other.env,
    url: b.remote as string,
    handle: 'spw',
  });
  const head = await revParse(first.root, 'HEAD');
  await rawCommit(first.root, { files: { 'local.md': 'x\n' } });
  const second = await cloneBacklog({
    homes: other.homes,
    env: other.env,
    url: b.remote as string,
    handle: 'spw',
  });
  expect(second.root).toBe(first.root);
  expect(await revParse(second.root, 'HEAD')).not.toBe(head);
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('an existing working copy is returned without cloning', async () => {
  const ctx = await b.context();
  const offline = {
    ...ctx,
    userConfig: { ...ctx.userConfig, backlogs: { acme: { remote: '/does/not/exist.git' } } },
  };
  expect(await ensureWorkingCopy(offline, 'spw')).toEqual({ root: b.root, notices: [] });
});

test('a missing bound working copy is not_found with hint', async () => {
  const missing = join(await tempDir(), 'gone');
  await registerBacklog(b.homes, { name: 'acme', handle: 'claude-1', path: missing });
  const ctx = await b.context();
  const err = await catchErrAsync(() => ensureWorkingCopy(ctx, 'claude-1'));
  expect(err.code).toBe('not_found');
  expect(err.message).toBe(`Arbeitskopie ${missing} fehlt`);
  expect(err.hint).toBe(
    `backe backlog add acme <pfad> --as claude-1 oder paths.claude-1 in ${userConfigPath(b.homes.backeHome)} entfernen`,
  );
});

test('a backlog without remote or working copy has no clone source', async () => {
  const local = await testBacklog();
  const ctx = await local.context();
  const err = await catchErrAsync(() =>
    ensureWorkingCopy({ ...ctx, backlog: { ...ctx.backlog, root: undefined } }, 'claude-1'),
  );
  expect(err.code).toBe('not_found');
  expect(err.hint).toBe('backe backlog clone <url>');
  expect(await tempEntries(local.homes)).toEqual([]);
});

test('a remote without backlog is refused and leaves nothing', async () => {
  const empty = join(await tempDir(), 'empty.git');
  await git(['init', '--bare', '-q', '-b', 'main', empty], { cwd: dirname(empty) });
  const err = await catchErrAsync(() =>
    cloneBacklog({ homes: other.homes, env: other.env, url: empty, handle: 'spw' }),
  );
  expect(err.code).toBe('validation');
  expect(err.message).toBe(`${empty} ist kein Backlog: ${BACKLOG_CONFIG} fehlt`);
  expect(await readUserConfig(other.homes.backeHome)).toEqual({});
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('an invalid handle is a usage error before cloning', async () => {
  const err = await catchErrAsync(() =>
    cloneBacklog({ homes: other.homes, env: other.env, url: b.remote as string, handle: '../x' }),
  );
  expect(err.code).toBe('usage');
  expect(await exists(join(other.homes.backeHome, 'tmp'))).toBe(false);
});

test('a target that is no working copy of the backlog is a conflict', async () => {
  const target = managedClonePath(other.homes, 'acme', 'spw');
  await mkdir(join(target, '.backe'), { recursive: true });
  await writeFile(join(target, BACKLOG_CONFIG), '{ "name": "Kein Name" }\n');
  const err = await catchErrAsync(() =>
    cloneBacklog({ homes: other.homes, env: other.env, url: b.remote as string, handle: 'spw' }),
  );
  expect(err.code).toBe('conflict');
  expect(err.message).toBe(`${target} existiert, ist aber keine Arbeitskopie von acme`);
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('a history with two roots has no trust anchor', async () => {
  const head = await revParse(b.root, 'HEAD');
  const orphan = await rawCommit(b.root, { files: { 'x.md': 'x\n' }, parents: [] });
  await rawCommit(b.root, { files: {}, parents: [head, orphan] });
  await push();
  const err = await catchErrAsync(() =>
    cloneBacklog({ homes: other.homes, env: other.env, url: b.remote as string, handle: 'spw' }),
  );
  expect(err.code).toBe('verify');
  expect(err.message).toBe(`Historie von ${b.remote} hat 2 Wurzel-Commits, erwartet genau einen`);
  expect(await exists(join(other.homes.backeHome, 'backlogs'))).toBe(false);
});

test('in off mode an invalid commit is kept without notices', async () => {
  await setVerify('off');
  await unsigned({ 'notes.md': 'x\n' });
  await push();
  const r = await cloneBacklog({
    homes: other.homes,
    env: other.env,
    url: b.remote as string,
    handle: 'spw',
  });
  expect(r.notices).toEqual([]);
  expect(await readLocalState(r.root, 'verified')).toBeUndefined();
  expect(await readLocalState(r.root, 'anchor')).toBe(await readLocalState(b.root, 'anchor'));
});

test('a registered remote of another backlog is refused', async () => {
  const beta = await testBacklog({ remote: true, name: 'beta' });
  const ctx = await b.context();
  const wrong = {
    ...ctx,
    userConfig: { ...ctx.userConfig, backlogs: { acme: { remote: beta.remote as string } } },
  };
  const err = await catchErrAsync(() => ensureWorkingCopy(wrong, 'claude-1'));
  expect(err.code).toBe('validation');
  expect(err.message).toBe(`${beta.remote}: gehört zum Backlog "beta", erwartet wurde "acme"`);
  expect(await exists(managedClonePath(b.homes, 'acme', 'claude-1'))).toBe(false);
  expect(await tempEntries(b.homes)).toEqual([]);
});

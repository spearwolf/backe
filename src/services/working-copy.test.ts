import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { vi } from 'vitest';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import {
  rawCommit,
  revParse,
  type TestBacklog,
  testBacklog,
  testKey,
} from '../../test/helpers/git.ts';
import { type Env, type Homes, physicalPath, resolveHomes } from '../context/paths.ts';
import {
  managedClonePath,
  registerBacklog,
  setIdentity,
  unregisterBacklog,
} from '../context/registry.ts';
import { resolveContext } from '../context/resolve.ts';
import { readUserConfig, userConfigPath } from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import { git } from '../git/exec.ts';
import { clearLocalState, readLocalState, writeLocalState } from '../git/local-state.ts';
import { attachmentsDir, BACKLOG_CONFIG } from '../store/layout.ts';
import { createIssue } from './issues.ts';
import { verifyRange } from './verify.ts';
import {
  addBacklog,
  cloneBacklog,
  ensureWorkingCopy,
  removeBacklog,
  showBacklog,
} from './working-copy.ts';
import { executeWrite } from './write.ts';

const faults = vi.hoisted(() => ({ identity: false }));

vi.mock('../git/local-state.ts', async (original) => {
  const real = await original<typeof import('../git/local-state.ts')>();
  return {
    ...real,
    writeLocalState: (wc: string, name: Parameters<typeof real.writeLocalState>[1], v: string) => {
      if (faults.identity && name === 'identity') {
        return Promise.reject(new BackeError('unexpected', 'identity kaputt'));
      }
      return real.writeLocalState(wc, name, v);
    },
  };
});

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
  expect(err.message).toBe('Der Backlog heißt »acme«, nicht »other«');
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

describe('descent of a clone from a trusted copy with unpushed work', () => {
  /** Klon von spw, darauf ein lokaler, ungepushter und verifizierter Commit. */
  async function trustedWithUnpushed(): Promise<string> {
    await push();
    const first = await cloneBacklog({
      homes: other.homes,
      env: other.env,
      url: b.remote as string,
      handle: 'spw',
    });
    await rawCommit(first.root, {
      files: { 'notes.md': 'lokal\n' },
      key: b.key,
      actor: 'spw',
      op: 'manual',
    });
    await verifyRange(first.root, { record: true });
    expect(await readLocalState(first.root, 'verified')).toBe(await revParse(first.root, 'HEAD'));
    return first.root;
  }

  const agentContext = async () =>
    resolveContext({
      cwd: await tempDir(),
      env: other.env,
      flags: { as: 'claude-1', backlog: 'acme' },
    });

  test('clone checks descent against upstream of the trusted copy', async () => {
    const trusted = await trustedWithUnpushed();
    const upstream = await readLocalState(trusted, 'upstream');
    expect(upstream).toBe(await revParse(b.root, 'HEAD'));

    const { root } = await ensureWorkingCopy(await agentContext(), 'claude-1');

    expect(await revParse(root, 'HEAD')).toBe(upstream);
    expect(await readLocalState(root, 'verified')).toBe(upstream);
  });

  test('without upstream it checks against the merge base with the remote-tracking branch', async () => {
    const trusted = await trustedWithUnpushed();
    await clearLocalState(trusted, 'upstream');

    const { root } = await ensureWorkingCopy(await agentContext(), 'claude-1');

    expect(await revParse(root, 'HEAD')).toBe(await revParse(b.root, 'HEAD'));
  });

  test('a remote behind the upstream of the trusted copy is refused', async () => {
    const trusted = await trustedWithUnpushed();
    await executeWrite(await b.context(), { kind: 'op', op: { op: 'issue.create', title: 'B' } });
    await push();
    await git(['fetch', '-q', 'origin'], { cwd: trusted });
    const ahead = await revParse(b.root, 'HEAD');
    await writeLocalState(trusted, 'upstream', ahead);
    await git(['push', '-q', '-f', 'origin', 'HEAD~1:main'], { cwd: b.root });

    const err = await catchErrAsync(async () =>
      ensureWorkingCopy(await agentContext(), 'claude-1'),
    );

    expect(err.code).toBe('verify');
    expect(err.message).toBe(
      `${b.remote} ist kein Nachfahre des zuletzt verifizierten Stands ${ahead.slice(0, 7)}`,
    );
  });
});

test('clone writes upstream for a remote clone', async () => {
  await executeWrite(await b.context(), { kind: 'op', op: { op: 'issue.create', title: 'A' } });
  await push();

  const r = await cloneBacklog({
    homes: other.homes,
    env: other.env,
    url: b.remote as string,
    handle: 'spw',
  });

  expect(await readLocalState(r.root, 'upstream')).toBe(await revParse(b.root, 'HEAD'));
});

test('a clone from a working copy without remote goes through the local hub', async () => {
  const local = await testBacklog();
  const ctx = await local.context({ as: 'claude-1' });

  const { root } = await ensureWorkingCopy(ctx, 'claude-1');

  const head = await revParse(local.root, 'HEAD');
  expect(await revParse(root, 'HEAD')).toBe(head);
  expect(await readLocalState(root, 'upstream')).toBe(head);
  const hub = join(local.homes.backeHome, 'backlogs', 'acme', 'hub.git');
  expect((await git(['remote', 'get-url', 'origin'], { cwd: root })).stdout.trim()).toBe(hub);
});

test('an agent whose user is not pushed yet gets a sync hint', async () => {
  const claude = await testKey('claude-1');
  await executeWrite(await b.context(), {
    kind: 'op',
    op: {
      op: 'user.add',
      handle: 'claude-1',
      name: 'Claude',
      kind: 'agent',
      operator: 'spw',
      keys: [claude.line],
    },
  });
  await setIdentity(b.homes, 'acme', 'claude-1', claude.priv);
  const ctx = await b.context({ as: 'claude-1' });

  const err = await catchErrAsync(() => ensureWorkingCopy(ctx, 'claude-1'));

  expect(err).toMatchObject({
    code: 'sync',
    message: 'User claude-1 ist noch nicht gepusht',
    hint: 'backe sync --as spw',
  });
  expect(await exists(managedClonePath(b.homes, 'acme', 'claude-1'))).toBe(false);
  expect(await tempEntries(b.homes)).toEqual([]);
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

test('a remote whose .backe is a file is no backlog', async () => {
  const dir = await tempDir();
  const bare = join(dir, 'file.git');
  const work = join(dir, 'work');
  await git(['init', '--bare', '-q', '-b', 'main', bare], { cwd: dir });
  await git(['init', '-q', '-b', 'main', work], { cwd: dir });
  await writeFile(join(work, '.backe'), 'keine Config\n');
  await git(['add', '.backe'], { cwd: work });
  const ident = [
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@example.org',
    '-c',
    'commit.gpgsign=false',
  ];
  await git([...ident, 'commit', '-q', '-m', 'init'], { cwd: work });
  await git(['push', '-q', bare, 'main'], { cwd: work });
  const err = await catchErrAsync(() =>
    cloneBacklog({ homes: other.homes, env: other.env, url: bare, handle: 'spw' }),
  );
  expect(err.code).toBe('validation');
  expect(err.message).toBe(`${bare} ist kein Backlog: ${BACKLOG_CONFIG} fehlt`);
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('an invalid handle is a validation error before cloning', async () => {
  const err = await catchErrAsync(() =>
    cloneBacklog({ homes: other.homes, env: other.env, url: b.remote as string, handle: '../x' }),
  );
  expect(err.code).toBe('validation');
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
  expect(err.message).toBe(`${beta.remote}: gehört zum Backlog »beta«, erwartet wurde »acme«`);
  expect(await exists(managedClonePath(b.homes, 'acme', 'claude-1'))).toBe(false);
  expect(await tempEntries(b.homes)).toEqual([]);
});

/** Ein eigener Clone der Remote in einem frischen Verzeichnis, wie ihn ein Nutzer selbst anlegt. */
async function ownClone(): Promise<string> {
  const dir = join(await tempDir(), 'mine');
  await git(['clone', '-q', b.remote as string, dir], { cwd: dirname(dir) });
  return dir;
}

describe('the reference of a new clone', () => {
  const alternates = (root: string) => exists(join(root, '.git', 'objects', 'info', 'alternates'));

  test('a managed clone stays the reference', async () => {
    const ctx = await resolveContext({ cwd: b.root, env: b.env, flags: { as: 'claude-1' } });
    const { root } = await ensureWorkingCopy(ctx, 'claude-1');
    expect(await alternates(root)).toBe(true);
  });

  test('a bound clone of the user lends its objects only for the transfer', async () => {
    await push();
    const dir = await ownClone();
    await addBacklog({
      homes: other.homes,
      env: other.env,
      name: 'acme',
      path: dir,
      handle: 'spw',
    });
    const ctx = await resolveContext({ cwd: dir, env: other.env, flags: { as: 'claude-1' } });
    const { root } = await ensureWorkingCopy(ctx, 'claude-1');
    expect(root).toBe(managedClonePath(other.homes, 'acme', 'claude-1'));
    expect(await alternates(root)).toBe(false);
  });
});

test('add binds an existing clone, sets identity and anchor', async () => {
  const dir = await ownClone();
  const r = await addBacklog({
    homes: other.homes,
    env: other.env,
    name: 'acme',
    path: dir,
    handle: 'claude-1',
  });
  expect(r).toEqual({ root: await physicalPath(dir), notices: [] });
  expect(await readLocalState(dir, 'identity')).toBe('claude-1');
  expect(await readLocalState(dir, 'anchor')).toBe(await readLocalState(b.root, 'anchor'));
  expect(await readLocalState(dir, 'verified')).toBe(await revParse(dir, 'HEAD'));
  const entry = (await readUserConfig(other.homes.backeHome)).backlogs?.acme;
  expect(entry?.remote).toBe(b.remote);
  expect(entry?.paths).toEqual({ 'claude-1': await physicalPath(dir) });
});

describe('the upstream of a bound clone', () => {
  const addSpw = (dir: string) =>
    addBacklog({ homes: other.homes, env: other.env, name: 'acme', path: dir, handle: 'spw' });

  test('add writes upstream from the remote-tracking branch, not from unpushed work', async () => {
    await push();
    const dir = await ownClone();
    await rawCommit(dir, {
      files: { 'notes.md': 'lokal\n' },
      key: b.key,
      actor: 'spw',
      op: 'manual',
    });

    await addSpw(dir);

    expect(await readLocalState(dir, 'upstream')).toBe(await revParse(b.root, 'HEAD'));
    expect(await readLocalState(dir, 'verified')).toBe(await revParse(dir, 'HEAD'));
  });

  test('a tracking branch ahead of the unverified HEAD only counts up to HEAD', async () => {
    await push();
    const dir = await ownClone();
    const head = await revParse(dir, 'HEAD');
    await executeWrite(await b.context(), { kind: 'op', op: { op: 'issue.create', title: 'B' } });
    await push();
    await git(['fetch', '-q', 'origin'], { cwd: dir });

    await addSpw(dir);

    expect(await revParse(dir, 'refs/remotes/origin/main')).not.toBe(head);
    expect(await readLocalState(dir, 'upstream')).toBe(head);
  });

  test('an upstream written before is kept', async () => {
    await push();
    const dir = await ownClone();
    const anchor = (await readLocalState(b.root, 'anchor')) as string;
    await writeLocalState(dir, 'upstream', anchor);

    await addSpw(dir);

    expect(await readLocalState(dir, 'upstream')).toBe(anchor);
  });
});

test('add of a directory holding another backlog is a validation error', async () => {
  const beta = await testBacklog({ name: 'beta' });
  const err = await catchErrAsync(() =>
    addBacklog({
      homes: other.homes,
      env: other.env,
      name: 'acme',
      path: beta.root,
      handle: 'claude-1',
    }),
  );
  expect(err.code).toBe('validation');
  expect(err.message).toContain('beta');
  expect(err.message).toContain('acme');
});

test('add of a subdirectory of a clone is a validation error', async () => {
  const sub = join(await ownClone(), '.backe');
  const err = await catchErrAsync(() =>
    addBacklog({ homes: other.homes, env: other.env, name: 'acme', path: sub, handle: 'claude-1' }),
  );
  expect(err.code).toBe('validation');
});

test('add refuses a clone that belongs to another identity', async () => {
  const dir = await ownClone();
  await writeLocalState(dir, 'identity', 'spw');
  const err = await catchErrAsync(() =>
    addBacklog({
      homes: other.homes,
      env: other.env,
      name: 'acme',
      path: dir,
      handle: 'claude-1',
    }),
  );
  expect(err.code).toBe('usage');
  expect(err.message).toContain('gehört »spw«');
  expect(await readUserConfig(other.homes.backeHome)).toEqual({});
});

test('add reports the reasons of an invalid commit in warn mode', async () => {
  await setVerify('warn');
  await unsigned({ 'x.md': 'x\n' });
  await push();
  const dir = await ownClone();
  const r = await addBacklog({
    homes: other.homes,
    env: other.env,
    name: 'acme',
    path: dir,
    handle: 'claude-1',
  });
  expect(r.notices.length).toBeGreaterThan(0);
  expect(await exists(dir)).toBe(true);
});

test('binding a second path for the same handle is a conflict', async () => {
  const dir = await ownClone();
  await addBacklog({
    homes: other.homes,
    env: other.env,
    name: 'acme',
    path: dir,
    handle: 'claude-1',
  });
  const second = await catchErrAsync(() =>
    registerBacklog(other.homes, { name: 'acme', handle: 'claude-1', path: '/other' }),
  );
  expect(second.code).toBe('conflict');
  expect(second.hint).toContain(`paths.claude-1 in ${userConfigPath(other.homes.backeHome)}`);
  // derselbe Pfad ist kein Konflikt
  await registerBacklog(other.homes, {
    name: 'acme',
    handle: 'claude-1',
    path: await physicalPath(dir),
  });
});

test('remove --purge deletes the managed clones but never a bound path', async () => {
  const dir = await ownClone();
  await addBacklog({
    homes: b.homes,
    env: b.env,
    name: 'acme',
    path: dir,
    handle: 'claude-1',
  });
  const r = await removeBacklog({ homes: b.homes, name: 'acme', purge: true });
  expect(r.purged).toBe(join(b.homes.backeHome, 'backlogs', 'acme'));
  expect(await exists(b.root)).toBe(false);
  expect(await exists(join(dir, BACKLOG_CONFIG))).toBe(true);
  expect((await readUserConfig(b.homes.backeHome)).backlogs?.acme).toBeUndefined();
});

describe('purge keeps the only copy of unpushed work', () => {
  const managed = () => join(b.homes.backeHome, 'backlogs', 'acme');

  test('a managed clone with commits on no remote is refused, registration intact', async () => {
    await executeWrite(await b.context(), {
      kind: 'manual',
      subject: 'lokal',
      changes: [{ path: 'notes.txt', content: 'nur hier\n' }],
    });
    const err = await catchErrAsync(() =>
      removeBacklog({ homes: b.homes, name: 'acme', purge: true }),
    );
    expect(err).toMatchObject({
      code: 'conflict',
      message: `Der verwaltete Clone »${b.root}« enthält Commits, die auf keiner Remote liegen (Branches: »main«)`,
      hint: 'backe backlog remove acme --purge --force löscht trotzdem',
    });
    expect((await readUserConfig(b.homes.backeHome)).backlogs?.acme).toBeDefined();
    expect(await exists(join(b.root, BACKLOG_CONFIG))).toBe(true);
  });

  test('purge refuses unpushed commits on any local branch', async () => {
    await git(['switch', '-c', 'wip'], { cwd: b.root });
    await writeFile(join(b.root, 'wip.txt'), 'wip\n');
    await git(['add', 'wip.txt'], { cwd: b.root });
    await git(['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qm', 'nur auf wip'], {
      cwd: b.root,
    });
    await git(['switch', 'main'], { cwd: b.root });
    await push();
    const err = await catchErrAsync(() =>
      removeBacklog({ homes: b.homes, name: 'acme', purge: true }),
    );
    expect(err.code).toBe('conflict');
    expect(err.message).toContain('»wip«');
    expect(err.message).not.toContain('»main«');
    expect(await exists(join(b.root, BACKLOG_CONFIG))).toBe(true);
  });

  test('--force purges the unpushed clone anyway', async () => {
    await executeWrite(await b.context(), {
      kind: 'manual',
      subject: 'lokal',
      changes: [{ path: 'notes.txt', content: 'nur hier\n' }],
    });
    const r = await removeBacklog({ homes: b.homes, name: 'acme', purge: true, force: true });
    expect(r.purged).toBe(managed());
    expect(await exists(b.root)).toBe(false);
  });

  test('a managed clone whose commits are all pushed is purged', async () => {
    await executeWrite(await b.context(), {
      kind: 'manual',
      subject: 'gepusht',
      changes: [{ path: 'notes.txt', content: 'auch drüben\n' }],
    });
    await push();
    expect((await removeBacklog({ homes: b.homes, name: 'acme', purge: true })).purged).toBe(
      managed(),
    );
  });

  test('a managed clone without a remote is refused unless forced', async () => {
    const local = await testBacklog({ name: 'solo' });
    const err = await catchErrAsync(() =>
      removeBacklog({ homes: local.homes, name: 'solo', purge: true }),
    );
    expect(err).toMatchObject({
      code: 'conflict',
      message: `Der verwaltete Clone »${local.root}« hat keine Remote`,
      hint: 'backe backlog remove solo --purge --force löscht trotzdem',
    });
    expect((await readUserConfig(local.homes.backeHome)).backlogs?.solo).toBeDefined();
    const r = await removeBacklog({ homes: local.homes, name: 'solo', purge: true, force: true });
    expect(r.purged).toBe(join(local.homes.backeHome, 'backlogs', 'solo'));
  });

  test('a stray directory or file that is no clone does not block the purge', async () => {
    await mkdir(join(managed(), 'leftover'), { recursive: true });
    await writeFile(join(managed(), 'note.txt'), 'x');
    expect((await removeBacklog({ homes: b.homes, name: 'acme', purge: true })).purged).toBe(
      managed(),
    );
  });

  test('a repo without backlog config is checked on all branches', async () => {
    const stray = join(managed(), 'stray');
    await git(['clone', '-q', b.remote as string, stray], { cwd: managed() });
    await rm(join(stray, BACKLOG_CONFIG));
    await git(['-c', 'user.name=t', '-c', 'user.email=t@x', 'commit', '-qam', 'weg'], {
      cwd: stray,
    });
    const err = await catchErrAsync(() =>
      removeBacklog({ homes: b.homes, name: 'acme', purge: true }),
    );
    expect(err.message).toBe(
      `Der verwaltete Clone »${await physicalPath(stray)}« enthält Commits, die auf keiner Remote liegen (Branches: »main«)`,
    );
  });
});

test('remove without --purge deletes nothing', async () => {
  const r = await removeBacklog({ homes: b.homes, name: 'acme' });
  expect(r.purged).toBeUndefined();
  expect(await exists(join(b.root, BACKLOG_CONFIG))).toBe(true);
  expect((await catchErrAsync(() => removeBacklog({ homes: b.homes, name: 'acme' }))).code).toBe(
    'not_found',
  );
});

test('purge of a backlog registered again meanwhile is a conflict', async () => {
  const err = await catchErrAsync(() =>
    removeBacklog(
      { homes: b.homes, name: 'acme', purge: true },
      { beforePurge: async () => void (await registerBacklog(b.homes, { name: 'acme' })) },
    ),
  );
  expect(err.code).toBe('conflict');
  expect(await exists(join(b.root, BACKLOG_CONFIG))).toBe(true);
});

test('show lists managed and bound working copies with identity and anchor', async () => {
  const dir = await ownClone();
  await addBacklog({
    homes: b.homes,
    env: b.env,
    name: 'acme',
    path: dir,
    handle: 'claude-1',
  });
  const cfg = await readUserConfig(b.homes.backeHome);
  const r = await showBacklog(b.homes, cfg, 'acme');
  expect(r.entry.name).toBe('acme');
  const anchor = await readLocalState(b.root, 'anchor');
  expect(r.workingCopies).toEqual([
    {
      handle: 'claude-1',
      path: await physicalPath(dir),
      managed: false,
      exists: true,
      identity: 'claude-1',
      anchor,
    },
    { handle: 'spw', path: b.root, managed: true, exists: true, identity: 'spw', anchor },
  ]);
  expect((await catchErrAsync(() => showBacklog(b.homes, cfg, 'nope'))).code).toBe('not_found');
});

test('show marks a bound path without clone as missing', async () => {
  const gone = join(await tempDir(), 'gone');
  await registerBacklog(b.homes, { name: 'acme', handle: 'claude-1', path: gone });
  const r = await showBacklog(b.homes, await readUserConfig(b.homes.backeHome), 'acme');
  expect(r.workingCopies[0]).toEqual({
    handle: 'claude-1',
    path: gone,
    managed: false,
    exists: false,
  });
});

test('add of a plain directory is a validation error', async () => {
  const err = await catchErrAsync(async () =>
    addBacklog({
      homes: other.homes,
      env: other.env,
      name: 'acme',
      path: await tempDir(),
      handle: 'claude-1',
    }),
  );
  expect(err.code).toBe('validation');
  expect(err.message).toContain('keines');
});

test('add of a clone without the sync remote registers no remote', async () => {
  const dir = await ownClone();
  await git(['remote', 'remove', 'origin'], { cwd: dir });
  await addBacklog({
    homes: other.homes,
    env: other.env,
    name: 'acme',
    path: dir,
    handle: 'claude-1',
  });
  expect((await readUserConfig(other.homes.backeHome)).backlogs?.acme?.remote).toBeUndefined();
  expect(await readLocalState(dir, 'upstream')).toBeUndefined();
});

test('show treats a file in place of the clone directory as no managed clones', async () => {
  await registerBacklog(other.homes, { name: 'zed' });
  await mkdir(other.homes.backeHome, { recursive: true });
  await writeFile(join(other.homes.backeHome, 'backlogs'), 'kein Verzeichnis\n');
  const shown = await showBacklog(other.homes, await readUserConfig(other.homes.backeHome), 'zed');
  expect(shown.workingCopies).toEqual([]);
});

test('purge and show of a backlog without managed clones', async () => {
  await registerBacklog(other.homes, { name: 'zed' });
  await setIdentity(other.homes, 'zed', 'spw', '/key');
  const cfg = await readUserConfig(other.homes.backeHome);
  const shown = await showBacklog(other.homes, cfg, 'zed');
  expect(shown.workingCopies).toEqual([
    {
      handle: 'spw',
      path: managedClonePath(other.homes, 'zed', 'spw'),
      managed: true,
      exists: false,
    },
  ]);
  expect(await removeBacklog({ homes: other.homes, name: 'zed', purge: true })).toEqual({
    purged: undefined,
  });
});

test('add of a relative path is a usage error and writes nothing', async () => {
  const err = await catchErrAsync(() =>
    addBacklog({
      homes: other.homes,
      env: other.env,
      name: 'acme',
      path: 'relative/clone',
      handle: 'claude-1',
    }),
  );
  expect(err.code).toBe('usage');
  expect(err.message).toBe('Pfad muss absolut sein: relative/clone');
  expect(await readUserConfig(other.homes.backeHome)).toEqual({});
});

test('purge refuses a bound clone inside the managed directory', async () => {
  const dir = join(b.homes.backeHome, 'backlogs', 'acme', 'elsewhere');
  await git(['clone', '-q', b.remote as string, dir], { cwd: b.homes.backeHome });
  await addBacklog({ homes: b.homes, env: b.env, name: 'acme', path: dir, handle: 'claude-1' });
  const err = await catchErrAsync(() =>
    removeBacklog({ homes: b.homes, name: 'acme', purge: true }),
  );
  expect(err.code).toBe('conflict');
  expect(err.message).toContain('ist gebunden und liegt im verwalteten Verzeichnis');
  expect((await readUserConfig(b.homes.backeHome)).backlogs?.acme).toBeDefined();
  expect(await exists(join(dir, BACKLOG_CONFIG))).toBe(true);
  expect(await exists(join(b.root, BACKLOG_CONFIG))).toBe(true);
});

test('purge refuses a bound clone that is the managed directory itself', async () => {
  await push();
  const dir = join(other.homes.backeHome, 'backlogs', 'acme');
  await mkdir(dirname(dir), { recursive: true });
  await git(['clone', '-q', b.remote as string, dir], { cwd: dirname(dir) });
  await addBacklog({ homes: other.homes, env: other.env, name: 'acme', path: dir, handle: 'spw' });
  const err = await catchErrAsync(() =>
    removeBacklog({ homes: other.homes, name: 'acme', purge: true }),
  );
  expect(err.code).toBe('conflict');
  expect(await exists(join(dir, BACKLOG_CONFIG))).toBe(true);
});

test('cloning a newer format succeeds with a read-only notice', async () => {
  const config = await readFile(join(b.root, BACKLOG_CONFIG), 'utf8');
  await rawCommit(b.root, {
    files: { [BACKLOG_CONFIG]: config.replace(/"version":\s*1/, '"version": 2') },
    key: b.key,
    actor: 'spw',
    op: 'manual',
  });
  await push();
  const r = await cloneBacklog({
    homes: other.homes,
    env: other.env,
    url: b.remote as string,
    handle: 'spw',
  });
  expect(r.notices).toEqual(['Backlog-Format 2 ist neuer als dieses backe (1); nur lesen']);
  expect(await exists(join(r.root, BACKLOG_CONFIG))).toBe(true);
});

test('a failed final move leaves no registration behind', async () => {
  const target = managedClonePath(other.homes, 'acme', 'spw');
  const err = await catchErrAsync(() =>
    cloneBacklog(
      { homes: other.homes, env: other.env, url: b.remote as string, handle: 'spw' },
      {
        beforeFinish: async () => {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, 'x');
        },
      },
    ),
  );
  expect(err.code).toBe('conflict');
  expect((await readUserConfig(other.homes.backeHome)).backlogs?.acme).toBeUndefined();
  expect(await tempEntries(other.homes)).toEqual([]);
});

test('a failed final move keeps a registration that existed before the call', async () => {
  await cloneBacklog({
    homes: other.homes,
    env: other.env,
    url: b.remote as string,
    handle: 'spw',
  });
  const target = managedClonePath(other.homes, 'acme', 'claude-1');
  const err = await catchErrAsync(() =>
    cloneBacklog(
      { homes: other.homes, env: other.env, url: b.remote as string, handle: 'claude-1' },
      {
        beforeFinish: async () => {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, 'x');
        },
      },
    ),
  );
  expect(err.code).toBe('conflict');
  expect((await readUserConfig(other.homes.backeHome)).backlogs?.acme?.remote).toBe(b.remote);
});

test('addBacklog writes nothing when verify fails', async () => {
  await push();
  const dir = await ownClone();
  await rawCommit(dir, {
    files: { 'notes.md': 'x\n' },
    key: await testKey('mallory'),
    actor: 'spw',
    op: 'manual',
  });
  const err = await catchErrAsync(() =>
    addBacklog({ homes: other.homes, env: other.env, name: 'acme', path: dir, handle: 'spw' }),
  );
  expect(err.code).toBe('verify');
  expect(await readUserConfig(other.homes.backeHome)).toEqual({});
  expect(await readLocalState(dir, 'identity')).toBeUndefined();
  expect(await readLocalState(dir, 'anchor')).toBeUndefined();
  expect(await readLocalState(dir, 'upstream')).toBeUndefined();
});

test('a failed verify keeps the anchor and upstream that were already there', async () => {
  await push();
  const dir = await ownClone();
  const known = (await readLocalState(b.root, 'anchor')) as string;
  await writeLocalState(dir, 'anchor', known);
  await writeLocalState(dir, 'upstream', known);
  await rawCommit(dir, {
    files: { 'notes.md': 'x\n' },
    key: await testKey('mallory'),
    actor: 'spw',
    op: 'manual',
  });
  const err = await catchErrAsync(() =>
    addBacklog({ homes: other.homes, env: other.env, name: 'acme', path: dir, handle: 'spw' }),
  );
  expect(err.code).toBe('verify');
  expect(await readLocalState(dir, 'anchor')).toBe(known);
  expect(await readLocalState(dir, 'upstream')).toBe(known);
  expect(await readLocalState(dir, 'identity')).toBeUndefined();
});

describe('a failing identity write takes back what add registered', () => {
  const addSpw = (dir: string) =>
    addBacklog({ homes: other.homes, env: other.env, name: 'acme', path: dir, handle: 'spw' });

  beforeEach(() => {
    faults.identity = true;
  });
  afterEach(() => {
    faults.identity = false;
  });

  test('a fresh backlog is unregistered and the anchor removed', async () => {
    await push();
    const dir = await ownClone();
    const err = await catchErrAsync(() => addSpw(dir));
    expect(err.message).toBe('identity kaputt');
    expect((await readUserConfig(other.homes.backeHome)).backlogs?.acme).toBeUndefined();
    expect(await readLocalState(dir, 'anchor')).toBeUndefined();
    expect(await readLocalState(dir, 'upstream')).toBeUndefined();
  });

  test('an already registered backlog loses only the new binding and remote', async () => {
    await push();
    await registerBacklog(other.homes, { name: 'acme' });
    const dir = await ownClone();
    await catchErrAsync(() => addSpw(dir));
    const entry = (await readUserConfig(other.homes.backeHome)).backlogs?.acme;
    expect(entry).toBeDefined();
    expect(entry?.remote).toBeUndefined();
    expect(entry?.paths ?? {}).toEqual({});
  });
});

const lfsInstalled = await git(['lfs', 'version'], { cwd: '/' }).then(
  () => true,
  () => false,
);

/** spw schaltet attachments.lfs an und legt ein Issue mit Anhang an; liefert dessen ID. */
async function lfsAttachment(): Promise<string> {
  const ctx = await b.context();
  const config = await readFile(join(b.root, BACKLOG_CONFIG), 'utf8');
  await executeWrite(ctx, {
    kind: 'manual',
    subject: 'lfs an',
    changes: [
      {
        path: BACKLOG_CONFIG,
        content: config.replace(/\n}\n$/, ',\n  "attachments": { "lfs": true }\n}\n'),
      },
    ],
  });
  const id = (await createIssue(ctx, { title: 'Mit Anhang' })).id as string;
  await executeWrite(ctx, {
    kind: 'op',
    op: { op: 'attach.add', id, name: 'log', file: 'log.txt', content: Buffer.from('Bytes\n') },
  });
  return id;
}

const cloneOther = () =>
  cloneBacklog({ homes: other.homes, env: other.env, url: b.remote as string, handle: 'spw' });

test.skipIf(!lfsInstalled)(
  'a clone with attachments.lfs pulls the attachment content',
  async () => {
    const id = await lfsAttachment();
    await git(['lfs', 'push', 'origin', 'main'], { cwd: b.root });
    await push();

    const r = await cloneOther();

    expect(r.notices).toEqual([]);
    expect(await readFile(join(r.root, attachmentsDir(id), 'log.txt'), 'utf8')).toBe('Bytes\n');
  },
);

/** Was `git lfs install` global einträgt: Ein Checkout lädt LFS-Objekte dann selbst herunter. */
const GLOBAL_LFS_FILTER =
  '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\tsmudge = git-lfs smudge -- %f\n' +
  '\tprocess = git-lfs filter-process\n\trequired = true\n';

describe.skipIf(!lfsInstalled)('a clone whose lfs objects are missing on the remote', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test.each([false, true])('still lands with a notice (global lfs filter: %s)', async (global) => {
    const id = await lfsAttachment();
    // Ohne pre-push-Hook kommt der Commit an, das LFS-Objekt nicht.
    await git(['push', '-q', '--no-verify', 'origin', 'main'], { cwd: b.root });
    if (global) {
      const file = join(await tempDir(), 'gitconfig');
      await writeFile(file, GLOBAL_LFS_FILTER);
      vi.stubEnv('GIT_CONFIG_GLOBAL', file);
    }

    const r = await cloneOther();

    expect(r.notices).toEqual([expect.stringMatching(/^git lfs pull fehlgeschlagen: \S/)]);
    expect(await readFile(join(r.root, attachmentsDir(id), 'log.txt'), 'utf8')).toMatch(
      /^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/,
    );
    expect(await readLocalState(r.root, 'identity')).toBe('spw');
  });
});

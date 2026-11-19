import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import { BackeError } from '../core/errors.ts';
import { git } from '../git/exec.ts';
import { LFS_RULE } from '../store/layout.ts';
import { type DoctorCheck, type DoctorDeps, doctorFailure, runDoctor } from './doctor.ts';
import { createIssue } from './issues.ts';

type Tool = 'git' | 'ssh-keygen' | 'git-lfs' | 'gh';

/** Fake für `DoctorDeps.run`: je Werkzeug seine Version oder `'missing'`. */
function fakeRun(over: Partial<Record<Tool, string>> = {}): NonNullable<DoctorDeps['run']> {
  const tools: Record<Tool, string> = {
    git: 'git version 2.56.1',
    'ssh-keygen': '',
    'git-lfs': 'git-lfs/3.8.1',
    gh: 'gh version 2.60.0',
    ...over,
  };
  return async (cmd, args) => {
    const tool: Tool = cmd === 'git' && args[0] === 'lfs' ? 'git-lfs' : (cmd as Tool);
    const out = tools[tool];
    return out === 'missing' ? 'missing' : { code: 0, stdout: out };
  };
}

const HOST = 'testhost';
const deps = (over: DoctorDeps = {}): DoctorDeps => ({
  run: fakeRun(),
  host: HOST,
  isAlive: () => false,
  ...over,
});

let b: TestBacklog;

beforeEach(async () => {
  b = await testBacklog();
});

async function input(extra: { fix?: boolean; noCtx?: boolean; contextError?: string } = {}) {
  return {
    env: b.env,
    cwd: b.root,
    ...(extra.noCtx ? {} : { ctx: await b.context() }),
    ...(extra.fix === undefined ? {} : { fix: extra.fix }),
    ...(extra.contextError === undefined ? {} : { contextError: extra.contextError }),
  };
}

const find = (checks: DoctorCheck[], id: string): DoctorCheck[] =>
  checks.filter((c) => c.id === id);
const one = (checks: DoctorCheck[], id: string): DoctorCheck => {
  const found = find(checks, id);
  expect(found).toHaveLength(1);
  return found[0] as DoctorCheck;
};

async function setLfs(lfs: boolean): Promise<void> {
  const file = join(b.root, '.backe/backlog.jsonc');
  const cfg = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  cfg.attachments = { max_bytes: 10485760, lfs };
  await writeFile(file, JSON.stringify(cfg));
}

async function ago(path: string, ms: number): Promise<void> {
  const when = new Date(Date.now() - ms);
  await utimes(path, when, when);
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

describe('runDoctor', () => {
  test('a healthy setup reports ok for every required check', async () => {
    const checks = await runDoctor(await input(), deps());
    expect(checks.map((c) => c.id)).toEqual([
      'node',
      'git',
      'ssh-keygen',
      'git-lfs',
      'gh',
      'user-config',
      'backlog',
      'identity',
      'lfs-rule',
      'bindings',
      'alternates',
      'temp',
      'problems',
      'references',
    ]);
    expect(checks.filter((c) => c.status !== 'ok')).toEqual([]);
  });

  test('the default run finds the real git', async () => {
    const checks = await runDoctor(await input());
    expect(one(checks, 'git').status).toBe('ok');
    expect(one(checks, 'ssh-keygen').status).toBe('ok');
  });

  test('an Apple git version string is accepted', async () => {
    const run = fakeRun({ git: 'git version 2.39.5 (Apple Git-154)' });
    expect(one(await runDoctor(await input(), deps({ run })), 'git').status).toBe('ok');
  });

  test('node older than 26 fails', async () => {
    const checks = await runDoctor(await input(), deps({ nodeVersion: '24.1.0' }));
    expect(one(checks, 'node')).toMatchObject({ status: 'fail' });
  });

  test('git older than 2.38 fails', async () => {
    const checks = await runDoctor(
      await input(),
      deps({ run: fakeRun({ git: 'git version 2.37.1' }) }),
    );
    expect(one(checks, 'git')).toMatchObject({ status: 'fail', hint: 'Git ≥ 2.38 installieren' });
  });

  test('missing or unreadable git and ssh-keygen fail', async () => {
    const checks = await runDoctor(
      await input(),
      deps({ run: fakeRun({ git: 'missing', 'ssh-keygen': 'missing' }) }),
    );
    expect(one(checks, 'git').status).toBe('fail');
    expect(one(checks, 'ssh-keygen').status).toBe('fail');
    const odd = await runDoctor(await input(), deps({ run: fakeRun({ git: 'huh' }) }));
    expect(one(odd, 'git').status).toBe('fail');
  });

  test('missing git-lfs fails only when the backlog uses lfs', async () => {
    const run = fakeRun({ 'git-lfs': 'missing', gh: 'missing' });
    let checks = await runDoctor(await input(), deps({ run }));
    expect(one(checks, 'git-lfs')).toMatchObject({ status: 'warn' });
    expect(one(checks, 'git-lfs').detail).toContain('optional');
    expect(one(checks, 'gh').detail).toContain('repo check --remote');
    await setLfs(true);
    checks = await runDoctor(await input(), deps({ run }));
    expect(one(checks, 'git-lfs').status).toBe('fail');
  });

  test('an invalid user config fails', async () => {
    await mkdir(b.homes.backeHome, { recursive: true });
    await writeFile(join(b.homes.backeHome, 'config.jsonc'), '{"current": 3}');
    const checks = await runDoctor({ env: b.env, cwd: b.root }, deps());
    expect(one(checks, 'user-config')).toMatchObject({
      status: 'fail',
      hint: 'backe config edit',
    });
    expect(one(checks, 'bindings').status).toBe('warn');
  });

  test('doctor without a backlog still checks the environment', async () => {
    const checks = await runDoctor(
      await input({ noCtx: true, contextError: 'Kein Backlog aufgelöst' }),
      deps(),
    );
    expect(one(checks, 'backlog')).toMatchObject({
      status: 'warn',
      detail: 'Kein Backlog aufgelöst',
    });
    expect(one(checks, 'git').status).toBe('ok');
    expect(find(checks, 'identity')).toEqual([]);
    expect(find(checks, 'references')).toEqual([]);
    const plain = await runDoctor(await input({ noCtx: true }), deps());
    expect(one(plain, 'backlog').status).toBe('warn');
  });

  test('a missing working copy, a wrong branch, a rebase and a journal fail the backlog check', async () => {
    const ctx = await b.context();
    const missing = await runDoctor(
      { env: b.env, cwd: b.root, ctx: { ...ctx, backlog: { ...ctx.backlog, root: undefined } } },
      deps(),
    );
    expect(one(missing, 'backlog').status).toBe('fail');

    await writeFile(join(b.root, '.git/backe/write.journal'), '{}\n');
    let checks = await runDoctor(await input(), deps());
    expect(one(checks, 'backlog').detail).toContain('write.journal');
    await rm(join(b.root, '.git/backe/write.journal'));

    await mkdir(join(b.root, '.git/rebase-merge'));
    checks = await runDoctor(await input(), deps());
    expect(one(checks, 'backlog').detail).toContain('rebase');
    await rm(join(b.root, '.git/rebase-merge'), { recursive: true });

    await git(['switch', '-q', '-c', 'other'], { cwd: b.root });
    checks = await runDoctor(await input(), deps());
    expect(one(checks, 'backlog')).toMatchObject({ status: 'fail' });
    expect(one(checks, 'backlog').detail).toContain('other');
  });

  test('identity: unreadable key, key not in the snapshot and a foreign identity file', async () => {
    const ctx = await b.context();
    const noKey = { ...ctx, user: { ...ctx.user, key: join(b.homes.backeHome, 'nope') } };
    let checks = await runDoctor({ env: b.env, cwd: b.root, ctx: noKey }, deps());
    expect(one(checks, 'identity').status).toBe('fail');

    const other = await testBacklog({ handle: 'zed' });
    const wrongKey = { ...ctx, user: { ...ctx.user, key: other.key.priv } };
    checks = await runDoctor({ env: b.env, cwd: b.root, ctx: wrongKey }, deps());
    expect(one(checks, 'identity').detail).toContain('Snapshot');

    await writeFile(join(b.root, '.git/backe/identity'), 'zed\n');
    checks = await runDoctor(await input(), deps());
    expect(one(checks, 'identity')).toMatchObject({ status: 'fail' });
    expect(one(checks, 'identity').detail).toContain('zed');

    const noUser = { ...ctx, user: { ...ctx.user, value: undefined, key: undefined } };
    checks = await runDoctor({ env: b.env, cwd: b.root, ctx: noUser }, deps());
    expect(one(checks, 'identity').status).toBe('warn');
  });

  test('lfs-rule warns about a missing rule and a missing local filter', async () => {
    await setLfs(true);
    let checks = await runDoctor(await input(), deps());
    expect(one(checks, 'lfs-rule')).toMatchObject({
      status: 'warn',
      hint: 'kommt mit dem nächsten attach add',
    });
    await writeFile(join(b.root, '.gitattributes'), `${LFS_RULE}\n`);
    checks = await runDoctor(await input(), deps());
    expect(one(checks, 'lfs-rule')).toMatchObject({
      status: 'warn',
      hint: 'wird beim nächsten Write eingerichtet',
    });
    await git(['config', '--local', 'filter.lfs.process', 'git-lfs filter-process'], {
      cwd: b.root,
    });
    checks = await runDoctor(await input(), deps());
    expect(one(checks, 'lfs-rule').status).toBe('ok');
    expect(
      await git(['config', '--global', '--get', 'filter.lfs.process'], {
        cwd: b.root,
        okExitCodes: [1],
      }).then((r) => r.exitCode),
    ).toBe(1);
  });

  test('a failing local git config read warns instead of aborting', async () => {
    await setLfs(true);
    await writeFile(join(b.root, '.gitattributes'), `${LFS_RULE}\n`);
    const start = await input();
    await writeFile(join(b.root, '.git/config'), '[broken\n');
    const checks = await runDoctor(start, deps());
    expect(one(checks, 'lfs-rule').status).toBe('warn');
  });

  test('missing bound paths warn', async () => {
    const gone = join(await tempDir(), 'gone');
    await mkdir(b.homes.backeHome, { recursive: true });
    await writeFile(
      join(b.homes.backeHome, 'config.jsonc'),
      JSON.stringify({
        current: 'acme',
        backlogs: { acme: { paths: { spw: b.root, bob: gone, amy: '/nonexistent/amy' } } },
        identities: { acme: { spw: { key: b.key.priv } } },
      }),
    );
    const checks = await runDoctor(await input(), deps());
    const bindings = find(checks, 'bindings');
    expect(bindings.map((c) => c.status)).toEqual(['warn', 'warn']);
    expect(bindings[0]?.detail).toContain('/nonexistent/amy');
    expect(bindings[0]?.hint).toBe('backe backlog remove acme oder backe backlog add');
  });

  test('broken alternates fail', async () => {
    const dir = await tempDir();
    const src = join(dir, 'src');
    await git(['init', '-q', '-b', 'main', src], { cwd: dir });
    await git(
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i'],
      { cwd: src },
    );
    const clone = join(b.homes.backeHome, 'backlogs', 'acme', 'bob');
    await git(['clone', '-q', '--reference', src, src, clone], { cwd: dir });
    expect(one(await runDoctor(await input(), deps()), 'alternates').status).toBe('ok');
    await rm(src, { recursive: true });
    const alt = one(await runDoctor(await input(), deps()), 'alternates');
    expect(alt.status).toBe('fail');
    expect(alt.hint).toBe(
      `git -C ${clone} repack -a -d && rm ${join(clone, '.git/objects/info/alternates')}`,
    );
  });

  test('relative alternates resolve against the objects directory, as git does', async () => {
    const dir = await tempDir();
    const src = join(dir, 'src');
    await git(['init', '-q', '-b', 'main', src], { cwd: dir });
    await git(
      ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'i'],
      { cwd: src },
    );
    const clone = join(b.homes.backeHome, 'backlogs', 'acme', 'bob');
    await git(['clone', '-q', '--reference', src, src, clone], { cwd: dir });
    const objects = join(clone, '.git', 'objects');
    const rel = relative(objects, join(src, '.git', 'objects'));
    await writeFile(join(objects, 'info', 'alternates'), `${rel}\n`);
    expect(await git(['cat-file', '-e', 'HEAD'], { cwd: clone })).toMatchObject({ exitCode: 0 });
    expect(one(await runDoctor(await input(), deps()), 'alternates').status).toBe('ok');
  });

  test('leftover temp files are reported and removed with fix', async () => {
    const tmp = join(b.homes.backeHome, 'tmp');
    await mkdir(join(tmp, 'clone-abc'), { recursive: true });
    await writeFile(join(tmp, 'clone-abc', 'f'), 'x');
    await ago(join(tmp, 'clone-abc'), 2 * 3_600_000);
    await mkdir(join(tmp, 'clone-new'), { recursive: true });
    const lock = `${join(b.root, '.git/backe/write.lock')}.99999.${randomBytes(6).toString('hex')}`;
    await writeFile(lock, `99999\n${new Date().toISOString()}\n${HOST}\n`);
    const foreign = `${join(b.root, '.git/backe/write.lock')}.99998.${randomBytes(6).toString('hex')}`;
    await writeFile(foreign, `99998\n${new Date().toISOString()}\nother\n`);
    const alive = `${join(b.homes.backeHome, 'config.lock')}.99997.${randomBytes(6).toString('hex')}`;
    await writeFile(alive, `99997\n${new Date().toISOString()}\n${HOST}\n`);
    const bare = [join(b.root, '.git/backe/write.lock'), join(b.homes.backeHome, 'config.lock')];
    for (const file of bare) await writeFile(file, `99999\n${new Date().toISOString()}\n${HOST}\n`);
    const live = deps({ isAlive: (pid) => pid === 99997 });

    let checks = await runDoctor(await input(), live);
    expect(one(checks, 'temp')).toMatchObject({ status: 'warn', detail: '2 Temp-Reste' });
    expect(await exists(lock)).toBe(true);

    checks = await runDoctor(await input({ fix: true }), live);
    expect(one(checks, 'temp')).toMatchObject({ status: 'ok', detail: '2 entfernt' });
    expect(await exists(join(tmp, 'clone-abc'))).toBe(false);
    expect(await exists(lock)).toBe(false);
    expect(await exists(join(tmp, 'clone-new'))).toBe(true);
    expect(await exists(foreign)).toBe(true);
    expect(await exists(alive)).toBe(true);
    for (const file of bare) expect(await exists(file)).toBe(true);
    expect(one(await runDoctor(await input(), live), 'temp').status).toBe('ok');
  });

  test('problems warn per file', async () => {
    await mkdir(join(b.root, 'projects'), { recursive: true });
    await writeFile(join(b.root, 'projects', 'bad.md'), '---\ntitle: [\n---\n');
    const found = find(await runDoctor(await input(), deps()), 'problems');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ status: 'warn' });
    expect(found[0]?.detail).toContain('projects/bad.md');
  });

  test('dangling assignee and lead warn after a hand edit', async () => {
    const issue = await createIssue(await b.context(), { title: 'x' });
    const id = issue.id as string;
    const file = join(b.root, `issues/${id.slice(3, 5)}/${id}/issue.md`);
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('---\n', '---\nassignee: ghost\n'));
    await mkdir(join(b.root, 'projects'), { recursive: true });
    await writeFile(join(b.root, 'projects', 'web.md'), '---\ntitle: Web\nlead: ghost\n---\n');
    const refs = find(await runDoctor(await input(), deps()), 'references');
    expect(refs.map((c) => c.detail)).toEqual([`${id} assignee ghost`, 'web lead ghost']);
    expect(refs[0]?.hint).toBe(`backe issue assign ${id} none`);
    expect(refs[1]?.hint).toBe('lead in projects/web.md entfernen oder den User anlegen');
  });
});

describe('doctorFailure', () => {
  const mk = (status: DoctorCheck['status']): DoctorCheck => ({ id: 'x', status, detail: '' });
  test('counts fails', () => {
    const err = doctorFailure([mk('fail'), mk('warn'), mk('fail')]);
    expect(err).toBeInstanceOf(BackeError);
    expect(err?.code).toBe('validation');
    expect(err?.message).toBe('doctor: 2 Prüfung(en) fehlgeschlagen');
  });
  test('no fails, no error', () => {
    expect(doctorFailure([mk('ok'), mk('warn')])).toBeUndefined();
  });
});

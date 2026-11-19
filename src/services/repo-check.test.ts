import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { normalizeRepoUrl } from '../core/url.ts';
import { git } from '../git/exec.ts';
import { issueFile } from '../store/layout.ts';
import { createIssue, linkIssue } from './issues.ts';
import {
  checkRepos,
  type RepoCheck,
  type RepoCheckDeps,
  repoCheckCachePath,
  repoCheckExit,
} from './repo-check.ts';
import { addRepo } from './repos.ts';

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@example.org', '-c', 'commit.gpgsign=false'];

/** Bare-Repo mit Branch main und Tag v1. */
async function bareWithRefs(): Promise<string> {
  const dir = await tempDir();
  const bare = join(dir, 'webapp.git');
  const work = join(dir, 'work');
  await git(['init', '--bare', '-q', '-b', 'main', bare], { cwd: dir });
  await git(['init', '-q', '-b', 'main', work], { cwd: dir });
  await git([...IDENT, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: work });
  await git(['tag', 'v1'], { cwd: work });
  await git(['push', '-q', bare, 'main', 'v1'], { cwd: work });
  return bare;
}

const neverCalled = (): never => {
  throw new Error('must not be called');
};

let b: TestBacklog;
let ctx: ResolvedContext;
let bare: string;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
  bare = await bareWithRefs();
  await addRepo(ctx, { url: bare, name: 'webapp', defaultRef: 'main' });
  await addRepo(ctx, { url: join(await tempDir(), 'missing', 'gone.git'), name: 'gone' });
  await addRepo(ctx, { url: 'https://github.com/acme/tool', name: 'gh' });
  for (const ref of ['webapp@feat/x', 'webapp@v1', 'webapp@4e1f9c2']) {
    const issue = await createIssue(ctx, { title: ref });
    await linkIssue(ctx, issue.id as string, ref);
  }
});

const byName = (checks: RepoCheck[], name: string): RepoCheck => {
  const found = checks.find((c) => c.name === name);
  if (found === undefined) throw new Error(`no check for ${name}`);
  return found;
};

describe('checkRepos', () => {
  test('local checks need no network', async () => {
    const checks = await checkRepos(ctx, {}, { lsRemote: neverCalled, github: neverCalled });
    expect(checks.map((c) => c.name)).toEqual(['gh', 'gone', 'webapp']);
    expect(checks.every((c) => c.findings.length === 0)).toBe(true);
    expect(byName(checks, 'gh').canonical).toBe('github.com/acme/tool');
  });

  test('an unknown name is not_found', async () => {
    const err = await catchErrAsync(() => checkRepos(ctx, { names: ['nope'] }));
    expect(err.code).toBe('not_found');
  });

  test('a duplicate canonical url and an invalid default ref are local errors', async () => {
    await copyFile(join(b.root, 'repos', 'webapp.md'), join(b.root, 'repos', 'dup.md'));
    await writeFile(
      join(b.root, 'repos', 'badref.md'),
      '---\nurl: https://example.org/x/y\ndefault_ref: a..b\n---\n',
    );
    await writeFile(join(b.root, 'repos', 'Bad Name.md'), '---\nurl: https://example.org/z\n---\n');
    const checks = await checkRepos(ctx, {}, { lsRemote: neverCalled, github: neverCalled });
    expect(byName(checks, 'dup').findings).toEqual([
      expect.objectContaining({ level: 'error', kind: 'local' }),
    ]);
    expect(byName(checks, 'dup').findings[0]?.message).toContain('webapp');
    expect(byName(checks, 'webapp').findings[0]?.message).toContain('dup');
    expect(byName(checks, 'badref').findings[0]).toMatchObject({ level: 'error', kind: 'local' });
    expect(byName(checks, 'Bad Name').findings[0]).toMatchObject({ level: 'error', kind: 'local' });
    expect(repoCheckExit(checks)?.code).toBe('validation');
    expect(repoCheckExit(checks)?.message).toBe('repo check: 4 Fehler');
    const only = await checkRepos(ctx, { names: ['badref'] }, { lsRemote: neverCalled });
    expect(only.map((c) => c.name)).toEqual(['badref']);
  });

  test('an issue with an invalid ref is a local error on its repo and never aborts', async () => {
    const issue = await createIssue(ctx, { title: 'bad' });
    const id = issue.id as string;
    const file = join(b.root, issueFile(id));
    const text = await readFile(file, 'utf8');
    await writeFile(file, text.replace('\n---\n', '\nrepos:\n  - webapp@a:b\n---\n'));
    const checks = await checkRepos(ctx, {}, { lsRemote: neverCalled, github: neverCalled });
    const msgs = byName(checks, 'webapp').findings;
    expect(msgs).toEqual([expect.objectContaining({ level: 'error', kind: 'local' })]);
    expect(msgs[0]?.message).toContain(id);
    expect(msgs[0]?.message).toContain('a:b');
    expect(repoCheckExit(checks)?.code).toBe('validation');
  });

  test('remote: missing refs are errors, commit refs are info', async () => {
    const checks = await checkRepos(ctx, { names: ['webapp'], remote: true });
    const findings = byName(checks, 'webapp').findings;
    expect(findings).toHaveLength(2);
    expect(findings).toContainEqual({
      level: 'error',
      kind: 'ref',
      message: 'Ref »feat/x« existiert im Remote nicht',
    });
    expect(findings).toContainEqual({
      level: 'info',
      kind: 'ref',
      message: 'Ref »4e1f9c2« sieht wie ein Commit aus und ist per ls-remote nicht prüfbar',
    });
    expect(repoCheckExit(checks)?.code).toBe('validation');
  });

  test('remote: a missing default ref is an error', async () => {
    const stub: RepoCheckDeps = { lsRemote: async () => ({ ok: true, refs: ['dev'] }) };
    const checks = await checkRepos(ctx, { names: ['webapp'], remote: true }, stub);
    expect(byName(checks, 'webapp').findings).toContainEqual({
      level: 'error',
      kind: 'ref',
      message: 'default_ref »main« existiert im Remote nicht',
    });
  });

  test('remote: unreachable repos are network errors and exit with 6', async () => {
    const checks = await checkRepos(ctx, { names: ['gone'], remote: true });
    expect(byName(checks, 'gone').findings).toEqual([
      expect.objectContaining({ level: 'error', kind: 'network' }),
    ]);
    const exit = repoCheckExit(checks);
    expect(exit?.code).toBe('sync');
    expect(exit?.exitCode).toBe(6);
    expect(exit?.message).toBe('repo check: 1 Fehler');
  });

  test('exit is clean for warnings and info only', async () => {
    expect(repoCheckExit([])).toBeUndefined();
    const checks = await checkRepos(
      ctx,
      { names: ['gh'], remote: true },
      {
        lsRemote: async () => ({ ok: true, refs: [] }),
        github: async () => ({ visibility: 'public', archived: true }),
      },
    );
    expect(byName(checks, 'gh').findings).toEqual([
      expect.objectContaining({ level: 'warning', kind: 'github' }),
    ]);
    expect(repoCheckExit(checks)).toBeUndefined();
  });

  test('remote: github visibility and archived come from the injected client', async () => {
    const calls: string[] = [];
    const deps: RepoCheckDeps = {
      lsRemote: async () => ({ ok: true, refs: [] }),
      github: async (owner, repo) => {
        calls.push(`${owner}/${repo}`);
        return { visibility: 'private', archived: false };
      },
    };
    const checks = await checkRepos(ctx, { names: ['gh'], remote: true }, deps);
    expect(calls).toEqual(['acme/tool']);
    expect(byName(checks, 'gh')).toMatchObject({
      github: { visibility: 'private', archived: false },
      findings: [],
    });
  });

  test('remote: a failing or empty github answer is a finding, not a crash', async () => {
    const lsRemote: RepoCheckDeps['lsRemote'] = async () => ({ ok: true, refs: [] });
    const failing = await checkRepos(
      ctx,
      { names: ['gh'], remote: true, fresh: true },
      {
        lsRemote,
        github: async () => {
          throw new Error('HTTP 403');
        },
      },
    );
    expect(byName(failing, 'gh').findings).toEqual([
      { level: 'warning', kind: 'github', message: 'GitHub-Abfrage fehlgeschlagen: HTTP 403' },
    ]);
    const empty = await checkRepos(
      ctx,
      { names: ['gh'], remote: true, fresh: true },
      {
        lsRemote,
        github: async () => undefined,
      },
    );
    expect(byName(empty, 'gh').findings).toEqual([
      expect.objectContaining({ level: 'info', kind: 'github' }),
    ]);
    expect(repoCheckExit(failing)).toBeUndefined();
  });

  test('a github repo is not queried for other hosts', async () => {
    const checks = await checkRepos(
      ctx,
      { names: ['webapp'], remote: true },
      {
        github: neverCalled,
      },
    );
    expect(byName(checks, 'webapp').github).toBeUndefined();
  });

  test('remote results are cached for 24 h; fresh bypasses the cache', async () => {
    let calls = 0;
    const lsRemote: RepoCheckDeps['lsRemote'] = async () => {
      calls++;
      return { ok: true, refs: ['main', 'v1', 'feat/x'] };
    };
    const t0 = new Date('2026-11-19T08:00:00Z');
    const at = (hours: number): RepoCheckDeps => ({
      now: () => new Date(t0.getTime() + hours * 3_600_000),
      lsRemote,
    });
    const run = (deps: RepoCheckDeps, fresh = false) =>
      checkRepos(ctx, { names: ['webapp'], remote: true, fresh }, deps);

    const first = await run(at(0));
    expect(calls).toBe(1);
    expect(first[0]?.cached).toBeUndefined();
    const second = await run(at(23));
    expect(calls).toBe(1);
    expect(second[0]?.cached).toBe(t0.toISOString());
    expect(second[0]?.findings).toEqual(first[0]?.findings);
    await run(at(24));
    expect(calls).toBe(2);
    await run(at(25)); // der Eintrag von 24 h gilt wieder
    expect(calls).toBe(2);
    await run(at(25), true);
    expect(calls).toBe(3);
    const cache = JSON.parse(await readFile(repoCheckCachePath(b.homes.backeHome), 'utf8'));
    expect(cache.version).toBe(1);
    expect(Object.keys(cache.entries)).toEqual([normalizeRepoUrl(bare)]);
  });

  test('a missing ref from the cache names the cache time and --fresh', async () => {
    const t0 = new Date('2026-11-19T08:00:00Z');
    const deps: RepoCheckDeps = {
      now: () => t0,
      lsRemote: async () => ({ ok: true, refs: ['main', 'v1'] }),
    };
    const missing = (checks: Awaited<ReturnType<typeof checkRepos>>) =>
      byName(checks, 'webapp').findings.find((f) => f.level === 'error')?.message;
    const run = (fresh = false) =>
      checkRepos(ctx, { names: ['webapp'], remote: true, fresh }, deps);
    expect(missing(await run())).toBe('Ref »feat/x« existiert im Remote nicht');
    expect(missing(await run())).toBe(
      `Ref »feat/x« existiert im Remote nicht (Cache vom ${t0.toISOString()}; --fresh prüft neu)`,
    );
    expect(missing(await run(true))).toBe('Ref »feat/x« existiert im Remote nicht');
  });

  test('unreachable results are not cached; a corrupt cache is discarded silently', async () => {
    let calls = 0;
    const lsRemote: RepoCheckDeps['lsRemote'] = async () => {
      calls++;
      return { ok: false, message: 'down' };
    };
    await checkRepos(ctx, { names: ['gone'], remote: true }, { lsRemote });
    await checkRepos(ctx, { names: ['gone'], remote: true }, { lsRemote });
    expect(calls).toBe(2);

    const file = repoCheckCachePath(b.homes.backeHome);
    for (const junk of [
      '{nope',
      '[]',
      '{"version":2,"entries":{}}',
      '{"version":1,"entries":{"x":1}}',
    ]) {
      await mkdir(join(file, '..'), { recursive: true });
      await writeFile(file, junk);
      const checks = await checkRepos(ctx, { names: ['webapp'], remote: true });
      expect(byName(checks, 'webapp').cached).toBeUndefined();
    }
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(1);
  });

  test('a cached entry without github data fetches github again', async () => {
    const deps = (github: RepoCheckDeps['github']): RepoCheckDeps => ({
      lsRemote: async () => ({ ok: true, refs: [] }),
      ...(github === undefined ? {} : { github }),
    });
    await checkRepos(
      ctx,
      { names: ['gh'], remote: true },
      { ...deps(undefined), github: async () => undefined },
    );
    const again = await checkRepos(
      ctx,
      { names: ['gh'], remote: true },
      {
        ...deps(async () => ({ visibility: 'public', archived: false })),
      },
    );
    expect(byName(again, 'gh')).toMatchObject({ github: { visibility: 'public' } });
    expect(byName(again, 'gh').cached).toBeDefined();
  });

  describe('default github client', () => {
    const ghCtx = (path: string, extra: Record<string, string> = {}): ResolvedContext => ({
      ...ctx,
      env: { ...ctx.env, PATH: path, ...extra },
    });
    const lsRemote: RepoCheckDeps['lsRemote'] = async () => ({ ok: true, refs: [] });

    afterEach(() => vi.unstubAllGlobals());

    test('uses gh api when gh is on the PATH', async () => {
      const bin = await tempDir();
      const script = join(bin, 'gh');
      await writeFile(
        script,
        '#!/bin/sh\n[ "$1 $2" = "api repos/acme/tool" ] && echo \'{"visibility":"internal","archived":false}\'\n',
      );
      await chmod(script, 0o755);
      const checks = await checkRepos(
        ghCtx(`/nonexistent:${bin}`),
        { names: ['gh'], remote: true },
        { lsRemote },
      );
      expect(byName(checks, 'gh').github).toEqual({ visibility: 'internal', archived: false });
    });

    test('a malformed gh answer is an info finding', async () => {
      const bin = await tempDir();
      const script = join(bin, 'gh');
      await writeFile(script, '#!/bin/sh\necho "not json"\n');
      await chmod(script, 0o755);
      const checks = await checkRepos(ghCtx(bin), { names: ['gh'], remote: true }, { lsRemote });
      expect(byName(checks, 'gh').findings).toEqual([
        expect.objectContaining({ level: 'info', kind: 'github' }),
      ]);
    });

    test('falls back to the REST API with the token', async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ private: true, archived: false })),
      );
      vi.stubGlobal('fetch', fetchMock);
      const checks = await checkRepos(
        ghCtx('', { GITHUB_TOKEN: 'tok' }),
        { names: ['gh'], remote: true },
        { lsRemote },
      );
      expect(byName(checks, 'gh').github).toEqual({ visibility: 'private', archived: false });
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/acme/tool',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer tok' }),
        }),
      );
    });

    test('REST failures and odd answers become findings', async () => {
      vi.stubGlobal('fetch', async () => new Response('no', { status: 404 }));
      const failed = await checkRepos(
        ghCtx(''),
        { names: ['gh'], remote: true, fresh: true },
        { lsRemote },
      );
      expect(byName(failed, 'gh').findings[0]).toEqual({
        level: 'warning',
        kind: 'github',
        message: 'GitHub-Abfrage fehlgeschlagen: HTTP 404',
      });
      for (const body of ['{"archived":true}', '{"archived":false,"visibility":"public"}', '[]']) {
        vi.stubGlobal('fetch', async () => new Response(body));
        const checks = await checkRepos(
          ghCtx(''),
          { names: ['gh'], remote: true, fresh: true },
          { lsRemote },
        );
        expect(byName(checks, 'gh').findings.length).toBeLessThanOrEqual(1);
      }
    });
  });
});

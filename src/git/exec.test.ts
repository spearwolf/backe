import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { git, sshKeygen } from './exec.ts';

describe('git', () => {
  test('runs git and returns its output', async () => {
    const dir = await tempDir();
    await git(['init', '-q'], { cwd: dir });
    const r = await git(['rev-parse', '--is-inside-work-tree'], { cwd: dir });
    expect(r).toEqual({ stdout: 'true\n', stderr: '', exitCode: 0 });
  });

  test('timeoutMs kills a command that runs too long', async () => {
    const cwd = await tempDir();
    const err = await catchErrAsync(() =>
      git(['-c', 'alias.hang=!sleep 2', 'hang'], { cwd, timeoutMs: 200 }),
    );
    expect(err.code).toBe('unexpected');
    expect(err.message).toBe('git hang: Zeitüberschreitung nach 200 ms');
    const ok = await git(['--version'], { cwd, timeoutMs: 20_000 });
    expect(ok.exitCode).toBe(0);
  });

  test('a failing command is an unexpected error with details', async () => {
    const err = await catchErrAsync(async () =>
      git(['rev-parse', '--verify', 'nope'], { cwd: await tempDir() }),
    );
    expect(err.code).toBe('unexpected');
    expect(err.message).toMatch(/^git rev-parse fehlgeschlagen \(Exit 128\): /);
    expect(err.details).toMatchObject({ args: ['rev-parse', '--verify', 'nope'], exitCode: 128 });
  });

  test('the error names the subcommand, not leading options', async () => {
    const cwd = await tempDir();
    const err = await catchErrAsync(() =>
      git(['-c', 'x.y=1', '-C', cwd, 'rev-parse', '--verify', 'nope'], { cwd }),
    );
    expect(err.message).toMatch(/^git rev-parse fehlgeschlagen \(Exit 128\): /);
    const bare = await catchErrAsync(() => git([], { cwd }));
    expect(bare.message).toMatch(/^git fehlgeschlagen \(Exit 1\)/);
  });

  test('repo-local git variables of the calling process are not inherited', async () => {
    const repo = await tempDir();
    await git(['init', '-q'], { cwd: repo });
    const outside = await tempDir();
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = join(repo, '.git');
    try {
      const err = await catchErrAsync(() =>
        git(['rev-parse', '--show-toplevel'], { cwd: outside }),
      );
      expect(err.code).toBe('unexpected');
      expect(err.details).toMatchObject({ exitCode: 128 });
      // Explizit über `opts.env` gesetzt gilt die Variable weiter.
      const r = await git(['rev-parse', '--git-dir'], {
        cwd: outside,
        env: { GIT_DIR: join(repo, '.git') },
      });
      expect(r.stdout).toBe(`${join(repo, '.git')}\n`);
    } finally {
      if (saved === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved;
    }
  });

  test('allowed exit codes are returned, not thrown', async () => {
    const r = await git(['config', '--get', 'x.y'], { cwd: await tempDir(), okExitCodes: [1] });
    expect(r.exitCode).toBe(1);
  });

  test('missing git binary has a hint', async () => {
    const err = await catchErrAsync(async () =>
      git(['--version'], { cwd: await tempDir(), env: { PATH: '' } }),
    );
    expect(err.message).toBe('git nicht gefunden');
    expect(err.hint).toBe('git installieren; backe doctor prüft die Voraussetzungen.');
  });

  test('a missing working directory is not reported as missing git', async () => {
    const err = await catchErrAsync(() => git(['--version'], { cwd: '/nonexistent/backe-cwd' }));
    expect(err.code).toBe('unexpected');
    expect(err.message).toBe('Arbeitsverzeichnis nicht gefunden: /nonexistent/backe-cwd');
    expect(err.hint).toBeUndefined();
  });

  test('other spawn errors are wrapped as unexpected errors', async () => {
    const dir = await tempDir();
    const file = join(dir, 'file');
    await writeFile(file, 'x');
    const err = await catchErrAsync(() => git(['--version'], { cwd: file }));
    expect(err.code).toBe('unexpected');
    expect(err.message).toMatch(/^git konnte nicht gestartet werden: /);
    expect(err.details).toMatchObject({ args: ['--version'] });
  });

  test('death by signal is an error even if exit code 1 is allowed', async () => {
    // Der Alias-Prozess tötet seinen Elternprozess, also git selbst.
    const err = await catchErrAsync(async () =>
      git(['-c', 'alias.killme=!kill -TERM $PPID', 'killme'], {
        cwd: await tempDir(),
        okExitCodes: [1, 143],
      }),
    );
    expect(err.code).toBe('unexpected');
    expect(err.message).toBe('git killme durch Signal beendet (SIGTERM)');
    expect(err.details).toMatchObject({ signal: 'SIGTERM' });
  });

  test('stdin input reaches git', async () => {
    const dir = await tempDir();
    await git(['init', '-q'], { cwd: dir });
    expect((await git(['hash-object', '--stdin'], { cwd: dir, input: 'x\n' })).stdout).toMatch(
      /^[0-9a-f]{40}\n$/,
    );
  });

  test('locale and prompt are forced, undefined removes a variable', async () => {
    // Alias-Name darf kein eingebauter Befehl sein (`show` wäre `git show`).
    const show = (v: string) => [
      '-c',
      `alias.printenv-test=!printf %s "\${${v}-unset}"`,
      'printenv-test',
    ];
    const cwd = await tempDir();
    expect((await git(show('LC_ALL'), { cwd, env: { LC_ALL: 'de_DE.UTF-8' } })).stdout).toBe('C');
    expect((await git(show('GIT_TERMINAL_PROMPT'), { cwd })).stdout).toBe('0');
    expect((await git(show('HOME'), { cwd, env: { HOME: undefined } })).stdout).toBe('unset');
  });
});

describe('sshKeygen', () => {
  test('sshKeygen failures name ssh-keygen', async () => {
    const err = await catchErrAsync(() => sshKeygen(['-lf', '/nonexistent'], { cwd: tmpdir() }));
    expect(err.message).toMatch(/^ssh-keygen fehlgeschlagen \(Exit \d+\)/);
  });
});

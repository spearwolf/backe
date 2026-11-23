import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { expandPath } from '../../src/context/paths.ts';
import { registerBacklog } from '../../src/context/registry.ts';
import { git } from '../../src/git/exec.ts';
import { formatCommitMessage } from '../../src/git/message.ts';
import { assertOnBranch } from '../../src/git/repo.ts';
import { readPublicKey } from '../../src/git/ssh.ts';
import { setLocale } from '../../src/i18n/locale.ts';
import { tempDir } from '../helpers/backlog.ts';
import { catchErrAsync } from '../helpers/catch.ts';

beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

describe('context and git messages in English', () => {
  test('an unsupported ~name path is a validation error with hint', async () => {
    const error = await catchErrAsync(async () =>
      expandPath('~bob/x', { home: '/home/a', base: '/tmp' }),
    );
    expect(error.message).toBe("Path '~bob/x': ~name is not supported");
    expect(error.hint).toBe('Use ~/… or an absolute path');
  });

  test('registering a path without a handle names the missing option', async () => {
    const dir = await tempDir();
    const error = await catchErrAsync(() =>
      registerBacklog(
        { home: dir, backeHome: join(dir, '.backe') },
        { name: 'demo', path: join(dir, 'wc') },
      ),
    );
    expect(error.message).toBe('--path needs --user (handle) that owns the path');
  });

  test('being on the wrong branch is a conflict with a switch hint', async () => {
    const wc = await realpath(await tempDir());
    await git(['init', '-q', '-b', 'main'], { cwd: wc });
    const error = await catchErrAsync(() => assertOnBranch(wc, 'backlog'));
    expect(error.message).toBe(`${wc} is on main, expected backlog`);
    expect(error.hint).toBe(`git -C ${wc} switch backlog`);
  });

  test('a missing key file is reported in English', async () => {
    const missing = join(await tempDir(), 'nope');
    const error = await catchErrAsync(() => readPublicKey(missing));
    expect(error.message).toBe(`Key file not found: ${missing}`);
  });

  test('an empty commit subject is rejected in English', () => {
    expect(() => formatCommitMessage({ subject: '', trailers: [] })).toThrow(
      'Commit subject must be exactly one non-empty line',
    );
  });
});

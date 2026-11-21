import { copyFile, rm, stat, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { fixture, tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { testKey } from '../../test/helpers/git.ts';
import { BackeError } from '../core/errors.ts';
import { sameKey } from '../core/ssh.ts';
import { sshKeygen } from './exec.ts';
import { generateKeypair, readPublicKey } from './ssh.ts';

vi.mock('./exec.ts', async (orig) => {
  const actual = await orig<typeof import('./exec.ts')>();
  return { ...actual, sshKeygen: vi.fn(actual.sshKeygen) };
});

describe('ssh keys', () => {
  test('deriving a public key never prompts for a passphrase', async () => {
    const k = await testKey('a');
    const lonely = join(await tempDir(), 'copy');
    await copyFile(k.priv, lonely);
    vi.mocked(sshKeygen).mockClear();
    await readPublicKey(lonely);
    expect(vi.mocked(sshKeygen).mock.calls.map(([args]) => args)).toEqual([
      ['-y', '-P', '', '-f', lonely],
    ]);
  });

  test('an encrypted private key without .pub is a usage error with hint', async () => {
    const dir = await tempDir();
    const locked = join(dir, 'locked');
    await sshKeygen(['-q', '-t', 'ed25519', '-N', 'geheim', '-f', locked], { cwd: dir });
    await rm(`${locked}.pub`);
    const err = await catchErrAsync(() => readPublicKey(locked));
    expect(err.code).toBe('usage');
    expect(err.message).toBe(`Key »${locked}« ist verschlüsselt und hat keine ».pub« daneben`);
    expect(err.hint).toBe(`ssh-keygen -y -f ${locked} > ${locked}.pub`);
  });

  test('an encrypted PEM key without .pub is a usage error with hint too', async () => {
    const dir = await tempDir();
    const pem = join(dir, 'pem');
    await sshKeygen(['-q', '-t', 'ecdsa', '-m', 'PEM', '-N', 'geheim', '-f', pem], { cwd: dir });
    await rm(`${pem}.pub`);
    const err = await catchErrAsync(() => readPublicKey(pem));
    expect(err).toMatchObject({
      code: 'usage',
      message: `Key »${pem}« ist verschlüsselt und hat keine ».pub« daneben`,
      hint: `ssh-keygen -y -f ${pem} > ${pem}.pub`,
    });
  });

  test('a readable PEM key of another type is derived and then refused', async () => {
    const dir = await tempDir();
    const pem = join(dir, 'pem');
    await sshKeygen(['-q', '-t', 'ecdsa', '-m', 'PEM', '-N', '', '-f', pem], { cwd: dir });
    await rm(`${pem}.pub`);
    const err = await catchErrAsync(() => readPublicKey(pem));
    expect(err.code).toBe('validation');
    expect(err.message).toContain('Typ ecdsa-sha2-nistp256 nicht unterstützt');
  });

  test('a broken key is not reported as encrypted', async () => {
    const dir = await tempDir();
    const broken = join(dir, 'broken');
    await writeFile(broken, '-----BEGIN OPENSSH PRIVATE KEY-----\nmüll\n');
    const err = await catchErrAsync(() => readPublicKey(broken));
    expect(err.code).toBe('validation');
    expect(err.message).toMatch(new RegExp(`^Key »${broken}« ist nicht lesbar: \\S`));
    expect(err.message).not.toMatch(/verschlüsselt/);
  });

  test('an ssh-keygen failing without output names its exit code', async () => {
    const dir = await tempDir();
    const broken = join(dir, 'broken');
    await writeFile(broken, 'müll\n');
    const actual = await vi.importActual<typeof import('./exec.ts')>('./exec.ts');
    // Das Fake-ssh-keygen aus test/fixtures/bin endet mit Exit 3, stdout und stderr leer.
    const path = `${fixture('bin')}${delimiter}${process.env.PATH ?? ''}`;
    vi.mocked(sshKeygen).mockImplementationOnce((args, opts) =>
      actual.sshKeygen(args, { ...opts, env: { ...opts.env, PATH: path } }),
    );
    const err = await catchErrAsync(() => readPublicKey(broken));
    expect(err.code).toBe('validation');
    expect(err.message).toBe(`Key »${broken}« ist nicht lesbar (ssh-keygen ohne Ausgabe, Exit 3)`);
  });

  test('a missing ssh-keygen is an unexpected error, not an unreadable key', async () => {
    const dir = await tempDir();
    const broken = join(dir, 'broken');
    await writeFile(broken, 'müll\n');
    vi.mocked(sshKeygen).mockRejectedValueOnce(
      new BackeError('unexpected', 'ssh-keygen nicht gefunden'),
    );
    const err = await catchErrAsync(() => readPublicKey(broken));
    expect(err).toMatchObject({ code: 'unexpected', message: 'ssh-keygen nicht gefunden' });
  });

  test('readPublicKey reads a public key, the .pub next to a private key, or derives it', async () => {
    const k = await testKey('a');
    expect(await readPublicKey(k.pub)).toBe(k.line);
    expect(await readPublicKey(k.priv)).toBe(k.line);
    const lonely = join(await tempDir(), 'copy');
    await copyFile(k.priv, lonely);
    expect(sameKey(await readPublicKey(lonely), k.line)).toBe(true);
  });

  test('readPublicKey reports a missing file', async () => {
    const p = join(await tempDir(), 'nope');
    const err = await catchErrAsync(() => readPublicKey(p));
    expect(err.code).toBe('not_found');
    expect(err.message).toBe(`Key-Datei nicht gefunden: ${p}`);
  });

  test('generateKeypair writes a 0600 private key and refuses to overwrite', async () => {
    const p = join(await tempDir(), 'keys/acme/claude-1');
    const line = await generateKeypair(p, 'claude-1@backe');
    expect(line).toMatch(/^ssh-ed25519 \S+ claude-1@backe$/);
    expect((await stat(p)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(p))).mode & 0o777).toBe(0o700);
    expect((await catchErrAsync(() => generateKeypair(p, 'x'))).code).toBe('conflict');
  });
});

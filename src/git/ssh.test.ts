import { copyFile, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { testKey } from '../../test/helpers/git.ts';
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

  test('a key with a passphrase and no .pub fails instead of prompting', async () => {
    const dir = await tempDir();
    const locked = join(dir, 'locked');
    await sshKeygen(['-q', '-t', 'ed25519', '-N', 'geheim', '-f', locked], { cwd: dir });
    await rm(`${locked}.pub`);
    const err = await catchErrAsync(() => readPublicKey(locked));
    expect(err.code).toBe('unexpected');
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

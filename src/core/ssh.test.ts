import { tmpdir } from 'node:os';
import { catchErr } from '../../test/helpers/catch.ts';
import { testKey } from '../../test/helpers/git.ts';
import { sshKeygen } from '../git/exec.ts';
import { parseSshPublicKey, sameKey, sshFingerprint } from './ssh.ts';

const field = (s: string): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(s.length);
  return Buffer.concat([len, Buffer.from(s)]);
};
const B64 = Buffer.concat([field('ssh-ed25519'), field('k'.repeat(32))]).toString('base64');
const RSA_BLOB_AS_ED25519 = Buffer.concat([field('ssh-rsa'), field('k'.repeat(32))]).toString(
  'base64',
);

describe('ssh public keys', () => {
  test('fingerprint matches ssh-keygen -lf', async () => {
    const k = await testKey('a');
    const { stdout } = await sshKeygen(['-lf', k.pub], { cwd: tmpdir() });
    expect(sshFingerprint(k.line)).toBe(stdout.split(' ')[1]);
  });

  test('sameKey ignores the comment', () => {
    expect(sameKey(`ssh-ed25519 ${B64} a@x`, `ssh-ed25519 ${B64}`)).toBe(true);
  });

  test('sameKey tells different blobs apart', async () => {
    const [a, b] = await Promise.all([testKey('a'), testKey('b')]);
    expect(sameKey(a.line, b.line)).toBe(false);
  });

  test('parseSshPublicKey returns type, blob and comment', () => {
    const k = parseSshPublicKey(`ssh-ed25519 ${B64} a@x y`);
    expect(k.type).toBe('ssh-ed25519');
    expect(Buffer.from(k.blob).toString('base64')).toBe(B64);
    expect(k.comment).toBe('a@x y');
    expect(parseSshPublicKey(`ssh-ed25519 ${B64}`).comment).toBeUndefined();
  });

  test.each([
    'ssh-rsa AAAAB3NzaC1yc2E= x',
    'ssh-ed25519 !!!',
    `ssh-ed25519 ${RSA_BLOB_AS_ED25519}`,
    'ssh-ed25519',
    'ssh-ed25519 AAAA',
  ])('parseSshPublicKey rejects %s', (line) => {
    const err = catchErr(() => parseSshPublicKey(line));
    expect(err.code).toBe('validation');
    expect(err.hint).toBe('backe unterstützt in v1 nur ssh-ed25519.');
  });
});

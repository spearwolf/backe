import { tmpdir } from 'node:os';
import { testKey } from '../../test/helpers/git.ts';
import { sshKeygen } from '../git/exec.ts';
import { sshFingerprint } from './fingerprint.ts';

test('fingerprint matches ssh-keygen -lf', async () => {
  const k = await testKey('a');
  const { stdout } = await sshKeygen(['-lf', k.pub], { cwd: tmpdir() });
  expect(sshFingerprint(k.line)).toBe(stdout.split(' ')[1]);
});

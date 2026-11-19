import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { sshKeygen } from '../../src/git/exec.ts';

export type TestKey = { priv: string; pub: string; line: string };

let keyDir: Promise<string> | undefined;
const keys = new Map<string, Promise<TestKey>>();

afterAll(async () => {
  const dir = await keyDir;
  keyDir = undefined;
  keys.clear();
  if (dir) await rm(dir, { recursive: true, force: true });
});

/** ed25519-Schlüsselpaar je Name und Testdatei; einmal erzeugt, nach der Datei entfernt. */
export function testKey(name: string): Promise<TestKey> {
  let key = keys.get(name);
  if (!key) {
    keyDir ??= mkdtemp(join(tmpdir(), 'backe-keys-'));
    const dirPromise = keyDir;
    key = (async () => {
      const dir = await dirPromise;
      const priv = join(dir, name);
      await sshKeygen(['-q', '-t', 'ed25519', '-N', '', '-C', `${name}@test`, '-f', priv], {
        cwd: dir,
      });
      const pub = `${priv}.pub`;
      return { priv, pub, line: (await readFile(pub, 'utf8')).split('\n')[0] as string };
    })();
    keys.set(name, key);
  }
  return key;
}

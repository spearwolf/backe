import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { git, sshKeygen } from '../../src/git/exec.ts';

export type TestKey = { priv: string; pub: string; line: string };

let keyDir: Promise<string> | undefined;
const keys = new Map<string, Promise<TestKey>>();

afterAll(async () => {
  const dir = await keyDir;
  keyDir = undefined;
  keys.clear();
  if (dir) await rm(dir, { recursive: true, force: true });
});

export async function revParse(wc: string, rev: string): Promise<string> {
  return (await git(['rev-parse', rev], { cwd: wc })).stdout.trim();
}

/** Zeilen von `git status --short` (ohne leere Zeilen). */
export async function statusShort(wc: string): Promise<string[]> {
  const { stdout } = await git(['status', '--short', '--untracked-files=all'], { cwd: wc });
  return stdout.split('\n').filter((line) => line !== '');
}

/** Signaturstatus (`%G?`) und Principal (`%GS`) von `rev`, geprüft gegen eine `allowed_signers`-Datei aus `keys`. */
export async function sigOf(
  wc: string,
  rev: string,
  keys: Readonly<Record<string, TestKey>>,
): Promise<[status: string, principal: string]> {
  const dir = await mkdtemp(join(tmpdir(), 'backe-signers-'));
  try {
    const file = join(dir, 'allowed_signers');
    const lines = Object.entries(keys).map(([name, key]) => `${name} ${key.line}`);
    await writeFile(file, `${lines.join('\n')}\n`);
    const { stdout } = await git(
      [
        '-c',
        'gpg.format=ssh',
        '-c',
        `gpg.ssh.allowedSignersFile=${file}`,
        'log',
        '-1',
        '--format=%G?%x00%GS',
        rev,
      ],
      { cwd: wc },
    );
    const [status = '', principal = ''] = stdout.replace(/\n$/, '').split('\0');
    return [status, principal];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

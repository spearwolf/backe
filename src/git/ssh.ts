import { access, chmod, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { parseSshPublicKey } from '../core/ssh.ts';
import { sshKeygen } from './exec.ts';

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

const firstLine = (text: string): string => text.split('\n')[0]?.trim() ?? '';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Public-Key-Zeile zu einem Pfad: der Key selbst, die `.pub` daneben oder per `ssh-keygen -y` abgeleitet. */
export async function readPublicKey(keyPath: string): Promise<string> {
  const own = await readText(keyPath);
  if (own === undefined) {
    throw new BackeError('not_found', `Key-Datei nicht gefunden: ${keyPath}`);
  }
  let line = firstLine(own);
  if (!line.startsWith('ssh-')) {
    const pub = await readText(`${keyPath}.pub`);
    line =
      pub !== undefined && firstLine(pub).startsWith('ssh-')
        ? firstLine(pub)
        : // `-P ''`: Ein Key mit Passphrase scheitert sofort, statt am Terminal nachzufragen.
          firstLine(
            (await sshKeygen(['-y', '-P', '', '-f', keyPath], { cwd: dirname(keyPath) })).stdout,
          );
  }
  parseSshPublicKey(line);
  return line;
}

/** Erzeugt ein ed25519-Schlüsselpaar ohne Passphrase und liefert die Public-Key-Zeile. */
export async function generateKeypair(path: string, comment: string): Promise<string> {
  for (const file of [path, `${path}.pub`]) {
    if (await exists(file)) {
      throw new BackeError('conflict', `Key-Datei existiert bereits: ${file}`);
    }
  }
  const dir = dirname(path);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await sshKeygen(['-q', '-t', 'ed25519', '-N', '', '-C', comment, '-f', path], { cwd: dir });
  await chmod(path, 0o600);
  return readPublicKey(`${path}.pub`);
}

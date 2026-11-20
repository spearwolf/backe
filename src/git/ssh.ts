import { chmod, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { parseSshPublicKey } from '../core/ssh.ts';
import { exists, isMissing } from '../store/files.ts';
import { sshKeygen } from './exec.ts';

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

const firstLine = (text: string): string => text.split('\n')[0]?.trim() ?? '';

/**
 * Leitet die Public-Key-Zeile per `ssh-keygen -y` ab. `-P ''`: Ein Key mit Passphrase scheitert
 * sofort, statt am Terminal nachzufragen; nennt ssh-keygen eine Passphrase, ist das der Fall
 * „verschlüsselt, keine `.pub` daneben“ und bekommt den Hinweis, die `.pub` zu erzeugen. Jeder andere
 * Fehler ist ein nicht lesbarer Key.
 */
async function deriveFromPrivateKey(keyPath: string): Promise<string> {
  try {
    return firstLine(
      (await sshKeygen(['-y', '-P', '', '-f', keyPath], { cwd: dirname(keyPath) })).stdout,
    );
  } catch (error) {
    // Ein fehlendes ssh-keygen (oder ein anderer Startfehler) trägt keinen stderr des Programms.
    const details =
      error instanceof BackeError
        ? (error.details as { stderr?: unknown; exitCode?: unknown })
        : undefined;
    const stderr = typeof details?.stderr === 'string' ? details.stderr : undefined;
    if (stderr === undefined) throw error;
    if (firstLine(stderr) === '') {
      throw new BackeError(
        'validation',
        `Key »${keyPath}« ist nicht lesbar (ssh-keygen ohne Ausgabe, Exit ${String(details?.exitCode)})`,
      );
    }
    if (/passphrase/i.test(stderr)) {
      throw new BackeError(
        'usage',
        `Key »${keyPath}« ist verschlüsselt und hat keine ».pub« daneben`,
        { hint: `ssh-keygen -y -f ${keyPath} > ${keyPath}.pub` },
      );
    }
    throw new BackeError('validation', `Key »${keyPath}« ist nicht lesbar: ${firstLine(stderr)}`);
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
        : await deriveFromPrivateKey(keyPath);
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

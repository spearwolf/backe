import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { type Env, exists, type Homes, physicalPath } from '../context/paths.ts';
import { managedClonePath, registerBacklog, setIdentity } from '../context/registry.ts';
import { readUserConfig } from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import { PREFIX_RE } from '../core/ids.ts';
import { BACKLOG_NAME_RE, isHandle } from '../core/names.ts';
import { commitPaths } from '../git/commit.ts';
import { git, transportEnv } from '../git/exec.ts';
import { writeLocalState } from '../git/local-state.ts';
import { formatCommitMessage, TRAILER_ACTOR, TRAILER_OP } from '../git/message.ts';
import { readPublicKey } from '../git/ssh.ts';
import { serializeEntityFile } from '../store/frontmatter.ts';
import { JUNK_PATTERNS } from '../store/layout.ts';
import { authorOf } from './env.ts';

export type InitInput = {
  homes: Homes;
  env: Env;
  dir?: string;
  name: string;
  prefix: string;
  remote?: string;
  handle: string;
  key: string;
  userName?: string;
};

/** Das Verzeichnis fehlt oder ist leer. */
async function isEmptyOrMissing(dir: string): Promise<boolean> {
  try {
    return (await readdir(dir)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

/** Räumt Angelegtes weg: das Zielverzeichnis selbst oder, war es schon da, nur seinen Inhalt. */
async function removeCreated(root: string, existed: boolean): Promise<void> {
  try {
    if (existed) {
      for (const entry of await readdir(root)) {
        await rm(join(root, entry), { recursive: true, force: true });
      }
    } else {
      await rm(root, { recursive: true, force: true });
    }
  } catch {
    // Das Aufräumen darf den ursprünglichen Fehler nicht überdecken.
  }
}

/** Erste nicht leere Zeile der git-Fehlerausgabe. */
export function firstStderrLine(error: unknown): string {
  const stderr = error instanceof BackeError ? (error.details as { stderr?: string })?.stderr : '';
  const line = (stderr ?? '').split('\n').find((l) => l.trim() !== '');
  return line ?? (error instanceof Error ? error.message : String(error));
}

/**
 * Legt einen Backlog mit signiertem Vertrauensanker an (backe.md §5): Config, Admin-User und eine
 * `.gitignore` für Editor- und Systemdateien in einem Commit, lokaler Anker- und Verified-Stand, Registrierung samt Identität.
 */
export async function initBacklog(input: InitInput): Promise<{ root: string; anchor: string }> {
  const { homes, env, name, prefix, remote, handle, key } = input;
  if (!BACKLOG_NAME_RE.test(name)) {
    throw new BackeError('validation', `Ungültiger Backlog-Name »${name}«`, {
      hint: 'Erlaubt sind Kleinbuchstaben, Ziffern und Bindestriche (max. 64 Zeichen).',
    });
  }
  if (!PREFIX_RE.test(prefix)) {
    throw new BackeError('validation', `Ungültiges ID-Präfix »${prefix}«`, {
      hint: 'Erlaubt sind 2 bis 6 Kleinbuchstaben.',
    });
  }
  if (!isHandle(handle)) {
    throw new BackeError('validation', `Ungültiger Handle »${handle}«`, {
      hint: 'Erlaubt sind Kleinbuchstaben, Ziffern und Bindestriche (2 bis 32 Zeichen); »me« ist reserviert.',
    });
  }
  const cfg = await readUserConfig(homes.backeHome);
  if (cfg.backlogs?.[name] !== undefined) {
    throw new BackeError('conflict', `Backlog »${name}« ist bereits registriert`, {
      hint: 'backe backlog list',
    });
  }

  if (input.dir !== undefined && !isAbsolute(input.dir)) {
    throw new BackeError('usage', `Zielverzeichnis muss absolut sein: ${input.dir}`);
  }
  const root =
    input.dir === undefined ? managedClonePath(homes, name, handle) : await physicalPath(input.dir);
  const existed = await exists(root);
  if (!(await isEmptyOrMissing(root))) {
    throw new BackeError('conflict', `Zielverzeichnis ist nicht leer: ${root}`);
  }

  const pub = await readPublicKey(key);
  const userName = input.userName ?? handle;

  let anchor: string;
  try {
    anchor = await createAnchor();
  } catch (error) {
    await removeCreated(root, existed);
    throw error;
  }

  async function createAnchor(): Promise<string> {
    await mkdir(root, { recursive: true });
    await git(['init', '-q', '-b', 'main'], { cwd: root });
    const config = `${JSON.stringify({ version: 1, name, id_prefix: prefix, admins: [handle] }, null, 2)}\n`;
    const userFile = serializeEntityFile(
      'user',
      { name: userName, kind: 'human', keys: [pub] },
      '',
    );
    const userPath = `users/${handle}.md`;
    await mkdir(join(root, '.backe'), { recursive: true });
    await mkdir(join(root, 'users'), { recursive: true });
    await writeFile(join(root, '.backe/backlog.jsonc'), config);
    await writeFile(join(root, userPath), userFile);
    await writeFile(join(root, '.gitignore'), `${JUNK_PATTERNS.join('\n')}\n`);

    const commit = await commitPaths(root, {
      paths: ['.backe/backlog.jsonc', userPath, '.gitignore'],
      message: formatCommitMessage({
        subject: `init ${name}`,
        trailers: [
          [TRAILER_ACTOR, handle],
          [TRAILER_OP, 'init'],
        ],
      }),
      key,
      author: authorOf(handle, userName),
      env,
      parent: undefined,
    });
    await writeLocalState(root, 'anchor', commit);
    await writeLocalState(root, 'verified', commit);
    await writeLocalState(root, 'clean', commit);
    await writeLocalState(root, 'identity', handle);
    return commit;
  }

  let pushFailure: BackeError | undefined;
  if (remote !== undefined) {
    await git(['remote', 'add', 'origin', remote], { cwd: root });
    try {
      await git(['push', '-q', '-u', 'origin', 'main'], { cwd: root, env: transportEnv(env) });
    } catch (error) {
      pushFailure = new BackeError(
        'sync',
        `Push nach ${remote} fehlgeschlagen: ${firstStderrLine(error)}`,
        { hint: `git -C ${root} push -u origin main` },
      );
    }
    // Erst ein gelungener Push macht den Anker zum verifizierten Stand des Remotes.
    if (pushFailure === undefined) await writeLocalState(root, 'upstream', anchor);
  }

  await registerBacklog(homes, {
    name,
    handle,
    ...(remote === undefined ? {} : { remote }),
    ...(input.dir === undefined ? {} : { path: root }),
  });
  await setIdentity(homes, name, handle, key);

  if (pushFailure) throw pushFailure;
  return { root, anchor };
}

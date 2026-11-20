/**
 * Der lokale Hub eines Backlogs ohne Remote (backe.md §2.16.1): ein bares Repository unter
 * `<BACKE_HOME>/backlogs/<name>/hub.git`, über das mehrere Arbeitskopien derselben Maschine
 * syncen. Angelegt wird er erst, wenn eine zweite Arbeitskopie entsteht; ein Backlog mit genau
 * einer Arbeitskopie hat keinen und syncet nicht.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { withFileLock } from '../context/lock.ts';
import type { Homes } from '../context/paths.ts';
import { configLockPath } from '../context/user-config.ts';
import { git } from '../git/exec.ts';
import { isAncestor, resolveCommit } from '../git/history.ts';
import { readLocalState, writeLocalState } from '../git/local-state.ts';
import { remoteUrl } from '../git/query.ts';
import { exists } from '../store/files.ts';

/** Nur für Tests: läuft zwischen dem Klonen ins Temp-Verzeichnis und dem Abschluss. */
export type HubHooks = { beforeFinish?: () => Promise<void> };

export function hubPath(homes: Homes, name: string): string {
  return join(homes.backeHome, 'backlogs', name, 'hub.git');
}

/** `url` ist ein lokales Verzeichnis mit Arbeitsbaum; eine URL, ein bares Repo oder nichts nicht. */
async function isNonBareDir(url: string): Promise<boolean> {
  if (!isAbsolute(url)) return false;
  try {
    const r = await git(['rev-parse', '--is-bare-repository'], { cwd: url });
    return r.stdout.trim() === 'false';
  } catch {
    return false;
  }
}

/**
 * Hängt die Quell-Arbeitskopie an den Hub: Fehlt der Git-Remote `remote`, wird er angelegt; zeigt
 * er auf ein nicht-bares Verzeichnis, wird er umgehängt. Einer auf ein bares Repo oder eine URL
 * bleibt. Liefert, ob der Remote danach auf den Hub zeigt.
 */
async function connect(source: string, hub: string, remote: string): Promise<boolean> {
  const url = await remoteUrl(source, remote);
  if (url === hub) return true;
  if (url === undefined) {
    await git(['remote', 'add', '--', remote, hub], { cwd: source });
    return true;
  }
  if (!(await isNonBareDir(url))) return false;
  await git(['remote', 'set-url', '--', remote, hub], { cwd: source });
  return true;
}

/**
 * Legt den Hub an, falls er fehlt: `git clone --bare` der Quelle in `<BACKE_HOME>/tmp`, dann unter
 * dem Config-Lock per `rename` an seinen Platz; hat ihn inzwischen ein anderer Prozess angelegt,
 * gilt dessen Hub. Danach zeigt der Git-Remote `config.remote` der Quelle auf den Hub (siehe
 * `connect`) und wird einmal geholt. Steht der geholte Branch im `HEAD` der Quelle, ist er ihr
 * `upstream`, sofern sie noch keinen hat: Der Hub enthält dann nur ihre eigene Historie.
 * `linked`: Der Remote der Quelle zeigt danach auf den Hub (nicht bei einem bleibenden fremden).
 */
export async function ensureHub(
  homes: Homes,
  name: string,
  source: string,
  config: { remote: string; branch: string },
  hooks: HubHooks = {},
): Promise<{ hub: string; created: boolean; linked: boolean }> {
  const hub = hubPath(homes, name);
  let created = false;
  if (!(await exists(hub))) {
    const dir = join(homes.backeHome, 'tmp');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = join(dir, `hub-${randomBytes(6).toString('hex')}`);
    try {
      await git(['clone', '--bare', '-q', '--', source, temp], { cwd: dir });
      await hooks.beforeFinish?.();
      created = await withFileLock(configLockPath(homes.backeHome), async () => {
        if (await exists(hub)) return false;
        await mkdir(dirname(hub), { recursive: true });
        await rename(temp, hub);
        return true;
      });
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
  const linked = await withFileLock(configLockPath(homes.backeHome), () =>
    connect(source, hub, config.remote),
  );
  if (!linked) return { hub, created, linked };
  const tracking = `refs/remotes/${config.remote}/${config.branch}`;
  await git(
    [
      'fetch',
      '-q',
      '--no-tags',
      '--end-of-options',
      config.remote,
      `+refs/heads/${config.branch}:${tracking}`,
    ],
    { cwd: source },
  );
  if ((await readLocalState(source, 'upstream')) === undefined) {
    const tip = await resolveCommit(source, tracking);
    if (await isAncestor(source, tip, 'HEAD')) await writeLocalState(source, 'upstream', tip);
  }
  return { hub, created, linked };
}

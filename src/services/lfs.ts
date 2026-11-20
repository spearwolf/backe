/**
 * git-lfs für Anhänge (backe.md §2.8): ob es läuft, und der LFS-Filter in der eigenen
 * `.git/config` der Arbeitskopie. Schreibpfad und Sync teilen sich Prüfung und Fehlermeldung.
 */

import type { Env } from '../context/paths.ts';
import { BackeError } from '../core/errors.ts';
import { git, transportEnv } from '../git/exec.ts';
import { firstStderrLine } from './init.ts';

/** `git lfs version` gelingt. */
export async function lfsAvailable(wc: string): Promise<boolean> {
  return git(['lfs', 'version'], { cwd: wc }).then(
    () => true,
    () => false,
  );
}

/** Wie `lfsAvailable`, aber ohne git-lfs ein `validation`-Fehler. */
export async function requireLfs(wc: string): Promise<void> {
  if (await lfsAvailable(wc)) return;
  throw new BackeError('validation', 'attachments.lfs verlangt git-lfs', { hint: 'backe doctor' });
}

/**
 * Mit `attachments.lfs` muss `git lfs` laufen, und die Arbeitskopie braucht den LFS-Filter in ihrer
 * eigenen `.git/config` (`git lfs install --local`): Sonst landeten Anhänge roh im Commit, `git
 * status` hielte jeden Anhang für geändert und ein Checkout schriebe den Pointer statt der Bytes.
 * Die globale Git-Config bleibt unberührt. Liegt schon ein fremder Hook, den git-lfs nicht
 * überschreibt, kommt nur der Filter dazu.
 */
export async function setUpLfs(wc: string): Promise<void> {
  await requireLfs(wc);
  const filter = await git(['config', '--local', '--get', 'filter.lfs.process'], {
    cwd: wc,
    okExitCodes: [1],
  });
  if (filter.exitCode === 0) return;
  await git(['lfs', 'install', '--local'], { cwd: wc }).catch(() =>
    git(['lfs', 'install', '--local', '--skip-repo'], { cwd: wc }),
  );
}

/**
 * `git lfs pull` für eine Arbeitskopie (wenn git-lfs da ist): `git lfs fetch` ohne Lock, dann
 * `git lfs checkout` über `checkout` (der Sync legt dort den Write-Lock um den Aufruf, weil sich
 * nur dabei der Arbeitsbaum ändert). Scheitern ist ein Hinweis, kein Fehler; ohne git-lfs gibt es
 * nichts zu tun.
 */
export async function lfsPull(
  wc: string,
  remote: string,
  env: Env,
  checkout: (fn: () => Promise<unknown>) => Promise<unknown> = (fn) => fn(),
): Promise<string[]> {
  if (!(await lfsAvailable(wc))) return [];
  try {
    await setUpLfs(wc);
    await git(['lfs', 'fetch', remote, 'HEAD'], { cwd: wc, env: transportEnv(env) });
    await checkout(() => git(['lfs', 'checkout'], { cwd: wc }));
    return [];
  } catch (err) {
    return [`git lfs pull fehlgeschlagen: ${firstStderrLine(err)}`];
  }
}

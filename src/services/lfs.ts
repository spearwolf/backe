/**
 * git-lfs für Anhänge (backe.md §2.8): ob es läuft, und der LFS-Filter in der eigenen
 * `.git/config` der Arbeitskopie. Schreibpfad und Sync teilen sich Prüfung und Fehlermeldung.
 */
import { BackeError } from '../core/errors.ts';
import { git } from '../git/exec.ts';

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

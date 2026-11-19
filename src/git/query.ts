import { BackeError } from '../core/errors.ts';
import { git } from './exec.ts';

/** Physischer Pfad der Wurzel des Arbeitsverzeichnisses, `undefined` außerhalb eines Repos. */
export async function gitToplevel(cwd: string): Promise<string | undefined> {
  const r = await git(['rev-parse', '--show-toplevel'], { cwd, okExitCodes: [128] });
  if (r.exitCode === 128) {
    if (r.stderr.includes('not a git repository')) return undefined;
    throw new BackeError('unexpected', `git rev-parse fehlgeschlagen: ${r.stderr.trim()}`, {
      details: { cwd, stderr: r.stderr },
    });
  }
  return r.stdout.replace(/\n$/, '');
}

/** Alle Remotes mit URL; `origin` zuerst, danach nach Name. */
export async function gitRemotes(cwd: string): Promise<{ name: string; url: string }[]> {
  const r = await git(['config', '--get-regexp', '^remote\\..*\\.url$'], { cwd, okExitCodes: [1] });
  const remotes: { name: string; url: string }[] = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^remote\.(.+)\.url (.*)$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) remotes.push({ name: m[1], url: m[2] });
  }
  const rank = (name: string): number => (name === 'origin' ? 0 : 1);
  return remotes.sort(
    (a, b) => rank(a.name) - rank(b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

/**
 * Commits von `refs/heads/<branch>`, die in keinem Remote-Tracking-Ref enthalten sind
 * (`git rev-list --count <branch> --not --remotes`); ein Branch, den es nicht gibt, zählt 0.
 */
export async function unpushedCount(cwd: string, branch: string): Promise<number> {
  const ref = `refs/heads/${branch}`;
  const known = await git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
    cwd,
    okExitCodes: [1],
  });
  if (known.exitCode === 1) return 0;
  const r = await git(['rev-list', '--count', ref, '--not', '--remotes', '--'], { cwd });
  return Number(r.stdout.trim());
}

/**
 * Lokale Branches mit Commits, die in keinem Remote-Tracking-Ref stehen (`git rev-list --branches
 * --not --remotes` ist nicht leer), nach Name sortiert. Ohne Remotes zählt jeder Branch mit Commits.
 */
export async function branchesWithUnpushed(cwd: string): Promise<string[]> {
  const refs = await git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { cwd });
  const names = refs.stdout.split('\n').filter((n) => n !== '');
  const out: string[] = [];
  for (const name of names.sort()) {
    const r = await git(['rev-list', '--count', `refs/heads/${name}`, '--not', '--remotes', '--'], {
      cwd,
    });
    if (Number(r.stdout.trim()) > 0) out.push(name);
  }
  return out;
}

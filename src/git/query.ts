import { compareCodeUnits } from '../core/compare.ts';
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
  return remotes.sort((a, b) => rank(a.name) - rank(b.name) || compareCodeUnits(a.name, b.name));
}

/** URL des Git-Remotes `name`; `undefined`, wenn es ihn nicht gibt. */
export async function remoteUrl(cwd: string, name: string): Promise<string | undefined> {
  const r = await git(['config', '--get', `remote.${name}.url`], { cwd, okExitCodes: [1] });
  return r.exitCode === 1 ? undefined : r.stdout.replace(/\n$/, '');
}

/**
 * Lokale Branches mit Commits, die in keinem Remote-Tracking-Ref stehen (`git rev-list --branches
 * --not --remotes` ist nicht leer), nach Name sortiert. Ohne Remotes zählt jeder Branch mit Commits.
 */
export async function branchesWithUnpushed(cwd: string): Promise<string[]> {
  // `lstrip=2` statt `short`: Bei einem gleichnamigen Tag macht `short` aus `x` ein `heads/x`.
  const refs = await git(['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads/'], {
    cwd,
  });
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

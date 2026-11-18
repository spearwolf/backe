import { git } from './exec.ts';

/** Physischer Pfad der Wurzel des Arbeitsverzeichnisses, `undefined` außerhalb eines Repos. */
export async function gitToplevel(cwd: string): Promise<string | undefined> {
  const r = await git(['rev-parse', '--show-toplevel'], { cwd, okExitCodes: [128] });
  if (r.exitCode === 128) return undefined;
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

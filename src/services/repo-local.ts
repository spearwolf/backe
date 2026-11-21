/** Lokale Pfade der Repos (backe.md §2.11): `repo where` und `repo scan`. */
import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expandPath, physicalPath } from '../context/paths.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { updateUserConfig } from '../context/user-config.ts';
import { compareCodeUnits } from '../core/compare.ts';
import { BackeError } from '../core/errors.ts';
import { normalizeRepoUrl } from '../core/url.ts';
import { gitRemotes } from '../git/query.ts';
import { exists } from '../store/files.ts';
import { openSnapshot } from './read.ts';

const SCAN_DEPTH = 4;

/** Name → Registry → kanonische URL → `repos[<kanonisch>]` der User-Config (expandiert). */
export async function locateRepo(
  ctx: ResolvedContext,
  name: string,
): Promise<{ name: string; url: string; canonical: string; defaultRef?: string; path: string }> {
  const { snapshot: s } = await openSnapshot(ctx);
  const repo = s.repos.get(name);
  if (repo === undefined) {
    throw new BackeError('not_found', `Repo »${name}« nicht gefunden`, {
      hint: 'backe repo list zeigt die registrierten Repos',
    });
  }
  const { url, default_ref: defaultRef } = repo.data;
  const canonical = normalizeRepoUrl(url);
  const configured = ctx.userConfig.repos?.[canonical];
  if (configured === undefined) {
    throw new BackeError('not_found', `Kein lokaler Pfad für »${name}«`, {
      hint: `backe repo scan <verzeichnis> oder backe config set repos.${canonical} <pfad>`,
      details: { url, canonical, ...(defaultRef === undefined ? {} : { default_ref: defaultRef }) },
    });
  }
  const path = expandPath(configured, { home: ctx.homes.home, base: ctx.homes.home });
  if (!(await exists(path))) {
    throw new BackeError('not_found', `${path} existiert nicht`, {
      hint: `backe config set repos.${canonical} <pfad>`,
    });
  }
  return { name, url, canonical, ...(defaultRef === undefined ? {} : { defaultRef }), path };
}

export type ScanEntry = {
  name: string;
  path: string;
  status: 'new' | 'unchanged' | 'differs' | 'overwritten';
  previous?: string;
};

/** Git-Repos unter `dir` (Tiefe ≤ 4): ohne versteckte Verzeichnisse, `node_modules` und Symlinks. */
async function findClones(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (path: string, depth: number): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch (error) {
      if (depth > 0) return; // unlesbare Unterverzeichnisse werden übersprungen
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BackeError('not_found', `${path} existiert nicht`);
      }
      const code = (error as NodeJS.ErrnoException).code ?? String(error);
      throw new BackeError('validation', `${path} lässt sich nicht durchsuchen (${code})`);
    }
    if (entries.some((e) => e.name === '.git')) {
      found.push(path);
      return;
    }
    if (depth >= SCAN_DEPTH) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      await walk(join(path, e.name), depth + 1);
    }
  };
  await walk(dir, 0);
  return found;
}

async function canonicalRemotes(path: string): Promise<Set<string>> {
  const out = new Set<string>();
  let remotes: { url: string }[];
  try {
    remotes = await gitRemotes(path);
  } catch {
    return out; // kein lesbares Repo (kaputtes .git, fremder Besitzer): überspringen
  }
  for (const { url } of remotes) {
    try {
      out.add(normalizeRepoUrl(url));
    } catch {
      // Remote-URL ohne kanonische Form: kann nicht registriert sein
    }
  }
  return out;
}

/**
 * Sucht Clones registrierter Repos unter `dir` und trägt ihren Pfad in `repos` der User-Config ein
 * (eine Änderung je Lauf). Ein abweichender Eintrag bleibt, außer mit `force`; `dryRun` schreibt nichts.
 */
export async function scanRepos(
  ctx: ResolvedContext,
  dir: string,
  input: { force?: boolean; dryRun?: boolean },
): Promise<ScanEntry[]> {
  const { snapshot: s } = await openSnapshot(ctx);
  const registered = new Map<string, string>(); // kanonisch → erster Name
  for (const [name, { data }] of [...s.repos.entries()].sort(([a], [b]) =>
    compareCodeUnits(a, b),
  )) {
    const canonical = normalizeRepoUrl(data.url);
    if (!registered.has(canonical)) registered.set(canonical, name);
  }

  const matches: { name: string; canonical: string; path: string }[] = [];
  for (const clone of await findClones(dir)) {
    const path = await physicalPath(clone);
    for (const canonical of await canonicalRemotes(clone)) {
      const name = registered.get(canonical);
      if (name !== undefined) matches.push({ name, canonical, path });
    }
  }
  matches.sort((a, b) => compareCodeUnits(a.name, b.name) || compareCodeUnits(a.path, b.path));

  const current = new Map<string, string>(Object.entries(ctx.userConfig.repos ?? {}));
  const home = ctx.homes.home;
  const chosen = new Set<string>();
  const entries: ScanEntry[] = [];
  const edits: { path: string[]; value: string }[] = [];
  for (const { name, canonical, path } of matches) {
    const old = current.get(canonical);
    if (chosen.has(canonical)) {
      // Weiterer Clone desselben Repos in diesem Lauf: der erste (nach Pfad) gilt.
      entries.push({ name, path, status: 'differs', previous: old as string });
      continue;
    }
    if (old === undefined) {
      entries.push({ name, path, status: 'new' });
    } else if ((await physicalPath(expandPath(old, { home, base: home }))) === path) {
      entries.push({ name, path, status: 'unchanged' });
      chosen.add(canonical);
      continue;
    } else if (input.force === true) {
      entries.push({ name, path, status: 'overwritten', previous: old });
    } else {
      entries.push({ name, path, status: 'differs', previous: old });
      continue;
    }
    current.set(canonical, path);
    chosen.add(canonical);
    edits.push({ path: ['repos', canonical], value: path });
  }
  if (edits.length > 0 && input.dryRun !== true) {
    await updateUserConfig(ctx.homes.backeHome, () => edits);
  }
  return entries;
}

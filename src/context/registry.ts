import { join } from 'node:path';
import { BackeError } from '../core/errors.ts';
import type { UserConfig } from '../core/schemas.ts';
import { normalizeRepoUrl } from '../core/url.ts';
import { expandPath, type Homes } from './paths.ts';
import { type ConfigEdit, updateUserConfig } from './user-config.ts';

export type BacklogEntry = {
  name: string;
  remote?: string;
  user?: string;
  current: boolean;
  paths: Readonly<Record<string, string>>;
};

/** Alle registrierten Backlogs nach Name sortiert; `current` markiert den Eintrag aus `cfg.current`. */
export function listBacklogs(cfg: UserConfig): BacklogEntry[] {
  return Object.entries(cfg.backlogs ?? {})
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, entry]) => ({
      name,
      ...(entry.remote === undefined ? {} : { remote: entry.remote }),
      ...(entry.user === undefined ? {} : { user: entry.user }),
      current: cfg.current === name,
      paths: entry.paths ?? {},
    }));
}

/** Name des Backlogs mit dieser Remote (kanonischer Vergleich); `usage`, wenn `url` nicht normalisierbar ist. */
export function findBacklogByRemote(cfg: UserConfig, url: string): string | undefined {
  const wanted = normalizeRepoUrl(url);
  return Object.entries(cfg.backlogs ?? {}).find(
    ([, entry]) => entry.remote !== undefined && normalizeRepoUrl(entry.remote) === wanted,
  )?.[0];
}

export function managedClonePath(homes: Homes, backlog: string, handle: string): string {
  return join(homes.backeHome, 'backlogs', backlog, handle);
}

/** Gebundener Pfad der Working Copy (`~` → Home, relativ → `backeHome`), sonst der verwaltete Klon. */
export function workingCopyPath(
  cfg: UserConfig,
  homes: Homes,
  backlog: string,
  handle: string,
): string {
  const bound = cfg.backlogs?.[backlog]?.paths?.[handle];
  return bound === undefined
    ? managedClonePath(homes, backlog, handle)
    : expandPath(bound, { home: homes.home, base: homes.backeHome });
}

function unknownBacklog(name: string): BackeError {
  return new BackeError('not_found', `Backlog "${name}" ist nicht registriert`, {
    hint: 'backe backlog list',
  });
}

/** Legt `backlogs.<name>` an oder ergänzt ihn; alle Prüfungen laufen auf dem frisch gelesenen Stand. */
export async function registerBacklog(
  homes: Homes,
  entry: { name: string; remote?: string; handle?: string; path?: string },
): Promise<UserConfig> {
  const { name, remote, handle, path } = entry;
  return updateUserConfig(homes.backeHome, (cfg) => {
    if (path !== undefined && handle === undefined) {
      throw new BackeError('usage', '--path braucht --user (Handle), dem der Pfad gehört');
    }
    const existing = cfg.backlogs?.[name];
    const edits: ConfigEdit[] = [];
    if (remote !== undefined) {
      const canonical = normalizeRepoUrl(remote);
      if (existing?.remote !== undefined && normalizeRepoUrl(existing.remote) !== canonical) {
        throw new BackeError(
          'conflict',
          `Backlog "${name}" ist bereits mit einer anderen Remote registriert: ${existing.remote}`,
        );
      }
      const other = findBacklogByRemote(cfg, remote);
      if (other !== undefined && other !== name) {
        throw new BackeError(
          'conflict',
          `Die Remote ist bereits als Backlog "${other}" registriert`,
        );
      }
      if (existing?.remote === undefined)
        edits.push({ path: ['backlogs', name, 'remote'], value: remote });
    }
    if (path !== undefined && handle !== undefined) {
      edits.push({ path: ['backlogs', name, 'paths', handle], value: path });
    }
    if (existing === undefined && edits.length === 0) {
      edits.push({ path: ['backlogs', name], value: {} });
    }
    if (cfg.current === undefined) edits.push({ path: ['current'], value: name });
    return edits;
  });
}

export async function useBacklog(homes: Homes, name: string): Promise<UserConfig> {
  return updateUserConfig(homes.backeHome, (cfg) => {
    if (cfg.backlogs?.[name] === undefined) throw unknownBacklog(name);
    return [{ path: ['current'], value: name }];
  });
}

/** Entfernt nur den Registry-Eintrag; Identitäten und Dateien bleiben (Löschen ist `--purge`). */
export async function unregisterBacklog(
  homes: Homes,
  name: string,
): Promise<{ config: UserConfig; managedDir: string }> {
  const config = await updateUserConfig(homes.backeHome, (cfg) => {
    if (cfg.backlogs?.[name] === undefined) throw unknownBacklog(name);
    const edits: ConfigEdit[] = [{ path: ['backlogs', name], value: undefined }];
    if (cfg.current === name) edits.push({ path: ['current'], value: undefined });
    return edits;
  });
  return { config, managedDir: join(homes.backeHome, 'backlogs', name) };
}

export async function setIdentity(
  homes: Homes,
  backlog: string,
  handle: string,
  key: string,
): Promise<UserConfig> {
  return updateUserConfig(homes.backeHome, () => [
    { path: ['identities', backlog, handle, 'key'], value: key },
  ]);
}

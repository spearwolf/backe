import { join } from 'node:path';
import { compareCodeUnits } from '../core/compare.ts';
import { BackeError } from '../core/errors.ts';
import type { UserConfig } from '../core/schemas.ts';
import { normalizeRepoUrl } from '../core/url.ts';
import { expandPath, type Homes } from './paths.ts';
import { m } from './registry.messages.ts';
import { type ConfigEdit, updateUserConfig, userConfigPath } from './user-config.ts';

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
    .sort(([a], [b]) => compareCodeUnits(a, b))
    .map(([name, entry]) => ({
      name,
      ...(entry.remote === undefined ? {} : { remote: entry.remote }),
      ...(entry.user === undefined ? {} : { user: entry.user }),
      current: cfg.current === name,
      paths: entry.paths ?? {},
    }));
}

/** Name des Backlogs mit dieser Remote (kanonischer Vergleich); `validation`, wenn `url` nicht normalisierbar ist. */
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
  return new BackeError('not_found', m.backlogNotRegistered(name), {
    hint: 'backe backlog list',
  });
}

/** Legt `backlogs.<name>` an oder ergänzt ihn; alle Prüfungen laufen auf dem frisch gelesenen Stand. */
export async function registerBacklog(
  homes: Homes,
  entry: { name: string; remote?: string; handle?: string; path?: string },
): Promise<UserConfig> {
  return (await registerBacklogTracked(homes, entry)).config;
}

/**
 * Wie `registerBacklog`, liefert aber zusätzlich den Stand, den der Aufruf unter dem Config-Lock
 * vorgefunden hat: Was davor schon registriert oder gebunden war, ist nicht Sache eines Rollbacks.
 */
export async function registerBacklogTracked(
  homes: Homes,
  entry: { name: string; remote?: string; handle?: string; path?: string },
): Promise<{ config: UserConfig; before: UserConfig }> {
  const { name, remote, handle, path } = entry;
  let before: UserConfig = {};
  const config = await updateUserConfig(homes.backeHome, (cfg) => {
    before = cfg;
    if (path !== undefined && handle === undefined) {
      throw new BackeError('usage', m.pathNeedsUser);
    }
    const existing = cfg.backlogs?.[name];
    const edits: ConfigEdit[] = [];
    if (remote !== undefined) {
      const canonical = normalizeRepoUrl(remote);
      if (existing?.remote !== undefined && normalizeRepoUrl(existing.remote) !== canonical) {
        throw new BackeError('conflict', m.backlogOtherRemote(name, existing.remote));
      }
      const other = findBacklogByRemote(cfg, remote);
      if (other !== undefined && other !== name) {
        throw new BackeError('conflict', m.remoteAlreadyRegistered(other));
      }
      if (existing?.remote === undefined)
        edits.push({ path: ['backlogs', name, 'remote'], value: remote });
    }
    if (path !== undefined && handle !== undefined) {
      const bound = existing?.paths?.[handle];
      if (bound !== undefined) {
        const expand = (p: string) => expandPath(p, { home: homes.home, base: homes.backeHome });
        if (expand(bound) !== expand(path)) {
          throw new BackeError('conflict', m.handleAlreadyBound(handle, name, bound), {
            hint: m.handleAlreadyBoundHint(handle, userConfigPath(homes.backeHome)),
          });
        }
      } else {
        edits.push({ path: ['backlogs', name, 'paths', handle], value: path });
      }
    }
    if (existing === undefined && edits.length === 0) {
      edits.push({ path: ['backlogs', name], value: {} });
    }
    if (cfg.current === undefined) edits.push({ path: ['current'], value: name });
    return edits;
  });
  return { config, before };
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

/**
 * Nimmt zurück, was ein `registerBacklog` an einem schon bestehenden Eintrag ergänzt hat: die
 * Bindung `paths.<handle>`, falls verlangt die Remote und, falls der Aufruf `current` gesetzt hat
 * (`current: true`), auch diesen Verweis. Der Eintrag selbst bleibt; ein fehlender Eintrag ist
 * kein Fehler.
 */
export async function revertBinding(
  homes: Homes,
  name: string,
  undo: { handle?: string; remote?: boolean; current?: boolean },
): Promise<UserConfig> {
  return updateUserConfig(homes.backeHome, (cfg) => {
    const entry = cfg.backlogs?.[name];
    const edits: ConfigEdit[] = [];
    if (entry === undefined) return edits;
    if (undo.handle !== undefined && entry.paths?.[undo.handle] !== undefined) {
      edits.push({ path: ['backlogs', name, 'paths', undo.handle], value: undefined });
    }
    if (undo.remote === true && entry.remote !== undefined) {
      edits.push({ path: ['backlogs', name, 'remote'], value: undefined });
    }
    if (undo.current === true && cfg.current === name) {
      edits.push({ path: ['current'], value: undefined });
    }
    return edits;
  });
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

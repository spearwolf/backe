import { mkdir, readFile, rm } from 'node:fs/promises';
import type { z } from 'zod';
import { withFileLock } from '../context/lock.ts';
import type { Homes } from '../context/paths.ts';
import {
  configLockPath,
  parseUserConfigText,
  readUserConfig,
  updateUserConfig,
  userConfigPath,
} from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import { type UserConfig, UserConfigSchema } from '../core/schemas.ts';
import { normalizeRepoUrl } from '../core/url.ts';
import { writeFileAtomic } from '../store/files.ts';

/**
 * Spec backe.md §2.15.1 (`config`-Pfade): `a.b.c`; unter `repos.` ist der ganze Rest ein Key und
 * wird kanonisiert. Die Struktur kommt aus `UserConfigSchema`, nicht aus einer Parallel-Tabelle.
 */

type Level =
  | { kind: 'object'; shape: Record<string, z.core.$ZodType> }
  | { kind: 'record'; value: z.core.$ZodType }
  | { kind: 'leaf' };

/** Löst optional/default/nullable-Hüllen auf und beschreibt die Ebene dahinter. */
function levelOf(schema: z.core.$ZodType): Level {
  let def = (schema as z.core.$ZodTypes)._zod.def;
  while (def.type === 'optional' || def.type === 'default' || def.type === 'nullable') {
    def = (def.innerType as z.core.$ZodTypes)._zod.def;
  }
  if (def.type === 'object')
    return { kind: 'object', shape: def.shape as Record<string, z.core.$ZodType> };
  if (def.type === 'record') return { kind: 'record', value: def.valueType };
  if (def.type === 'string' || def.type === 'enum') return { kind: 'leaf' };
  throw new Error(`UserConfigSchema: Typ »${def.type}« wird von config nicht unterstützt`);
}

/** Top-Level-Keys der Config-Struktur (für den Abgleich mit dem Schema im Test). */
export function configKeyShape(): Record<string, true> {
  const level = levelOf(UserConfigSchema);
  if (level.kind !== 'object') throw new Error('UserConfigSchema ist kein Objekt');
  return Object.fromEntries(Object.keys(level.shape).map((k) => [k, true]));
}

type Resolved = { path: string[]; leaf: boolean };

function splitKey(key: string): string[] {
  // Nur `repos` behält den Rest als einen Key; das schließt Punkte in URLs ein.
  if (key === 'repos' || !key.startsWith('repos.')) return key.split('.');
  return ['repos', key.slice('repos.'.length)];
}

function resolveKey(key: string): Resolved {
  const segments = splitKey(key);
  let level = levelOf(UserConfigSchema);
  const path: string[] = [];
  for (const [i, segment] of segments.entries()) {
    const prefix = path.length === 0 ? '' : ` (unter »${path.join('.')}«)`;
    if (level.kind === 'leaf') {
      throw new BackeError('validation', `»${path.join('.')}« hat keine Unterkeys`);
    }
    if (level.kind === 'object') {
      const next = level.shape[segment];
      if (next === undefined) {
        throw new BackeError(
          'validation',
          `Unbekannter Key »${segment}«; erlaubt: ${Object.keys(level.shape).join(', ')}`,
        );
      }
      path.push(segment);
      level = levelOf(next);
    } else {
      if (segment === '') throw new BackeError('validation', `Leerer Key${prefix}`);
      path.push(
        path.length === 1 && path[0] === 'repos' && i === 1 ? normalizeRepoUrl(segment) : segment,
      );
      level = levelOf(level.value);
    }
  }
  return { path, leaf: level.kind === 'leaf' };
}

/** Zerlegt einen Key in seinen Pfad; nur String-Blätter des Schemas sind setzbar. */
export function parseConfigKey(key: string): string[] {
  const { path, leaf } = resolveKey(key);
  if (!leaf) throw new BackeError('validation', `»${key}« ist kein setzbarer Wert`);
  return path;
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function lookup(config: UserConfig, path: readonly string[]): unknown {
  let node: unknown = config;
  for (const segment of path) {
    if (typeof node !== 'object' || node === null || !Object.hasOwn(node, segment))
      return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/** Ohne Key: Dateitext (falls vorhanden) und geparste Config; mit Key: der Wert an dieser Stelle. */
export async function getConfig(
  homes: Homes,
  key?: string,
): Promise<{ text?: string; config: UserConfig; value?: unknown }> {
  const config = await readUserConfig(homes.backeHome);
  if (key === undefined) {
    const text = await readText(userConfigPath(homes.backeHome));
    return text === undefined ? { config } : { text, config };
  }
  const { path } = resolveKey(key);
  const value = lookup(config, path);
  if (value === undefined) {
    throw new BackeError('not_found', `»${key}« ist nicht gesetzt`);
  }
  return { config, value };
}

/** Setzt einen String-Wert; `undefined` entfernt den Key (fehlender Key: No-op). */
export async function setConfig(
  homes: Homes,
  key: string,
  value: string | undefined,
): Promise<UserConfig> {
  const path = parseConfigKey(key);
  return updateUserConfig(homes.backeHome, (current) =>
    value === undefined && lookup(current, path) === undefined ? [] : [{ path, value }],
  );
}

/**
 * `edit` bekommt den Dateitext (fehlt die Datei: `{}`; ist er ungültig: so wie er ist) und liefert
 * den neuen. Ungültiges Ergebnis oder eine zwischenzeitlich geänderte Datei lassen das Original
 * unberührt; der Entwurf bleibt in `config.jsonc.draft`, und `datei:zeile` eines ungültigen
 * Ergebnisses nennt ihn.
 */
export async function editConfigText(
  homes: Homes,
  edit: (text: string) => Promise<string>,
): Promise<{ changed: boolean }> {
  const file = userConfigPath(homes.backeHome);
  const draft = `${file}.draft`;
  await mkdir(homes.backeHome, { recursive: true, mode: 0o700 });
  const original = await readText(file);
  const start = original ?? '{}\n';
  const edited = await edit(start);
  if (edited === start) return { changed: false };

  const keepDraft = async (): Promise<string> => {
    await writeFileAtomic(draft, edited);
    return `Dein Entwurf liegt in ${draft}`;
  };

  try {
    parseUserConfigText(edited, draft);
  } catch (error) {
    if (!(error instanceof BackeError)) throw error;
    throw new BackeError(error.code, error.message, { hint: await keepDraft() });
  }

  await withFileLock(configLockPath(homes.backeHome), async () => {
    if ((await readText(file)) !== original) {
      throw new BackeError(
        'conflict',
        `${file} hat sich geändert, seit der Editor gestartet wurde`,
        {
          hint: await keepDraft(),
        },
      );
    }
    await writeFileAtomic(file, edited);
  });
  await rm(draft, { force: true });
  return { changed: true };
}

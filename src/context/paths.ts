import { access, constants, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { type Env, envValue } from '../core/env.ts';
import { BackeError } from '../core/errors.ts';
import { isMissing } from '../store/files.ts';
import { m } from './paths.messages.ts';

export { type Env, envValue } from '../core/env.ts';
export type Homes = { home: string; backeHome: string };

/** Expandiert `~` und relative Pfade, normalisiert; greift nie auf das Dateisystem zu. */
export function expandPath(p: string, opts: { home: string; base: string }): string {
  if (p === '~') return resolve(opts.home);
  if (p.startsWith('~/')) return resolve(opts.home, p.slice(2));
  if (p.startsWith('~')) {
    throw new BackeError('validation', m.tildeUserUnsupported(p), {
      hint: m.tildeUserHint,
    });
  }
  return resolve(opts.base, p);
}

/** Home-Verzeichnis und BACKE_HOME (Default `<home>/.backe`) aus `env`, nie aus `process.env`. */
export function resolveHomes(env: Env, cwd: string): Homes {
  const home = envValue(env, 'HOME') ?? homedir();
  const configured = envValue(env, 'BACKE_HOME');
  if (configured === undefined) return { home, backeHome: join(home, '.backe') };
  try {
    return { home, backeHome: expandPath(configured, { home, base: cwd }) };
  } catch (error) {
    // expandPath wirft nur `validation`; die Variable gehört in die Meldung.
    const e = error as BackeError;
    throw new BackeError('validation', `BACKE_HOME: ${e.message}`, {
      ...(e.hint === undefined ? {} : { hint: e.hint }),
    });
  }
}

/** `realpath`; fehlt `p`, `realpath` des nächsten existierenden Vorfahren plus der Rest. */
export async function physicalPath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch (error) {
    if (!isMissing(error)) throw error;
    const parent = dirname(p);
    // Wurzel erreicht: kann nicht fehlen, aber die Rekursion muss terminieren.
    if (parent === p) throw error;
    return join(await physicalPath(parent), basename(p));
  }
}

/** Zeigen beide Pfade (über Symlinks hinweg) auf dieselbe Stelle? */
export async function samePath(a: string, b: string): Promise<boolean> {
  return (await physicalPath(a)) === (await physicalPath(b));
}

/**
 * Das Programm `bin` aus den absoluten Einträgen von `PATH` in `env`. Leere und relative Einträge
 * zählen nicht: Sie meinen das Arbeitsverzeichnis, und ein `git` dort soll das echte nicht
 * überschatten.
 */
export async function findOnPath(env: Env, bin: string): Promise<string | undefined> {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!isAbsolute(dir)) continue;
    const file = join(dir, bin);
    try {
      await access(file, constants.X_OK);
      if ((await stat(file)).isFile()) return file;
    } catch {
      // nicht in diesem Verzeichnis
    }
  }
  return undefined;
}

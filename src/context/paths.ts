import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { BackeError } from '../core/errors.ts';

export type Env = Readonly<Record<string, string | undefined>>;
export type Homes = { home: string; backeHome: string };

/** Wert einer Umgebungsvariable; ein leerer String zählt als nicht gesetzt. */
export function envValue(env: Env, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Expandiert `~` und relative Pfade, normalisiert; greift nie auf das Dateisystem zu. */
export function expandPath(p: string, opts: { home: string; base: string }): string {
  if (p === '~') return resolve(opts.home);
  if (p.startsWith('~/')) return resolve(opts.home, p.slice(2));
  if (p.startsWith('~')) {
    throw new BackeError('validation', `Pfad »${p}«: ~name wird nicht unterstützt`, {
      hint: 'Nutze ~/… oder einen absoluten Pfad.',
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

/** Fehlt der Pfad (oder ist ein Vorfahr kein Verzeichnis)? Nur `ENOENT` und `ENOTDIR` zählen so. */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Macht aus einem unerwarteten Dateisystemfehler eine `unexpected`-Meldung `<pfad>: <code>`. */
export function fsFailure(path: string, error: unknown): BackeError {
  if (error instanceof BackeError) return error;
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return new BackeError('unexpected', `${path}: ${code ?? String(error)}`, { details: { path } });
}

/** Gibt es `path`? `false` nur bei `ENOENT`/`ENOTDIR`; jeder andere Fehler ist `unexpected`. */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw fsFailure(path, error);
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

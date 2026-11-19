/**
 * Eine Arbeitskopie je Identität (backe.md §2.16.1): `backe` klont sie selbst nach
 * `<BACKE_HOME>/backlogs/<backlog>/<handle>/`, mit Vertrauensanker, Identität und Verify.
 * Geklont und geprüft wird in `<BACKE_HOME>/tmp` ohne Lock; erst der Abschluss läuft unter dem
 * Config-Lock und verschiebt den fertigen Clone per `rename` an sein Ziel.
 */
import { randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { withFileLock } from '../context/lock.ts';
import type { Env, Homes } from '../context/paths.ts';
import { managedClonePath, registerBacklog, workingCopyPath } from '../context/registry.ts';
import { type ResolvedContext, readBacklogName } from '../context/resolve.ts';
import {
  configLockPath,
  readUserConfig,
  schemaError,
  userConfigPath,
} from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import { isHandle } from '../core/names.ts';
import { BacklogConfigSchema } from '../core/schemas.ts';
import { git, transportEnv } from '../git/exec.ts';
import { rootCommits } from '../git/history.ts';
import { readLocalState, writeLocalState } from '../git/local-state.ts';
import { headState } from '../git/repo.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { assertVerified, verifyRange } from './verify.ts';

/** Nur für Tests: läuft zwischen Clone und Abschluss. */
export type CloneHooks = { beforeFinish?: () => Promise<void> };

export type CloneResult = { name: string; root: string; notices: string[] };

/** Nur was der Clone braucht; unbekannte Felder einer neueren Formatversion stören nicht. */
const CloneConfigSchema = z.object({
  sync: BacklogConfigSchema.shape.sync,
  verify: BacklogConfigSchema.shape.verify,
});
type CloneConfig = z.infer<typeof CloneConfigSchema>;

const short = (sha: string) => sha.slice(0, 7);

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Führt `fn` mit einem frischen Temp-Pfad aus und räumt ihn danach immer weg. */
async function withTempClone<T>(homes: Homes, fn: (temp: string) => Promise<T>): Promise<T> {
  const dir = join(homes.backeHome, 'tmp');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `clone-${randomBytes(6).toString('hex')}`);
  try {
    return await fn(temp);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function readCloneConfig(wc: string, source: string): Promise<CloneConfig> {
  let text: string;
  try {
    text = await readFile(join(wc, BACKLOG_CONFIG), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new BackeError('validation', `${source} ist kein Backlog: ${BACKLOG_CONFIG} fehlt`);
  }
  const result = CloneConfigSchema.safeParse(readJsonc(text, BACKLOG_CONFIG));
  if (!result.success) throw schemaError(BACKLOG_CONFIG, result.error);
  return result.data;
}

/** Der Vertrauensanker eines Clones ohne Referenz: die einzige Wurzel von `HEAD`. */
async function singleRoot(wc: string, source: string): Promise<string> {
  const roots = await rootCommits(wc, 'HEAD');
  if (roots.length !== 1) {
    throw new BackeError(
      'verify',
      `Historie von ${source} hat ${roots.length} Wurzel-Commits, erwartet genau einen`,
    );
  }
  return roots[0] as string;
}

/** Prüft je `verify`-Modus: `strict` wirft bei ungültigen Commits, `warn` meldet ihre Gründe. */
async function verifyClone(wc: string, mode: CloneConfig['verify']): Promise<string[]> {
  if (mode === 'off') return [];
  const report = await verifyRange(wc, { record: true });
  if (mode === 'strict') assertVerified(report);
  const reasons = report.invalid.flatMap((f) => f.reasons.map((r) => `${short(f.sha)}: ${r}`));
  return [...reasons, ...report.notices];
}

/**
 * Klont `source` nach `temp` (mit `--reference`, falls angegeben), steht danach auf dem
 * Sync-Branch und hat Anker, Identität und je `verify`-Modus den verifizierten Stand.
 * `checkName` prüft den Backlog-Namen vor Anker und Verify.
 */
async function cloneInto(input: {
  env: Env;
  source: string;
  reference?: string;
  temp: string;
  handle: string;
  checkName: (name: string) => void;
}): Promise<{ name: string; notices: string[] }> {
  const { env, source, reference, temp, handle } = input;
  const ref = reference === undefined ? [] : ['--reference', reference];
  await git(['clone', '-q', ...ref, '--', source, temp], {
    cwd: dirname(temp),
    env: transportEnv(env),
  });
  let config = await readCloneConfig(temp, source);
  if ((await headState(temp)).branch !== config.sync.branch) {
    await git(['switch', '-q', config.sync.branch], { cwd: temp });
    config = await readCloneConfig(temp, source);
  }
  const name = (await readBacklogName(temp)) as string;
  input.checkName(name);
  const anchor =
    (reference === undefined ? undefined : await readLocalState(reference, 'anchor')) ??
    (await singleRoot(temp, source));
  await writeLocalState(temp, 'anchor', anchor);
  await writeLocalState(temp, 'identity', handle);
  return { name, notices: await verifyClone(temp, config.verify) };
}

async function isWorkingCopyOf(dir: string, name: string): Promise<boolean> {
  try {
    return (await readBacklogName(dir)) === name;
  } catch (error) {
    if (error instanceof BackeError) return false;
    throw error;
  }
}

/**
 * Abschluss unter dem Config-Lock: Backlog noch registriert, Ziel noch frei, dann `rename`.
 * Hat ein anderer Prozess das Ziel schon als gültige Arbeitskopie angelegt, gilt dessen Clone.
 */
async function finish(homes: Homes, name: string, temp: string, target: string): Promise<string> {
  return withFileLock(configLockPath(homes.backeHome), async () => {
    const cfg = await readUserConfig(homes.backeHome);
    if (cfg.backlogs?.[name] === undefined) {
      throw new BackeError('conflict', `Backlog ${name} wurde während des Klonens entfernt`);
    }
    if (await exists(target)) {
      if (await isWorkingCopyOf(target, name)) return target;
      throw new BackeError(
        'conflict',
        `${target} existiert, ist aber keine Arbeitskopie von ${name}`,
        {
          hint: `${target} prüfen und entfernen`,
        },
      );
    }
    await mkdir(dirname(target), { recursive: true });
    await rename(temp, target);
    return target;
  });
}

/**
 * `backe backlog clone` (backe.md §2.14): registriert die Remote und klont die Arbeitskopie des
 * Handles. Lokale Aliasnamen gibt es in v1 nicht: `name` muss dem Namen im Backlog entsprechen.
 */
export async function cloneBacklog(
  input: { homes: Homes; env: Env; url: string; handle: string; name?: string },
  hooks: CloneHooks = {},
): Promise<CloneResult> {
  const { homes, env, url, handle } = input;
  if (!isHandle(handle)) {
    throw new BackeError('usage', `Ungültiger Handle »${handle}«`, {
      hint: 'Erlaubt sind Kleinbuchstaben, Ziffern und Bindestriche (2 bis 32 Zeichen); »me« ist reserviert.',
    });
  }
  return withTempClone(homes, async (temp) => {
    const { name, notices } = await cloneInto({
      env,
      source: url,
      temp,
      handle,
      checkName: (actual) => {
        if (input.name === undefined || input.name === actual) return;
        throw new BackeError('validation', `Der Backlog heißt "${actual}", nicht "${input.name}"`, {
          hint: '--name weglassen; lokale Aliasnamen gibt es in v1 nicht.',
        });
      },
    });
    await registerBacklog(homes, { name, remote: url });
    await hooks.beforeFinish?.();
    const root = await finish(homes, name, temp, managedClonePath(homes, name, handle));
    return { name, root, notices };
  });
}

/**
 * Die Arbeitskopie des Handles; fehlt eine verwaltete, wird sie geklont (backe.md §2.16.1):
 * aus der registrierten Remote, ohne Remote aus der gelesenen Arbeitskopie, mit dieser als
 * `--reference`. Eine vorhandene Arbeitskopie kommt ohne Netzzugriff zurück.
 */
export async function ensureWorkingCopy(ctx: ResolvedContext, handle: string): Promise<string> {
  const name = ctx.backlog.value;
  const wc = workingCopyPath(ctx.userConfig, ctx.homes, name, handle);
  if (await exists(join(wc, BACKLOG_CONFIG))) return wc;
  const entry = ctx.userConfig.backlogs?.[name];
  if (entry?.paths?.[handle] !== undefined) {
    throw new BackeError('not_found', `Arbeitskopie ${wc} fehlt`, {
      hint: `backe backlog add ${name} <pfad> --as ${handle} oder paths.${handle} in ${userConfigPath(ctx.homes.backeHome)} entfernen`,
    });
  }
  const root = ctx.backlog.root;
  const reference =
    root !== undefined && (await exists(join(root, BACKLOG_CONFIG))) ? root : undefined;
  const source = entry?.remote ?? reference;
  if (source === undefined) {
    throw new BackeError('not_found', `Keine Quelle zum Klonen von Backlog ${name}`, {
      hint: 'backe backlog clone <url>',
    });
  }
  return withTempClone(ctx.homes, async (temp) => {
    await cloneInto({
      env: ctx.env,
      source,
      ...(reference === undefined ? {} : { reference }),
      temp,
      handle,
      checkName: (actual) => {
        if (actual === name) return;
        throw new BackeError(
          'validation',
          `${source}: gehört zum Backlog "${actual}", erwartet wurde "${name}"`,
        );
      },
    });
    return finish(ctx.homes, name, temp, wc);
  });
}

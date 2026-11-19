/**
 * Eine Arbeitskopie je Identität (backe.md §2.16.1): `backe` klont sie selbst nach
 * `<BACKE_HOME>/backlogs/<backlog>/<handle>/`, mit Vertrauensanker, Identität und Verify.
 * Geklont und geprüft wird in `<BACKE_HOME>/tmp` ohne Lock; erst der Abschluss läuft unter dem
 * Config-Lock und verschiebt den fertigen Clone per `rename` an sein Ziel.
 */
import { randomBytes } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { z } from 'zod';
import { withFileLock } from '../context/lock.ts';
import { type Env, expandPath, type Homes, physicalPath, samePath } from '../context/paths.ts';
import {
  type BacklogEntry,
  listBacklogs,
  managedClonePath,
  registerBacklog,
  unregisterBacklog,
  workingCopyPath,
} from '../context/registry.ts';
import { fallbackRoot, type ResolvedContext, readBacklogName } from '../context/resolve.ts';
import {
  configLockPath,
  readUserConfig,
  schemaError,
  userConfigPath,
} from '../context/user-config.ts';
import { BackeError } from '../core/errors.ts';
import { isHandle } from '../core/names.ts';
import { BacklogConfigSchema, type UserConfig } from '../core/schemas.ts';
import { git, transportEnv } from '../git/exec.ts';
import { isAncestor, readBlobs, resolveCommit, rootCommits } from '../git/history.ts';
import { readLocalState, writeLocalState } from '../git/local-state.ts';
import { gitRemotes, gitToplevel } from '../git/query.ts';
import { headState } from '../git/repo.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { firstStderrLine } from './init.ts';
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

/**
 * `verify`-Modus des letzten vertrauenswürdigen Stands: der Config im Parent von `sha`. Ein
 * ungültiger Commit darf den Modus, nach dem er beurteilt wird, nicht selbst setzen. Ohne Parent
 * (der Anker ist ungültig) oder ohne lesbare Config gilt `strict`.
 */
async function trustedMode(wc: string, sha: string): Promise<CloneConfig['verify']> {
  const spec = `${sha}^:${BACKLOG_CONFIG}`;
  const blob = (await readBlobs(wc, [spec])).get(spec);
  if (blob === null || blob === undefined) return 'strict';
  try {
    const result = CloneConfigSchema.safeParse(readJsonc(blob.toString('utf8'), BACKLOG_CONFIG));
    return result.success ? result.data.verify : 'strict';
  } catch (error) {
    if (error instanceof BackeError) return 'strict';
    throw error;
  }
}

/**
 * Prüft den Clone und zeichnet den verifizierten Stand auf. Gibt es ungültige Commits, entscheidet
 * der Modus vor dem ersten davon: `strict` wirft, `warn` meldet die Gründe, `off` behält still.
 */
async function verifyClone(wc: string): Promise<string[]> {
  const report = await verifyRange(wc, { record: true });
  const first = report.invalid[0];
  if (first === undefined) return report.notices;
  const mode = await trustedMode(wc, first.sha);
  if (mode === 'strict') assertVerified(report);
  if (mode === 'off') return [];
  const reasons = report.invalid.flatMap((f) => f.reasons.map((r) => `${short(f.sha)}: ${r}`));
  return [...reasons, ...report.notices];
}

/** `HEAD` von `wc` enthält `sha`; fehlt das Objekt in `wc`, ist es kein Vorfahre. */
async function descendsFrom(wc: string, sha: string): Promise<boolean> {
  try {
    await resolveCommit(wc, sha);
  } catch (error) {
    if (error instanceof BackeError && error.code === 'not_found') return false;
    throw error;
  }
  return isAncestor(wc, sha, 'HEAD');
}

/**
 * Referenz für einen Clone: `path` leiht Objekte; `dissociate` kopiert sie nach dem Transfer, damit
 * der neue Clone nicht an einem Verzeichnis hängt, das der Nutzer jederzeit löschen kann.
 */
type Reference = { path: string; dissociate: boolean };

/** Klont per git; scheitert git selbst (Netz, Auth, fehlende Quelle), ist das ein `sync`-Fehler. */
async function gitClone(
  env: Env,
  source: string,
  reference: Reference | undefined,
  temp: string,
): Promise<void> {
  const ref =
    reference === undefined
      ? []
      : ['--reference', reference.path, ...(reference.dissociate ? ['--dissociate'] : [])];
  try {
    await git(['clone', '-q', ...ref, '--', source, temp], {
      cwd: dirname(temp),
      env: transportEnv(env),
    });
  } catch (error) {
    const ran =
      error instanceof BackeError &&
      (error.details as { exitCode?: number } | undefined)?.exitCode !== undefined;
    if (!ran) throw error;
    throw new BackeError('sync', `Clone von ${source} fehlgeschlagen: ${firstStderrLine(error)}`);
  }
}

/**
 * Klont `source` nach `temp` (mit `--reference`, falls angegeben), steht danach auf dem
 * Sync-Branch und hat Anker, Identität und den verifizierten Stand. `trust` prüft den
 * Backlog-Namen und nennt eine vorhandene Arbeitskopie desselben Backlogs: Von ihr kommen Anker
 * und zuletzt verifizierter Stand, und der Clone muss davon abstammen. Ohne sie gilt die einzige
 * Wurzel als Anker.
 */
async function cloneInto(input: {
  env: Env;
  source: string;
  reference?: Reference;
  temp: string;
  handle: string;
  trust: (name: string) => Promise<string | undefined>;
}): Promise<{ name: string; notices: string[] }> {
  const { env, source, reference, temp, handle } = input;
  await gitClone(env, source, reference, temp);
  const { sync } = await readCloneConfig(temp, source);
  if ((await headState(temp)).branch !== sync.branch) {
    await git(['switch', '-q', sync.branch], { cwd: temp });
  }
  const name = (await readBacklogName(temp)) as string;
  const trusted = await input.trust(name);
  const anchor =
    (trusted === undefined ? undefined : await readLocalState(trusted, 'anchor')) ??
    (await singleRoot(temp, source));
  await writeLocalState(temp, 'anchor', anchor);
  const verified = trusted === undefined ? undefined : await readLocalState(trusted, 'verified');
  if (verified !== undefined) {
    if (!(await descendsFrom(temp, verified))) {
      throw new BackeError(
        'verify',
        `${source} ist kein Nachfahre des zuletzt verifizierten Stands ${short(verified)}`,
      );
    }
    await writeLocalState(temp, 'verified', verified);
  }
  await writeLocalState(temp, 'identity', handle);
  return { name, notices: await verifyClone(temp) };
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
      trust: async (actual) => {
        if (input.name !== undefined && input.name !== actual) {
          throw new BackeError(
            'validation',
            `Der Backlog heißt "${actual}", nicht "${input.name}"`,
            { hint: '--name weglassen; lokale Aliasnamen gibt es in v1 nicht.' },
          );
        }
        const cfg = await readUserConfig(homes.backeHome);
        const existing = await fallbackRoot(cfg, homes, actual, undefined);
        return existing !== undefined && (await isWorkingCopyOf(existing, actual))
          ? existing
          : undefined;
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
 * aus der registrierten Remote, ohne Remote aus der gelesenen Arbeitskopie. Die gelesene
 * Arbeitskopie dient als `--reference` (ein gebundener Clone nur mit `--dissociate`) und als
 * Quelle für Anker und verifizierten Stand.
 * Eine vorhandene Arbeitskopie kommt ohne Netzzugriff zurück; `notices` hat nur ein Clone im
 * Modus `warn`.
 */
export async function ensureWorkingCopy(
  ctx: ResolvedContext,
  handle: string,
): Promise<{ root: string; notices: string[] }> {
  const name = ctx.backlog.value;
  const wc = workingCopyPath(ctx.userConfig, ctx.homes, name, handle);
  if (await exists(join(wc, BACKLOG_CONFIG))) return { root: wc, notices: [] };
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
  // Dauerhaft Objekte leihen darf der neue Clone nur von einem verwalteten Clone; ein gebundener
  // gehört dem Nutzer, der ihn jederzeit löschen kann.
  const managed =
    reference !== undefined &&
    (await samePath(reference, managedClonePath(ctx.homes, name, basename(reference))));
  return withTempClone(ctx.homes, async (temp) => {
    const { notices } = await cloneInto({
      env: ctx.env,
      source,
      ...(reference === undefined ? {} : { reference: { path: reference, dissociate: !managed } }),
      temp,
      handle,
      trust: async (actual) => {
        if (actual !== name) {
          throw new BackeError(
            'validation',
            `${source}: gehört zum Backlog "${actual}", erwartet wurde "${name}"`,
          );
        }
        return reference;
      },
    });
    return { root: await finish(ctx.homes, name, temp, wc), notices };
  });
}

/** Die Arbeitskopie `wc` gehört `identity`; die von `handle` liegt unter `own`. */
export function identityMismatch(
  wc: string,
  identity: string,
  handle: string,
  own: string,
): BackeError {
  return new BackeError(
    'usage',
    `Die Arbeitskopie ${wc} gehört "${identity}"; die Arbeitskopie von "${handle}" ist ${own}`,
  );
}

/**
 * `backe backlog add` (backe.md §2.14): bindet einen vorhandenen Clone an eine Identität. Der
 * Clone gehört dem Nutzer und wird nie angefasst außer um Identität, Anker und verifizierten
 * Stand in seinem lokalen Zustand.
 */
export async function addBacklog(input: {
  homes: Homes;
  env: Env;
  name: string;
  path: string;
  handle: string;
}): Promise<{ root: string; notices: string[] }> {
  const { homes, name, handle } = input;
  if (!isAbsolute(input.path)) {
    throw new BackeError('usage', `Pfad muss absolut sein: ${input.path}`);
  }
  const wanted = await physicalPath(input.path);
  const top = await gitToplevel(wanted).catch(() => undefined);
  const actual = top === wanted ? await readBacklogName(wanted) : undefined;
  if (top !== wanted || actual !== name) {
    throw new BackeError(
      'validation',
      `${input.path} ist keine Arbeitskopie des Backlogs "${name}" (Git-Toplevel: ${top ?? 'keines'}, Backlog: ${actual ?? 'keiner'}, erwartet: ${wanted})`,
    );
  }
  const cfg = await readUserConfig(homes.backeHome);
  const identity = await readLocalState(wanted, 'identity');
  if (identity === undefined) {
    await writeLocalState(wanted, 'identity', handle);
  } else if (identity !== handle) {
    throw identityMismatch(wanted, identity, handle, workingCopyPath(cfg, homes, name, handle));
  }
  const { sync } = await readCloneConfig(wanted, wanted);
  if ((await readLocalState(wanted, 'anchor')) === undefined) {
    const sibling = await fallbackRoot(cfg, homes, name, handle);
    const known =
      sibling !== undefined &&
      !(await samePath(sibling, wanted)) &&
      (await isWorkingCopyOf(sibling, name))
        ? await readLocalState(sibling, 'anchor')
        : undefined;
    await writeLocalState(wanted, 'anchor', known ?? (await singleRoot(wanted, wanted)));
  }
  const notices = await verifyClone(wanted);
  const remote = (await gitRemotes(wanted)).find((r) => r.name === sync.remote)?.url;
  await registerBacklog(homes, {
    name,
    ...(remote === undefined ? {} : { remote }),
    handle,
    path: wanted,
  });
  return { root: wanted, notices };
}

/** `--purge` löscht nur verwaltete Clones: ein gebundener Pfad im verwalteten Verzeichnis blockiert es. */
async function assertNoBoundInManaged(homes: Homes, name: string): Promise<void> {
  const cfg = await readUserConfig(homes.backeHome);
  const managedDir = await physicalPath(join(homes.backeHome, 'backlogs', name));
  for (const [handle, bound] of Object.entries(cfg.backlogs?.[name]?.paths ?? {})) {
    const path = await physicalPath(expandPath(bound, { home: homes.home, base: homes.backeHome }));
    if (path === (await physicalPath(managedClonePath(homes, name, handle)))) continue;
    if (path.startsWith(managedDir + sep)) {
      throw new BackeError(
        'conflict',
        `${path} ist gebunden und liegt im verwalteten Verzeichnis`,
        {
          hint: `paths.${handle} in ${userConfigPath(homes.backeHome)} entfernen oder den Clone verschieben`,
        },
      );
    }
  }
}

/** Nur für Tests: läuft zwischen Deregistrieren und Löschen. */
export type RemoveHooks = { beforePurge?: () => Promise<void> };

/**
 * `backe backlog remove` (backe.md §2.14): deregistriert; `purge` löscht danach die verwalteten
 * Clones unter `<BACKE_HOME>/backlogs/<name>`, nie einen gebundenen Pfad. Wurde der Backlog
 * inzwischen neu registriert, bleibt alles stehen.
 */
export async function removeBacklog(
  input: { homes: Homes; name: string; purge?: boolean },
  hooks: RemoveHooks = {},
): Promise<{ purged: string | undefined }> {
  const { homes, name } = input;
  if (input.purge === true) await assertNoBoundInManaged(homes, name);
  const { managedDir } = await unregisterBacklog(homes, name);
  if (input.purge !== true) return { purged: undefined };
  await hooks.beforePurge?.();
  return withFileLock(configLockPath(homes.backeHome), async () => {
    const cfg = await readUserConfig(homes.backeHome);
    if (cfg.backlogs?.[name] !== undefined) {
      throw new BackeError('conflict', `Backlog ${name} wurde inzwischen neu registriert`, {
        hint: 'backe backlog remove --purge erneut ausführen',
      });
    }
    if (!(await exists(managedDir))) return { purged: undefined };
    await rm(managedDir, { recursive: true, force: true });
    return { purged: managedDir };
  });
}

export type WorkingCopyInfo = {
  handle: string;
  path: string;
  managed: boolean;
  exists: boolean;
  identity?: string;
  anchor?: string;
};

/** `backe backlog show` (backe.md §2.14): Eintrag samt allen bekannten Arbeitskopien. */
export async function showBacklog(
  homes: Homes,
  cfg: UserConfig,
  name: string,
): Promise<{ entry: BacklogEntry; workingCopies: WorkingCopyInfo[] }> {
  const entry = listBacklogs(cfg).find((e) => e.name === name);
  if (entry === undefined) {
    throw new BackeError('not_found', `Backlog "${name}" ist nicht registriert`, {
      hint: 'backe backlog list',
    });
  }
  const managedRoot = join(homes.backeHome, 'backlogs', name);
  const dirs = await readdir(managedRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const handles = new Set([
    ...Object.keys(entry.paths),
    ...Object.keys(cfg.identities?.[name] ?? {}),
    ...dirs,
  ]);
  const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const workingCopies: WorkingCopyInfo[] = [];
  for (const handle of [...handles].sort(byCodeUnit)) {
    const path = workingCopyPath(cfg, homes, name, handle);
    const present = await exists(join(path, BACKLOG_CONFIG));
    const identity = present ? await readLocalState(path, 'identity') : undefined;
    const anchor = present ? await readLocalState(path, 'anchor') : undefined;
    workingCopies.push({
      handle,
      path,
      managed: path === managedClonePath(homes, name, handle),
      exists: present,
      ...(identity === undefined ? {} : { identity }),
      ...(anchor === undefined ? {} : { anchor }),
    });
  }
  return { entry, workingCopies };
}

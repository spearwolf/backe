/**
 * Eine Arbeitskopie je Identität (backe.md §2.16.1): `backe` klont sie selbst nach
 * `<BACKE_HOME>/backlogs/<backlog>/<handle>/`, mit Vertrauensanker, Identität und Verify.
 * Geklont und geprüft wird in `<BACKE_HOME>/tmp` ohne Lock; erst der Abschluss läuft unter dem
 * Config-Lock und verschiebt den fertigen Clone per `rename` an sein Ziel.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { z } from 'zod';
import { withFileLock } from '../context/lock.ts';
import { type Env, expandPath, type Homes, physicalPath, samePath } from '../context/paths.ts';
import {
  type BacklogEntry,
  listBacklogs,
  managedClonePath,
  registerBacklogTracked,
  revertBinding,
  unregisterBacklog,
  workingCopyPath,
} from '../context/registry.ts';
import { fallbackRoot, type ResolvedContext, readBacklogName } from '../context/resolve.ts';
import { configLockPath, readUserConfig, userConfigPath } from '../context/user-config.ts';
import { BackeError, schemaError } from '../core/errors.ts';
import { shortSha } from '../core/ids.ts';
import { isHandle } from '../core/names.ts';
import { BACKLOG_FORMAT_VERSION, BacklogConfigSchema, type UserConfig } from '../core/schemas.ts';
import { git, transportEnv } from '../git/exec.ts';
import { isAncestor, mergeBase, readBlobs, resolveCommit, rootCommits } from '../git/history.ts';
import { clearLocalState, readLocalState, writeLocalState } from '../git/local-state.ts';
import { branchesWithUnpushed, gitRemotes, gitToplevel } from '../git/query.ts';
import { headState } from '../git/repo.ts';
import type { Notice } from '../ops/notice.ts';
import { exists } from '../store/files.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG, userFile } from '../store/layout.ts';
import { ensureHub, hubPath } from './hub.ts';
import { firstStderrLine } from './init.ts';
import { lfsPull } from './lfs.ts';
import { assertVerified, trustedVerifyMode, type VerifyReport, verifyRange } from './verify.ts';
import { parseJsoncAs } from './verify-state.ts';

/** Nur für Tests: läuft zwischen Clone und Abschluss. */
export type CloneHooks = { beforeFinish?: () => Promise<void> };

export type CloneResult = { name: string; root: string; notices: string[] };

/** Nur was der Clone braucht; unbekannte Felder einer neueren Formatversion stören nicht. */
const CloneConfigSchema = z.object({
  version: BacklogConfigSchema.shape.version,
  sync: BacklogConfigSchema.shape.sync,
  verify: BacklogConfigSchema.shape.verify,
  attachments: BacklogConfigSchema.shape.attachments,
});
type CloneConfig = z.infer<typeof CloneConfigSchema>;

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
 * Urteil über einen Bericht von `verifyRange` bis `to` (Default `HEAD`): Gibt es ungültige Commits,
 * entscheidet der Modus des letzten vertrauenswürdigen Stands (`trustedVerifyMode`): `strict`
 * wirft, `warn` meldet die Gründe, `off` behält still. Clone, `backlog add` und Sync teilen sich das.
 */
export async function judgeReport(
  wc: string,
  report: VerifyReport,
  to?: string,
): Promise<string[]> {
  return (await judgeReportOnce(wc, report, to, new Set())).notices;
}

/**
 * Wie `judgeReport`, aber im Modus `warn` nur mit den Gründen der ungültigen Commits, die nicht in
 * `warned` stehen; `warned` im Ergebnis sind dann alle ungültigen Commits des Berichts — gemeldet
 * sind sie ja jetzt. Gemerkt wird also nie mehr, als der Bericht an ungültigen Commits trägt.
 * `strict` wirft wie dort, gleich was in `warned` steht; `off` meldet und merkt nichts.
 */
export async function judgeReportOnce(
  wc: string,
  report: VerifyReport,
  to: string | undefined,
  warned: ReadonlySet<string>,
): Promise<{ notices: string[]; warned: string[] }> {
  if (report.invalid.length === 0) return { notices: report.notices, warned: [] };
  const mode = await trustedVerifyMode(wc, to);
  if (mode === 'strict') assertVerified(report);
  if (mode === 'off') return { notices: [], warned: [] };
  const reasons = report.invalid
    .filter((f) => !warned.has(f.sha))
    .flatMap((f) => f.reasons.map((r) => `${shortSha(f.sha)}: ${r}`));
  return { notices: [...reasons, ...report.notices], warned: report.invalid.map((f) => f.sha) };
}

/** Prüft `HEAD` des Clones, zeichnet den verifizierten Stand auf und urteilt (`judgeReport`). */
async function verifyClone(wc: string): Promise<string[]> {
  return judgeReport(wc, await verifyRange(wc, { record: true }));
}

/** `sync` der Config in `rev` von `wc`; fehlt sie oder ist sie unlesbar, `undefined`. */
async function syncAt(wc: string, rev: string): Promise<CloneConfig['sync'] | undefined> {
  const spec = `${rev}:${BACKLOG_CONFIG}`;
  const blob = (await readBlobs(wc, [spec])).get(spec);
  if (blob === null || blob === undefined) return undefined;
  const config = parseJsoncAs(CloneConfigSchema, blob.toString('utf8'), BACKLOG_CONFIG);
  return typeof config === 'string' ? undefined : config.sync;
}

/**
 * Der Stand der vertrauten Arbeitskopie, von dem ein frischer Clone abstammen muss: ihr `upstream`
 * (zuletzt verifizierter Remote-Stand), sonst der gemeinsame Vorfahre von `verified` und ihrem
 * Remote-Tracking-Branch, sonst `verified`. `verified` allein darf auf einen ungepushten lokalen
 * Commit zeigen, den kein Remote kennt. Remote und Branch kommen aus der Config im `HEAD` der
 * vertrauten Arbeitskopie, nicht aus dem noch ungeprüften Clone. Der Sync fragt vor dem Fetch
 * dasselbe für Eingehendes, solange der Tracking-Ref noch den vorigen Remote-Stand trägt.
 */
export async function descentBase(trusted: string): Promise<string | undefined> {
  const upstream = await readLocalState(trusted, 'upstream');
  if (upstream !== undefined) return upstream;
  const verified = await readLocalState(trusted, 'verified');
  if (verified === undefined) return undefined;
  const sync = await syncAt(trusted, 'HEAD');
  const tracking = sync && `refs/remotes/${sync.remote}/${sync.branch}`;
  return (tracking && (await mergeBase(trusted, verified, tracking))) ?? verified;
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

/** Klont `source` nach `temp`; `origin` ist der Name des Git-Remotes im Clone (Default `origin`). */
type CloneSource = { url: string; origin?: string };

/** Klont per git; scheitert git selbst (Netz, Auth, fehlende Quelle), ist das ein `sync`-Fehler. */
async function gitClone(
  env: Env,
  { url: source, origin }: CloneSource,
  reference: Reference | undefined,
  temp: string,
): Promise<void> {
  const ref =
    reference === undefined
      ? []
      : ['--reference', reference.path, ...(reference.dissociate ? ['--dissociate'] : [])];
  const name = origin === undefined ? [] : ['--origin', origin];
  try {
    await git(['clone', '-q', ...ref, ...name, '--', source, temp], {
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
 * Backlog-Namen und nennt eine vorhandene Arbeitskopie desselben Backlogs: Von ihr kommt der
 * Anker, und der Clone muss von ihrem `descentBase` abstammen, der sein erster verifizierter Stand
 * wird. Ohne sie gilt die einzige Wurzel als Anker. `fromRemote`: `source` ist das registrierte
 * Remote des Backlogs, nicht eine Arbeitskopie; dann ist `HEAD` des Clones nach bestandener Prüfung
 * sein `upstream`.
 */
async function cloneInto(input: {
  env: Env;
  source: string;
  /** Name des Git-Remotes im Clone; Default `origin`. */
  origin?: string;
  fromRemote: boolean;
  reference?: Reference;
  temp: string;
  handle: string;
  trust: (name: string) => Promise<string | undefined>;
}): Promise<{ name: string; notices: string[] }> {
  const { env, source, reference, temp, handle } = input;
  await gitClone(
    env,
    { url: source, ...(input.origin === undefined ? {} : { origin: input.origin }) },
    reference,
    temp,
  );
  const { sync, version, attachments } = await readCloneConfig(temp, source);
  if ((await headState(temp)).branch !== sync.branch) {
    await git(['switch', '-q', sync.branch], { cwd: temp });
  }
  const name = (await readBacklogName(temp)) as string;
  const trusted = await input.trust(name);
  const anchor =
    (trusted === undefined ? undefined : await readLocalState(trusted, 'anchor')) ??
    (await singleRoot(temp, source));
  await writeLocalState(temp, 'anchor', anchor);
  const base = trusted === undefined ? undefined : await descentBase(trusted);
  if (base !== undefined) {
    if (!(await descendsFrom(temp, base))) {
      throw new BackeError(
        'verify',
        `${source} ist kein Nachfahre des zuletzt verifizierten Stands ${shortSha(base)}`,
      );
    }
    await writeLocalState(temp, 'verified', base);
  }
  await writeLocalState(temp, 'identity', handle);
  const notices = await verifyClone(temp);
  // Ein Clone hat bei `attachments.lfs` zunächst nur Pointer statt der Anhänge.
  if (attachments.lfs) {
    notices.push(...(await lfsPull(temp, input.origin ?? 'origin', env)));
  }
  if (input.fromRemote) await writeLocalState(temp, 'upstream', await resolveCommit(temp, 'HEAD'));
  if (version > BACKLOG_FORMAT_VERSION) {
    notices.unshift(
      `Backlog-Format ${version} ist neuer als dieses backe (${BACKLOG_FORMAT_VERSION}); nur lesen`,
    );
  }
  return { name, notices };
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
    throw new BackeError('validation', `Ungültiger Handle »${handle}«`, {
      hint: 'Erlaubt sind Kleinbuchstaben, Ziffern und Bindestriche (2 bis 32 Zeichen); »me« ist reserviert.',
    });
  }
  return withTempClone(homes, async (temp) => {
    const { name, notices } = await cloneInto({
      env,
      source: url,
      fromRemote: true,
      temp,
      handle,
      trust: async (actual) => {
        if (input.name !== undefined && input.name !== actual) {
          throw new BackeError(
            'validation',
            `Der Backlog heißt »${actual}«, nicht »${input.name}«`,
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
    const { before } = await registerBacklogTracked(homes, { name, remote: url });
    const wasRegistered = before.backlogs?.[name] !== undefined;
    try {
      await hooks.beforeFinish?.();
      const root = await finish(homes, name, temp, managedClonePath(homes, name, handle));
      return { name, root, notices };
    } catch (error) {
      if (!wasRegistered) await unregisterBacklog(homes, name).catch(() => undefined);
      throw error;
    }
  });
}

/**
 * Hängt den frischen Clone an den Hub und holt dessen Sync-Branch. `upstream` ist der Teil von
 * `HEAD`, den der Hub trägt — ein Clone direkt aus der Quelle kann ihm voraus sein, wenn ein
 * anderer Prozess den Hub inzwischen aus einem älteren Stand angelegt hat.
 */
async function linkToHub(temp: string, hub: string, sync: CloneConfig['sync']): Promise<void> {
  await git(['remote', 'set-url', '--', sync.remote, hub], { cwd: temp });
  const tracking = `refs/remotes/${sync.remote}/${sync.branch}`;
  await git(
    [
      'fetch',
      '-q',
      '--no-tags',
      '--end-of-options',
      sync.remote,
      `+refs/heads/${sync.branch}:${tracking}`,
    ],
    { cwd: temp },
  );
  const upstream = await mergeBase(temp, 'HEAD', tracking);
  if (upstream === undefined) await clearLocalState(temp, 'upstream');
  else await writeLocalState(temp, 'upstream', upstream);
}

/**
 * Fehlt `users/<handle>.md` im frischen Clone, steht aber im `HEAD` der Quell-Arbeitskopie, hat
 * deren Identität den User angelegt und noch nicht gepusht: Ohne ihn könnte der Clone nie schreiben.
 */
async function assertUserPushed(temp: string, reference: string, handle: string): Promise<void> {
  if (await exists(join(temp, userFile(handle)))) return;
  const spec = `HEAD:${userFile(handle)}`;
  if ((await readBlobs(reference, [spec])).get(spec) == null) return;
  const identity = await readLocalState(reference, 'identity');
  throw new BackeError('sync', `User ${handle} ist noch nicht gepusht`, {
    hint: identity === undefined ? 'backe sync' : `backe sync --as ${identity}`,
  });
}

/**
 * Die Arbeitskopie des Handles; fehlt eine verwaltete, wird sie geklont (backe.md §2.16.1):
 * aus der registrierten Remote, ohne Remote aus dem lokalen Hub — fehlt er noch, aus der gelesenen
 * Arbeitskopie, und erst der geprüfte Clone legt den Hub an (`ensureHub`) und hängt sich daran. Die gelesene Arbeitskopie dient als `--reference`
 * (ein gebundener Clone nur mit `--dissociate`) und als Quelle für Anker und verifizierten Stand.
 * Eine vorhandene Arbeitskopie kommt ohne Netzzugriff zurück; `notices` hat nur ein Clone: im
 * Modus `warn` die Gründe ungültiger Commits. `hub` nennt einen dabei neu angelegten Hub — ein
 * Hinweis, keine Warnung.
 */
export async function ensureWorkingCopy(
  ctx: ResolvedContext,
  handle: string,
): Promise<{ root: string; notices: string[]; hub?: string }> {
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
  if (entry?.remote === undefined && reference === undefined) {
    throw new BackeError('not_found', `Keine Quelle zum Klonen von Backlog ${name}`, {
      hint: 'backe backlog clone <url>',
    });
  }
  let source = entry?.remote;
  let viaHub: { from: string; sync: CloneConfig['sync'] } | undefined;
  if (source === undefined) {
    const from = reference as string;
    viaHub = { from, sync: (await readCloneConfig(from, from)).sync };
    // Einen fehlenden Hub legt erst der geprüfte Clone an; bis dahin hat die Quelle denselben Stand.
    const hub = hubPath(ctx.homes, name);
    source = (await exists(hub)) ? hub : from;
  }
  const url = source;
  const origin = viaHub?.sync.remote;
  // Dauerhaft Objekte leihen darf der neue Clone nur von einem verwalteten Clone; ein gebundener
  // gehört dem Nutzer, der ihn jederzeit löschen kann.
  const managed =
    reference !== undefined &&
    (await samePath(reference, managedClonePath(ctx.homes, name, basename(reference))));
  return withTempClone(ctx.homes, async (temp) => {
    const cloned = await cloneInto({
      env: ctx.env,
      source: url,
      ...(origin === undefined ? {} : { origin }),
      fromRemote: true,
      ...(reference === undefined ? {} : { reference: { path: reference, dissociate: !managed } }),
      temp,
      handle,
      trust: async (actual) => {
        if (actual !== name) {
          throw new BackeError(
            'validation',
            `${url}: gehört zum Backlog »${actual}«, erwartet wurde »${name}«`,
          );
        }
        return reference;
      },
    });
    if (reference !== undefined) await assertUserPushed(temp, reference, handle);
    let created: string | undefined;
    if (viaHub !== undefined) {
      const { from, sync } = viaHub;
      const hub = await ensureHub(ctx.homes, name, from, sync);
      if (hub.created && hub.linked) {
        created = `Lokaler Hub ${hub.hub} angelegt; ${from} synct jetzt darüber`;
      }
      await linkToHub(temp, hub.hub, sync);
    }
    return {
      root: await finish(ctx.homes, name, temp, wc),
      notices: cloned.notices,
      ...(created === undefined ? {} : { hub: created }),
    };
  });
}

/** Der Hinweis auf einen neu angelegten Hub als Notice; ohne Hub keiner. */
export function hubNotices(hub: string | undefined): Notice[] {
  return hub === undefined ? [] : [{ code: 'hub_created', message: hub, ids: [] }];
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
    `Die Arbeitskopie ${wc} gehört »${identity}«; die Arbeitskopie von »${handle}« ist ${own}`,
  );
}

/**
 * `backe backlog add` (backe.md §2.14): bindet einen vorhandenen Clone an eine Identität. Der
 * Clone gehört dem Nutzer und wird nie angefasst außer um Identität, Anker, verifizierten Stand
 * und `upstream` in seinem lokalen Zustand.
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
      `${input.path} ist keine Arbeitskopie des Backlogs »${name}« (Git-Toplevel: ${top ?? 'keines'}, Backlog: ${actual ?? 'keiner'}, erwartet: ${wanted})`,
    );
  }
  const cfg = await readUserConfig(homes.backeHome);
  const identity = await readLocalState(wanted, 'identity');
  if (identity !== undefined && identity !== handle) {
    throw identityMismatch(wanted, identity, handle, workingCopyPath(cfg, homes, name, handle));
  }
  const { sync } = await readCloneConfig(wanted, wanted);
  // Der Anker muss vor dem Verify stehen; scheitert es, nimmt `add` ihn wieder weg. Identität und
  // Registrierung folgen erst nach dem Verify.
  let wroteAnchor = false;
  if ((await readLocalState(wanted, 'anchor')) === undefined) {
    const sibling = await fallbackRoot(cfg, homes, name, handle);
    const known =
      sibling !== undefined &&
      !(await samePath(sibling, wanted)) &&
      (await isWorkingCopyOf(sibling, name))
        ? await readLocalState(sibling, 'anchor')
        : undefined;
    await writeLocalState(wanted, 'anchor', known ?? (await singleRoot(wanted, wanted)));
    wroteAnchor = true;
  }
  let wroteUpstream = false;
  const undoLocalState = async () => {
    if (wroteAnchor) await clearLocalState(wanted, 'anchor').catch(() => undefined);
    if (wroteUpstream) await clearLocalState(wanted, 'upstream').catch(() => undefined);
  };
  let notices: string[];
  try {
    notices = await verifyClone(wanted);
    // `upstream` ist der geprüfte Teil des Remote-Tracking-Branches: sein gemeinsamer Vorfahre mit
    // `HEAD`. Was der Branch darüber hinaus trägt, hat das Verify nicht gesehen; ein schon
    // vorhandenes `upstream` bleibt.
    if ((await readLocalState(wanted, 'upstream')) === undefined) {
      const tracking = `refs/remotes/${sync.remote}/${sync.branch}`;
      const upstream = await mergeBase(wanted, 'HEAD', tracking);
      if (upstream !== undefined) {
        await writeLocalState(wanted, 'upstream', upstream);
        wroteUpstream = true;
      }
    }
  } catch (error) {
    await undoLocalState();
    throw error;
  }
  const remote = (await gitRemotes(wanted)).find((r) => r.name === sync.remote)?.url;
  const { before: priorConfig } = await registerBacklogTracked(homes, {
    name,
    ...(remote === undefined ? {} : { remote }),
    handle,
    path: wanted,
  });
  const before = priorConfig.backlogs?.[name];
  try {
    if (identity === undefined) await writeLocalState(wanted, 'identity', handle);
  } catch (error) {
    // Zurücknehmen, was dieser Aufruf ergänzt hat: den ganzen Eintrag, falls er ihn angelegt hat.
    if (before === undefined) {
      await unregisterBacklog(homes, name).catch(() => undefined);
    } else {
      await revertBinding(homes, name, {
        ...(before.paths?.[handle] === undefined ? { handle } : {}),
        remote: before.remote === undefined,
        current: priorConfig.current === undefined,
      }).catch(() => undefined);
    }
    await undoLocalState();
    throw error;
  }
  return { root: wanted, notices };
}

/** `--purge` löscht nur verwaltete Clones: ein gebundener Pfad im verwalteten Verzeichnis blockiert es. */
async function assertNoBoundInManaged(homes: Homes, name: string): Promise<void> {
  const cfg = await readUserConfig(homes.backeHome);
  const managedDir = await physicalPath(join(homes.backeHome, 'backlogs', name));
  for (const [handle, bound] of Object.entries(cfg.backlogs?.[name]?.paths ?? {})) {
    const path = await physicalPath(expandPath(bound, { home: homes.home, base: homes.backeHome }));
    if (path === (await physicalPath(managedClonePath(homes, name, handle)))) continue;
    if (path === managedDir || path.startsWith(managedDir + sep)) {
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

/**
 * `--purge` ohne `--force` löscht keine Arbeit, die nur hier liegt: Jeder verwaltete Clone unter
 * `<BACKE_HOME>/backlogs/<name>` braucht eine Remote außer dem lokalen Hub — der wird mitgelöscht —,
 * und kein lokaler Branch darf Commits tragen, die in keinem Remote-Tracking-Ref stehen. Ein
 * Verzeichnis, das kein Clone ist, und der Hub selbst zählen nicht.
 */
async function assertNothingOnlyHere(homes: Homes, name: string): Promise<void> {
  const managedDir = join(homes.backeHome, 'backlogs', name);
  const hub = hubPath(homes, name);
  const entries = await readdir(managedDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const clone = join(managedDir, entry.name);
    if (clone === hub) continue;
    if ((await gitToplevel(clone)) !== (await physicalPath(clone))) continue;
    const refuse = (what: string) =>
      new BackeError('conflict', `Der verwaltete Clone »${clone}« ${what}`, {
        hint: `backe backlog remove ${name} --purge --force löscht trotzdem`,
      });
    const remotes = (await gitRemotes(clone)).filter((r) => r.url !== hub);
    if (remotes.length === 0) throw refuse('hat keine Remote');
    const unpushed = await branchesWithUnpushed(clone);
    if (unpushed.length > 0) {
      throw refuse(
        `enthält Commits, die auf keiner Remote liegen (Branches: ${unpushed.map((b) => `»${b}«`).join(', ')})`,
      );
    }
  }
}

/** Nur für Tests: läuft zwischen Deregistrieren und Löschen. */
export type RemoveHooks = { beforePurge?: () => Promise<void> };

/**
 * `backe backlog remove` (backe.md §2.14): deregistriert; `purge` löscht danach die verwalteten
 * Clones unter `<BACKE_HOME>/backlogs/<name>`, nie einen gebundenen Pfad. Ohne `force` verweigert
 * `purge` einen Clone ohne Remote oder mit ungepushten Commits, bevor irgendetwas deregistriert
 * ist. Wurde der Backlog inzwischen neu registriert, bleibt alles stehen.
 */
export async function removeBacklog(
  input: { homes: Homes; name: string; purge?: boolean; force?: boolean },
  hooks: RemoveHooks = {},
): Promise<{ purged: string | undefined }> {
  const { homes, name } = input;
  if (input.purge === true) {
    await assertNoBoundInManaged(homes, name);
    if (input.force !== true) await assertNothingOnlyHere(homes, name);
  }
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
    throw new BackeError('not_found', `Backlog »${name}« ist nicht registriert`, {
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
    // Der lokale Hub `hub.git` ist keine Arbeitskopie; sein Name ist kein Handle.
    ...dirs.filter(isHandle),
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

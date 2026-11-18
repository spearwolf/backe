import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { BACKLOG_NAME_RE, isHandle } from '../core/names.ts';
import type { UserConfig } from '../core/schemas.ts';
import { normalizeRepoUrl } from '../core/url.ts';
import { gitToplevel } from '../git/query.ts';
import { readJsonc } from '../store/jsonc.ts';
import { BACKLOG_CONFIG } from '../store/layout.ts';
import { type Env, envValue, expandPath, type Homes, resolveHomes } from './paths.ts';
import { findProjectConfig, type ProjectConfigLevel } from './project-config.ts';
import { findBacklogByRemote, managedClonePath, workingCopyPath } from './registry.ts';
import { readUserConfig, userConfigPath } from './user-config.ts';

export type ContextFlags = { backlog?: string; as?: string; project?: string; sprint?: string };
export type ContextInput = { cwd: string; env: Env; flags: ContextFlags };
export type SourceKind =
  | 'flag'
  | 'env'
  | 'backlog-repo'
  | 'project-local'
  | 'project'
  | 'user-backlog'
  | 'user-default'
  | 'user-current'
  | 'remote'
  | 'none';
export type Source = { kind: SourceKind; detail?: string };
export type Resolved<T> = { value: T; source: Source };
export type ResolvedContext = {
  homes: Homes;
  userConfig: UserConfig;
  backlog: Resolved<string> & { root: string | undefined; workingCopy: string | undefined };
  user: Resolved<string | undefined> & { key: string | undefined };
  project: Resolved<string | undefined>;
  sprint: Resolved<string | undefined>;
  repo: Resolved<string | null | undefined>;
};

const NONE: Source = { kind: 'none' };
const PATH_PREFIXES = ['/', './', '../', '~'];

type Ref = { kind: 'name' | 'path' | 'url'; value: string };

export function classifyBacklogRef(value: string, allowPath: boolean): Ref {
  if (BACKLOG_NAME_RE.test(value)) return { kind: 'name', value };
  const pathLike =
    value === '.' || value === '..' || PATH_PREFIXES.some((prefix) => value.startsWith(prefix));
  if (allowPath && pathLike) return { kind: 'path', value };
  return { kind: 'url', value: normalizeRepoUrl(value) };
}

/** Liest nur `name` aus `.backe/backlog.jsonc`, damit eine neuere Formatversion den Kontext nicht bricht. */
export async function readBacklogName(root: string): Promise<string | undefined> {
  const file = join(root, BACKLOG_CONFIG);
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const raw = readJsonc(text, file);
  const name =
    typeof raw === 'object' && raw !== null ? (raw as { name?: unknown }).name : undefined;
  if (typeof name !== 'string' || !BACKLOG_NAME_RE.test(name)) {
    throw new BackeError('validation', `${file}: name: kein gültiger Backlog-Name`);
  }
  return name;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function describe(source: Source): string {
  return source.detail === undefined ? source.kind : `${source.kind} ${source.detail}`;
}

function validHandle(handle: string, source: Source): string {
  if (!isHandle(handle)) {
    throw new BackeError(
      'usage',
      `Ungültiger User-Handle "${handle}" (Quelle: ${describe(source)})`,
    );
  }
  return handle;
}

type Level = ProjectConfigLevel | undefined;

/** `backlog` einer Projekt-Config-Ebene; `.backlog.local.jsonc` gewinnt vor `.backlog.jsonc`. */
function levelBacklog(level: Level): Resolved<string> | undefined {
  const local = level?.local;
  if (local?.config.backlog !== undefined) {
    return { value: local.config.backlog, source: { kind: 'project-local', detail: local.file } };
  }
  const shared = level?.shared;
  if (shared?.config.backlog !== undefined) {
    return { value: shared.config.backlog, source: { kind: 'project', detail: shared.file } };
  }
  return undefined;
}

type Found = { name: string; source: Source; bound?: string };

/** Bindet eine Arbeitskopie direkt über ihr Git-Toplevel; der Name kommt aus `.backe/backlog.jsonc`. */
async function bindPath(path: string, source: Source): Promise<Found> {
  const top = (await exists(path)) ? await gitToplevel(path) : undefined;
  const name = top === undefined ? undefined : await readBacklogName(top);
  if (top === undefined || name === undefined) {
    throw new BackeError(
      'not_found',
      `Kein Backlog unter "${path}" (Quelle: ${describe(source)})`,
      { hint: 'backe backlog list' },
    );
  }
  return { name, source, bound: top };
}

function byName(cfg: UserConfig, name: string, source: Source): Found {
  if (cfg.backlogs?.[name] === undefined) {
    throw new BackeError(
      'not_found',
      `Backlog "${name}" ist nicht registriert (Quelle: ${describe(source)})`,
      { hint: 'backe backlog list' },
    );
  }
  return { name, source };
}

type RefContext = { cfg: UserConfig; homes: Homes; cwd: string };

async function resolveRef(
  value: string,
  allowPath: boolean,
  source: Source,
  ctx: RefContext,
): Promise<Found> {
  let ref: Ref;
  try {
    ref = classifyBacklogRef(value, allowPath);
  } catch (error) {
    // normalizeRepoUrl wirft nur `usage`; die Quelle gehört in die Meldung.
    const e = error as BackeError;
    throw new BackeError('usage', `${e.message} (Quelle: ${describe(source)})`, {
      ...(e.hint === undefined ? {} : { hint: e.hint }),
    });
  }
  if (ref.kind === 'name') return byName(ctx.cfg, ref.value, source);
  if (ref.kind === 'path') {
    return bindPath(expandPath(ref.value, { home: ctx.homes.home, base: ctx.cwd }), source);
  }
  const name = findBacklogByRemote(ctx.cfg, value);
  if (name === undefined) {
    throw new BackeError(
      'not_found',
      `Backlog "${value}" ist nicht registriert (Quelle: ${describe(source)})`,
      { hint: `backe backlog clone ${value}` },
    );
  }
  return { name, source };
}

async function findBacklog(input: ContextInput, ctx: RefContext, level: Level): Promise<Found> {
  const { flags, env, cwd } = input;
  if (flags.backlog !== undefined) return resolveRef(flags.backlog, true, { kind: 'flag' }, ctx);
  const fromEnv = envValue(env, 'BACKE_BACKLOG');
  if (fromEnv !== undefined) {
    return resolveRef(fromEnv, true, { kind: 'env', detail: 'BACKE_BACKLOG' }, ctx);
  }
  const top = await gitToplevel(cwd);
  const repoName = top === undefined ? undefined : await readBacklogName(top);
  if (top !== undefined && repoName !== undefined) {
    return { name: repoName, source: { kind: 'backlog-repo' }, bound: top };
  }
  const fromLevel = levelBacklog(level);
  if (fromLevel !== undefined) return resolveRef(fromLevel.value, false, fromLevel.source, ctx);
  if (ctx.cfg.current !== undefined) {
    return byName(ctx.cfg, ctx.cfg.current, { kind: 'user-current' });
  }
  throw new BackeError('usage', 'Kein Backlog angegeben', {
    hint: '--backlog <name>, BACKE_BACKLOG, "backe backlog use <name>" oder "backlog" in einer .backlog.jsonc',
  });
}

function findUser(
  input: ContextInput,
  cfg: UserConfig,
  backlog: string,
  level: Level,
): Resolved<string | undefined> {
  const pick = (value: string, source: Source): Resolved<string> => ({
    value: validHandle(value, source),
    source,
  });
  if (input.flags.as !== undefined) return pick(input.flags.as, { kind: 'flag' });
  const fromEnv = envValue(input.env, 'BACKE_USER');
  if (fromEnv !== undefined) return pick(fromEnv, { kind: 'env', detail: 'BACKE_USER' });
  const local = level?.local;
  if (local?.config.user !== undefined) {
    return pick(local.config.user, { kind: 'project-local', detail: local.file });
  }
  const perBacklog = cfg.backlogs?.[backlog]?.user;
  if (perBacklog !== undefined) return pick(perBacklog, { kind: 'user-backlog' });
  if (cfg.user !== undefined) return pick(cfg.user, { kind: 'user-default' });
  return { value: undefined, source: NONE };
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Erste vorhandene andere Arbeitskopie desselben Backlogs: gebundene Pfade, dann verwaltete Klone. */
async function fallbackRoot(
  cfg: UserConfig,
  homes: Homes,
  backlog: string,
  handle: string | undefined,
): Promise<string | undefined> {
  const bound = Object.keys(cfg.backlogs?.[backlog]?.paths ?? {})
    .filter((h) => h !== handle)
    .sort(byCodeUnit)
    .map((h) => workingCopyPath(cfg, homes, backlog, h));
  let managed: string[] = [];
  try {
    managed = (await readdir(join(homes.backeHome, 'backlogs', backlog)))
      .filter((h) => h !== handle)
      .sort(byCodeUnit)
      .map((h) => managedClonePath(homes, backlog, h));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const dir of [...bound, ...managed]) {
    if (await exists(join(dir, BACKLOG_CONFIG))) return dir;
  }
  return undefined;
}

export async function resolveContext(input: ContextInput): Promise<ResolvedContext> {
  const homes = resolveHomes(input.env, input.cwd);
  const userConfig = await readUserConfig(homes.backeHome);
  const level = await findProjectConfig(input.cwd);
  const found = await findBacklog(input, { cfg: userConfig, homes, cwd: input.cwd }, level);
  const user = findUser(input, userConfig, found.name, level);
  const handle = user.value;

  let workingCopy: string | undefined;
  let root: string | undefined;
  if (found.bound !== undefined) {
    workingCopy = found.bound;
    root = found.bound;
  } else {
    workingCopy =
      handle === undefined ? undefined : workingCopyPath(userConfig, homes, found.name, handle);
    root =
      workingCopy !== undefined && (await exists(join(workingCopy, BACKLOG_CONFIG)))
        ? workingCopy
        : await fallbackRoot(userConfig, homes, found.name, handle);
    const actual = root === undefined ? undefined : await readBacklogName(root);
    if (actual !== undefined && actual !== found.name) {
      throw new BackeError(
        'validation',
        `${root}: gehört zum Backlog "${actual}", erwartet wurde "${found.name}"`,
      );
    }
  }

  const keyRaw =
    handle === undefined ? undefined : userConfig.identities?.[found.name]?.[handle]?.key;
  const key =
    keyRaw === undefined
      ? undefined
      : expandPath(keyRaw, { home: homes.home, base: homes.backeHome });
  const unresolved = { value: undefined, source: NONE };
  return {
    homes,
    userConfig,
    backlog: { value: found.name, source: found.source, root, workingCopy },
    user: { ...user, key },
    project: unresolved,
    sprint: unresolved,
    repo: unresolved,
  };
}

/** Jeder Schreibzugriff geht hierüber: braucht Handle, Key und Arbeitskopie (backe.md §2.14). */
export function requireWriter(ctx: ResolvedContext): {
  handle: string;
  key: string;
  workingCopy: string;
} {
  const handle = ctx.user.value;
  const file = userConfigPath(ctx.homes.backeHome);
  if (handle === undefined || ctx.backlog.workingCopy === undefined) {
    throw new BackeError('usage', 'Kein User aufgelöst, Schreiben braucht eine Identität', {
      hint: `--as <handle>, BACKE_USER oder "user" in ${file}`,
    });
  }
  if (ctx.user.key === undefined) {
    throw new BackeError('usage', `Für "${handle}" ist kein Signing-Key eingetragen`, {
      hint: `identities.${ctx.backlog.value}.${handle} in ${file} eintragen oder backe user create-agent`,
    });
  }
  return { handle, key: ctx.user.key, workingCopy: ctx.backlog.workingCopy };
}

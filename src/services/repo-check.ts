/** `repo check` (backe.md §2.11): lokale Prüfung, mit `remote` Erreichbarkeit, Refs und GitHub-Status. */
import { execFile } from 'node:child_process';
import { access, constants, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Env } from '../context/paths.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { isGitArg, isGitRef, parseRepoRef } from '../core/names.ts';
import { normalizeRepoUrl } from '../core/url.ts';
import { git, transportEnv } from '../git/exec.ts';
import { writeFileAtomic } from '../store/files.ts';
import { parseEntityFile } from '../store/frontmatter.ts';
import type { Problem } from '../store/snapshot.ts';
import { openSnapshot } from './read.ts';

export type RepoFinding = {
  level: 'error' | 'warning' | 'info';
  kind: 'local' | 'ref' | 'network' | 'github';
  message: string;
};

export type RepoCheck = {
  name: string;
  url: string;
  canonical?: string;
  findings: RepoFinding[];
  github?: { visibility: string; archived: boolean };
  /** Zeitstempel, wenn das Remote-Ergebnis aus dem Cache kommt. */
  cached?: string;
};

type GithubInfo = { visibility: string; archived: boolean };

export type RepoCheckDeps = {
  now?: () => Date;
  github?: (owner: string, repo: string) => Promise<GithubInfo | undefined>;
  lsRemote?: (
    url: string,
  ) => Promise<{ ok: true; refs: string[] } | { ok: false; message: string }>;
};

const TTL_MS = 24 * 3_600_000;
const NETWORK_TIMEOUT_MS = 20_000;
const COMMIT_LIKE = /^[0-9a-f]{7,40}$/;
const GITHUB_CANONICAL = /^github\.com\/([^/]+)\/([^/]+)$/;

/** Cache-Datei der Remote-Ergebnisse. */
export function repoCheckCachePath(backeHome: string): string {
  return join(backeHome, 'cache', 'repo-check.json');
}

type CacheEntry = { checked: string; result: { refs: string[]; github?: GithubInfo } };
type Cache = { version: 1; entries: Record<string, CacheEntry> };

function isGithubInfo(v: unknown): v is GithubInfo {
  const g = v as GithubInfo | null;
  return typeof g?.visibility === 'string' && typeof g.archived === 'boolean';
}

function isEntry(v: unknown): v is CacheEntry {
  const e = v as CacheEntry | null;
  const r = e?.result as CacheEntry['result'] | undefined;
  return (
    typeof e?.checked === 'string' &&
    Array.isArray(r?.refs) &&
    r.refs.every((x) => typeof x === 'string') &&
    (r.github === undefined || isGithubInfo(r.github))
  );
}

/** Liest den Cache; fehlt er oder ist er kaputt, ein leerer (stillschweigend). */
async function readCache(file: string): Promise<Cache> {
  const empty: Cache = { version: 1, entries: {} };
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Cache | null;
    if (raw?.version !== 1 || typeof raw.entries !== 'object' || raw.entries === null) return empty;
    const entries: Record<string, CacheEntry> = {};
    for (const [key, value] of Object.entries(raw.entries)) {
      if (!isEntry(value)) return empty;
      entries[key] = value;
    }
    return { version: 1, entries };
  } catch {
    return empty;
  }
}

/** URL, die `git ls-remote` versteht: Kurzform `gh:` und kanonische Formen werden ausgeschrieben. */
function gitUrl(url: string, canonical: string): string {
  if (/^gh:/i.test(url)) return `https://${canonical}`;
  if (/^file:\/(?!\/)/i.test(url)) return url.slice('file:'.length);
  return /^[a-z][a-z0-9+.-]*:\/\/|^[^/@]+@[^/:]+:|^\//i.test(url) ? url : `https://${canonical}`;
}

function defaultLsRemote(env: Env): NonNullable<RepoCheckDeps['lsRemote']> {
  return async (url) => {
    try {
      const r = await git(['ls-remote', '--end-of-options', url], {
        cwd: tmpdir(),
        env: transportEnv(env),
        timeoutMs: NETWORK_TIMEOUT_MS,
      });
      const refs: string[] = [];
      for (const line of r.stdout.split('\n')) {
        const ref = /^\S+\t(?:refs\/heads\/|refs\/tags\/)(.+?)(?:\^\{\})?$/.exec(line)?.[1];
        if (ref !== undefined) refs.push(ref);
      }
      return { ok: true, refs: [...new Set(refs)] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message };
    }
  };
}

async function findOnPath(env: Env, bin: string): Promise<string | undefined> {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue;
    const file = join(dir, bin);
    try {
      await access(file, constants.X_OK);
      return file;
    } catch {
      // nicht in diesem Verzeichnis
    }
  }
  return undefined;
}

function parseGithub(text: string): GithubInfo | undefined {
  let data: { visibility?: unknown; private?: unknown; archived?: unknown } | null;
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    return undefined;
  }
  if (typeof data?.archived !== 'boolean') return undefined;
  const visibility =
    typeof data.visibility === 'string'
      ? data.visibility
      : typeof data.private === 'boolean'
        ? data.private
          ? 'private'
          : 'public'
        : undefined;
  return visibility === undefined ? undefined : { visibility, archived: data.archived };
}

/** `gh api repos/<o>/<r>`, wenn `gh` im PATH liegt, sonst die REST-API (mit `GITHUB_TOKEN`, falls gesetzt). */
function defaultGithub(env: Env): NonNullable<RepoCheckDeps['github']> {
  return async (owner, repo) => {
    const gh = await findOnPath(env, 'gh');
    if (gh !== undefined) {
      const { stdout } = await promisify(execFile)(gh, ['api', `repos/${owner}/${repo}`], {
        env: { ...env },
        timeout: NETWORK_TIMEOUT_MS,
      });
      return parseGithub(stdout);
    }
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'backe',
    };
    const token = env.GITHUB_TOKEN;
    if (token !== undefined && token !== '') headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers,
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseGithub(await res.text());
  };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type RepoItem = {
  name: string;
  url: string;
  canonical?: string;
  defaultRef?: string;
  refs: string[];
  findings: RepoFinding[];
  github?: GithubInfo;
  cached?: string;
};

/** Prüft die Repos des Backlogs; `names` leer oder fehlend heißt alle. Unbekannter Name → `not_found`. */
export async function checkRepos(
  ctx: ResolvedContext,
  input: { names?: string[]; remote?: boolean; fresh?: boolean },
  deps: RepoCheckDeps = {},
): Promise<RepoCheck[]> {
  const { root, snapshot: s } = await openSnapshot(ctx);

  const refsOf = new Map<string, Set<string>>();
  for (const { data } of s.issues.values()) {
    for (const r of data.repos ?? []) {
      const { name, ref } = parseRepoRef(r);
      if (ref === undefined) continue;
      const set = refsOf.get(name) ?? new Set<string>();
      set.add(ref);
      refsOf.set(name, set);
    }
  }

  const canonicals = new Map<string, string[]>();
  for (const [name, { data }] of s.repos) {
    const canonical = normalizeRepoUrl(data.url);
    canonicals.set(canonical, [...(canonicals.get(canonical) ?? []), name]);
  }

  const items: RepoItem[] = [];
  for (const [name, { data }] of s.repos) {
    const canonical = normalizeRepoUrl(data.url);
    const findings: RepoFinding[] = [];
    const twins = (canonicals.get(canonical) ?? []).filter((n) => n !== name);
    if (twins.length > 0) {
      const list = twins.map((n) => `»${n}«`).join(', ');
      findings.push({
        level: 'error',
        kind: 'local',
        message: `Kanonische URL »${canonical}« gehört auch zu ${list}`,
      });
    }
    items.push({
      name,
      url: data.url,
      canonical,
      ...(data.default_ref === undefined ? {} : { defaultRef: data.default_ref }),
      refs: [...(refsOf.get(name) ?? [])].sort(cmp),
      findings,
    });
  }
  const broken = s.problems.filter((p) => p.kind === 'repo');
  for (const p of broken) {
    const name = p.key ?? p.path.replace(/^repos\//, '').replace(/\.md$/, '');
    items.push({
      name,
      url: '',
      refs: [],
      findings: [{ level: 'error', kind: 'local', message: p.message }],
    });
  }
  await addInvalidIssueRefs(root, s.problems, items);
  items.sort((a, b) => cmp(a.name, b.name));

  let selected = items;
  if (input.names !== undefined && input.names.length > 0) {
    const wanted = new Set(input.names);
    for (const name of wanted) {
      if (!items.some((i) => i.name === name)) {
        throw new BackeError('not_found', `Repo »${name}« nicht gefunden`, {
          hint: 'backe repo list zeigt die registrierten Repos',
        });
      }
    }
    selected = items.filter((i) => wanted.has(i.name));
  }

  if (input.remote === true) await checkRemote(ctx, selected, input.fresh === true, deps);

  return selected.map((i) => ({
    name: i.name,
    url: i.url,
    ...(i.canonical === undefined ? {} : { canonical: i.canonical }),
    findings: i.findings,
    ...(i.github === undefined ? {} : { github: i.github }),
    ...(i.cached === undefined ? {} : { cached: i.cached }),
  }));
}

/**
 * Issues mit ungültigem `name@ref` fallen aus dem Snapshot (sie stehen in `problems`). Ihre rohen
 * `repos` werden hier sicher gelesen und der Fehler dem Repo zugeordnet.
 */
async function addInvalidIssueRefs(
  root: string,
  problems: readonly Problem[],
  items: readonly RepoItem[],
): Promise<void> {
  for (const p of problems) {
    if (p.kind !== 'issue' || p.key === undefined) continue;
    let repos: unknown;
    try {
      repos = parseEntityFile(await readFile(join(root, p.path), 'utf8'), p.path).data.repos;
    } catch {
      continue; // nicht lesbar oder kein Frontmatter: das Problem selbst meldet `validation` anderswo
    }
    if (!Array.isArray(repos)) continue;
    for (const raw of repos) {
      if (typeof raw !== 'string' || raw.indexOf('@') < 0) continue;
      const at = raw.indexOf('@');
      const ref = raw.slice(at + 1);
      if (isGitArg(ref) && isGitRef(ref)) continue;
      items
        .find((i) => i.name === raw.slice(0, at) && i.canonical !== undefined)
        ?.findings.push({
          level: 'error',
          kind: 'local',
          message: `Issue »${p.key}« (${p.path}): Ref »${ref}« ist ungültig`,
        });
    }
  }
}

type Remote = { refs: string[]; github?: GithubInfo; cached?: string; githubFinding?: RepoFinding };

/** Remote-Teil: ls-remote (mit Cache), Refs gegen die Remote-Refs, GitHub-Status. */
async function checkRemote(
  ctx: ResolvedContext,
  items: RepoItem[],
  fresh: boolean,
  deps: RepoCheckDeps,
): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const lsRemote = deps.lsRemote ?? defaultLsRemote(ctx.env);
  const github = deps.github ?? defaultGithub(ctx.env);
  const file = repoCheckCachePath(ctx.homes.backeHome);
  const cache = await readCache(file);
  let dirty = false;
  const seen = new Map<string, Promise<Remote | string>>();

  const fetchRemote = async (item: RepoItem, canonical: string): Promise<Remote | string> => {
    const t = now();
    const hit = cache.entries[canonical];
    const age = hit === undefined ? Number.NaN : t.getTime() - Date.parse(hit.checked);
    const usable = !fresh && hit !== undefined && age >= 0 && age < TTL_MS;
    const gh = GITHUB_CANONICAL.exec(canonical) ?? undefined;
    let refs: string[];
    let info = usable ? hit.result.github : undefined;
    let checked = t.toISOString();
    if (usable) {
      refs = hit.result.refs;
      checked = hit.checked;
    } else {
      const r = await lsRemote(gitUrl(item.url, canonical));
      if (!r.ok) return r.message;
      refs = r.refs;
    }
    const out: Remote = { refs };
    if (usable) out.cached = hit.checked;
    if (gh !== undefined && info === undefined) {
      try {
        info = await github(gh[1] as string, gh[2] as string);
        if (info === undefined) {
          out.githubFinding = {
            level: 'info',
            kind: 'github',
            message: 'GitHub lieferte keine auswertbare Antwort',
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        out.githubFinding = {
          level: 'warning',
          kind: 'github',
          message: `GitHub-Abfrage fehlgeschlagen: ${message}`,
        };
      }
    }
    if (gh !== undefined && info !== undefined) out.github = info;
    if (!usable || (hit?.result.github === undefined && info !== undefined)) {
      cache.entries[canonical] = {
        checked,
        result: { refs, ...(info === undefined ? {} : { github: info }) },
      };
      dirty = true;
    }
    return out;
  };

  for (const item of items) {
    const canonical = item.canonical;
    if (canonical === undefined) continue;
    let pending = seen.get(canonical);
    if (pending === undefined) {
      pending = fetchRemote(item, canonical);
      seen.set(canonical, pending);
    }
    const remote = await pending;
    if (typeof remote === 'string') {
      item.findings.push({
        level: 'error',
        kind: 'network',
        message: `nicht erreichbar: ${remote}`,
      });
      continue;
    }
    if (remote.cached !== undefined) item.cached = remote.cached;
    if (remote.github !== undefined) {
      item.github = remote.github;
      if (remote.github.archived) {
        item.findings.push({ level: 'warning', kind: 'github', message: 'Repo ist archiviert' });
      }
    }
    if (remote.githubFinding !== undefined) item.findings.push(remote.githubFinding);

    const known = new Set(remote.refs);
    const wanted: [string, string][] = [];
    if (item.defaultRef !== undefined) wanted.push(['default_ref', item.defaultRef]);
    for (const ref of item.refs) wanted.push(['Ref', ref]);
    for (const [label, ref] of wanted) {
      if (COMMIT_LIKE.test(ref)) {
        item.findings.push({
          level: 'info',
          kind: 'ref',
          message: `${label} »${ref}« sieht wie ein Commit aus und ist per ls-remote nicht prüfbar`,
        });
      } else if (!known.has(ref)) {
        item.findings.push({
          level: 'error',
          kind: 'ref',
          message: `${label} »${ref}« existiert im Remote nicht`,
        });
      }
    }
  }

  if (dirty) {
    try {
      await mkdir(dirname(file), { recursive: true });
      await writeFileAtomic(file, `${JSON.stringify(cache)}\n`);
    } catch {
      // Bewusst still und nicht fatal: Der Cache ist nur eine Beschleunigung; ein nicht schreibbares Verzeichnis ist kein Prüfergebnis.
    }
  }
}

/**
 * Exit-Fehler nach dem Bericht: lokale oder Ref-Fehler → `validation`, nur Erreichbarkeitsfehler
 * → `sync`, sonst keiner.
 */
export function repoCheckExit(checks: readonly RepoCheck[]): BackeError | undefined {
  const errors = checks.flatMap((c) => c.findings).filter((f) => f.level === 'error');
  if (errors.length === 0) return undefined;
  const message = `repo check: ${errors.length} Fehler`;
  const content = errors.some((f) => f.kind === 'local' || f.kind === 'ref');
  return new BackeError(content ? 'validation' : 'sync', message);
}

/**
 * Lädt ein Backlog vom Dateisystem in einen Snapshot (backe.md §2.2). Kaputte Entitätsdateien
 * landen als `Problem` im Snapshot und fehlen in den Maps; nur die Backlog-Config ist Pflicht.
 */
import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BackeError } from '../core/errors.ts';
import { isIssueId, shardOf } from '../core/ids.ts';
import { isHandle, isProjectPath, isRepoName, isSprintSlug } from '../core/names.ts';
import {
  type BacklogConfig,
  BacklogConfigSchema,
  type Comment,
  type EntityKind,
  type Issue,
  type Project,
  type Repo,
  type Sprint,
  type User,
  validateEntity,
} from '../core/schemas.ts';
import { parseEntityFile } from './frontmatter.ts';
import { readJsonc } from './jsonc.ts';
import { BACKLOG_CONFIG, commentsDir } from './layout.ts';

export type StoredEntity<T> = { data: T; body: string; unknownKeys: string[]; path: string };
export type Problem = { path: string; message: string };

export type BacklogSnapshot = {
  config: BacklogConfig;
  users: Map<string, StoredEntity<User>>;
  projects: Map<string, StoredEntity<Project>>;
  sprints: Map<string, StoredEntity<Sprint>>;
  repos: Map<string, StoredEntity<Repo>>;
  issues: Map<string, StoredEntity<Issue>>;
  problems: Problem[];
};

// --- Dateisystem-Helfer ------------------------------------------------------------------

function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/** Einträge eines Verzeichnisses, nach Name sortiert; ein fehlendes Verzeichnis ist leer. */
async function readDirSorted(abs: string): Promise<Dirent[]> {
  try {
    const entries = await readdir(abs, { withFileTypes: true });
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (err) {
    if (isMissing(err)) return [];
    throw err;
  }
}

/** Alle `*.md`-Dateien unter `dir` (rekursiv wenn `deep`), als Pfade relativ zur Wurzel. */
async function listMarkdown(root: string, dir: string, deep: boolean): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readDirSorted(join(root, dir))) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (deep) out.push(...(await listMarkdown(root, rel, deep)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(rel);
    }
  }
  return out;
}

// --- Einzelne Entität --------------------------------------------------------------------

/** Liest, parst und validiert eine Entitätsdatei; wirft `BackeError('validation')`. */
async function readEntity<T>(
  root: string,
  path: string,
  kind: EntityKind,
): Promise<StoredEntity<T>> {
  const text = await readFile(join(root, path), 'utf8');
  const parsed = parseEntityFile(text, path);
  const { data, unknownKeys } = validateEntity(kind, parsed.data, path);
  return { data: data as T, body: parsed.body, unknownKeys, path };
}

/** Wie `readEntity`, aber Prüffehler werden als Problem gesammelt statt geworfen. */
async function tryEntity<T>(
  root: string,
  path: string,
  kind: EntityKind,
  problems: Problem[],
): Promise<StoredEntity<T> | undefined> {
  try {
    return await readEntity<T>(root, path, kind);
  } catch (err) {
    if (err instanceof BackeError) {
      problems.push({ path, message: err.message });
      return undefined;
    }
    throw err;
  }
}

function sortedMap<T>(entries: Iterable<[string, T]>): Map<string, T> {
  return new Map([...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Lädt alle Dateien unter `dir`, deren aus dem Pfad abgeleiteter Name `valid` besteht. */
async function loadNamed<T>(
  root: string,
  dir: string,
  kind: EntityKind,
  deep: boolean,
  valid: (name: string) => boolean,
  label: string,
  problems: Problem[],
): Promise<Map<string, StoredEntity<T>>> {
  const out: [string, StoredEntity<T>][] = [];
  for (const path of await listMarkdown(root, dir, deep)) {
    const name = path.slice(dir.length + 1, -'.md'.length);
    if (!valid(name)) {
      problems.push({ path, message: `${path}: ungültiger ${label} "${name}"` });
      continue;
    }
    const entity = await tryEntity<T>(root, path, kind, problems);
    if (entity) out.push([name, entity]);
  }
  return sortedMap(out);
}

async function loadProjects(
  root: string,
  problems: Problem[],
): Promise<Map<string, StoredEntity<Project>>> {
  const loaded = await loadNamed<Project>(
    root,
    'projects',
    'project',
    true,
    isProjectPath,
    'Projekt-Pfad',
    problems,
  );
  // Eltern zuerst: ein Unterprojekt braucht ein (selbst gültiges) Elternprojekt (§2.9).
  const byDepth = [...loaded].sort(([a], [b]) => a.split('/').length - b.split('/').length);
  const accepted = new Map<string, StoredEntity<Project>>();
  for (const [name, entity] of byDepth) {
    const slash = name.lastIndexOf('/');
    if (slash >= 0 && !accepted.has(name.slice(0, slash))) {
      const parent = name.slice(0, slash);
      problems.push({
        path: entity.path,
        message: `${entity.path}: Elternprojekt "${parent}" fehlt`,
      });
      continue;
    }
    accepted.set(name, entity);
  }
  return sortedMap(accepted);
}

async function loadIssues(
  root: string,
  problems: Problem[],
): Promise<Map<string, StoredEntity<Issue>>> {
  const out: [string, StoredEntity<Issue>][] = [];
  for (const shard of await readDirSorted(join(root, 'issues'))) {
    if (!shard.isDirectory()) continue;
    for (const dir of await readDirSorted(join(root, 'issues', shard.name))) {
      if (!dir.isDirectory()) continue;
      const path = `issues/${shard.name}/${dir.name}/issue.md`;
      const file = (await readDirSorted(join(root, 'issues', shard.name, dir.name))).find(
        (e) => e.name === 'issue.md' && e.isFile(),
      );
      if (!file) continue;
      const id = dir.name;
      if (!isIssueId(id)) {
        problems.push({ path, message: `${path}: Verzeichnisname "${id}" ist keine Issue-ID` });
        continue;
      }
      if (shardOf(id) !== shard.name) {
        problems.push({
          path,
          message: `${path}: Issue "${id}" gehört in den Shard "${shardOf(id)}", nicht "${shard.name}"`,
        });
        continue;
      }
      const entity = await tryEntity<Issue>(root, path, 'issue', problems);
      if (!entity) continue;
      if (entity.data.id !== id) {
        problems.push({
          path,
          message: `${path}: id "${entity.data.id}" passt nicht zum Verzeichnis "${id}"`,
        });
        continue;
      }
      out.push([id, entity]);
    }
  }
  return sortedMap(out);
}

// --- Öffentliche API ---------------------------------------------------------------------

async function loadConfig(root: string): Promise<BacklogConfig> {
  let text: string;
  try {
    text = await readFile(join(root, BACKLOG_CONFIG), 'utf8');
  } catch (err) {
    if (isMissing(err)) {
      throw new BackeError(
        'not_found',
        `Kein Backlog gefunden: ${BACKLOG_CONFIG} fehlt in ${root}`,
      );
    }
    throw err;
  }
  const result = BacklogConfigSchema.safeParse(readJsonc(text, BACKLOG_CONFIG));
  if (!result.success) {
    const lines = result.error.issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '<root>';
      return `${BACKLOG_CONFIG}: ${path}: ${i.message}`;
    });
    throw new BackeError('validation', lines.join('\n'));
  }
  return result.data;
}

/** Lädt Config und alle Entitäten außer Kommentaren und Anhängen. */
export async function loadSnapshot(root: string): Promise<BacklogSnapshot> {
  const config = await loadConfig(root);
  const problems: Problem[] = [];
  const users = await loadNamed<User>(root, 'users', 'user', false, isHandle, 'Handle', problems);
  const projects = await loadProjects(root, problems);
  const sprints = await loadNamed<Sprint>(
    root,
    'sprints',
    'sprint',
    false,
    isSprintSlug,
    'Sprint-Slug',
    problems,
  );
  const repos = await loadNamed<Repo>(
    root,
    'repos',
    'repo',
    false,
    isRepoName,
    'Repo-Name',
    problems,
  );
  const issues = await loadIssues(root, problems);
  return { config, users, projects, sprints, repos, issues, problems };
}

/** Kommentare eines Issues, chronologisch nach Dateiname; ein kaputter Kommentar wirft. */
export async function listComments(root: string, id: string): Promise<StoredEntity<Comment>[]> {
  const out: StoredEntity<Comment>[] = [];
  for (const path of await listMarkdown(root, commentsDir(id), false)) {
    out.push(await readEntity<Comment>(root, path, 'comment'));
  }
  return out;
}

/** Issue-IDs aus den Verzeichnisnamen, sortiert; mit `shard` nur dieser Shard. */
export async function listIssueIds(root: string, shard?: string): Promise<string[]> {
  const shards =
    shard !== undefined
      ? [shard]
      : (await readDirSorted(join(root, 'issues')))
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
  const ids: string[] = [];
  for (const s of shards) {
    for (const entry of await readDirSorted(join(root, 'issues', s))) {
      if (entry.isDirectory() && isIssueId(entry.name) && shardOf(entry.name) === s) {
        ids.push(entry.name);
      }
    }
  }
  return ids.sort();
}

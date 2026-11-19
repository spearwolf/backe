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
import { entriesInFileOrder, parseEntityFile } from './frontmatter.ts';
import { readJsonc } from './jsonc.ts';
import { BACKLOG_CONFIG, commentsDir } from './layout.ts';

/**
 * Eine geladene Entität. `extra` sind die unbekannten Top-Level-Keys samt Werten in
 * Dateireihenfolge; sie gehören beim Zurückschreiben an `serializeEntityFile` (backe.md §2.3).
 */
export type StoredEntity<T> = { data: T; extra: [string, unknown][]; body: string; path: string };
/**
 * Eine Datei, die nicht geladen werden konnte. `kind` und `key` nennen die betroffene Entität,
 * soweit sie sich aus dem Pfad ableiten lässt — auch wenn der Inhalt kaputt ist. `key` fehlt,
 * wenn der Name im Pfad selbst ungültig ist.
 */
export type Problem = { path: string; message: string; kind?: EntityKind; key?: string };

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

const MAX_CONCURRENT_READS = 32;

/**
 * Wendet `fn` auf alle Elemente an, mit höchstens `limit` gleichzeitig laufenden Aufrufen.
 * Nach der ersten Ablehnung startet kein weiterer Aufruf; das Ergebnis lehnt mit diesem Fehler ab.
 */
async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i] as T);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// --- Einzelne Entität --------------------------------------------------------------------

/** Liest, parst und validiert eine Entitätsdatei; wirft `BackeError('validation')`. */
async function readEntity<T>(
  root: string,
  path: string,
  kind: EntityKind,
): Promise<StoredEntity<T>> {
  return parseStored<T>(await readFile(join(root, path), 'utf8'), path, kind);
}

function parseStored<T>(text: string, path: string, kind: EntityKind): StoredEntity<T> {
  const parsed = parseEntityFile(text, path);
  const { data, unknownKeys } = validateEntity(kind, parsed.data, path);
  const extra = entriesInFileOrder(parsed, unknownKeys);
  return { data: data as T, extra, body: parsed.body, path };
}

/** Wie `readEntity`, aber Prüffehler werden als Problem gesammelt statt geworfen. */
async function tryEntity<T>(
  root: string,
  path: string,
  kind: EntityKind,
  key: string,
  problems: Problem[],
): Promise<StoredEntity<T> | undefined> {
  const text = await readFile(join(root, path), 'utf8');
  return tryParse<T>(text, path, kind, key, problems);
}

/** Wie `parseStored`, aber Prüffehler werden als Problem gesammelt statt geworfen. */
function tryParse<T>(
  text: string,
  path: string,
  kind: EntityKind,
  key: string,
  problems: Problem[],
): StoredEntity<T> | undefined {
  try {
    return parseStored<T>(text, path, kind);
  } catch (err) {
    if (err instanceof BackeError) {
      problems.push({ path, message: err.message, kind, key });
      return undefined;
    }
    throw err;
  }
}

/**
 * Führt `collect` mit einer frischen Problem-Liste aus und hängt sie nach Pfad sortiert an
 * `problems` an. Parallele Reads liefern Problems in Abschlussreihenfolge; die Sortierung macht
 * sie unabhängig davon deterministisch, die Reihenfolge der Entitätsarten bleibt erhalten.
 */
async function withSortedProblems<R>(
  problems: Problem[],
  collect: (local: Problem[]) => Promise<R>,
): Promise<R> {
  const local: Problem[] = [];
  try {
    return await collect(local);
  } finally {
    local.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    problems.push(...local);
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
  const candidates: { path: string; name: string }[] = [];
  for (const path of await listMarkdown(root, dir, deep)) {
    const name = path.slice(dir.length + 1, -'.md'.length);
    if (valid(name)) {
      candidates.push({ path, name });
    } else {
      problems.push({ path, message: `${path}: ungültiger ${label} »${name}«`, kind });
    }
  }
  const loaded = await mapPool(candidates, MAX_CONCURRENT_READS, async ({ path, name }) => {
    const entity = await tryEntity<T>(root, path, kind, name, problems);
    return entity ? ([name, entity] as [string, StoredEntity<T>]) : undefined;
  });
  return sortedMap(loaded.filter((e) => e !== undefined));
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
        message: `${entity.path}: Elternprojekt »${parent}« fehlt`,
        kind: 'project',
        key: name,
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
  const candidates: { shard: string; id: string; path: string }[] = [];
  const shards = (await readDirSorted(join(root, 'issues'))).filter((e) => e.isDirectory());
  const listings = await mapPool(shards, MAX_CONCURRENT_READS, (shard) =>
    readDirSorted(join(root, 'issues', shard.name)),
  );
  for (const [i, shard] of shards.entries()) {
    for (const dir of listings[i] ?? []) {
      if (!dir.isDirectory()) continue;
      candidates.push({
        shard: shard.name,
        id: dir.name,
        path: `issues/${shard.name}/${dir.name}/issue.md`,
      });
    }
  }

  const loaded = await mapPool(
    candidates,
    MAX_CONCURRENT_READS,
    async ({ shard, id, path }): Promise<[string, StoredEntity<Issue>] | undefined> => {
      // Ohne issue.md ist das Verzeichnis kein Issue und bleibt unbeachtet.
      let text: string;
      try {
        text = await readFile(join(root, path), 'utf8');
      } catch (err) {
        // Ein Verzeichnis namens issue.md (EISDIR) zählt wie eine fehlende Datei.
        if (isMissing(err) || (err as NodeJS.ErrnoException | undefined)?.code === 'EISDIR') {
          return undefined;
        }
        throw err;
      }
      if (!isIssueId(id)) {
        problems.push({
          path,
          message: `${path}: Verzeichnisname »${id}« ist keine Issue-ID`,
          kind: 'issue',
        });
        return undefined;
      }
      if (shardOf(id) !== shard) {
        problems.push({
          path,
          message: `${path}: Issue »${id}« gehört in den Shard »${shardOf(id)}«, nicht »${shard}«`,
          kind: 'issue',
          key: id,
        });
        return undefined;
      }
      const entity = tryParse<Issue>(text, path, 'issue', id, problems);
      if (!entity) return undefined;
      if (entity.data.id !== id) {
        problems.push({
          path,
          message: `${path}: id »${entity.data.id}« passt nicht zum Verzeichnis »${id}«`,
          kind: 'issue',
          key: id,
        });
        return undefined;
      }
      return [id, entity];
    },
  );
  return sortedMap(loaded.filter((e) => e !== undefined));
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
  const users = await withSortedProblems(problems, (p) =>
    loadNamed<User>(root, 'users', 'user', false, isHandle, 'Handle', p),
  );
  const projects = await withSortedProblems(problems, (p) => loadProjects(root, p));
  const sprints = await withSortedProblems(problems, (p) =>
    loadNamed<Sprint>(root, 'sprints', 'sprint', false, isSprintSlug, 'Sprint-Slug', p),
  );
  const repos = await withSortedProblems(problems, (p) =>
    loadNamed<Repo>(root, 'repos', 'repo', false, isRepoName, 'Repo-Name', p),
  );
  const issues = await withSortedProblems(problems, (p) => loadIssues(root, p));
  return { config, users, projects, sprints, repos, issues, problems };
}

/** Lädt nur `repos/`, ohne die Backlog-Config zu verlangen; kaputte Dateien fehlen in der Map. */
export async function loadRepoRegistry(root: string): Promise<Map<string, StoredEntity<Repo>>> {
  return loadNamed<Repo>(root, 'repos', 'repo', false, isRepoName, 'Repo-Name', []);
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

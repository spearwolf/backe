/**
 * Lädt ein Backlog vom Dateisystem in einen Snapshot (backe.md §2.2). Kaputte Entitätsdateien
 * landen als `Problem` im Snapshot und fehlen in den Maps; nur die Backlog-Config ist Pflicht.
 */
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
import { BACKLOG_CONFIG, commentsDir, GITATTRIBUTES } from './layout.ts';
import { fsSource, type SourceEntry, type TreeSource } from './source.ts';

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
  /** Inhalt von `.gitattributes`; `undefined`, wenn die Datei fehlt. */
  attributes: string | undefined;
};

type NamedKind = 'user' | 'project' | 'sprint' | 'repo';

/** Wo die Dateien einer benannten Entitätsart liegen und wie ihr Name aus dem Pfad geprüft wird. */
const NAMED: Record<
  NamedKind,
  { dir: string; deep: boolean; valid: (name: string) => boolean; label: string }
> = {
  user: { dir: 'users', deep: false, valid: isHandle, label: 'Handle' },
  project: { dir: 'projects', deep: true, valid: isProjectPath, label: 'Projekt-Pfad' },
  sprint: { dir: 'sprints', deep: false, valid: isSprintSlug, label: 'Sprint-Slug' },
  repo: { dir: 'repos', deep: false, valid: isRepoName, label: 'Repo-Name' },
};
const NAMED_KINDS: readonly NamedKind[] = ['user', 'project', 'sprint', 'repo'];
const MAP_OF = {
  user: 'users',
  project: 'projects',
  sprint: 'sprints',
  repo: 'repos',
  issue: 'issues',
} as const satisfies Record<NamedKind | 'issue', keyof BacklogSnapshot>;
/** Reihenfolge der Entitätsarten in `problems`, wie `loadSnapshot` sie lädt. */
const PROBLEM_ORDER: readonly EntityKind[] = ['user', 'project', 'sprint', 'repo', 'issue'];

// --- Dateisystem-Helfer ------------------------------------------------------------------

/** Einträge eines Verzeichnisses (die Quelle sortiert sie nach Name); ein fehlendes ist leer. */
function readDirSorted(src: TreeSource, dir: string): Promise<SourceEntry[]> {
  return src.list(dir);
}

/** Inhalt einer Datei, die die Quelle eben aufgelistet hat; verschwindet sie doch (Wettlauf), ist das unerwartet. */
async function readText(src: TreeSource, path: string): Promise<string> {
  const bytes = await src.read(path);
  if (bytes === undefined)
    throw new BackeError('unexpected', `Datei »${path}« verschwand zwischen Auflisten und Lesen`);
  return bytes.toString('utf8');
}

/** Alle `*.md`-Dateien unter `dir` (rekursiv wenn `deep`), als Pfade relativ zur Wurzel. */
async function listMarkdown(src: TreeSource, dir: string, deep: boolean): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readDirSorted(src, dir)) {
    const rel = `${dir}/${entry.name}`;
    if (entry.dir) {
      if (deep) out.push(...(await listMarkdown(src, rel, deep)));
    } else if (entry.name.endsWith('.md')) {
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
  src: TreeSource,
  path: string,
  kind: EntityKind,
): Promise<StoredEntity<T>> {
  return parseStored<T>(await readText(src, path), path, kind);
}

function parseStored<T>(text: string, path: string, kind: EntityKind): StoredEntity<T> {
  const parsed = parseEntityFile(text, path);
  const { data, unknownKeys } = validateEntity(kind, parsed.data, path);
  const extra = entriesInFileOrder(parsed, unknownKeys);
  return { data: data as T, extra, body: parsed.body, path };
}

/** Wie `readEntity`, aber Prüffehler werden als Problem gesammelt statt geworfen. */
async function tryEntity<T>(
  src: TreeSource,
  path: string,
  kind: EntityKind,
  key: string,
  problems: Problem[],
): Promise<StoredEntity<T> | undefined> {
  const text = await readText(src, path);
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

/**
 * Name der Entität aus ihrem Pfad unter `NAMED[kind].dir`; ist er ungültig, ein Problem ohne
 * `key` und `undefined`.
 */
function nameOf(kind: NamedKind, path: string, problems: Problem[]): string | undefined {
  const { dir, valid, label } = NAMED[kind];
  const name = path.slice(dir.length + 1, -'.md'.length);
  if (valid(name)) return name;
  problems.push({ path, message: `${path}: ungültiger ${label} »${name}«`, kind });
  return undefined;
}

/** Die benannte Entitätsart, deren Verzeichnis `loadSnapshot` die Datei `path` entnähme. */
function namedKindOf(path: string): NamedKind | undefined {
  return NAMED_KINDS.find((kind) => {
    const { dir, deep } = NAMED[kind];
    if (!path.startsWith(`${dir}/`) || !path.endsWith('.md')) return false;
    return deep || !path.slice(dir.length + 1).includes('/');
  });
}

/** Lädt alle Dateien einer benannten Entitätsart, deren aus dem Pfad abgeleiteter Name gültig ist. */
async function loadNamed<T>(
  src: TreeSource,
  kind: NamedKind,
  problems: Problem[],
): Promise<Map<string, StoredEntity<T>>> {
  const { dir, deep } = NAMED[kind];
  const candidates: { path: string; name: string }[] = [];
  for (const path of await listMarkdown(src, dir, deep)) {
    const name = nameOf(kind, path, problems);
    if (name !== undefined) candidates.push({ path, name });
  }
  const loaded = await mapPool(candidates, MAX_CONCURRENT_READS, async ({ path, name }) => {
    const entity = await tryEntity<T>(src, path, kind, name, problems);
    return entity ? ([name, entity] as [string, StoredEntity<T>]) : undefined;
  });
  return sortedMap(loaded.filter((e) => e !== undefined));
}

/**
 * Behält nur Projekte, deren Elternprojekt (selbst angenommen) existiert (§2.9); die übrigen
 * werden Probleme. Eltern zuerst, damit ein verworfenes Projekt auch seine Unterprojekte verwirft.
 */
function acceptProjects(
  loaded: ReadonlyMap<string, StoredEntity<Project>>,
  problems: Problem[],
): Map<string, StoredEntity<Project>> {
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

async function loadProjects(
  src: TreeSource,
  problems: Problem[],
): Promise<Map<string, StoredEntity<Project>>> {
  return acceptProjects(await loadNamed<Project>(src, 'project', problems), problems);
}

/** Shard und Verzeichnisname, wenn `path` die Form `issues/<shard>/<dir>/issue.md` hat. */
function issueCandidate(path: string): { shard: string; id: string } | undefined {
  const [top, shard, id, file, ...rest] = path.split('/');
  if (top !== 'issues' || file !== 'issue.md' || rest.length > 0) return undefined;
  if (shard === undefined || shard === '' || id === undefined || id === '') return undefined;
  return { shard, id };
}

/**
 * Prüft Verzeichnis, Shard und Inhalt einer `issue.md`; jeder Fehler wird ein Problem. Ohne
 * gültige Issue-ID im Verzeichnisnamen hat das Problem keinen `key`.
 */
function parseIssue(
  path: string,
  shard: string,
  id: string,
  text: string,
  problems: Problem[],
): [string, StoredEntity<Issue>] | undefined {
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
}

async function loadIssues(
  src: TreeSource,
  problems: Problem[],
): Promise<Map<string, StoredEntity<Issue>>> {
  const candidates: { shard: string; id: string; path: string }[] = [];
  const shards = (await readDirSorted(src, 'issues')).filter((e) => e.dir);
  const listings = await mapPool(shards, MAX_CONCURRENT_READS, (shard) =>
    readDirSorted(src, `issues/${shard.name}`),
  );
  for (const [i, shard] of shards.entries()) {
    for (const dir of listings[i] ?? []) {
      if (!dir.dir) continue;
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
      // Ein Verzeichnis namens issue.md zählt wie eine fehlende Datei.
      const bytes = await src.read(path);
      if (bytes === undefined) return undefined;
      return parseIssue(path, shard, id, bytes.toString('utf8'), problems);
    },
  );
  return sortedMap(loaded.filter((e) => e !== undefined));
}

// --- Öffentliche API ---------------------------------------------------------------------

async function loadConfig(src: TreeSource, origin: string): Promise<BacklogConfig> {
  const bytes = await src.read(BACKLOG_CONFIG);
  if (bytes === undefined) {
    throw new BackeError(
      'not_found',
      `Kein Backlog gefunden: ${BACKLOG_CONFIG} fehlt in ${origin}`,
    );
  }
  const text = bytes.toString('utf8');
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

async function loadAttributes(src: TreeSource): Promise<string | undefined> {
  return (await src.read(GITATTRIBUTES))?.toString('utf8');
}

/** Lädt Config, `.gitattributes` und alle Entitäten außer Kommentaren und Anhängen. */
export async function loadSnapshot(root: string): Promise<BacklogSnapshot> {
  return loadSnapshotFrom(fsSource(root), root);
}

/** Wie `loadSnapshot` für eine beliebige Quelle; `origin` benennt sie in der Fehlermeldung. */
export async function loadSnapshotFrom(
  src: TreeSource,
  origin = 'der Quelle',
): Promise<BacklogSnapshot> {
  const config = await loadConfig(src, origin);
  const problems: Problem[] = [];
  const users = await withSortedProblems(problems, (p) => loadNamed<User>(src, 'user', p));
  const projects = await withSortedProblems(problems, (p) => loadProjects(src, p));
  const sprints = await withSortedProblems(problems, (p) => loadNamed<Sprint>(src, 'sprint', p));
  const repos = await withSortedProblems(problems, (p) => loadNamed<Repo>(src, 'repo', p));
  const issues = await withSortedProblems(problems, (p) => loadIssues(src, p));
  const attributes = await loadAttributes(src);
  return { config, users, projects, sprints, repos, issues, problems, attributes };
}

/**
 * Der Snapshot `s` mit anderem Inhalt an den Pfaden `files` (`null` = Datei fehlt), rein und ohne
 * `s` zu verändern. Jeder Pfad wird geparst und geprüft wie von `loadSnapshot`; seine bisherige
 * Entität und seine bisherigen Probleme entfallen. `.gitattributes` wird `attributes`; Pfade, die
 * `loadSnapshot` nicht liest (Kommentare, Anhänge, Config, fremde Dateien), ändern nichts.
 * Unterprojekte ohne Elternprojekt werden wie beim Laden zu Problemen. Ein Unterprojekt, das
 * schon in `s` mangels Elternprojekt verworfen war, bleibt verworfen, solange seine eigene Datei
 * nicht in `files` steht: Sein Inhalt liegt dem Snapshot nicht vor.
 *
 * Einen anderen Stand rekonstruieren (etwa `HEAD` aus der Arbeitskopie): `files` sind die
 * geänderten Pfade mit ihrem Inhalt in jenem Stand **plus** die Pfade aus
 * `orphanedProjectPaths(s)` mit ihrem unveränderten Inhalt. Sonst fehlt ein Unterprojekt, dessen
 * Elternprojekt nur in `s` gelöscht ist, auch im Ergebnis.
 */
export function snapshotAt(
  s: BacklogSnapshot,
  files: readonly { path: string; content: string | null }[],
): BacklogSnapshot {
  type AnyMap = Map<string, StoredEntity<unknown>>;
  const maps: Partial<Record<NamedKind | 'issue', AnyMap>> = {};
  const mapOf = (kind: NamedKind | 'issue'): AnyMap => {
    maps[kind] ??= new Map(s[MAP_OF[kind]] as AnyMap);
    return maps[kind];
  };
  const reparsed = new Set<string>();
  const fresh: Problem[] = [];
  let attributes = s.attributes;

  for (const { path, content } of files) {
    if (path === GITATTRIBUTES) {
      attributes = content ?? undefined;
      continue;
    }
    const named = namedKindOf(path);
    const issue = named === undefined ? issueCandidate(path) : undefined;
    let key: string;
    let parse: (text: string) => [string, StoredEntity<unknown>] | undefined;
    if (named !== undefined) {
      key = path.slice(NAMED[named].dir.length + 1, -'.md'.length);
      parse = (text) => parseNamedText(named, path, text, fresh);
    } else if (issue !== undefined) {
      key = issue.id;
      parse = (text) => parseIssue(path, issue.shard, issue.id, text, fresh);
    } else {
      continue;
    }
    reparsed.add(path);
    const map = mapOf(named ?? 'issue');
    // Nur die Entität genau dieses Pfads; ein falsch abgelegtes Issue lässt das echte stehen.
    if (map.get(key)?.path === path) map.delete(key);
    const entry = content === null ? undefined : parse(content);
    if (entry !== undefined) map.set(entry[0], entry[1]);
  }

  const next: BacklogSnapshot = { ...s, attributes };
  for (const kind of [...NAMED_KINDS, 'issue'] as const) {
    const map = maps[kind];
    if (map === undefined) continue;
    const sorted =
      kind === 'project'
        ? acceptProjects(map as Map<string, StoredEntity<Project>>, fresh)
        : sortedMap(map);
    (next as Record<string, unknown>)[MAP_OF[kind]] = sorted;
  }
  const rank = (p: Problem) => {
    const i = p.kind === undefined ? -1 : PROBLEM_ORDER.indexOf(p.kind);
    return i < 0 ? PROBLEM_ORDER.length : i;
  };
  next.problems = [...s.problems.filter((p) => !reparsed.has(p.path)), ...fresh].sort(
    (a, b) => rank(a) - rank(b) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  return next;
}

/**
 * Pfade der Projektdateien, die in `s` fehlen und deren Elternprojekt in `s` fehlt, sortiert.
 * Darunter sind alle, die `loadSnapshot` nur mangels Elternprojekt verworfen hat (backe.md §2.9);
 * eine solche Datei, die zusätzlich kaputt ist, steht ebenfalls da. Für `snapshotAt` ist das
 * unschädlich: Eine unveränderte Datei erneut zu parsen ergibt, was `loadSnapshot` ergäbe.
 */
export function orphanedProjectPaths(s: BacklogSnapshot): string[] {
  const paths = new Set<string>();
  for (const p of s.problems) {
    if (p.kind !== 'project' || p.key === undefined || s.projects.has(p.key)) continue;
    const slash = p.key.lastIndexOf('/');
    if (slash >= 0 && !s.projects.has(p.key.slice(0, slash))) paths.add(p.path);
  }
  return [...paths].sort();
}

/** Wie `loadNamed` für eine einzelne Datei mit bekanntem Inhalt. */
function parseNamedText(
  kind: NamedKind,
  path: string,
  text: string,
  problems: Problem[],
): [string, StoredEntity<unknown>] | undefined {
  const name = nameOf(kind, path, problems);
  if (name === undefined) return undefined;
  const entity = tryParse<unknown>(text, path, kind, name, problems);
  return entity === undefined ? undefined : [name, entity];
}

/** Lädt nur `repos/`, ohne die Backlog-Config zu verlangen; kaputte Dateien fehlen in der Map. */
export async function loadRepoRegistry(root: string): Promise<Map<string, StoredEntity<Repo>>> {
  return loadNamed<Repo>(fsSource(root), 'repo', []);
}

/** Kommentare eines Issues, chronologisch nach Dateiname; ein kaputter Kommentar wirft. */
export async function listComments(root: string, id: string): Promise<StoredEntity<Comment>[]> {
  return listCommentsFrom(fsSource(root), id);
}

/** Wie `listComments` für eine beliebige Quelle. */
export async function listCommentsFrom(
  src: TreeSource,
  id: string,
): Promise<StoredEntity<Comment>[]> {
  if (!isIssueId(id)) throw new BackeError('validation', `Ungültige Issue-ID »${id}«`);
  const out: StoredEntity<Comment>[] = [];
  for (const path of await listMarkdown(src, commentsDir(id), false)) {
    out.push(await readEntity<Comment>(src, path, 'comment'));
  }
  return out;
}

/**
 * Wie `listComments`, aber ein Kommentar, der sich nicht lesen oder prüfen lässt, fehlt nur, statt
 * zu werfen — für Prüfungen über den ganzen Backlog (`verify`).
 */
export async function readableComments(root: string, id: string): Promise<StoredEntity<Comment>[]> {
  const src = fsSource(root);
  const out: StoredEntity<Comment>[] = [];
  for (const path of await listMarkdown(src, commentsDir(id), false)) {
    const comment = tryParse<Comment>(await readText(src, path), path, 'comment', path, []);
    if (comment !== undefined) out.push(comment);
  }
  return out;
}

const SHARD_RE = /^[0-9a-hjkmnp-tv-z]{2}$/;

/** Issue-IDs aus den Verzeichnisnamen, sortiert; mit `shard` nur dieser Shard. */
export async function listIssueIds(root: string, shard?: string): Promise<string[]> {
  if (shard !== undefined && !SHARD_RE.test(shard)) {
    throw new BackeError('validation', `Ungültiger Shard »${shard}«`);
  }
  const src = fsSource(root);
  const shards =
    shard !== undefined
      ? [shard]
      : (await readDirSorted(src, 'issues')).filter((e) => e.dir).map((e) => e.name);
  const ids: string[] = [];
  for (const s of shards) {
    for (const entry of await readDirSorted(src, `issues/${s}`)) {
      if (entry.dir && isIssueId(entry.name) && shardOf(entry.name) === s) {
        ids.push(entry.name);
      }
    }
  }
  return ids.sort();
}

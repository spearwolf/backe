/**
 * Delta zwischen zwei Ständen eines Backlogs für den Event-Stream von `backe ui` (ui.md §2.4.2):
 * Entitäts-JSON je Snapshot als Tabelle, Vergleich zweier Tabellen zu einem Patch, Einordnung
 * geänderter Pfade. Rein, ohne I/O; `/state` baut seine Listen über dieselben Funktionen, damit
 * Patch und Gesamtzustand dieselbe Form haben.
 */
import { compareCodeUnits } from '../core/compare.ts';
import { sshFingerprint } from '../core/fingerprint.ts';
import type { User } from '../core/schemas.ts';
import { isAtomicTemp } from '../store/files.ts';
import { BACKLOG_CONFIG, isJunkFile } from '../store/layout.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import type { PatchJson, StateJson, UserJson } from './api.ts';

/** Wie `user show --json` ohne `body`: Fingerprints statt Keys, leere Listen fehlen. */
export function userJson(handle: string, user: User, admins: readonly string[]): UserJson {
  const fingerprints = (user.keys ?? []).map(sshFingerprint);
  const revoked = (user.revoked_keys ?? []).map((r) => ({
    fingerprint: sshFingerprint(r.key),
    revoked: r.revoked,
  }));
  return {
    handle,
    name: user.name,
    kind: user.kind,
    ...(user.operator === undefined ? {} : { operator: user.operator }),
    admin: admins.includes(handle),
    ...(fingerprints.length === 0 ? {} : { fingerprints }),
    ...(revoked.length === 0 ? {} : { revoked }),
  };
}

/**
 * Beschreibung von Projekt, Sprint oder Repo wie bei `sprint show --format json`: fehlt, wenn leer.
 * Sie reist in den Listen, damit eine reine Body-Änderung als Upsert im Patch ankommt; Issue-Bodies
 * bleiben draußen.
 */
const bodyOf = (e: { body: string }): { body?: string } => (e.body === '' ? {} : { body: e.body });

/** Die Entitätslisten von `/state`, in der Reihenfolge des Snapshots. */
export function entityLists(
  s: BacklogSnapshot,
): Pick<StateJson, 'config' | 'issues' | 'projects' | 'sprints' | 'repos' | 'users'> {
  const { $schema: _schema, ...config } = s.config;
  return {
    config,
    issues: [...s.issues.values()].map((e) => e.data),
    projects: [...s.projects].map(([path, e]) => ({ path, ...e.data, ...bodyOf(e) })),
    sprints: [...s.sprints].map(([slug, e]) => ({ slug, ...e.data, ...bodyOf(e) })),
    repos: [...s.repos].map(([name, e]) => ({ name, ...e.data, ...bodyOf(e) })),
    users: [...s.users].map(([handle, e]) => userJson(handle, e.data, s.config.admins)),
  };
}

export const ENTITY_KINDS = ['issues', 'projects', 'sprints', 'repos', 'users'] as const;
export type EntityKindKey = (typeof ENTITY_KINDS)[number];

/** Ein Wert samt seiner Serialisierung, über die verglichen wird. */
type Row = { json: unknown; text: string };
const row = (json: unknown): Row => ({ json, text: JSON.stringify(json) });

/**
 * Sichtbarer Stand eines Snapshots: je Entitätsart Key → JSON, dazu Config und Probleme. Die
 * Issue-Bodies stehen nur zum Vergleich darin; der Patch trägt sie nie (ui.md §3.4).
 */
export type EntityTable = {
  entities: Record<EntityKindKey, Map<string, Row>>;
  bodies: Map<string, string>;
  config: Row;
  problems: Row;
};

const KEY_OF: Record<EntityKindKey, (e: never) => string> = {
  issues: (e: { id: string }) => e.id,
  projects: (e: { path: string }) => e.path,
  sprints: (e: { slug: string }) => e.slug,
  repos: (e: { name: string }) => e.name,
  users: (e: { handle: string }) => e.handle,
};

export function entityTable(s: BacklogSnapshot): EntityTable {
  const lists = entityLists(s);
  const entities = {} as EntityTable['entities'];
  for (const kind of ENTITY_KINDS) {
    const key = KEY_OF[kind] as (e: unknown) => string;
    entities[kind] = new Map(lists[kind].map((e) => [key(e), row(e)]));
  }
  const bodies = new Map([...s.issues].map(([id, e]) => [id, e.body]));
  return { entities, bodies, config: row(lists.config), problems: row(s.problems) };
}

/**
 * Patch von `a` nach `b` ohne `rev` und `head`: neue oder geänderte Entitäten in `upsert`,
 * verschwundene in `remove`, `config` und `problems` nur, wenn sie sich ändern. `touched` sind die
 * Issues mit geänderten Kommentaren oder Anhängen (`pathTouched`) und die, die in beiden Ständen
 * stehen und deren Body sich geändert hat; es zählt als sichtbar. Nichts Sichtbares → `undefined`.
 */
export function diffTables(
  a: EntityTable,
  b: EntityTable,
  pathTouched: readonly string[] = [],
): Omit<PatchJson, 'rev' | 'head'> | undefined {
  const touchedSet = new Set(pathTouched);
  for (const [id, body] of b.bodies) {
    const before = a.bodies.get(id);
    if (before !== undefined && before !== body) touchedSet.add(id);
  }
  const touched = [...touchedSet].sort(compareCodeUnits);
  const upsert: Record<string, unknown> = {};
  const remove: Record<string, string[]> = {};
  let visible = touched.length > 0;
  for (const kind of ENTITY_KINDS) {
    const before = a.entities[kind];
    const after = b.entities[kind];
    const changed = [...after]
      .filter(([key, r]) => before.get(key)?.text !== r.text)
      .map(([, r]) => r.json);
    const gone = [...before.keys()].filter((key) => !after.has(key)).sort(compareCodeUnits);
    if (changed.length > 0) upsert[kind] = changed;
    if (gone.length > 0) remove[kind] = gone;
    visible ||= changed.length > 0 || gone.length > 0;
  }
  if (a.config.text !== b.config.text) {
    upsert.config = b.config.json;
    visible = true;
  }
  const problemsChanged = a.problems.text !== b.problems.text;
  if (!visible && !problemsChanged) return undefined;
  return {
    upsert: upsert as PatchJson['upsert'],
    remove: remove as PatchJson['remove'],
    ...(touched.length === 0 ? {} : { touched }),
    ...(problemsChanged ? { problems: b.problems.json as PatchJson['problems'] } : {}),
  };
}

/** Die Verzeichnisse eines Backlogs, deren Inhalt den sichtbaren Stand bestimmt. */
export const BACKLOG_DIRS = ['issues', 'projects', 'sprints', 'repos', 'users', '.backe'] as const;
const WATCHED_DIRS = BACKLOG_DIRS.map((d) => `${d}/`);

/**
 * Ob ein Pfad im Arbeitsbaum (relativ, mit `/`) den sichtbaren Stand betreffen kann. Sicherungs-
 * und Swap-Dateien von Editoren zählen nicht, sie entstehen bei jedem Hand-Edit; ebenso wenig die
 * Temp-Dateien von `writeFileAtomic` — deren `rename` meldet sich unter dem echten Namen.
 */
export function watchedPath(path: string): boolean {
  if (isJunkFile(path) || isAtomicTemp(path)) return false;
  return WATCHED_DIRS.some((dir) => path.startsWith(dir) || `${path}/` === dir);
}

/** `issues/<shard>/<id>/comments|attachments[/…]` → `<id>`, sonst `undefined`. */
export function touchedIssue(path: string): string | undefined {
  const id = issueOfPath(path);
  const sub = path.split('/')[3];
  return sub === 'comments' || sub === 'attachments' ? id : undefined;
}

/** `issues/<shard>/<id>/…` → `<id>`, sonst `undefined`. */
export function issueOfPath(path: string): string | undefined {
  const [top, shard, id, sub] = path.split('/');
  if (top !== 'issues' || shard === undefined || id === undefined || sub === undefined) {
    return undefined;
  }
  return id;
}

/** Issues, deren Kommentare oder Anhänge unter `paths` liegen, sortiert und ohne Doppelte. */
export function touchedIssues(paths: Iterable<string>): string[] {
  const ids = new Set<string>();
  for (const p of paths) {
    const id = touchedIssue(p);
    if (id !== undefined) ids.add(id);
  }
  return [...ids].sort(compareCodeUnits);
}

/**
 * Ob ein geänderter Pfad nicht per `snapshotAt` nachgeladen werden kann: die Backlog-Config (die
 * `snapshotAt` nicht liest), und alles, was keine einzelne Entitätsdatei ist — ein Verzeichnis
 * etwa, dessen Inhalt mit ihm verschwand. Kommentare und Anhänge laden nie neu, sie sind `touched`.
 */
export function needsFullReload(path: string): boolean {
  if (path === BACKLOG_CONFIG) return true;
  if (touchedIssue(path) !== undefined) return false;
  if (path.startsWith('.backe/')) return false;
  return !path.endsWith('.md');
}

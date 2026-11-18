/**
 * Arbeitsstand einer Operation: Änderungen an Entitäten und Dateien gegen einen unveränderlichen
 * Snapshot sammeln, Invarianten beim Schreiben prüfen und am Ende in `FileChange`s übersetzen.
 * Ein Draft wird nach jedem geworfenen Fehler verworfen; er kennt kein Zurückrollen.
 */
import { BackeError } from '../core/errors.ts';
import { CROCKFORD, defaultRandomBytes } from '../core/ids.ts';
import {
  type EntityKind,
  type Issue,
  type Project,
  type Repo,
  type Sprint,
  type User,
  validateEntity,
} from '../core/schemas.ts';
import type { State } from '../core/state.ts';
import type { FileChange } from '../store/files.ts';
import { canonicalBody, serializeEntityFile } from '../store/frontmatter.ts';
import {
  commentFileName,
  commentsDir,
  issueDir,
  issueFile,
  projectFile,
  repoFile,
  sprintFile,
  userFile,
} from '../store/layout.ts';
import type { BacklogSnapshot, StoredEntity } from '../store/snapshot.ts';
import type { ApplyContext } from './apply.ts';
import { checkIssueInvariants, sameValue, violation } from './invariants.ts';
import type { Notice } from './notice.ts';

/** Entitäten neben Issues, die eine Operation schreiben kann. */
export type NamedKind = 'user' | 'project' | 'sprint' | 'repo';
type NamedData = { user: User; project: Project; sprint: Sprint; repo: Repo };

type MapName = 'issues' | 'users' | 'projects' | 'sprints' | 'repos';
type AnyMap = Map<string, StoredEntity<unknown>>;

const MAP_OF = {
  user: 'users',
  project: 'projects',
  sprint: 'sprints',
  repo: 'repos',
} as const satisfies Record<NamedKind, MapName>;

const KIND_OF = {
  issues: 'issue',
  users: 'user',
  projects: 'project',
  sprints: 'sprint',
  repos: 'repo',
} as const satisfies Record<MapName, EntityKind>;

const FILE_OF: Record<NamedKind, (key: string) => string> = {
  user: userFile,
  project: projectFile,
  sprint: sprintFile,
  repo: repoFile,
};

const LABEL_OF: Record<NamedKind, string> = {
  user: 'User',
  project: 'Projekt',
  sprint: 'Sprint',
  repo: 'Repo',
};

const MAP_NAMES: readonly MapName[] = ['issues', 'users', 'projects', 'sprints', 'repos'];
const MAX_NAME_ATTEMPTS = 100;
const COMMENT_FILE_RE = new RegExp(`^(\\d{8}T\\d{6}Z)-(.+)-[${CROCKFORD}]{3}\\.md$`);

export type CommentHead = { kind?: 'transition'; from?: State; to?: State };

/** Autor und Zeitstempel aus `YYYYMMDDTHHMMSSZ-<author>-<rnd>.md` (backe.md §2.7). */
function parseCommentFileName(file: string): { author: string; created: string } | undefined {
  const m = COMMENT_FILE_RE.exec(file);
  if (m === null) return undefined;
  const [, t = '', author = ''] = m;
  const created = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`;
  return { author, created };
}

function byKey<T>([a]: [string, T], [b]: [string, T]): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Top-Level-Keys mit `undefined` entfallen, damit gleiche Daten auch gleich aussehen. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export class Draft {
  readonly ctx: ApplyContext;
  readonly #base: BacklogSnapshot;
  /** Aktuelle Maps; eine Map in `#shared` gehört auch einem ausgegebenen Snapshot. */
  readonly #maps: Record<MapName, AnyMap>;
  readonly #shared = new Set<MapName>(MAP_NAMES);
  readonly #unsorted = new Set<MapName>();
  readonly #dirty = new Set<MapName>();
  readonly #touched: Record<MapName, Set<string>>;
  readonly #files = new Map<string, string | Uint8Array | null>();
  readonly #notices: Notice[] = [];
  #snapshot: BacklogSnapshot;
  #revision = 0;

  constructor(base: BacklogSnapshot, ctx: ApplyContext) {
    this.ctx = ctx;
    this.#base = base;
    this.#snapshot = base;
    this.#maps = {
      issues: base.issues as AnyMap,
      users: base.users as AnyMap,
      projects: base.projects as AnyMap,
      sprints: base.sprints as AnyMap,
      repos: base.repos as AnyMap,
    };
    this.#touched = {
      issues: new Set(),
      users: new Set(),
      projects: new Set(),
      sprints: new Set(),
      repos: new Set(),
    };
  }

  /**
   * Stand inklusive eigener Änderungen. Nach jeder Änderung ist die betroffene Map eine neue
   * Instanz, damit an ihr hängende Caches (`graphOf`) nie einen alten Stand liefern.
   */
  get snapshot(): BacklogSnapshot {
    if (this.#dirty.size === 0) return this.#snapshot;
    const fresh: Partial<Record<MapName, AnyMap>> = {};
    for (const name of this.#dirty) {
      if (this.#unsorted.has(name)) {
        this.#maps[name] = new Map([...this.#maps[name]].sort(byKey));
        this.#unsorted.delete(name);
      }
      fresh[name] = this.#maps[name];
      this.#shared.add(name);
    }
    this.#dirty.clear();
    this.#snapshot = { ...this.#snapshot, ...fresh } as BacklogSnapshot;
    return this.#snapshot;
  }

  /** Anzahl wirksamer Änderungen; bleibt sie 0, war die Operation ein No-op. */
  get revision(): number {
    return this.#revision;
  }

  // --- Issues ------------------------------------------------------------------------------

  findIssue(id: string): StoredEntity<Issue> | undefined {
    return this.#maps.issues.get(id) as StoredEntity<Issue> | undefined;
  }

  issue(id: string): StoredEntity<Issue> {
    const found = this.findIssue(id);
    if (found === undefined) {
      throw violation('missing_ref', `Issue ${id} nicht gefunden`, { ids: [id] });
    }
    return found;
  }

  /**
   * Schreibt ein Issue. `body` fehlt → bisheriger Body (`''` bei neuen); unbekannte Keys bleiben.
   * Identische Daten und Body ändern nichts. Danach gelten die Invarianten gegen den neuen Stand.
   */
  putIssue(id: string, data: Issue, body?: string): void {
    const file = issueFile(id);
    const parsed = this.#validated('issue', data, file) as Issue;
    if (parsed.id !== id) {
      throw violation('schema', `${file}: id: erwartet ${id}, bekam ${parsed.id}`);
    }
    const before = this.findIssue(id);
    if (!this.#put('issues', id, file, before, parsed, body)) return;
    checkIssueInvariants(this, before?.data, parsed);
  }

  removeIssue(id: string): void {
    this.issue(id);
    this.#store('issues', id, undefined);
  }

  // --- Benannte Entitäten ------------------------------------------------------------------

  findEntity<K extends NamedKind>(kind: K, key: string): StoredEntity<NamedData[K]> | undefined {
    return this.#maps[MAP_OF[kind]].get(key) as StoredEntity<NamedData[K]> | undefined;
  }

  entity<K extends NamedKind>(kind: K, key: string): StoredEntity<NamedData[K]> {
    const found = this.findEntity(kind, key);
    if (found === undefined) {
      throw violation('missing_ref', `${LABEL_OF[kind]} ${key} nicht gefunden`, { ids: [key] });
    }
    return found;
  }

  /** Wie `putIssue`, ohne Issue-Invarianten; die prüft die jeweilige Operation selbst. */
  putEntity<K extends NamedKind>(kind: K, key: string, data: NamedData[K], body?: string): void {
    const file = FILE_OF[kind](key);
    const parsed = this.#validated(kind, data, file);
    this.#put(MAP_OF[kind], key, file, this.findEntity(kind, key), parsed, body);
  }

  removeEntity(kind: NamedKind, key: string): void {
    this.entity(kind, key);
    this.#store(MAP_OF[kind], key, undefined);
  }

  // --- Kommentare, Dateien, Hinweise -------------------------------------------------------

  /**
   * Legt einen Kommentar des Akteurs an und gibt den Dateinamen zurück. Ohne `file` entsteht der
   * Name aus `ctx.now`, `ctx.actor` und drei Zufallszeichen; mit `file` muss der Autorenteil der
   * Akteur sein, `created` kommt dann aus dem Namen.
   */
  addComment(issueId: string, head: CommentHead, body: string, file?: string): string {
    this.issue(issueId);
    const dir = commentsDir(issueId);
    let name: string;
    let created: string;
    if (file === undefined) {
      name = this.#freshCommentName(issueId);
      created = this.ctx.now;
    } else {
      const parsed = parseCommentFileName(file);
      if (parsed === undefined) {
        throw violation('schema', `Ungültiger Kommentar-Dateiname "${file}"`);
      }
      if (parsed.author !== this.ctx.actor) {
        throw violation('policy', `Kommentar "${file}" gehört nicht zu ${this.ctx.actor}`);
      }
      if (this.#commentTaken(issueId, file)) {
        throw violation('exists', `Kommentar ${dir}/${file} existiert bereits`, { ids: [issueId] });
      }
      name = file;
      created = parsed.created;
    }
    const path = `${dir}/${name}`;
    const data = this.#validated(
      'comment',
      compact({ author: this.ctx.actor, created, ...head }),
      path,
    );
    this.putFile(path, serializeEntityFile('comment', data, body));
    return name;
  }

  /** Schreibt (`string`/`Uint8Array`) oder löscht (`null`) eine Datei, etwa einen Anhang. */
  putFile(path: string, content: string | Uint8Array | null): void {
    this.#files.set(path, content);
    this.#revision++;
  }

  notice(n: Notice): void {
    this.#notices.push(n);
  }

  /**
   * Endstand und Dateiänderungen: jede berührte Entität, die sich gegenüber dem Basis-Snapshot
   * unterscheidet, wird kanonisch geschrieben; entfernte Issues werden ein rekursives Löschen
   * ihres Verzeichnisses, alle Dateien darunter entfallen. Sortiert nach Pfad.
   */
  finish(): { snapshot: BacklogSnapshot; changes: FileChange[]; notices: Notice[] } {
    const snapshot = this.snapshot;
    const changes: FileChange[] = [];
    const removedDirs: string[] = [];
    for (const name of MAP_NAMES) {
      const kind = KIND_OF[name];
      const was = this.#base[name] as AnyMap;
      const now = snapshot[name] as AnyMap;
      for (const key of this.#touched[name]) {
        const before = was.get(key);
        const after = now.get(key);
        if (after !== undefined) {
          if (before === undefined || !this.#sameStored(before, after)) {
            const data = after.data as Record<string, unknown>;
            const content = serializeEntityFile(kind, data, after.body, after.extra);
            changes.push({ path: after.path, content });
          }
          continue;
        }
        if (kind === 'issue') removedDirs.push(`${issueDir(key)}/`);
        if (before === undefined) continue;
        changes.push(
          kind === 'issue'
            ? { path: issueDir(key), content: null, recursive: true }
            : { path: before.path, content: null },
        );
      }
    }
    for (const [path, content] of this.#files) {
      if (!removedDirs.some((dir) => path.startsWith(dir))) changes.push({ path, content });
    }
    changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return { snapshot, changes, notices: [...this.#notices] };
  }

  // --- Intern ------------------------------------------------------------------------------

  #validated(kind: EntityKind, data: object, file: string): Record<string, unknown> {
    let result: { data: object; unknownKeys: string[] };
    try {
      result = validateEntity(kind, data, file);
    } catch (err) {
      if (err instanceof BackeError) throw violation('schema', err.message);
      throw err;
    }
    if (result.unknownKeys.length > 0) {
      throw violation('schema', `${file}: unbekannte Felder: ${result.unknownKeys.join(', ')}`);
    }
    return compact(result.data as Record<string, unknown>);
  }

  /**
   * Schreibt Daten und Body (so normalisiert, wie der Serializer ihn schreibt) in die Map; `false`,
   * wenn beides schon so dasteht. Unbekannte Keys und Pfad bleiben.
   */
  #put(
    name: MapName,
    key: string,
    file: string,
    before: StoredEntity<unknown> | undefined,
    data: object,
    body: string | undefined,
  ): boolean {
    const nextBody = body === undefined ? (before?.body ?? '') : canonicalBody(body);
    if (before !== undefined && sameValue(before.data, data) && nextBody === before.body) {
      return false;
    }
    this.#store(name, key, {
      data,
      extra: before?.extra ?? [],
      body: nextBody,
      path: before?.path ?? file,
    });
    return true;
  }

  #sameStored(a: StoredEntity<unknown>, b: StoredEntity<unknown>): boolean {
    return a.body === b.body && sameValue(a.data, b.data) && sameValue(a.extra, b.extra);
  }

  #store(name: MapName, key: string, entity: StoredEntity<unknown> | undefined): void {
    if (this.#shared.has(name)) {
      this.#maps[name] = new Map(this.#maps[name]);
      this.#shared.delete(name);
    }
    const map = this.#maps[name];
    if (entity === undefined) {
      map.delete(key);
    } else {
      if (!map.has(key)) this.#unsorted.add(name);
      map.set(key, entity);
    }
    this.#dirty.add(name);
    this.#touched[name].add(key);
    this.#revision++;
  }

  /** Name schon in diesem Draft vergeben oder unter den geladenen Kommentaren des Issues. */
  #commentTaken(issueId: string, name: string): boolean {
    const path = `${commentsDir(issueId)}/${name}`;
    if (this.#files.has(path)) return true;
    return (this.ctx.comments?.get(issueId) ?? []).some((c) => c.path === path);
  }

  #freshCommentName(issueId: string): string {
    const source = this.ctx.randomBytes ?? defaultRandomBytes;
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
      const bytes = source(3);
      if (bytes.length < 3) {
        throw new BackeError('unexpected', `Zufallsquelle lieferte ${bytes.length} statt 3 Bytes`);
      }
      // 256 ist durch 32 teilbar, `& 31` ist also gleichverteilt.
      const rnd = [...bytes.subarray(0, 3)].map((b) => CROCKFORD[b & 31]).join('');
      const name = commentFileName(this.ctx.now, this.ctx.actor, rnd);
      if (!this.#commentTaken(issueId, name)) return name;
    }
    throw new BackeError(
      'unexpected',
      `Kein freier Kommentar-Dateiname nach ${MAX_NAME_ATTEMPTS} Versuchen gefunden`,
    );
  }
}

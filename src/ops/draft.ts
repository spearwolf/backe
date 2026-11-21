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
  GITATTRIBUTES,
  issueDir,
  issueFile,
  parseCommentFileName,
  projectFile,
  repoFile,
  sprintFile,
  userFile,
} from '../store/layout.ts';
import type { BacklogSnapshot, Problem, StoredEntity } from '../store/snapshot.ts';
import type { ApplyContext } from './apply.ts';
import { checkIssueInvariants, sameValue, violation } from './invariants.ts';
import { LayeredMap } from './layered-map.ts';
import type { Notice } from './notice.ts';

/** Entitäten neben Issues, die eine Operation schreiben kann. */
export type NamedKind = 'user' | 'project' | 'sprint' | 'repo';
type NamedData = { user: User; project: Project; sprint: Sprint; repo: Repo };

type MapName = 'issues' | 'users' | 'projects' | 'sprints' | 'repos';
type AnyMap = Map<string, StoredEntity<unknown>>;
/** Geänderte Einträge gegenüber dem Basis-Snapshot; `undefined` heißt entfernt. */
type Changes = Map<string, StoredEntity<unknown> | undefined>;

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

const LABEL_OF: Record<NamedKind | 'issue', string> = {
  issue: 'Issue',
  user: 'User',
  project: 'Projekt',
  sprint: 'Sprint',
  repo: 'Repo',
};

const MAP_NAMES: readonly MapName[] = ['issues', 'users', 'projects', 'sprints', 'repos'];
const MAX_NAME_ATTEMPTS = 100;
export type CommentHead = { kind?: 'transition'; from?: State; to?: State };

/** Top-Level-Keys mit `undefined` entfallen, damit gleiche Daten auch gleich aussehen. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

export class Draft {
  readonly ctx: ApplyContext;
  readonly #base: BacklogSnapshot;
  /**
   * Alle Änderungen je Map seit Beginn. Ausgegebene Snapshots sehen sie als `LayeredMap` über der
   * Basis-Map: Eine Operation kostet so die Zahl der Änderungen, nicht die Größe des Backlogs.
   */
  readonly #changes: Record<MapName, Changes>;
  /** Maps mit Änderungen, die noch in keinem ausgegebenen Snapshot stehen. */
  readonly #dirty = new Set<MapName>();
  readonly #files = new Map<string, string | Uint8Array | null>();
  readonly #notices: Notice[] = [];
  #attributes: string | undefined;
  #snapshot: BacklogSnapshot;
  #revision = 0;

  constructor(base: BacklogSnapshot, ctx: ApplyContext) {
    this.ctx = ctx;
    this.#base = base;
    this.#snapshot = base;
    this.#attributes = base.attributes;
    this.#changes = {
      issues: new Map(),
      users: new Map(),
      projects: new Map(),
      sprints: new Map(),
      repos: new Map(),
    };
  }

  /**
   * Stand inklusive eigener Änderungen. Nach jeder Änderung ist die betroffene Map eine neue
   * Instanz, damit an ihr hängende Caches (`graphOf`) nie einen alten Stand liefern; ein
   * ausgegebener Snapshot ändert sich danach nicht mehr.
   */
  get snapshot(): BacklogSnapshot {
    if (this.#dirty.size === 0 && this.#snapshot.attributes === this.#attributes) {
      return this.#snapshot;
    }
    const fresh: Partial<Record<MapName, AnyMap>> = {};
    for (const name of this.#dirty) {
      fresh[name] = new LayeredMap(this.#base[name] as AnyMap, new Map(this.#changes[name]));
    }
    this.#dirty.clear();
    this.#snapshot = {
      ...this.#snapshot,
      ...fresh,
      attributes: this.#attributes,
    } as BacklogSnapshot;
    return this.#snapshot;
  }

  /** Config des Basis-Snapshots; ein Draft ändert sie nie, das Lesen kopiert also keine Maps. */
  get config(): BacklogSnapshot['config'] {
    return this.#base.config;
  }

  /** Inhalt der `.gitattributes` inklusive eigener Änderung; liest nicht den Snapshot und baut ihn nicht neu. */
  get attributes(): string | undefined {
    return this.#attributes;
  }

  /** Anzahl wirksamer Änderungen; bleibt sie 0, war die Operation ein No-op. */
  get revision(): number {
    return this.#revision;
  }

  // --- Issues ------------------------------------------------------------------------------

  /**
   * Das Issue im aktuellen Stand oder `undefined`. War seine Datei nicht ladbar, ist das ein
   * `schema`-Fehler: Ein Write darf sie weder überschreiben noch so tun, als fehle sie.
   */
  findIssue(id: string): StoredEntity<Issue> | undefined {
    return this.#lookup('issues', id) as StoredEntity<Issue> | undefined;
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

  /** Wie `findIssue` für benannte Entitäten, ebenfalls mit `schema` bei nicht ladbarer Datei. */
  findEntity<K extends NamedKind>(kind: K, key: string): StoredEntity<NamedData[K]> | undefined {
    return this.#lookup(MAP_OF[kind], key) as StoredEntity<NamedData[K]> | undefined;
  }

  /**
   * Das Ladeproblem der Datei von `kind`/`key` im Basis-Snapshot, sonst `undefined`. Eine kaputte
   * Datei lässt `loadSnapshot` aus und meldet sie; Writes auf ihre Entität scheitern.
   */
  brokenFile(kind: EntityKind, key: string): Problem | undefined {
    return this.#base.problems.find((p) => p.kind === kind && p.key === key);
  }

  entity<K extends NamedKind>(kind: K, key: string): StoredEntity<NamedData[K]> {
    const found = this.findEntity(kind, key);
    if (found === undefined) {
      throw violation('missing_ref', `${LABEL_OF[kind]} ${key} nicht gefunden`, { ids: [key] });
    }
    return found;
  }

  /**
   * Wie `putIssue`, ohne Issue-Invarianten; die prüft die jeweilige Operation selbst. `extra`
   * überschreibt die unbekannten Keys; fehlt es, bleiben die der bisherigen Entität.
   */
  putEntity<K extends NamedKind>(
    kind: K,
    key: string,
    data: NamedData[K],
    body?: string,
    extra?: StoredEntity<unknown>['extra'],
  ): void {
    const file = FILE_OF[kind](key);
    const parsed = this.#validated(kind, data, file);
    this.#put(MAP_OF[kind], key, file, this.findEntity(kind, key), parsed, body, extra);
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
        throw violation('schema', `Ungültiger Kommentar-Dateiname »${file}«`);
      }
      if (parsed.author !== this.ctx.actor) {
        throw violation('policy', `Kommentar »${file}« gehört nicht zu ${this.ctx.actor}`);
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

  /** Schreibt `.gitattributes`; der Snapshot trägt den neuen Inhalt als `attributes`. */
  putAttributes(content: string): void {
    this.#attributes = content;
    this.putFile(GITATTRIBUTES, content);
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
    const changes: FileChange[] = [];
    const removedDirs: string[] = [];
    // Der Endstand verlässt den Draft mit gewöhnlichen Maps.
    const plain: Partial<Record<MapName, AnyMap>> = {};
    for (const name of MAP_NAMES) {
      const kind = KIND_OF[name];
      const was = this.#base[name] as AnyMap;
      const touched = this.#changes[name];
      if (touched.size > 0) plain[name] = new Map(new LayeredMap(was, touched));
      for (const [key, after] of touched) {
        const before = was.get(key);
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
    const snapshot = { ...this.#base, ...plain, attributes: this.#attributes } as BacklogSnapshot;
    return { snapshot, changes, notices: [...this.#notices] };
  }

  // --- Intern ------------------------------------------------------------------------------

  /** Eintrag der Map; fehlt er, weil die Datei nicht ladbar war, ein `schema`-Fehler. */
  #lookup(name: MapName, key: string): StoredEntity<unknown> | undefined {
    const changes = this.#changes[name];
    const found = changes.has(key) ? changes.get(key) : (this.#base[name] as AnyMap).get(key);
    if (found !== undefined) return found;
    const kind = KIND_OF[name];
    const problem = this.brokenFile(kind, key);
    if (problem === undefined) return undefined;
    throw violation(
      'schema',
      `${LABEL_OF[kind]} ${key} ist nicht ladbar (${problem.path}): ${problem.message}`,
      { ids: [key], hint: 'Erst die Datei reparieren; bis dahin scheitert jeder Write darauf.' },
    );
  }

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
    extra?: StoredEntity<unknown>['extra'],
  ): boolean {
    const nextBody = body === undefined ? (before?.body ?? '') : canonicalBody(body);
    const nextExtra = extra ?? before?.extra ?? [];
    if (
      before !== undefined &&
      sameValue(before.data, data) &&
      nextBody === before.body &&
      sameValue(before.extra, nextExtra)
    ) {
      return false;
    }
    this.#store(name, key, {
      data,
      extra: nextExtra,
      body: nextBody,
      path: before?.path ?? file,
    });
    return true;
  }

  #sameStored(a: StoredEntity<unknown>, b: StoredEntity<unknown>): boolean {
    return a.body === b.body && sameValue(a.data, b.data) && sameValue(a.extra, b.extra);
  }

  #store(name: MapName, key: string, entity: StoredEntity<unknown> | undefined): void {
    this.#changes[name].set(key, entity);
    this.#dirty.add(name);
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

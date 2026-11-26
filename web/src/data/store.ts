import type { BacklogSnapshot, StoredEntity } from '@backe/store/snapshot.ts';
import type {
  IssueJson,
  PatchJson,
  ProblemJson,
  ProjectJson,
  RepoJson,
  SprintJson,
  StateJson,
  UserJson,
} from '@backe/ui/api.ts';
import {
  batch,
  createMemo,
  createSignal,
  type Signal,
  SignalGroup,
  type SignalReader,
} from '@spearwolf/signalize';

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

/** JSON-Wert mit sortierten Objekt-Keys; Arrays behalten ihre Reihenfolge. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

/**
 * Trägt `value` jedes Feld von `fields` mit demselben Wert? Verglichen wird per JSON, unabhängig
 * von der Reihenfolge der Keys in Objekten (`props`); ein fehlendes Feld gilt als `undefined`.
 * Arrays zählen samt Reihenfolge: Überlagerungen geben sie in der Form des Servers an (etwa
 * `depends_on` so sortiert wie der Server), sonst gleichen sie nie und der Write wartet auf den
 * Rückfall. Ohne `value` nie: Ein Issue, das der Server nicht kennt, gleicht keiner Überlagerung.
 */
export function hasFields<T extends object>(value: T | undefined, fields: Partial<T>): boolean {
  if (value === undefined) return false;
  const record = value as Record<string, unknown>;
  return Object.entries(fields).every(
    ([field, want]) => JSON.stringify(canonical(record[field])) === JSON.stringify(canonical(want)),
  );
}

/**
 * Eine Entitätsart als ein Signal je Eintrag plus ein Signal für die Schlüsselliste. Wer eine
 * Zeile zeigt, hängt nur an `get(key)`; ein Patch auf ein Issue weckt so genau diese Zeile.
 * Alle Signale hängen an `owner` und gehen mit `SignalGroup.delete(owner)` unter.
 *
 * Neben dem Serverstand hält die Tabelle Überlagerungen (»ausstehend«, ui.md §2.5): `get(key)`
 * zeigt den Serverwert mit allen Überlagerungen in Token-Reihenfolge darüber. Ohne Serverwert
 * bleibt der Eintrag leer, und die Schlüsselliste kennt nur Serverwerte.
 */
export class EntityTable<T extends object> {
  readonly keys: Signal<readonly string[]>;
  readonly #entries = new Map<string, Signal<T | undefined>>();
  readonly #server = new Map<string, T>();
  readonly #overlays = new Map<number, ReadonlyMap<string, Partial<T>>>();
  readonly #keyOf: (item: T) => string;
  readonly #owner: object;

  constructor(keyOf: (item: T) => string, owner: object = this) {
    this.#keyOf = keyOf;
    this.#owner = owner;
    this.keys = createSignal<readonly string[]>([], { attach: owner });
  }

  /** Signal des Eintrags; unbekannte Keys bekommen eins mit `undefined`, das ein Upsert füllt. */
  get(key: string): Signal<T | undefined> {
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      entry = createSignal<T | undefined>(this.#effective(key), { attach: this.#owner });
      this.#entries.set(key, entry);
    }
    return entry;
  }

  /** Serverstand ohne Überlagerung, ungetrackt. */
  server(key: string): T | undefined {
    return this.#server.get(key);
  }

  /** Tracked: die Schlüsselliste und jeder Eintrag. */
  list(): T[] {
    const out: T[] = [];
    for (const key of this.keys.get()) {
      const item = this.get(key).get();
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  replaceAll(items: readonly T[]): void {
    batch(() => {
      const next = items.map(this.#keyOf);
      const keep = new Set(next);
      for (const key of [...this.#server.keys()]) {
        if (!keep.has(key)) {
          this.#server.delete(key);
          this.#publish(key);
        }
      }
      items.forEach((item, i) => {
        const key = next[i] as string;
        this.#server.set(key, item);
        this.#publish(key);
      });
      this.#setKeys(next);
    });
  }

  upsert(items: readonly T[]): void {
    if (items.length === 0) return;
    batch(() => {
      const known = new Set(this.keys.value);
      const added: string[] = [];
      for (const item of items) {
        const key = this.#keyOf(item);
        this.#server.set(key, item);
        this.#publish(key);
        if (!known.has(key)) {
          known.add(key);
          added.push(key);
        }
      }
      if (added.length > 0) this.#setKeys([...this.keys.value, ...added]);
    });
  }

  remove(keys: readonly string[]): void {
    const gone = new Set(keys.filter((key) => this.#server.has(key)));
    if (gone.size === 0) return;
    batch(() => {
      for (const key of gone) {
        this.#server.delete(key);
        this.#publish(key);
      }
      this.#setKeys(this.keys.value.filter((key) => !gone.has(key)));
    });
  }

  /** Legt die Überlagerung `token` über die Einträge; ein schon vergebenes Token wird ersetzt. */
  overlay(token: number, entries: ReadonlyMap<string, Partial<T>>): void {
    const before = this.#overlays.get(token);
    this.#overlays.set(token, entries);
    batch(() => {
      for (const key of new Set([...(before?.keys() ?? []), ...entries.keys()])) {
        this.#publish(key);
      }
    });
  }

  dropOverlay(token: number): void {
    const entries = this.#overlays.get(token);
    if (entries === undefined) return;
    this.#overlays.delete(token);
    batch(() => {
      for (const key of entries.keys()) this.#publish(key);
    });
  }

  /**
   * Serverwert mit den Überlagerungen darüber; ein Feld mit `undefined` fällt weg. Gleicht der
   * Serverwert schon jedem überlagerten Feld, bleibt es beim Serverobjekt: Wer an der Identität
   * hängt (die Zeilen der Backlog-Liste), rechnet dann nichts neu.
   */
  #effective(key: string): T | undefined {
    const server = this.#server.get(key);
    if (server === undefined || this.#overlays.size === 0) return server;
    const layers = [...this.#overlays]
      .filter(([, entries]) => entries.has(key))
      .sort(([a], [b]) => a - b);
    if (layers.length === 0) return server;
    const fields: Partial<T> = Object.assign({}, ...layers.map(([, entries]) => entries.get(key)));
    if (hasFields(server, fields)) return server;
    const merged: Record<string, unknown> = { ...server, ...fields };
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) delete merged[field];
    }
    return merged as T;
  }

  #publish(key: string): void {
    const next = this.#effective(key);
    const entry = this.#entries.get(key);
    if (entry === undefined) {
      // Ein Eintrag ohne Wert braucht noch kein Signal; `get` legt es mit dem Wert an.
      if (next !== undefined) this.get(key);
      return;
    }
    entry.set(next);
  }

  // Eine gleichbleibende Schlüsselmenge darf die Liste nicht wecken.
  #setKeys(next: readonly string[]): void {
    if (!sameKeys(this.keys.value, next)) this.keys.set(next);
  }
}

export type PatchOutcome = 'applied' | 'stale' | 'gap';

/** Clientzustand eines Backlogs (ui.md): `load` für `/state`, `applyPatch` für Patch-Ereignisse. */
export class Store {
  readonly issues = new EntityTable<IssueJson>((i) => i.id, this);
  readonly projects = new EntityTable<ProjectJson>((p) => p.path, this);
  readonly sprints = new EntityTable<SprintJson>((s) => s.slug, this);
  readonly repos = new EntityTable<RepoJson>((r) => r.name, this);
  readonly users = new EntityTable<UserJson>((u) => u.handle, this);
  readonly rev = createSignal(0, { attach: this });
  readonly head = createSignal('', { attach: this });
  readonly loaded = createSignal(false, { attach: this });
  readonly context = createSignal<Record<string, unknown>>({}, { attach: this });
  readonly config = createSignal<StateJson['config'] | undefined>(undefined, { attach: this });
  readonly problems = createSignal<readonly ProblemJson[]>([], { attach: this });
  readonly sync = createSignal<Record<string, unknown> | null>(null, { attach: this });
  /**
   * Issues, die der letzte Patch geändert, angelegt oder entfernt hat; Ansichten heben sie hervor.
   * `load` setzt es nie: Ein Neuladen ist kein Ereignis, das jemand sehen soll.
   */
  readonly lastChange = createSignal<{ rev: number; issues: readonly string[] } | undefined>(
    undefined,
    { attach: this },
  );
  readonly #touches = new Map<string, Signal<number>>();
  readonly #pending = new Map<string, Signal<number>>();
  /** Issues je Überlagerung, damit `clearOverlay` die Zähler zurücknimmt. */
  readonly #overlayIds = new Map<number, readonly string[]>();

  /**
   * Snapshot für `graphOf` und `selectIssues`; das Memo liest `issues`, `projects` und `config`.
   * Users, Sprints und Repos bleiben leer, darum rechnet ein Patch darauf nichts neu.
   */
  readonly toSnapshot: SignalReader<BacklogSnapshot | undefined> = createMemo(
    (): BacklogSnapshot | undefined => {
      const config = this.config.get();
      const issues = this.issues.list();
      const projects = this.projects.list();
      if (config === undefined) return undefined;
      const stored = <T>(data: T): StoredEntity<T> => ({ data, extra: [], body: '', path: '' });
      return {
        config,
        users: new Map(),
        projects: new Map(projects.map((project) => [project.path, stored(project)])),
        sprints: new Map(),
        repos: new Map(),
        issues: new Map(issues.map((issue) => [issue.id, stored(issue)])),
        problems: [],
        attributes: undefined,
      };
    },
    { attach: this },
  );

  /** Zählt `touched`-Einträge und Upserts des Issues; wer Kommentare oder Anhänge zeigt, hängt daran. */
  touchCount(id: string): Signal<number> {
    let count = this.#touches.get(id);
    if (count === undefined) {
      count = createSignal(0, { attach: this });
      this.#touches.set(id, count);
    }
    return count;
  }

  /** Anzahl offener Überlagerungen des Issues; > 0 heißt »ausstehend«. */
  pendingCount(id: string): Signal<number> {
    let count = this.#pending.get(id);
    if (count === undefined) {
      count = createSignal(0, { attach: this });
      this.#pending.set(id, count);
    }
    return count;
  }

  /** Überlagert Issues bis `clearOverlay(token)`; ein schon vergebenes Token wird ersetzt. */
  setOverlay(token: number, issues: ReadonlyMap<string, Partial<IssueJson>>): void {
    batch(() => {
      this.#countPending(this.#overlayIds.get(token) ?? [], -1);
      const ids = [...issues.keys()];
      this.#overlayIds.set(token, ids);
      this.issues.overlay(token, issues);
      this.#countPending(ids, 1);
    });
  }

  clearOverlay(token: number): void {
    const ids = this.#overlayIds.get(token);
    if (ids === undefined) return;
    this.#overlayIds.delete(token);
    batch(() => {
      this.issues.dropOverlay(token);
      this.#countPending(ids, -1);
    });
  }

  #countPending(ids: readonly string[], delta: number): void {
    for (const id of ids) {
      const count = this.pendingCount(id);
      count.set(count.value + delta);
    }
  }

  load(state: StateJson): void {
    batch(() => {
      this.issues.replaceAll(state.issues);
      this.projects.replaceAll(state.projects);
      this.sprints.replaceAll(state.sprints);
      this.repos.replaceAll(state.repos);
      this.users.replaceAll(state.users);
      this.context.set(state.context);
      this.config.set(state.config);
      this.problems.set(state.problems);
      this.sync.set(state.sync);
      this.rev.set(state.rev);
      this.head.set(state.head);
      this.loaded.set(true);
      // Bodies, Kommentare und Anhänge stehen nicht im JSON: nach einem Neuladen können verpasste
      // `touched`-Einträge fehlen, also gilt jedes offene Issue als berührt.
      for (const count of this.#touches.values()) count.set(count.value + 1);
    });
  }

  applyPatch(p: PatchJson): PatchOutcome {
    const rev = this.rev.value;
    if (p.rev <= rev) return 'stale';
    if (p.rev > rev + 1) return 'gap';
    batch(() => {
      const { upsert, remove } = p;
      this.issues.upsert(upsert.issues ?? []);
      this.projects.upsert(upsert.projects ?? []);
      this.sprints.upsert(upsert.sprints ?? []);
      this.repos.upsert(upsert.repos ?? []);
      this.users.upsert(upsert.users ?? []);
      this.issues.remove(remove.issues ?? []);
      this.projects.remove(remove.projects ?? []);
      this.sprints.remove(remove.sprints ?? []);
      this.repos.remove(remove.repos ?? []);
      this.users.remove(remove.users ?? []);
      if (upsert.config !== undefined) this.config.set(upsert.config);
      if (p.problems !== undefined) this.problems.set(p.problems);
      for (const id of [...(upsert.issues ?? []).map((i) => i.id), ...(p.touched ?? [])]) {
        const count = this.#touches.get(id);
        count?.set(count.value + 1);
      }
      const changed = [...(upsert.issues ?? []).map((i) => i.id), ...(remove.issues ?? [])];
      if (changed.length > 0) this.lastChange.set({ rev: p.rev, issues: changed });
      this.rev.set(p.rev);
      this.head.set(p.head);
    });
    return 'applied';
  }

  dispose(): void {
    SignalGroup.delete(this);
  }
}

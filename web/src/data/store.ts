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

/**
 * Eine Entitätsart als ein Signal je Eintrag plus ein Signal für die Schlüsselliste. Wer eine
 * Zeile zeigt, hängt nur an `get(key)`; ein Patch auf ein Issue weckt so genau diese Zeile.
 * Alle Signale hängen an `owner` und gehen mit `SignalGroup.delete(owner)` unter.
 */
export class EntityTable<T> {
  readonly keys: Signal<readonly string[]>;
  readonly #entries = new Map<string, Signal<T | undefined>>();
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
      entry = createSignal<T | undefined>(undefined, { attach: this.#owner });
      this.#entries.set(key, entry);
    }
    return entry;
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
      for (const [key, entry] of this.#entries) if (!keep.has(key)) entry.set(undefined);
      items.forEach((item, i) => {
        this.get(next[i] as string).set(item);
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
        this.get(key).set(item);
        if (!known.has(key)) {
          known.add(key);
          added.push(key);
        }
      }
      if (added.length > 0) this.#setKeys([...this.keys.value, ...added]);
    });
  }

  remove(keys: readonly string[]): void {
    const gone = new Set(keys.filter((key) => this.#entries.get(key)?.value !== undefined));
    if (gone.size === 0) return;
    batch(() => {
      for (const key of gone) this.get(key).set(undefined);
      this.#setKeys(this.keys.value.filter((key) => !gone.has(key)));
    });
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
  readonly #touches = new Map<string, Signal<number>>();

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
      this.rev.set(p.rev);
      this.head.set(p.head);
    });
    return 'applied';
  }

  dispose(): void {
    SignalGroup.delete(this);
  }
}

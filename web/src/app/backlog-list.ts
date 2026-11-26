/**
 * Das Listenmodell des Tabs Backlog (ui.md §2.7): rechnet aus Store, Filter und Ansicht die
 * Zeilen, ausschließlich über `selectIssues`. Treffer in Beschreibungen kommen vom Server, weil
 * der Client keine Bodies hat (ui.md §3.4).
 */
import { childProgress } from '@backe/ops/graph.ts';
import { selectIssues } from '@backe/ops/issue-query.ts';
import type { IssueJson } from '@backe/ui/api.ts';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  type Signal,
  SignalGroup,
  type SignalReader,
} from '@spearwolf/signalize';
import type { Store } from '../data/store.ts';
import { readJson, writeJson } from '../lib/storage.ts';
import {
  DEFAULT_VIEW,
  type FilterError,
  type ListFilter,
  type ListView,
  toSelector,
} from './list-filter.ts';

export const SEARCH_DEBOUNCE_MS = 200;
/** Neue und geänderte Zeilen heben sich so lange ab (ui.md §2.7 »Live«). */
export const HIGHLIGHT_MS = 1500;
/** So lange blendet eine Zeile aus, die ein Patch aus der Liste nimmt. */
export const FADE_MS = 300;

export type ListRow = {
  issue: IssueJson;
  depth: number;
  openDeps: boolean;
  progress?: { settled: number; total: number };
  live?: 'fresh' | 'leaving';
};

export type Timers = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

// Spät gebunden, damit Fake Timers der Tests greifen.
const globalTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const isView = (v: unknown): v is ListView =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as ListView).tree === 'boolean' &&
  ((v as ListView).sort === 'rank' || (v as ListView).sort === 'created');

/** Baum/flach und Sortierung je Backlog im `localStorage` (ui.md §2.5 »Ansichtszustand«). */
export class ViewPrefs {
  readonly view: Signal<ListView>;
  readonly #key: string;

  constructor(backlog: string) {
    this.#key = `backe-ui:${backlog}:backlog-view`;
    this.view = createSignal<ListView>(readJson(this.#key, DEFAULT_VIEW, isView), {
      attach: this,
    });
  }

  set(next: ListView): void {
    this.view.set(next);
    writeJson(this.#key, next);
  }

  dispose(): void {
    SignalGroup.delete(this);
  }
}

/**
 * `next` plus jede Zeile aus `prev`, deren ID in `leaving` steht, als `live: 'leaving'` direkt
 * hinter der nächsten vorangehenden Zeile aus `prev`, die auch in `next` steht; ohne solche vorn.
 */
export function mergeLeaving(
  prev: readonly ListRow[],
  next: readonly ListRow[],
  leaving: ReadonlySet<string>,
): readonly ListRow[] {
  if (leaving.size === 0) return next;
  const at = new Map(next.map((r, i) => [r.issue.id, i]));
  const after = new Map<number, ListRow[]>();
  let anchor = -1;
  for (const row of prev) {
    const i = at.get(row.issue.id);
    if (i !== undefined) anchor = i;
    else if (leaving.has(row.issue.id)) {
      const ghosts = after.get(anchor) ?? [];
      ghosts.push({ ...row, live: 'leaving' });
      after.set(anchor, ghosts);
    }
  }
  const out: ListRow[] = [...(after.get(-1) ?? [])];
  next.forEach((row, i) => {
    out.push(row, ...(after.get(i) ?? []));
  });
  return out;
}

type BodyHits = { q: string; ids: ReadonlySet<string> };
const NO_HITS: ReadonlySet<string> = new Set();

export class BacklogListModel {
  readonly selected: SignalReader<readonly ListRow[]>;
  readonly errors: SignalReader<readonly FilterError[]>;
  readonly bodySearch: Signal<'idle' | 'pending' | 'failed'>;
  /** `selected` plus Live-Marken und ausblendende Zeilen; das zeigt die Liste. */
  readonly rows: Signal<readonly ListRow[]>;
  readonly #fresh = new Map<string, unknown>();
  readonly #leaving = new Map<string, unknown>();
  #base: readonly ListRow[] = [];
  readonly #hits: Signal<BodyHits | undefined>;
  readonly #timers: Timers;
  #seq = 0;

  constructor(
    store: Store,
    opts: {
      filter: SignalReader<ListFilter>;
      view: SignalReader<ListView>;
      me: string | null;
      search: (q: string) => Promise<string[]>;
      timers?: Timers;
    },
  ) {
    this.#timers = opts.timers ?? globalTimers;
    this.bodySearch = createSignal<'idle' | 'pending' | 'failed'>('idle', { attach: this });
    this.#hits = createSignal<BodyHits | undefined>(undefined, { attach: this });
    this.rows = createSignal<readonly ListRow[]>([], { attach: this });

    const query = createMemo(
      () => {
        const config = store.config.get();
        if (config === undefined) return undefined;
        return toSelector(opts.filter(), opts.view(), { me: opts.me, config });
      },
      { attach: this },
    );
    this.errors = createMemo((): readonly FilterError[] => query()?.errors ?? [], { attach: this });
    // Eigenes Memo: Ein Wechsel von Ansicht oder anderen Filtern sucht nicht erneut.
    const text = createMemo(() => query()?.selector.text, { attach: this });

    this.selected = createMemo(
      (): readonly ListRow[] => {
        const s = store.toSnapshot();
        const q = query();
        if (s === undefined || q === undefined) return [];
        const needle = q.selector.text;
        const hits = this.#hits.get();
        const sel =
          needle === undefined
            ? q.selector
            : { ...q.selector, bodyHits: hits?.q === needle ? hits.ids : NO_HITS };
        return selectIssues(s, sel).map((r) => {
          const progress = childProgress(s, r.issue.id);
          return {
            issue: r.issue,
            depth: r.depth ?? 0,
            openDeps: r.openDeps,
            ...(progress === undefined ? {} : { progress }),
          };
        });
      },
      { attach: this },
    );

    createEffect(
      () => {
        const needle = text();
        store.head.get();
        if (needle === undefined) {
          this.#seq++;
          this.bodySearch.set('idle');
          return;
        }
        this.bodySearch.set('pending');
        const handle = this.#timers.setTimeout(
          () => this.#search(needle, opts.search),
          SEARCH_DEBOUNCE_MS,
        );
        return () => this.#timers.clearTimeout(handle);
      },
      { attach: this },
    );

    // Ein Objekt je Stand der Eingaben: gleiche Identität heißt, nur der Store hat sich bewegt.
    const inputs = createMemo(() => ({ q: query(), hits: this.#hits.get() }), { attach: this });
    this.#track(this.selected, inputs, store);
  }

  /**
   * Ein Patch (neues `lastChange`) bei unveränderten Eingaben markiert seine Issues als frisch und
   * lässt Zeilen, die er aus der Liste nimmt, ausblenden. Jede andere Änderung der Liste — Filter,
   * Ansicht, Suchtreffer, Neuladen — markiert nichts und beendet laufendes Ausblenden.
   */
  #track(selected: SignalReader<readonly ListRow[]>, inputs: () => unknown, store: Store): void {
    let prevInputs: unknown;
    let prevChange = store.lastChange.value;
    createEffect(
      () => {
        const next = selected();
        const current = inputs();
        const change = store.lastChange.get();
        const byPatch = change !== prevChange && current === prevInputs;
        prevInputs = current;
        prevChange = change;
        if (byPatch && change !== undefined) {
          const present = new Set(next.map((r) => r.issue.id));
          for (const id of change.issues) {
            if (present.has(id)) this.#mark(this.#fresh, id, HIGHLIGHT_MS);
          }
          for (const row of this.#base) {
            if (!present.has(row.issue.id)) this.#mark(this.#leaving, row.issue.id, FADE_MS);
          }
          for (const id of this.#leaving.keys())
            if (present.has(id)) this.#unmark(this.#leaving, id);
        } else if (!byPatch) {
          for (const id of [...this.#leaving.keys()]) this.#unmark(this.#leaving, id);
        }
        this.#base = next;
        this.#compose();
      },
      { attach: this },
    );
  }

  #mark(marks: Map<string, unknown>, id: string, ms: number): void {
    this.#unmark(marks, id);
    marks.set(
      id,
      this.#timers.setTimeout(() => {
        marks.delete(id);
        this.#compose();
      }, ms),
    );
  }

  #unmark(marks: Map<string, unknown>, id: string): void {
    if (!marks.has(id)) return;
    this.#timers.clearTimeout(marks.get(id));
    marks.delete(id);
  }

  #compose(): void {
    const fresh = this.#fresh;
    const marked =
      fresh.size === 0
        ? this.#base
        : this.#base.map((r) => (fresh.has(r.issue.id) ? { ...r, live: 'fresh' as const } : r));
    this.rows.set(mergeLeaving(this.rows.value, marked, new Set(this.#leaving.keys())));
  }

  /** Nur die Antwort auf die jüngste Anfrage zählt; ältere kommen womöglich später an. */
  #search(needle: string, search: (q: string) => Promise<string[]>): void {
    const seq = ++this.#seq;
    search(needle).then(
      (ids) => {
        if (seq !== this.#seq) return;
        batch(() => {
          this.#hits.set({ q: needle, ids: new Set(ids) });
          this.bodySearch.set('idle');
        });
      },
      () => {
        if (seq === this.#seq) this.bodySearch.set('failed');
      },
    );
  }

  dispose(): void {
    this.#seq++;
    for (const marks of [this.#fresh, this.#leaving]) {
      for (const id of [...marks.keys()]) this.#unmark(marks, id);
    }
    SignalGroup.delete(this);
  }
}

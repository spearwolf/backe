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

type BodyHits = { q: string; ids: ReadonlySet<string> };
const NO_HITS: ReadonlySet<string> = new Set();

export class BacklogListModel {
  readonly selected: SignalReader<readonly ListRow[]>;
  readonly errors: SignalReader<readonly FilterError[]>;
  readonly bodySearch: Signal<'idle' | 'pending' | 'failed'>;
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
    SignalGroup.delete(this);
  }
}

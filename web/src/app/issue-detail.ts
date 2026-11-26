/**
 * Das Detailmodell des Tabs Issue (ui.md §2.9): Body, Kommentare und Anhänge kommen vom Server,
 * Felder und Beziehungen aus dem Store. Eine Berührung des Issues (`touchCount`) lädt neu; nur die
 * Antwort der jüngsten Ladung zählt.
 */
import type { AttachmentListJson, IssueDetailJson } from '@backe/ui/api.ts';
import {
  createEffect,
  createMemo,
  createSignal,
  SignalGroup,
  type SignalReader,
} from '@spearwolf/signalize';
import { ApiError } from '../data/api-client.ts';
import type { Store } from '../data/store.ts';
import { issueProblem } from './issue-problem.ts';
import { type IssueRelations, issueRelations } from './issue-relations.ts';

export type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: IssueDetailJson; attachments: AttachmentListJson }
  | { status: 'deleted' }
  | { status: 'error'; error: ApiError };

export type DetailLoaders = {
  issue: (id: string) => Promise<IssueDetailJson>;
  attachments: (id: string) => Promise<AttachmentListJson>;
};

export class IssueDetailModel {
  readonly state: SignalReader<DetailState>;
  readonly relations: SignalReader<IssueRelations | undefined>;
  readonly #loaded = createSignal<
    { detail: IssueDetailJson; attachments: AttachmentListJson } | { failure: ApiError } | undefined
  >(undefined, { attach: this });
  readonly #id: string;
  readonly #load: DetailLoaders;
  #seq = 0;

  constructor(store: Store, id: string, load: DetailLoaders) {
    this.#id = id;
    this.#load = load;

    this.relations = createMemo(
      () => {
        const s = store.toSnapshot();
        return s === undefined ? undefined : issueRelations(s, id);
      },
      { attach: this },
    );

    this.state = createMemo(
      (): DetailState => {
        const problem = issueProblem(store.problems.get(), id);
        if (problem !== undefined) {
          return { status: 'error', error: new ApiError(0, 'problem', problem.message) };
        }
        const present = store.issues.get(id).get() !== undefined;
        if (store.loaded.get() && !present) return { status: 'deleted' };
        const got = this.#loaded.get();
        if (got === undefined) return { status: 'loading' };
        if ('failure' in got) {
          // Ein 404 bei fehlendem Issue ist ein Löschen, das der Patch noch nicht gebracht hat.
          return got.failure.status === 404 && got.failure.code === 'not_found' && !present
            ? { status: 'deleted' }
            : { status: 'error', error: got.failure };
        }
        return { status: 'ready', ...got };
      },
      { attach: this },
    );

    // Jede Berührung (Upsert, `touched`, Neuladen des Stores) lädt Body, Kommentare, Anhänge neu.
    createEffect(
      () => {
        store.touchCount(id).get();
        this.#reload();
      },
      { attach: this },
    );
  }

  #reload(): void {
    const seq = ++this.#seq;
    Promise.all([this.#load.issue(this.#id), this.#load.attachments(this.#id)]).then(
      ([detail, attachments]) => {
        if (seq === this.#seq) this.#loaded.set({ detail, attachments });
      },
      (err: unknown) => {
        if (seq !== this.#seq) return;
        const failure =
          err instanceof ApiError
            ? err
            : new ApiError(0, 'offline', err instanceof Error ? err.message : String(err));
        this.#loaded.set({ failure });
      },
    );
  }

  dispose(): void {
    this.#seq++;
    SignalGroup.delete(this);
  }
}

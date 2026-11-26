import type {
  IssueJson,
  ToolArgs,
  ToolResults,
  UiToolName,
  WriteResultJson,
} from '@backe/ui/api.ts';
import { createEffect, createSignal, type Signal, SignalGroup } from '@spearwolf/signalize';
import { ApiError } from './api-client.ts';
import { hasFields, type Store } from './store.ts';

/** So lange wartet ein erfolgreicher Write auf seinen Patch, dann lädt der Client `/state` (ui.md §2.5). */
export const PENDING_TIMEOUT_MS = 5000;

export type WriteFailure = { id: number; error: ApiError };

export type WriteDeps = {
  call: <N extends UiToolName>(name: N, args: ToolArgs[N]) => Promise<ToolResults[N]>;
  upload: (id: string, name: string, bytes: Blob) => Promise<WriteResultJson>;
  /** Lädt `/state` neu; erfüllt, sobald das Laden fertig ist, auch nach einem Fehler. */
  refresh: () => Promise<void>;
};

type Pending = {
  readonly optimistic: ReadonlyMap<string, Partial<IssueJson>> | undefined;
  /** Jeder `head`, den der Store seit dem Start trug; der Patch kann vor der Antwort kommen. */
  readonly seen: Set<string>;
  /** Gesetzt, sobald die Antwort einen `commit` brachte. */
  commit?: string;
  timer?: ReturnType<typeof setTimeout>;
};

function toApiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError(0, 'offline', cause instanceof Error ? cause.message : String(cause));
}

function commitOf(result: unknown): string | undefined {
  const commit = (result as { commit?: unknown } | null)?.commit;
  return typeof commit === 'string' ? commit : undefined;
}

/**
 * Schreibende Aufrufe samt optimistischer Anzeige (ui.md §2.5). Ein Write mit `optimistic`
 * überlagert die Issues im Store, bis sein Ergebnis da ist: ein Patch oder `/state` mit dem
 * `commit` der Antwort, oder Serverwerte, die der Überlagerung gleichen (ein Rebase spielt den
 * Commit mit neuem Hash ein). Kommt beides nicht binnen `PENDING_TIMEOUT_MS`, lädt `refresh`
 * den Zustand neu. Ein Fehler nimmt die Überlagerung sofort zurück.
 */
export class Writes {
  readonly failures: Signal<readonly WriteFailure[]>;
  readonly #store: Store;
  readonly #deps: WriteDeps;
  readonly #pending = new Map<number, Pending>();
  #nextToken = 1;
  #nextFailure = 1;
  #disposed = false;

  constructor(store: Store, deps: WriteDeps) {
    this.#store = store;
    this.#deps = deps;
    this.failures = createSignal<readonly WriteFailure[]>([], { attach: this });
    // Nur `rev` und `head`: Jeder Patch und jedes Neuladen setzt beide, die Issue-Signale liest
    // die Prüfung ungetrackt über `server`.
    createEffect(
      () => {
        store.rev.get();
        this.#check(store.head.get());
      },
      { attach: this },
    );
  }

  run<N extends UiToolName>(
    name: N,
    args: ToolArgs[N],
    opts: { optimistic?: ReadonlyMap<string, Partial<IssueJson>> } = {},
  ): Promise<ToolResults[N]> {
    return this.#track(opts.optimistic, () => this.#deps.call(name, args));
  }

  upload(id: string, name: string, bytes: Blob): Promise<WriteResultJson> {
    return this.#track(undefined, () => this.#deps.upload(id, name, bytes));
  }

  /** Für Aktionen ohne eigene Fehlerfläche (Kontextmenü, Drag): `writes.run(…).catch(writes.report)`. */
  readonly report = (error: unknown): void => {
    const failure = { id: this.#nextFailure++, error: toApiError(error) };
    this.failures.set([...this.failures.value, failure]);
  };

  dismiss(id: number): void {
    const next = this.failures.value.filter((f) => f.id !== id);
    if (next.length !== this.failures.value.length) this.failures.set(next);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const token of [...this.#pending.keys()]) this.#settle(token);
    SignalGroup.delete(this);
  }

  async #track<R>(
    optimistic: ReadonlyMap<string, Partial<IssueJson>> | undefined,
    call: () => Promise<R>,
  ): Promise<R> {
    // Nach dem Ende gehört der Store niemandem mehr: kein Aufruf, keine Überlagerung.
    if (this.#disposed) throw new ApiError(0, 'disposed', 'writes are disposed');
    const token = this.#nextToken++;
    this.#pending.set(token, { optimistic, seen: new Set() });
    // Vor dem `fetch`: Die Anzeige wechselt im selben Frame wie die Geste.
    if (optimistic !== undefined && optimistic.size > 0) this.#store.setOverlay(token, optimistic);
    let result: R;
    try {
      result = await call();
    } catch (cause) {
      this.#settle(token);
      throw toApiError(cause);
    }
    const pending = this.#pending.get(token);
    if (pending === undefined) return result;
    const commit = commitOf(result);
    if (commit === undefined || pending.seen.has(commit) || this.#store.head.value === commit) {
      this.#settle(token);
      return result;
    }
    pending.commit = commit;
    pending.timer = setTimeout(() => {
      pending.timer = undefined;
      const done = () => this.#settle(token);
      this.#deps.refresh().then(done, done);
    }, PENDING_TIMEOUT_MS);
    return result;
  }

  #check(head: string): void {
    for (const [token, pending] of [...this.#pending]) {
      if (pending.commit === undefined) pending.seen.add(head);
      else if (pending.commit === head || this.#matches(pending.optimistic)) this.#settle(token);
    }
  }

  /** Ohne überlagerte Felder gibt es nichts zu vergleichen: Dann zählt nur der `commit`. */
  #matches(optimistic: ReadonlyMap<string, Partial<IssueJson>> | undefined): boolean {
    if (optimistic === undefined || optimistic.size === 0) return false;
    for (const [id, fields] of optimistic) {
      if (!hasFields(this.#store.issues.server(id), fields)) return false;
    }
    return true;
  }

  #settle(token: number): void {
    const pending = this.#pending.get(token);
    if (pending === undefined) return;
    this.#pending.delete(token);
    if (pending.timer !== undefined) clearTimeout(pending.timer);
    this.#store.clearOverlay(token);
  }
}

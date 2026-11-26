import type { PatchJson } from '@backe/ui/api.ts';
import { createSignal, type Signal, SignalGroup } from '@spearwolf/signalize';
import { ApiError } from './api-client.ts';
import { Connection, type ConnectionDeps, type ConnectionStatus } from './connection.ts';
import { Store } from './store.ts';

export type Session = {
  readonly backlog: string;
  readonly connection: Connection;
  readonly store: Store;
  readonly status: Signal<ConnectionStatus>;
  /** Letzter Fehler beim Laden von /state; undefined nach jedem erfolgreichen Laden. */
  readonly error: Signal<ApiError | undefined>;
  dispose(): void;
};

// `Connection` prüft die Form der Daten nicht; ein JSON `null` käme sonst bis in den Store.
function hasRev(data: unknown): data is { rev: number } {
  return (
    typeof data === 'object' && data !== null && typeof (data as { rev?: unknown }).rev === 'number'
  );
}

/**
 * Sitzung je Backlog nach dem Client-Protokoll des Event-Streams (ui.md §2.4.3): das erste
 * `hello` lädt `/state`, Patches davor oder währenddessen warten im Puffer, `gap` und `reset`
 * laden neu. Vor dem ersten `store.load` fasst nichts den Store per `applyPatch` an.
 */
export function openSession(backlog: string, deps: Partial<ConnectionDeps> = {}): Session {
  const connection = new Connection(backlog, deps);
  const store = new Store();
  const owner = {};
  const status = createSignal<ConnectionStatus>(connection.status, { attach: owner });
  const error = createSignal<ApiError | undefined>(undefined, { attach: owner });

  let disposed = false;
  let loading = false;
  let reloadPending = false;
  const buffer: PatchJson[] = [];

  const drain = (): void => {
    while (buffer.length > 0 && !disposed) {
      const next = buffer.shift() as PatchJson;
      if (store.applyPatch(next) === 'gap') {
        // Der Rest bleibt im Puffer und läuft nach dem Neuladen durch.
        load();
        return;
      }
    }
  };

  const load = (): void => {
    loading = true;
    connection.state().then(
      (state) => {
        if (disposed) return;
        loading = false;
        store.load(state);
        error.set(undefined);
        if (reloadPending) {
          reloadPending = false;
          load();
        } else {
          drain();
        }
      },
      (cause: unknown) => {
        if (disposed) return;
        loading = false;
        reloadPending = false;
        error.set(cause instanceof ApiError ? cause : new ApiError(0, 'offline', String(cause)));
      },
    );
  };

  const reload = (): void => {
    if (loading) reloadPending = true;
    else load();
  };

  const handles = [
    connection.on('status', (s) => status.set(s)),
    connection.on('hello', (h) => {
      if (!hasRev(h)) reload();
      else if (!loading && !store.loaded.value) load();
    }),
    connection.on('patch', (p) => {
      if (!hasRev(p)) {
        reload();
        return;
      }
      if (loading || !store.loaded.value) {
        buffer.push(p);
        return;
      }
      if (store.applyPatch(p) === 'gap') {
        buffer.length = 0;
        buffer.push(p);
        reload();
      }
    }),
    connection.on('sync', (s) => {
      store.sync.set(s);
    }),
    connection.on('reset', reload),
  ];

  connection.open();

  return {
    backlog,
    connection,
    store,
    status,
    error,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of handles) off();
      connection.close();
      store.dispose();
      SignalGroup.delete(owner);
    },
  };
}

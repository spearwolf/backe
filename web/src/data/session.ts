import type { PatchJson } from '@backe/ui/api.ts';
import { createSignal, type Signal, SignalGroup } from '@spearwolf/signalize';
import { ApiError } from './api-client.ts';
import { Connection, type ConnectionDeps, type ConnectionStatus } from './connection.ts';
import { Store } from './store.ts';
import { callTool, uploadAttachment } from './tools.ts';
import { Writes } from './writes.ts';

export type Session = {
  readonly backlog: string;
  readonly connection: Connection;
  readonly store: Store;
  readonly status: Signal<ConnectionStatus>;
  /**
   * Letzter Fehler beim Laden von /state, auch nach einem gescheiterten Stream; undefined nach
   * jedem erfolgreichen Laden.
   */
  readonly error: Signal<ApiError | undefined>;
  readonly writes: Writes;
  /** Lädt `/state` neu; erfüllt, sobald das letzte Laden fertig ist, auch nach einem Fehler. */
  refresh(): Promise<void>;
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
 * laden neu. Scheitert der Stream, fragt die Sitzung `/state` nach dem Grund. Vor dem ersten `store.load` fasst nichts den Store per `applyPatch` an.
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
  // Der Store ist womöglich veraltet (Laden gescheitert oder ohne laufenden Stream geladen);
  // das nächste hello lädt neu.
  let stale = false;
  const buffer: PatchJson[] = [];
  // Wer `refresh` rief, wartet, bis kein Laden mehr läuft: Ein Neuladen während eines anderen
  // kommt erst mit dem letzten.
  let waiters: Array<() => void> = [];
  const wake = (): void => {
    if (loading) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };

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

  /** `probe`: Der Stream steht nicht; geladen wird, um den Zustand oder den Fehler zu kennen. */
  const load = (probe = false): void => {
    loading = true;
    connection.state().then(
      (state) => {
        if (disposed) return;
        loading = false;
        stale = probe;
        store.load(state);
        error.set(undefined);
        if (reloadPending) {
          reloadPending = false;
          load();
        } else {
          drain();
        }
        wake();
      },
      (cause: unknown) => {
        if (disposed) return;
        loading = false;
        stale = true;
        // Alles im Puffer kam vor der nächsten Anfrage und steckt in deren `state.rev`.
        buffer.length = 0;
        error.set(cause instanceof ApiError ? cause : new ApiError(0, 'offline', String(cause)));
        // Ein Reset während des Ladens geht nicht verloren: ein zweiter Versuch, nicht mehr.
        if (reloadPending) {
          reloadPending = false;
          load();
        }
        wake();
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
      else if (!store.loaded.value || stale) {
        // Läuft gerade eine Probe, kennt sie den Stream noch nicht: ein Laden folgt, genau eines.
        if (loading) reloadPending = true;
        else load();
      }
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
    // Ohne Stream kommt kein hello; den Grund (404 ohne Arbeitskopie, 401 nach einem Neustart)
    // kennt nur `/state`.
    connection.on('failed', () => {
      if (!loading) load(true);
    }),
  ];

  const refresh = (): Promise<void> => {
    const done = new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
    // Ohne laufenden Stream fehlen womöglich Patches: Dann ist es eine Probe, und das nächste
    // hello lädt noch einmal.
    if (loading) reloadPending = true;
    else load(connection.status !== 'open');
    return done;
  };

  const writes = new Writes(store, {
    call: (name, args) => callTool(backlog, name, args, deps.fetch),
    upload: (id, name, bytes) => uploadAttachment(backlog, id, name, bytes, deps.fetch),
    refresh,
  });

  connection.open();

  return {
    backlog,
    connection,
    store,
    status,
    error,
    writes,
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const off of handles) off();
      connection.close();
      writes.dispose();
      store.dispose();
      SignalGroup.delete(owner);
      // Ein Laden nach dem Ende meldet sich nicht mehr; niemand soll darauf ewig warten.
      loading = false;
      wake();
    },
  };
}

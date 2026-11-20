/**
 * Aufschub von SIGINT/SIGTERM für Abschnitte, die nicht mittendrin enden dürfen (backe.md §2.16.1):
 * Schreibpfad und Sync teilen sich ihn, Abschnitte dürfen sich verschachteln oder überlappen.
 */

const DEFERRED_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

type Listener = (...args: unknown[]) => void;

/** Zahl der laufenden Abschnitte; der Zustand darunter gilt nur, solange sie größer als 0 ist. */
let depth = 0;
let pending: NodeJS.Signals | undefined;
/** Die fremden Listener je Signal, solange sie abgehängt sind. */
let foreign: [NodeJS.Signals, Listener[]][] = [];

const handlers = new Map<NodeJS.Signals, Listener>(
  DEFERRED_SIGNALS.map((signal) => [
    signal,
    () => {
      pending ??= signal;
    },
  ]),
);

/** Löst `signal` am eigenen Prozess neu aus; ohne fremde Listener beendet es ihn. */
export function raiseSignal(signal: NodeJS.Signals): void {
  process.kill(process.pid, signal);
}

/** Eigene Handler zuerst, dann die fremden ab: Dazwischen bliebe ein Signal sonst ohne Listener. */
function detach(): void {
  pending = undefined;
  foreign = DEFERRED_SIGNALS.map((signal) => [signal, process.rawListeners(signal) as Listener[]]);
  for (const [signal, listeners] of foreign) {
    process.on(signal, handlers.get(signal) as Listener);
    for (const listener of listeners) process.removeListener(signal, listener);
  }
}

/** Fremde Listener zurück (in ihrer Reihenfolge, `once` bleibt `once`), dann die eigenen weg. */
function restore(): NodeJS.Signals | undefined {
  for (const [signal, listeners] of foreign) {
    for (const listener of listeners) process.on(signal, listener);
    process.removeListener(signal, handlers.get(signal) as Listener);
  }
  foreign = [];
  const signal = pending;
  pending = undefined;
  return signal;
}

/**
 * Führt `fn` aus, ohne dass SIGINT/SIGTERM den Prozess dazwischen beenden. Der erste Abschnitt
 * hängt die fremden Listener ab und installiert eigene, die sich das erste Signal merken; weitere
 * Abschnitte, die währenddessen beginnen, zählen nur mit. Endet der letzte, kommen die fremden
 * Listener zurück, und das gemerkte Signal wird einmal neu ausgelöst — über `raise` dieses letzten
 * Abschnitts (Default: `process.kill` auf den eigenen Prozess), auch wenn `fn` geworfen hat.
 */
export async function withDeferredSignals<T>(
  fn: () => Promise<T>,
  opts: { raise?: (s: NodeJS.Signals) => void } = {},
): Promise<T> {
  if (depth === 0) detach();
  depth++;
  try {
    return await fn();
  } finally {
    depth--;
    if (depth === 0) {
      const signal = restore();
      if (signal !== undefined) (opts.raise ?? raiseSignal)(signal);
    }
  }
}

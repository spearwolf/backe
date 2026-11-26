import { useCallback, useEffect, useRef, useState } from 'react';
import { type ApiError, asApiError } from '../../data/api-client.ts';

/**
 * Zustand einer Aktion mit eigener Fehlerfläche (Dialog, Formular). `run` liefert `true` bei
 * Erfolg; ein Wurf landet als `ApiError` in `error`, ein neuer Lauf löscht den alten Fehler.
 * `false` kommt auch, wenn schon ein Lauf läuft: Dann startet nichts, und `error` bleibt, wie es ist.
 */
export function useAction(): {
  busy: boolean;
  error: ApiError | undefined;
  run(fn: () => Promise<unknown>): Promise<boolean>;
  reset(): void;
} {
  const [busy, setBusy] = useState(false);
  // Synchron lesbar, anders als `busy`: Ein Doppelklick vor dem nächsten Render startet nichts zweimal.
  const running = useRef(false);
  const [error, setError] = useState<ApiError>();
  // Nach dem Abbau (Dialog zu, Ansicht weg) setzt ein spätes Ergebnis keinen State mehr.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (fn: () => Promise<unknown>): Promise<boolean> => {
    if (running.current) return false;
    running.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      return true;
    } catch (cause) {
      if (mounted.current) setError(asApiError(cause));
      return false;
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }, []);

  const reset = useCallback(() => setError(undefined), []);
  return { busy, error, run, reset };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../data/api-client.ts';

function asApiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError(0, 'offline', cause instanceof Error ? cause.message : String(cause));
}

/**
 * Zustand einer Aktion mit eigener Fehlerfläche (Dialog, Formular). `run` liefert `true` bei
 * Erfolg; ein Wurf landet als `ApiError` in `error`, ein neuer Lauf löscht den alten Fehler.
 */
export function useAction(): {
  busy: boolean;
  error: ApiError | undefined;
  run(fn: () => Promise<unknown>): Promise<boolean>;
  reset(): void;
} {
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      return true;
    } catch (cause) {
      if (mounted.current) setError(asApiError(cause));
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, []);

  const reset = useCallback(() => setError(undefined), []);
  return { busy, error, run, reset };
}

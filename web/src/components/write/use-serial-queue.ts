import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError } from '../../data/api-client.ts';
import { asApiError } from './use-action.ts';

/** Ein Auftrag der Warteschlange; `alive()` ist falsch, sobald die Komponente abgebaut ist. */
export type SerialJob = (alive: () => boolean) => Promise<void>;

/**
 * Aufträge nacheinander statt parallel: Was während eines laufenden Auftrags kommt (ein zweites
 * Einfügen, ein Ablegen), reiht sich hinten an, statt verloren zu gehen. `busy` gilt, solange
 * etwas läuft oder wartet. Der Wurf eines Auftrags landet als `ApiError` in `error` und bleibt
 * stehen, bis die Schlange leer war und ein neuer Auftrag kommt: Ein Auftrag, der schon wartete,
 * löscht ihn nicht, sonst erführe niemand, dass dem Vorgänger etwas fehlt. Nach dem Abbau startet
 * keiner mehr.
 */
export function useSerialQueue() {
  const chain = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(0);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError>();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const alive = useCallback(() => mounted.current, []);
  /** Synchron lesbar, anders als `busy`: Läuft gerade nichts und wartet nichts? */
  const idle = useCallback(() => queued.current === 0, []);

  const enqueue = useCallback(
    (job: SerialJob): void => {
      if (queued.current === 0) setError(undefined);
      queued.current += 1;
      setBusy(true);
      chain.current = chain.current.then(async () => {
        try {
          if (!mounted.current) return;
          await job(alive);
        } catch (cause) {
          if (mounted.current) setError(asApiError(cause));
        } finally {
          queued.current -= 1;
          if (mounted.current && queued.current === 0) setBusy(false);
        }
      });
    },
    [alive],
  );

  return { busy, error, idle, enqueue };
}

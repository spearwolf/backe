import { createEffect, type Signal, type SignalReader } from '@spearwolf/signalize';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Liest ein Signal oder Memo als React-State. Der Effekt liest getrackt und meldet jede spätere
 * Änderung; der erste Lauf meldet nichts. Gleiche Werte lösen im Signal selbst nichts aus.
 */
export function useSignal<T>(source: Signal<T> | SignalReader<T>): T {
  const read: SignalReader<T> = typeof source === 'function' ? source : source.get;
  const subscribe = useCallback(
    (notify: () => void) => {
      let first = true;
      const effect = createEffect(() => {
        read();
        if (first) first = false;
        else notify();
      });
      return () => effect.destroy();
    },
    [read],
  );
  return useSyncExternalStore(subscribe, () => read());
}

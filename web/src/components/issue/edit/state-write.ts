/** Ein Zustandswechsel als Write: Aufruf aus `stateCall`, Vorschau aus `stateOverlay`. */
import { BackeError } from '@backe/core/errors.ts';
import { stateOverlay } from '../../../app/optimistic.ts';
import type { StateAction, StateCall } from '../../../app/state-actions.ts';
import type { Store } from '../../../data/store.ts';
import type { Writes } from '../../../data/writes.ts';

type Overlay = ReturnType<typeof stateOverlay>;

/**
 * Die Überlagerung ist nur Vorschau: Lehnt die Rechnung den Wechsel ab (`BackeError`, etwa eine
 * Blocker-ID, die `planTransition` nicht annimmt), läuft der Write ohne sie und der Server
 * entscheidet allein. Jeder andere Wurf ist ein Fehler im Client und fliegt weiter.
 */
export function overlayOf(
  store: Store,
  id: string,
  action: StateAction,
  blockedBy?: string[],
): Overlay | undefined {
  const snapshot = store.toSnapshot();
  if (snapshot === undefined) return undefined;
  try {
    return stateOverlay(snapshot, id, action, blockedBy);
  } catch (cause) {
    if (cause instanceof BackeError) return undefined;
    throw cause;
  }
}

export function runState(writes: Writes, call: StateCall, optimistic: Overlay | undefined) {
  const opts = optimistic === undefined ? {} : { optimistic };
  switch (call.name) {
    case 'issue_move':
      return writes.run(call.name, call.args, opts);
    case 'issue_resume':
      return writes.run(call.name, call.args, opts);
    case 'issue_reopen':
      return writes.run(call.name, call.args, opts);
  }
}

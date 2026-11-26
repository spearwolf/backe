/** Ein Zustandswechsel als Write: Aufruf aus `stateCall`, Vorschau aus `stateOverlay`. */
import { preview, stateOverlay } from '../../../app/optimistic.ts';
import type { StateAction, StateCall } from '../../../app/state-actions.ts';
import type { Store } from '../../../data/store.ts';
import type { Writes } from '../../../data/writes.ts';

type Overlay = ReturnType<typeof stateOverlay>;

/** Die Vorschau des Wechsels; lehnt die Rechnung ihn ab, entscheidet der Server allein (`preview`). */
export function overlayOf(
  store: Store,
  id: string,
  action: StateAction,
  blockedBy?: string[],
): Overlay | undefined {
  const snapshot = store.toSnapshot();
  if (snapshot === undefined) return undefined;
  return preview(() => stateOverlay(snapshot, id, action, blockedBy));
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

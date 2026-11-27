import { useCallback } from 'react';
import { m as app } from '../app/app.messages.ts';
import { BoardModel, BoardPrefs } from '../app/board-state.ts';
import { BoardLane } from '../components/board/BoardLane.tsx';
import { BoardToolbar } from '../components/board/BoardToolbar.tsx';
import type { Store } from '../data/store.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { useOwned } from '../lib/use-owned.ts';

/** Ansichtszustand aus dem `localStorage`, darüber das Modell der Bahnen. */
class BoardViewState {
  readonly prefs: BoardPrefs;
  readonly model: BoardModel;

  constructor(store: Store, backlog: string) {
    this.prefs = new BoardPrefs(backlog);
    this.model = new BoardModel(store, this.prefs.view.get);
  }

  dispose(): void {
    this.model.dispose();
    this.prefs.dispose();
  }
}

/**
 * Tab Board (ui.md §2.8): Werkzeugleiste oben, darunter die Bahnen. Lädt als eigener Chunk
 * (`React.lazy` in `App.tsx`), damit Backlog und Issue-Tab den Board-Code nicht mittragen.
 */
export function BoardView({ backlog }: { backlog: string; me: string | null }) {
  const store = useStore();
  const create = useCallback(() => new BoardViewState(store, backlog), [store, backlog]);
  const state = useOwned(backlog, create);
  const loaded = useSignal(store.loaded);
  if (state === undefined || !loaded) {
    return <p className="p-4 text-sm text-muted-foreground">{app.loading}</p>;
  }
  return <Loaded state={state} backlog={backlog} />;
}

function Loaded({ state, backlog }: { state: BoardViewState; backlog: string }) {
  const view = useSignal(state.prefs.view);
  const lanes = useSignal(state.model.lanes);
  // Abonniert die Klappzustände; `isFolded` liest sie beim Rendern.
  useSignal(state.prefs.folded);
  const { group } = view;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <BoardToolbar view={view} onView={(next) => state.prefs.setView(next)} />
      <div className="min-h-0 flex-1 overflow-auto">
        {lanes.map((lane) => (
          <BoardLane
            key={`${group}\n${lane.key}`}
            backlog={backlog}
            group={group}
            lane={lane}
            folded={group !== 'none' && state.prefs.isFolded(group, lane)}
            onFold={(folded) => state.prefs.setFolded(group, lane.key, folded)}
          />
        ))}
      </div>
    </div>
  );
}

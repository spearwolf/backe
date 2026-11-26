import { createMemo, SignalGroup, type SignalReader } from '@spearwolf/signalize';
import { Plus } from 'lucide-react';
import { useCallback } from 'react';
import { m as app } from '../app/app.messages.ts';
import { BacklogListModel, ViewPrefs } from '../app/backlog-list.ts';
import { draftFromFilter } from '../app/create-draft.ts';
import {
  type ListFilter,
  type ListView,
  listFilterSearch,
  parseListFilter,
} from '../app/list-filter.ts';
import { type Router, useRouter } from '../app/router.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { IssueList } from '../components/IssueList.tsx';
import { Button } from '../components/ui/button.tsx';
import { useCreateIssue } from '../components/write/create-context.tsx';
import { m as w } from '../components/write/write.messages.ts';
import { searchIds } from '../data/search.ts';
import type { Store } from '../data/store.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
import { useWrites } from '../data/write-context.tsx';
import { useOwned } from '../lib/use-owned.ts';

/** Filter aus der URL, Ansicht aus dem `localStorage`, darüber das Listenmodell. */
class BacklogViewState {
  readonly filter: SignalReader<ListFilter>;
  readonly prefs: ViewPrefs;
  readonly model: BacklogListModel;

  constructor(store: Store, router: Router, backlog: string, me: string | null) {
    this.filter = createMemo(() => parseListFilter(router.location.get().search), {
      attach: this,
    });
    this.prefs = new ViewPrefs(backlog);
    this.model = new BacklogListModel(store, {
      filter: this.filter,
      view: this.prefs.view.get,
      me,
      search: (q) => searchIds(backlog, q),
    });
  }

  dispose(): void {
    this.model.dispose();
    this.prefs.dispose();
    SignalGroup.delete(this);
  }
}

/** Tab Backlog (ui.md §2.7): Filterleiste oben, darunter die Issue-Liste. */
export function BacklogView({ backlog, me }: { backlog: string; me: string | null }) {
  const store = useStore();
  const router = useRouter();
  const create = useCallback(
    () => new BacklogViewState(store, router, backlog, me),
    [store, router, backlog, me],
  );
  const state = useOwned(`${backlog}\n${me ?? ''}`, create);
  const loaded = useSignal(store.loaded);
  if (state === undefined || !loaded) {
    return <p className="p-4 text-sm text-muted-foreground">{app.loading}</p>;
  }
  return <Loaded state={state} router={router} backlog={backlog} me={me} />;
}

function Loaded(props: {
  state: BacklogViewState;
  router: Router;
  backlog: string;
  me: string | null;
}) {
  const { state, router, backlog, me } = props;
  const create = useCreateIssue();
  const { canWrite } = useWrites();
  const filter = useSignal(state.filter);
  const view = useSignal(state.prefs.view);
  const rows = useSignal(state.model.rows);
  const selected = useSignal(state.model.selected);
  const errors = useSignal(state.model.errors);
  const bodySearch = useSignal(state.model.bodySearch);
  const onFilter = (next: ListFilter) => {
    const { pathname } = router.location.value;
    router.navigate(`${pathname}${listFilterSearch(next)}`, { replace: true });
  };
  const onView = (next: ListView) => state.prefs.set(next);
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-stretch">
        <div className="min-w-0 flex-1">
          <FilterBar
            filter={filter}
            errors={errors}
            view={view}
            count={selected.length}
            bodySearch={bodySearch}
            onFilter={onFilter}
            onView={onView}
          />
        </div>
        {create !== undefined && (
          <div className="border-b p-3">
            <Button size="sm" onClick={() => create.open(draftFromFilter(filter, me))}>
              <Plus aria-hidden="true" />
              {w.newIssue}
            </Button>
          </div>
        )}
      </div>
      {/* Umsortieren nur, wo die Reihenfolge der Rang ist (ui.md §2.7). */}
      <IssueList backlog={backlog} rows={rows} reorder={canWrite && view.sort === 'rank'} />
    </section>
  );
}

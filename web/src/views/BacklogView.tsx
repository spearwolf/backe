import { createMemo, SignalGroup, type SignalReader } from '@spearwolf/signalize';
import { useCallback } from 'react';
import { m as app } from '../app/app.messages.ts';
import { BacklogListModel, ViewPrefs } from '../app/backlog-list.ts';
import {
  type ListFilter,
  type ListView,
  listFilterSearch,
  parseListFilter,
} from '../app/list-filter.ts';
import { type Router, useRouter } from '../app/router.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { IssueList } from '../components/IssueList.tsx';
import { searchIds } from '../data/search.ts';
import type { Store } from '../data/store.ts';
import { useStore } from '../data/store-context.tsx';
import { useSignal } from '../data/use-signal.ts';
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
  return <Loaded state={state} router={router} backlog={backlog} />;
}

function Loaded(props: { state: BacklogViewState; router: Router; backlog: string }) {
  const { state, router, backlog } = props;
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
      <FilterBar
        filter={filter}
        errors={errors}
        view={view}
        count={selected.length}
        bodySearch={bodySearch}
        onFilter={onFilter}
        onView={onView}
      />
      <IssueList backlog={backlog} rows={rows} />
    </section>
  );
}

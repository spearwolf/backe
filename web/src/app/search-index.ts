import { createMemo, SignalGroup, type SignalReader } from '@spearwolf/signalize';
import type { Store } from '../data/store.ts';
import { buildSearchIndex, type SearchIndex } from './search.ts';

export type OwnedSearchIndex = { index: SignalReader<SearchIndex>; dispose(): void };

/**
 * Der Suchindex eines Stores als Memo, das rechnet neu bei jeder Entitätsänderung (die
 * Tabellen-`list()`s sind getrackt). Ein Memo rechnet eifrig, solange es lebt; darum gehört es
 * dem, der gerade sucht, und geht mit `dispose` unter. `lazy` hilft nicht: Ein träges Memo
 * benachrichtigt seine Leser nicht, die offene Liste bliebe stehen.
 */
export function createSearchIndex(store: Store): OwnedSearchIndex {
  const owner = {};
  const index = createMemo(
    () =>
      buildSearchIndex({
        issues: store.issues.list(),
        projects: store.projects.list(),
        sprints: store.sprints.list(),
        repos: store.repos.list(),
        users: store.users.list(),
      }),
    { attach: owner },
  );
  return { index, dispose: () => SignalGroup.delete(owner) };
}

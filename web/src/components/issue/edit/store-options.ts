/**
 * Auswahllisten aus dem Store, je Store einmal gerechnet: Alle Eingaben teilen dasselbe Memo,
 * statt bei jedem Patch einzeln über den ganzen Backlog zu laufen. Die Memos hängen am Store und
 * enden mit ihm (`Store.dispose`).
 */
import { createMemo, type SignalReader } from '@spearwolf/signalize';
import type { Store } from '../../../data/store.ts';

export type IssueOption = { id: string; title: string };

type Options = {
  issues: SignalReader<readonly IssueOption[]>;
  openSprints: SignalReader<readonly string[]>;
};

const cache = new WeakMap<Store, Options>();

/**
 * Ein Memo, das sein voriges Array weitergibt, solange die Einträge gleich sind (`same`): Ein Patch,
 * der nur einen State ändert, rendert so keine Vorschlagsliste neu (Patch-Lokalität, ui.md §2.5).
 */
function stableList<T>(
  store: Store,
  compute: () => T[],
  same: (a: T, b: T) => boolean,
): SignalReader<readonly T[]> {
  let previous: readonly T[] | undefined;
  return createMemo<readonly T[]>(
    () => {
      const next = compute();
      const kept =
        previous !== undefined &&
        previous.length === next.length &&
        next.every((item, i) => same(item, (previous as readonly T[])[i] as T));
      if (!kept) previous = next;
      return previous as readonly T[];
    },
    { attach: store },
  );
}

function optionsOf(store: Store): Options {
  let options = cache.get(store);
  if (options === undefined) {
    options = {
      issues: stableList(
        store,
        () => store.issues.list().map((i) => ({ id: i.id, title: i.title })),
        (a, b) => a.id === b.id && a.title === b.title,
      ),
      // Geschlossene Sprints nimmt niemand mehr auf; das Memo liest jeden Sprint, nicht nur die Keys.
      openSprints: stableList(
        store,
        () =>
          store.sprints
            .list()
            .filter((s) => s.closed !== true)
            .map((s) => s.slug),
        (a, b) => a === b,
      ),
    };
    cache.set(store, options);
  }
  return options;
}

/** ID und Titel aller Issues, für die Vorschläge der ID-Eingaben. */
export const issueOptions = (store: Store) => optionsOf(store).issues;

/** Slugs der offenen Sprints. */
export const openSprints = (store: Store) => optionsOf(store).openSprints;

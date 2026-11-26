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

function optionsOf(store: Store): Options {
  let options = cache.get(store);
  if (options === undefined) {
    options = {
      issues: createMemo<readonly IssueOption[]>(
        () => store.issues.list().map((i) => ({ id: i.id, title: i.title })),
        {
          attach: store,
        },
      ),
      // Geschlossene Sprints nimmt niemand mehr auf; das Memo liest jeden Sprint, nicht nur die Keys.
      openSprints: createMemo<readonly string[]>(
        () =>
          store.sprints
            .list()
            .filter((s) => s.closed !== true)
            .map((s) => s.slug),
        { attach: store },
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

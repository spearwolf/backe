/**
 * Memos der Settings-Abschnitte, je Store einmal: `useSignal` braucht eine stabile Quelle, und ein
 * `list()` im Render trackt nichts. Die Memos hängen am Store und enden mit ihm (`Store.dispose`).
 */
import { compareCodeUnits } from '@backe/core/compare.ts';
import type { SprintJson, UserJson } from '@backe/ui/api.ts';
import type { SignalReader } from '@spearwolf/signalize';
import { type ProjectRow, projectRows } from '../../app/settings-model.ts';
import type { Store } from '../../data/store.ts';
import { stableList } from '../issue/edit/store-options.ts';

type Memos = {
  projects: SignalReader<readonly ProjectRow[]>;
  sprints: SignalReader<readonly SprintJson[]>;
  users: SignalReader<readonly UserJson[]>;
};

const cache = new WeakMap<Store, Memos>();

function memosOf(store: Store): Memos {
  let memos = cache.get(store);
  if (memos === undefined) {
    memos = {
      // Ein Patch, der keine Zeile ändert (etwa nur einen Titel eines Issues), rendert nichts neu.
      projects: stableList(
        store,
        () => projectRows(store.projects.list(), store.issues.list()),
        (a, b) =>
          a.project === b.project &&
          a.depth === b.depth &&
          a.open === b.open &&
          a.hasChildren === b.hasChildren,
      ),
      sprints: stableList(
        store,
        () => store.sprints.list(),
        (a, b) => a === b,
      ),
      users: stableList(
        store,
        () => store.users.list().sort((a, b) => compareCodeUnits(a.handle, b.handle)),
        (a, b) => a === b,
      ),
    };
    cache.set(store, memos);
  }
  return memos;
}

/** Baumzeilen der Projekte samt rekursiver Zahl offener Issues. */
export const projectRowsOf = (store: Store) => memosOf(store).projects;

/** Alle Sprints; jeder Eintrag wird gelesen, damit auch `closed` neu rechnet. */
export const sprintsOf = (store: Store) => memosOf(store).sprints;

/** Alle User nach Handle; jeder Eintrag wird gelesen, damit auch ein neuer Name ankommt. */
export const usersOf = (store: Store) => memosOf(store).users;

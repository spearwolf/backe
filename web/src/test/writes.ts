/**
 * Gemeinsames für die Tests der Schreib-Bausteine: ein echtes `Writes` über einem Store ohne
 * Server (`call` und `upload` werden nie gebraucht) und ein Serverfehler mit Hinweis.
 */
import { ApiError } from '../data/api-client.ts';
import { Store } from '../data/store.ts';
import { Writes } from '../data/writes.ts';
import { testIssue, testState } from './state.ts';

export function makeWrites() {
  const store = new Store();
  store.load(testState([testIssue(1)]));
  const writes = new Writes(store, {
    call: () => Promise.reject(new Error('unused')),
    upload: () => Promise.reject(new Error('unused')),
    refresh: () => Promise.resolve(),
  });
  return { store, writes };
}

export const failure = () =>
  new ApiError(409, 'conflict', 'Issue ist gesperrt', 'Mit backe issue claim übernehmen');

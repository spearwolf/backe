/**
 * Ansichtszustand des Abschnitts Abhängigkeiten (ui.md §2.9.5, §2.5 »Ansichtszustand«): offen
 * oder zugeklappt, Graph oder Baum, Parent-Kanten ja oder nein, je Backlog im `localStorage`.
 */
import { readJson, writeJson } from '../lib/storage.ts';

export type DepPrefs = { open: boolean; view: 'graph' | 'tree'; parents: boolean };

export const DEFAULT_DEP_PREFS: DepPrefs = { open: true, view: 'graph', parents: false };

const keyOf = (backlog: string) => `backe-ui:${backlog}:deps`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Je Feld geprüft: Ein kaputtes Feld kostet nur sich selbst, nicht die übrigen. */
export function readDepPrefs(backlog: string): DepPrefs {
  const raw = readJson(keyOf(backlog), {}, isRecord);
  return {
    open: typeof raw.open === 'boolean' ? raw.open : DEFAULT_DEP_PREFS.open,
    view: raw.view === 'graph' || raw.view === 'tree' ? raw.view : DEFAULT_DEP_PREFS.view,
    parents: typeof raw.parents === 'boolean' ? raw.parents : DEFAULT_DEP_PREFS.parents,
  };
}

export function writeDepPrefs(backlog: string, prefs: DepPrefs): void {
  writeJson(keyOf(backlog), prefs);
}

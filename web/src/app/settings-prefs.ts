/**
 * Ansichtszustand des Tabs Settings (ui.md §2.5 »Ansichtszustand«): welche Abschnitte eingeklappt
 * sind, je Backlog im `localStorage`. Der Wert ist ein Objekt mit `folded`, damit spätere Felder
 * daneben Platz haben, ohne alte Stände zu brechen.
 */
import { readJson, writeJson } from '../lib/storage.ts';
import { isSettingsSection, type SettingsSection } from './settings-model.ts';

export type Folded = Partial<Record<SettingsSection, boolean>>;

const keyOf = (backlog: string) => `backe-ui:${backlog}:settings`;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Je Abschnitt geprüft: Ein kaputter Eintrag kostet nur sich selbst; fehlend heißt offen. */
export function readFolded(backlog: string): Folded {
  const raw = readJson(keyOf(backlog), {}, isRecord);
  const folded: Folded = {};
  if (!isRecord(raw.folded)) return folded;
  for (const [section, value] of Object.entries(raw.folded)) {
    if (isSettingsSection(section) && typeof value === 'boolean') folded[section] = value;
  }
  return folded;
}

export function writeFolded(backlog: string, folded: Folded): void {
  writeJson(keyOf(backlog), { folded });
}

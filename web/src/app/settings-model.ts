/**
 * Die Abschnitte des Tabs Settings (ui.md §2.10) in der Reihenfolge der Skizze `settings.png`.
 * Ein Abschnitt ist auch das letzte Segment der Route `/b/<backlog>/settings/<abschnitt>`.
 */
export const SETTINGS_SECTIONS = [
  'repositories',
  'projects',
  'sprints',
  'users',
  'backlog',
  'interface',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export function isSettingsSection(s: string): s is SettingsSection {
  return (SETTINGS_SECTIONS as readonly string[]).includes(s);
}

/**
 * Die Navigation (`router.navigation`), deren Abschnitt Settings zuletzt gezeigt hat. Ein
 * Sprachwechsel mountet Settings neu (`key={lang}` in `App`); darum hält `App` diese Marke über dem
 * Fragment und reicht sie herunter. Sonst scrollte dieselbe Navigation noch einmal und nähme der
 * Sprachwahl den Fokus.
 */
export type ShownNavigation = { last: number | undefined };

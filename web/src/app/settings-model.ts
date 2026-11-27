import { parseRepoRef } from '@backe/core/names.ts';
import { compareIssues } from '@backe/ops/order.ts';
import type { IssueJson } from '@backe/ui/api.ts';

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

/**
 * IDs der Issues, die das Repo per Name nennen, mit oder ohne Ref (`core` und `core@main`), nach
 * Rangfolge. Ein Eintrag, der nicht als Repo-Referenz lesbar ist, nennt kein Repo.
 */
export function repoReferences(issues: readonly IssueJson[], name: string): string[] {
  const names = (issue: IssueJson): boolean =>
    (issue.repos ?? []).some((ref) => {
      try {
        return parseRepoRef(ref).name === name;
      } catch {
        return false;
      }
    });
  return issues
    .filter(names)
    .sort(compareIssues)
    .map((i) => i.id);
}

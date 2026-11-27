import { compareCodeUnits } from '@backe/core/compare.ts';
import { parseRepoRef, projectAncestors } from '@backe/core/names.ts';
import type { BacklogConfig } from '@backe/core/schemas.ts';
import { isSettled } from '@backe/core/state.ts';
import { isAdmin } from '@backe/ops/admin.ts';
import { compareIssues } from '@backe/ops/order.ts';
import type { IssueJson, ProjectJson, SprintJson, UserJson } from '@backe/ui/api.ts';

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

export type ProjectRow = {
  project: ProjectJson;
  depth: number;
  open: number;
  hasChildren: boolean;
};

/**
 * Pfadordnung je Segment (`compareCodeUnits`): Ein Unterprojekt folgt so direkt seinem Elternteil,
 * auch wenn ein Geschwister mit `-` weitergeht (`web/auth` vor `web-x`; `-` liegt vor `/`).
 */
function comparePaths(a: string, b: string): number {
  const as = a.split('/');
  const bs = b.split('/');
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const c = compareCodeUnits(as[i] as string, bs[i] as string);
    if (c !== 0) return c;
  }
  return as.length - bs.length;
}

/**
 * Baum in Pfadordnung. `open` zählt wie `project list` (BK §2.9) rekursiv über die Unterprojekte:
 * Ein offenes Issue zählt für jedes genannte Projekt und alle Vorfahren, je Projekt einmal.
 * `depth` zählt die vorhandenen Vorfahren, damit ein verwaister Pfad nicht ins Leere einrückt.
 */
export function projectRows(
  projects: readonly ProjectJson[],
  issues: readonly IssueJson[],
): ProjectRow[] {
  const open = new Map<string, number>();
  for (const issue of issues) {
    if (isSettled(issue.state)) continue;
    const counted = new Set<string>();
    for (const p of issue.projects ?? []) {
      counted.add(p);
      for (const a of projectAncestors(p)) counted.add(a);
    }
    for (const path of counted) open.set(path, (open.get(path) ?? 0) + 1);
  }
  const paths = new Set(projects.map((p) => p.path));
  return [...projects]
    .sort((a, b) => comparePaths(a.path, b.path))
    .map((project) => ({
      project,
      depth: projectAncestors(project.path).filter((a) => paths.has(a)).length,
      open: open.get(project.path) ?? 0,
      hasChildren: projects.some((p) => p.path.startsWith(`${project.path}/`)),
    }));
}

/** IDs der Issues, die genau diesen Pfad nennen (wie `project rm`), nach Rangfolge. */
export function projectReferences(issues: readonly IssueJson[], path: string): string[] {
  return issues
    .filter((issue) => (issue.projects ?? []).includes(path))
    .sort(compareIssues)
    .map((i) => i.id);
}

/** Jüngster `start` zuerst, ohne `start` zuletzt, dann nach Slug. */
function compareSprints(a: SprintJson, b: SprintJson): number {
  if (a.start !== b.start) {
    if (a.start === undefined) return 1;
    if (b.start === undefined) return -1;
    return compareCodeUnits(b.start, a.start);
  }
  return compareCodeUnits(a.slug, b.slug);
}

/** Offene und geschlossene Sprints, je nach `start` absteigend (ohne `start` zuletzt), dann Slug. */
export function sprintGroups(sprints: readonly SprintJson[]): {
  open: SprintJson[];
  closed: SprintJson[];
} {
  const sorted = [...sprints].sort(compareSprints);
  return {
    open: sorted.filter((s) => s.closed !== true),
    closed: sorted.filter((s) => s.closed === true),
  };
}

/** Was die aktuelle Identität im Abschnitt Users & Agents darf (ui.md §2.10, BK §2.13 Punkt 4). */
export type SettingsRights = {
  /** Mensch anlegen (`user_add` ohne `agent`). */
  addHuman: boolean;
  /** Agent per vorhandenem Key: `'any'` (Admin, Operator frei), `'self'` (Operator fest = ich), `false`. */
  addAgent: 'any' | 'self' | false;
  /** `user_create_agent`: Operator = ich, darum nur für menschliche User. */
  createAgent: boolean;
  revokeKey(user: UserJson): boolean;
  removeUser(user: UserJson): boolean;
};

const NO_RIGHTS: SettingsRights = {
  addHuman: false,
  addAgent: false,
  createAgent: false,
  revokeKey: () => false,
  removeUser: () => false,
};

/**
 * Spiegelt den Identitätsschutz von `verify`, damit die UI nur anbietet, was die Policy nicht
 * sicher ablehnt: Admin ist nur ein Mensch in `admins`; ein Mitglied legt Agents mit sich selbst
 * als Operator an und ändert sich und die eigenen Agents (nur als Mensch); User entfernen nur
 * Admins, nie einen Admin, sich selbst oder einen Operator, den noch ein Agent nennt (BK §2.12).
 */
export function settingsRights(input: {
  canWrite: boolean;
  me: string | null;
  users: readonly UserJson[];
  config: Pick<BacklogConfig, 'admins'>;
}): SettingsRights {
  const { canWrite, me, users, config } = input;
  if (!canWrite || me === null) return NO_RIGHTS;
  const meUser = users.find((u) => u.handle === me);
  const admin = isAdmin(config, me, meUser);
  const human = meUser?.kind === 'human';
  return {
    addHuman: admin,
    addAgent: admin ? 'any' : human ? 'self' : false,
    createAgent: human,
    revokeKey: (u) =>
      admin || u.handle === me || (human && u.kind === 'agent' && u.operator === me),
    removeUser: (u) =>
      admin && !u.admin && u.handle !== me && !users.some((other) => other.operator === u.handle),
  };
}

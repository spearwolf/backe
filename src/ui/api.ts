/**
 * Form der JSON-Antworten von `backe ui` (ui.md): reine Typen, die auch das Web-Bundle importiert.
 * Darum nur `import type`, nichts mit Laufzeit.
 */
import type { BacklogConfig, EntityKind, Issue, Project, Repo, Sprint } from '../core/schemas.ts';

/** Ein Eintrag der Backlog-Liste. */
export type BacklogEntryJson = {
  name: string;
  current: boolean;
  can_write: boolean;
  user: string | null;
};
export type BacklogsJson = { backlogs: BacklogEntryJson[]; lang: 'en' | 'de' };

export type IssueJson = Issue;
export type ProjectJson = { path: string } & Project;
export type SprintJson = { slug: string } & Sprint;
export type RepoJson = { name: string } & Repo;

/** Wie `user show --json` ohne `body`; leere Listen fehlen. */
export type UserJson = {
  handle: string;
  name: string;
  kind: 'human' | 'agent';
  operator?: string;
  admin: boolean;
  fingerprints?: string[];
  revoked?: { fingerprint: string; revoked: string }[];
};

export type ProblemJson = { path: string; message: string; kind?: EntityKind; key?: string };

/** Gesamtzustand eines Backlogs für `GET /state`. */
export type StateJson = {
  rev: number;
  head: string;
  context: Record<string, unknown>;
  config: Omit<BacklogConfig, '$schema'>;
  issues: IssueJson[];
  projects: ProjectJson[];
  sprints: SprintJson[];
  repos: RepoJson[];
  users: UserJson[];
  problems: ProblemJson[];
  /** JSON von `sync status`; `null` ohne eigene Arbeitskopie. */
  sync: Record<string, unknown> | null;
};

/** Fehlerantwort, dieselbe Form wie `errorJson` der CLI. */
export type ErrorJson = {
  error: { code: string; message: string; hint?: string; details?: unknown };
};

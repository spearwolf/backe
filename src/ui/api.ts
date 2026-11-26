/**
 * Form der JSON-Antworten von `backe ui` (ui.md): reine Typen, die auch das Web-Bundle importiert.
 * Darum nur `import type`, nichts mit Laufzeit.
 */
import type { BacklogConfig, EntityKind, Issue, Project, Repo, Sprint } from '../core/schemas.ts';
import type { State } from '../core/state.ts';

/** Ein Eintrag der Backlog-Liste. */
export type BacklogEntryJson = {
  name: string;
  current: boolean;
  can_write: boolean;
  user: string | null;
  /** `id_prefix` aus der Backlog-Config; `null` ohne Arbeitskopie oder lesbare Config. */
  prefix: string | null;
};
export type BacklogsJson = { backlogs: BacklogEntryJson[]; lang: 'en' | 'de' };

export type IssueJson = Issue;
export type IssueRefJson = { id: string; state: State; title: string; assignee?: string };
export type CommentJson = {
  file: string;
  author: string;
  created: string;
  kind?: 'transition';
  from?: State;
  to?: State;
  body: string;
};
/** `issue show --comments all --format json`; leere Listen und leerer Body fehlen. */
export type IssueDetailJson = Omit<IssueJson, 'depends_on'> & {
  depends_on?: (IssueRefJson | { id: string; missing: true })[];
  body?: string;
  parents?: IssueRefJson[];
  dependents?: IssueRefJson[];
  children?: IssueRefJson[];
  progress?: { settled: number; total: number };
  comments_count: number;
  last_reason?: CommentJson;
  comments?: CommentJson[];
  notices?: { code: string; message: string; ids: string[] }[];
};
/** `attach list <id> --format json`; `not_loaded` bei LFS-Pointern ohne geladene Bytes. */
export type AttachmentListJson = {
  name: string;
  file?: string;
  url?: string;
  size?: number;
  not_loaded?: true;
}[];
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

/**
 * Änderung zwischen zwei Ständen (ui.md §2.4.2): Entitäten in derselben Form wie in `StateJson`,
 * `remove` als Keys, `problems` als ganze Liste, wenn sie sich ändert.
 */
export type PatchJson = {
  rev: number;
  head: string;
  upsert: {
    issues?: IssueJson[];
    projects?: ProjectJson[];
    sprints?: SprintJson[];
    repos?: RepoJson[];
    users?: UserJson[];
    config?: StateJson['config'];
  };
  remove: {
    issues?: string[];
    projects?: string[];
    sprints?: string[];
    repos?: string[];
    users?: string[];
  };
  /** Issues mit geänderten Kommentaren oder Anhängen. */
  touched?: string[];
  problems?: ProblemJson[];
};

export type HelloJson = { rev: number; head: string };

/** Ein Ereignis des Event-Streams (ui.md §2.4.3); `sync` trägt das JSON von `sync status`. */
export type ServerEvent =
  | { event: 'hello'; data: HelloJson }
  | { event: 'patch'; data: PatchJson }
  | { event: 'sync'; data: Record<string, unknown> }
  | { event: 'reset'; data: Record<string, never> };

/** Fehlerantwort, dieselbe Form wie `errorJson` der CLI. */
export type ErrorJson = {
  error: { code: string; message: string; hint?: string; details?: unknown };
};

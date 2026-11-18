/** Baut `BacklogSnapshot`s im Speicher für Tests der Ops-Schicht. */
import {
  type BacklogConfig,
  BacklogConfigSchema,
  type Issue,
  IssueSchema,
  ProjectSchema,
  RepoSchema,
  SprintSchema,
  type User,
  UserSchema,
} from '../../src/core/schemas.ts';
import { issueFile, projectFile, repoFile, sprintFile, userFile } from '../../src/store/layout.ts';
import type { BacklogSnapshot, StoredEntity } from '../../src/store/snapshot.ts';

export type SnapSpec = {
  config?: Partial<BacklogConfig>;
  /** Zusätzliche menschliche User neben den Defaults `spw`, `alice`, `claude-1`. */
  users?: string[];
  projects?: string[];
  sprints?: string[];
  /** Repo-Name zu URL. */
  repos?: Record<string, string>;
  issues?: (Partial<Issue> & { id: string })[];
};

/** Backlog-Config mit Test-Defaults. */
export function cfg(partial: Partial<BacklogConfig> = {}): BacklogConfig {
  return BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
    ...partial,
  });
}

/** Issue-ID Nummer `n`: `I(1) === 'bk-t0001'`. */
export function I(n: number): string {
  return `bk-t${String(n).padStart(4, '0')}`;
}

const BASE_TIME = Date.parse('2026-11-18T10:00:00Z');

function stored<T>(data: T, path: string): StoredEntity<T> {
  return { data, extra: [], body: '', path };
}

function sortedByKey<T>(entries: [string, StoredEntity<T>][]): Map<string, StoredEntity<T>> {
  return new Map(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function user(handle: string, extra: Partial<User>): [string, StoredEntity<User>] {
  const data = UserSchema.parse({
    name: handle,
    kind: 'human',
    keys: [`ssh-ed25519 AAAA${handle.replace(/[^A-Za-z0-9]/g, '')} ${handle}`],
    ...extra,
  });
  return [handle, stored(data, userFile(handle))];
}

/**
 * Snapshot aus einer Kurzbeschreibung. Jede Entität läuft durch ihr zod-Schema, ein kaputtes
 * Test-Issue scheitert also sofort. Für `blocked`/`on_hold` ohne eigenes `paused_from` wird
 * `todo` eingesetzt; `blocked_by` muss der Test selbst nennen.
 */
export function snap(spec: SnapSpec = {}): BacklogSnapshot {
  const handles = new Map<string, Partial<User>>([
    ['spw', {}],
    ['alice', {}],
    ['claude-1', { kind: 'agent', operator: 'spw' }],
  ]);
  for (const h of spec.users ?? []) if (!handles.has(h)) handles.set(h, {});
  const issues = (spec.issues ?? []).map((partial, index): [string, StoredEntity<Issue>] => {
    const paused = partial.state === 'blocked' || partial.state === 'on_hold';
    const data = IssueSchema.parse({
      title: partial.id,
      state: 'todo',
      creator: 'spw',
      created: new Date(BASE_TIME + index * 60_000).toISOString().replace('.000Z', 'Z'),
      ...(paused ? { paused_from: 'todo' } : {}),
      ...partial,
    });
    return [data.id, stored(data, issueFile(data.id))];
  });
  return {
    config: cfg(spec.config),
    users: sortedByKey([...handles].map(([h, extra]) => user(h, extra))),
    projects: sortedByKey(
      (spec.projects ?? []).map((p) => [
        p,
        stored(ProjectSchema.parse({ title: p }), projectFile(p)),
      ]),
    ),
    sprints: sortedByKey(
      (spec.sprints ?? []).map((sl) => [
        sl,
        stored(SprintSchema.parse({ title: sl }), sprintFile(sl)),
      ]),
    ),
    repos: sortedByKey(
      Object.entries(spec.repos ?? {}).map(([name, url]) => [
        name,
        stored(RepoSchema.parse({ url }), repoFile(name)),
      ]),
    ),
    issues: sortedByKey(issues),
    problems: [],
  };
}

/** Deterministische Byte-Quelle für `ApplyContext.randomBytes`: 0, 1, 2, … über alle Aufrufe. */
export function seqBytes(start = 0): (n: number) => Uint8Array {
  let next = start;
  return (n) => Uint8Array.from({ length: n }, () => next++ & 0xff);
}

/** Kopie des Snapshots, in der Issue `id` die unbekannten Keys `extra` trägt. */
export function withExtra(
  s: BacklogSnapshot,
  id: string,
  extra: [string, unknown][],
): BacklogSnapshot {
  const entity = s.issues.get(id);
  if (entity === undefined) throw new Error(`withExtra: Issue ${id} fehlt im Snapshot`);
  return { ...s, issues: new Map(s.issues).set(id, { ...entity, extra }) };
}

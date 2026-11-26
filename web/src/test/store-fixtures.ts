/**
 * Issues, Zustände und Patches für die Tests des Stores, in der Form des Servers.
 */
import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import type { IssueJson, PatchJson, StateJson, UserJson } from '@backe/ui/api.ts';

export const id = (n: number) => `bk-t${String(n).padStart(4, '0')}`;

export function issue(n: number, extra: Partial<IssueJson> = {}): IssueJson {
  return {
    id: id(n),
    title: `Issue ${n}`,
    state: 'todo',
    creator: 'spw',
    created: `2026-11-18T10:0${n}:00Z`,
    ...extra,
  } as IssueJson;
}

export const alice: UserJson = { handle: 'alice', name: 'Alice', kind: 'human', admin: false };

// Dieselbe Konstellation wie in graph.test.ts: ein Parent mit zwei Kindern, eines hängt am anderen.
export const issues = [
  issue(1),
  issue(2, { parent: id(1) }),
  issue(3, { parent: id(1), depends_on: [id(2)] }),
];

export function config() {
  const { $schema: _unused, ...rest } = BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
  });
  return rest;
}

export function state(over: Partial<StateJson> = {}): StateJson {
  return {
    rev: 1,
    head: 'h1',
    context: { user: 'spw' },
    config: config(),
    issues,
    projects: [{ path: 'web', title: 'Web' } as StateJson['projects'][number]],
    sprints: [{ slug: 's1', title: 'S1' } as StateJson['sprints'][number]],
    repos: [{ name: 'core', url: 'https://example.com/core.git' } as StateJson['repos'][number]],
    users: [alice],
    problems: [],
    sync: null,
    ...over,
  };
}

export function patch(over: Partial<PatchJson> = {}): PatchJson {
  return { rev: 2, head: 'h2', upsert: {}, remove: {}, ...over };
}

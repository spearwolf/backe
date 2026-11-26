/** Bausteine für Client-Tests: Issues, `/state` und Patches in der Form des Servers. */
import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import type { IssueJson, PatchJson, StateJson } from '@backe/ui/api.ts';

export const tid = (n: number) => `bk-t${String(n).padStart(4, '0')}`;

export function testIssue(n: number, extra: Partial<IssueJson> = {}): IssueJson {
  return {
    id: tid(n),
    title: `Issue ${n}`,
    state: 'todo',
    creator: 'spw',
    created: new Date(Date.UTC(2026, 10, 18, 10, 0, n)).toISOString().replace('.000Z', 'Z'),
    rank: n * 1000,
    ...extra,
  } as IssueJson;
}

export function testConfig(over: Record<string, unknown> = {}): StateJson['config'] {
  const { $schema: _unused, ...rest } = BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
    ...over,
  });
  return rest;
}

export function testState(issues: IssueJson[], over: Partial<StateJson> = {}): StateJson {
  return {
    rev: 1,
    head: 'h1',
    context: {},
    config: testConfig(),
    issues,
    projects: [],
    sprints: [],
    repos: [],
    users: [],
    problems: [],
    sync: null,
    ...over,
  };
}

export function testPatch(rev: number, over: Partial<PatchJson> = {}): PatchJson {
  return { rev, head: `h${rev}`, upsert: {}, remove: {}, ...over };
}

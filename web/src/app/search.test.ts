import type { IssueJson, ProjectJson, RepoJson, SprintJson, UserJson } from '@backe/ui/api.ts';
import { describe, expect, test } from 'vitest';
import { Store } from '../data/store.ts';
import { testIssue, testPatch, testState } from '../test/state.ts';
import {
  buildSearchIndex,
  fold,
  SEARCH_LIMIT,
  type SearchGroup,
  searchIndexOf,
  searchStore,
} from './search.ts';

type Data = {
  issues?: IssueJson[];
  projects?: ProjectJson[];
  sprints?: SprintJson[];
  repos?: RepoJson[];
  users?: UserJson[];
};

function index(data: Data) {
  return buildSearchIndex({
    issues: data.issues ?? [],
    projects: data.projects ?? [],
    sprints: data.sprints ?? [],
    repos: data.repos ?? [],
    users: data.users ?? [],
  });
}

function issue(id: string, title: string, extra: Partial<IssueJson> = {}): IssueJson {
  return { ...testIssue(1, extra), id, title };
}

const idsOf = (groups: SearchGroup[], kind = 'issue'): string[] =>
  (groups.find((g) => g.kind === kind)?.hits ?? []).map((h) =>
    h.kind === 'issue' ? h.issue.id : '?',
  );

describe('search', () => {
  test('title words match by prefix, substring and one typo', () => {
    const idx = index({ issues: [issue('bk-aaaaa', 'Login-Seite reparieren')] });
    const hit = (q: string) => idsOf(searchStore(idx, q, 'bk')).length === 1;
    expect(hit('log')).toBe(true);
    expect(hit('seite rep')).toBe(true);
    expect(hit('eparier')).toBe(true);
    expect(hit('repariern')).toBe(true);
    expect(hit('logni')).toBe(true);
    expect(hit('xyz')).toBe(false);
    expect(hit('rxyz')).toBe(false);
  });

  test('every token must match', () => {
    const idx = index({
      issues: [issue('bk-aaaaa', 'Login fehlt'), issue('bk-bbbbb', 'Login')],
    });
    expect(idsOf(searchStore(idx, 'login fehlt', 'bk'))).toEqual(['bk-aaaaa']);
  });

  test('ids follow the short form rules', () => {
    const idx = index({ issues: [issue('bk-7f3k2', 'Etwas')] });
    const ids = (q: string, prefix: string | undefined = 'bk') =>
      idsOf(searchStore(idx, q, prefix));
    expect(ids('7f3')).toEqual(['bk-7f3k2']);
    expect(ids('BK-7F3')).toEqual(['bk-7f3k2']);
    expect(ids('ac-7f3')).toEqual([]);
    expect(ids('7f')).toEqual([]);
    expect(ids('7f3', undefined)).toEqual(['bk-7f3k2']);
    const exact = (q: string) => {
      const hit = searchStore(idx, q, 'bk')[0]?.hits[0];
      return hit?.kind === 'issue' && hit.exact;
    };
    expect(exact('bk-7f3k2')).toBe(true);
    expect(exact('7f3k2')).toBe(true);
    expect(exact('7f3')).toBe(false);
  });

  test('an exact id hit stands first', () => {
    const idx = index({
      issues: [
        issue('bk-zzzzz', '7f3k2 notes', { rank: 1 }),
        issue('bk-7f3k2', 'Etwas', { rank: 9 }),
      ],
    });
    const hit = searchStore(idx, '7f3k2', 'bk')[0]?.hits[0];
    expect(hit).toMatchObject({ kind: 'issue', exact: true });
    expect(hit?.kind === 'issue' && hit.issue.id).toBe('bk-7f3k2');
  });

  test('an id hit and a title hit of one issue count once', () => {
    const idx = index({ issues: [issue('bk-7f3k2', '7f3k2 notes')] });
    expect(idsOf(searchStore(idx, '7f3k2', 'bk'))).toEqual(['bk-7f3k2']);
  });

  test('folding ignores case and accents', () => {
    expect(fold('Über Café')).toBe('uber cafe');
    const idx = index({ issues: [issue('bk-aaaaa', 'Über'), issue('bk-bbbbb', 'café')] });
    expect(idsOf(searchStore(idx, 'uber', 'bk'))).toEqual(['bk-aaaaa']);
    expect(idsOf(searchStore(idx, 'CAFE', 'bk'))).toEqual(['bk-bbbbb']);
  });

  test('groups keep their order and stop at eight', () => {
    const projects = Array.from({ length: 12 }, (_, i) => ({
      path: `p${String(i).padStart(2, '0')}`,
      title: 'Zebra',
    }));
    const idx = index({
      issues: [issue('bk-aaaaa', 'Zebra')],
      projects,
      sprints: [{ slug: 's1', title: 'Zebra' }],
      repos: [{ name: 'zebra', url: 'https://example.org/zebra.git' }],
      users: [{ handle: 'zebra', name: 'Z', kind: 'human', admin: false }],
    });
    const groups = searchStore(idx, 'zebra', 'bk');
    expect(groups.map((g) => g.kind)).toEqual(['issue', 'project', 'sprint', 'repo', 'user']);
    const projectGroup = groups.find((g) => g.kind === 'project');
    expect(projectGroup?.hits).toHaveLength(SEARCH_LIMIT);
    expect(projectGroup?.more).toBe(4);
    expect(groups[0]?.more).toBe(0);
  });

  test('open issues come before settled ones at equal score', () => {
    const idx = index({
      issues: [
        issue('bk-aaaaa', 'Same', { state: 'done', rank: 1 }),
        issue('bk-bbbbb', 'Same', { state: 'todo', rank: 2 }),
        issue('bk-ccccc', 'Same', { state: 'todo', rank: 1 }),
      ],
    });
    expect(idsOf(searchStore(idx, 'same', 'bk'))).toEqual(['bk-ccccc', 'bk-bbbbb', 'bk-aaaaa']);
  });

  test('a better score beats an open state', () => {
    const idx = index({
      issues: [
        issue('bk-aaaaa', 'Reparatur', { state: 'todo' }),
        issue('bk-bbbbb', 'Repar', { state: 'done' }),
      ],
    });
    expect(idsOf(searchStore(idx, 'repar', 'bk'))).toEqual(['bk-bbbbb', 'bk-aaaaa']);
  });

  test('projects, sprints, repos and users match their fields', () => {
    const idx = index({
      projects: [{ path: 'core/engine', title: 'Antrieb' }],
      sprints: [{ slug: 'w47', title: 'Herbstputz' }],
      repos: [{ name: 'backe', url: 'https://github.com/acme/backe.git' }],
      users: [{ handle: 'spw', name: 'Wolfger', kind: 'human', admin: true }],
    });
    const kinds = (q: string) => searchStore(idx, q, 'bk').map((g) => g.kind);
    expect(kinds('engine')).toEqual(['project']);
    expect(kinds('antrieb')).toEqual(['project']);
    expect(kinds('w47')).toEqual(['sprint']);
    expect(kinds('herbst')).toEqual(['sprint']);
    expect(kinds('github')).toEqual(['repo']);
    expect(kinds('backe')).toEqual(['repo']);
    expect(kinds('spw')).toEqual(['user']);
    expect(kinds('wolfger')).toEqual(['user']);
  });

  test('odd queries never throw', () => {
    const idx = index({ issues: [issue('bk-aaaaa', 'Etwas')] });
    expect(searchStore(idx, '   ', 'bk')).toEqual([]);
    expect(searchStore(idx, '', 'bk')).toEqual([]);
    expect(searchStore(idx, '(*\\[', 'bk')).toEqual([]);
    expect(searchStore(idx, 'a'.repeat(300), 'bk')).toEqual([]);
  });

  test('the index memo follows the store', () => {
    const store = new Store();
    store.load(testState([issue('bk-aaaaa', 'Alt')]));
    const reader = searchIndexOf(store);
    expect(searchIndexOf(store)).toBe(reader);
    expect(idsOf(searchStore(reader(), 'neu', 'bk'))).toEqual([]);
    store.applyPatch(testPatch(2, { upsert: { issues: [issue('bk-bbbbb', 'Neu')] } }));
    expect(idsOf(searchStore(searchIndexOf(store)(), 'neu', 'bk'))).toEqual(['bk-bbbbb']);
  });
});

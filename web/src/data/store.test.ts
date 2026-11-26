import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import { graphOf } from '@backe/ops/graph.ts';
import { selectIssues } from '@backe/ops/issue-query.ts';
import type { BacklogSnapshot } from '@backe/store/snapshot.ts';
import type { IssueJson, PatchJson, StateJson, UserJson } from '@backe/ui/api.ts';
import {
  createEffect,
  getEffectsCount,
  getLinksCount,
  getSignalsCount,
  SignalGroup,
} from '@spearwolf/signalize';
import { describe, expect, it } from 'vitest';
import { EntityTable, Store } from './store.ts';

const id = (n: number) => `bk-t${String(n).padStart(4, '0')}`;

function issue(n: number, extra: Partial<IssueJson> = {}): IssueJson {
  return {
    id: id(n),
    title: `Issue ${n}`,
    state: 'todo',
    creator: 'spw',
    created: `2026-11-18T10:0${n}:00Z`,
    ...extra,
  } as IssueJson;
}

const alice: UserJson = { handle: 'alice', name: 'Alice', kind: 'human', admin: false };

// Dieselbe Konstellation wie in graph.test.ts: ein Parent mit zwei Kindern, eines hängt am anderen.
const issues = [
  issue(1),
  issue(2, { parent: id(1) }),
  issue(3, { parent: id(1), depends_on: [id(2)] }),
];

function config() {
  const { $schema: _unused, ...rest } = BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
  });
  return rest;
}

function state(over: Partial<StateJson> = {}): StateJson {
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

function patch(over: Partial<PatchJson> = {}): PatchJson {
  return { rev: 2, head: 'h2', upsert: {}, remove: {}, ...over };
}

describe('EntityTable', () => {
  it('get creates an empty signal for an unknown key that fills on upsert', () => {
    const table = new EntityTable<{ k: string }>((x) => x.k);
    const sig = table.get('a');
    expect(sig.value).toBeUndefined();
    expect(table.keys.value).toEqual([]);
    table.upsert([{ k: 'a' }]);
    expect(sig.value).toEqual({ k: 'a' });
    expect(table.get('a')).toBe(sig);
    expect(table.keys.value).toEqual(['a']);
    SignalGroup.delete(table);
  });

  it('keeps the state order and appends new keys', () => {
    const table = new EntityTable<{ k: string }>((x) => x.k);
    table.replaceAll([{ k: 'b' }, { k: 'a' }]);
    table.upsert([{ k: 'c' }, { k: 'b' }]);
    expect(table.keys.value).toEqual(['b', 'a', 'c']);
    expect(table.list().map((x) => x.k)).toEqual(['b', 'a', 'c']);
    SignalGroup.delete(table);
  });

  it('remove empties the signal and drops the key', () => {
    const table = new EntityTable<{ k: string }>((x) => x.k);
    table.replaceAll([{ k: 'a' }, { k: 'b' }]);
    const a = table.get('a');
    table.remove(['a', 'zzz']);
    expect(a.value).toBeUndefined();
    expect(table.keys.value).toEqual(['b']);
    SignalGroup.delete(table);
  });

  it('replaceAll empties entries that vanished', () => {
    const table = new EntityTable<{ k: string }>((x) => x.k);
    table.replaceAll([{ k: 'a' }, { k: 'b' }]);
    const a = table.get('a');
    table.replaceAll([{ k: 'b' }]);
    expect(a.value).toBeUndefined();
    expect(table.keys.value).toEqual(['b']);
    SignalGroup.delete(table);
  });

  it('does not touch keys when the key set is unchanged', () => {
    const table = new EntityTable<{ k: string; v: number }>((x) => x.k);
    table.replaceAll([{ k: 'a', v: 1 }]);
    let runs = 0;
    createEffect(
      () => {
        table.keys.get();
        runs++;
      },
      { attach: table },
    );
    table.upsert([{ k: 'a', v: 2 }]);
    table.replaceAll([{ k: 'a', v: 3 }]);
    table.remove(['nope']);
    expect(runs).toBe(1);
    SignalGroup.delete(table);
  });
});

describe('Store', () => {
  it('load fills every table', () => {
    const store = new Store();
    expect(store.loaded.value).toBe(false);
    expect(store.toSnapshot()).toBeUndefined();
    store.load(state({ sync: { ahead: 1 }, problems: [{ path: 'x.md', message: 'kaputt' }] }));
    expect(store.loaded.value).toBe(true);
    expect(store.rev.value).toBe(1);
    expect(store.head.value).toBe('h1');
    expect(store.context.value).toEqual({ user: 'spw' });
    expect(store.config.value?.name).toBe('acme');
    expect(store.issues.keys.value).toEqual([id(1), id(2), id(3)]);
    expect(store.issues.get(id(2)).value?.parent).toBe(id(1));
    expect(store.projects.get('web').value?.title).toBe('Web');
    expect(store.sprints.get('s1').value?.title).toBe('S1');
    expect(store.repos.get('core').value?.url).toBe('https://example.com/core.git');
    expect(store.users.get('alice').value).toEqual(alice);
    expect(store.problems.value).toHaveLength(1);
    expect(store.sync.value).toEqual({ ahead: 1 });
    store.dispose();
  });

  it('a patch upserts and removes entities', () => {
    const store = new Store();
    store.load(state());
    const row = store.issues.get(id(2));
    const outcome = store.applyPatch(
      patch({
        upsert: {
          issues: [issue(2, { title: 'neu' }), issue(4)],
          projects: [{ path: 'api', title: 'API' } as StateJson['projects'][number]],
          users: [{ ...alice, name: 'Alice B.' }],
        },
        remove: { issues: [id(3)], sprints: ['s1'], repos: ['core'] },
      }),
    );
    expect(outcome).toBe('applied');
    expect(store.rev.value).toBe(2);
    expect(store.head.value).toBe('h2');
    expect(row.value?.title).toBe('neu');
    expect(store.issues.keys.value).toEqual([id(1), id(2), id(4)]);
    expect(store.issues.get(id(3)).value).toBeUndefined();
    expect(store.projects.keys.value).toEqual(['web', 'api']);
    expect(store.sprints.keys.value).toEqual([]);
    expect(store.repos.keys.value).toEqual([]);
    expect(store.users.get('alice').value?.name).toBe('Alice B.');
    store.dispose();
  });

  it('a patch not newer than the store is stale', () => {
    const store = new Store();
    store.load(state({ rev: 5 }));
    expect(store.applyPatch(patch({ rev: 5, upsert: { issues: [issue(9)] } }))).toBe('stale');
    expect(store.applyPatch(patch({ rev: 3 }))).toBe('stale');
    expect(store.issues.get(id(9)).value).toBeUndefined();
    expect(store.rev.value).toBe(5);
    store.dispose();
  });

  it('a patch beyond rev + 1 is a gap and changes nothing', () => {
    const store = new Store();
    store.load(state());
    expect(store.applyPatch(patch({ rev: 3, upsert: { issues: [issue(9)] } }))).toBe('gap');
    expect(store.rev.value).toBe(1);
    expect(store.head.value).toBe('h1');
    expect(store.issues.keys.value).toEqual([id(1), id(2), id(3)]);
    store.dispose();
  });

  it('touched bumps the touch count', () => {
    const store = new Store();
    store.load(state());
    const count = store.touchCount(id(2));
    const other = store.touchCount(id(3));
    expect(count.value).toBe(0);
    store.applyPatch(patch({ touched: [id(2), id(3)] }));
    expect(count.value).toBe(1);
    expect(other.value).toBe(1);
    store.applyPatch(patch({ rev: 3, upsert: { issues: [issue(2, { title: 'x' })] } }));
    expect(count.value).toBe(2);
    expect(store.touchCount(id(1)).value).toBe(0);
    store.dispose();
  });

  it('config and problems follow the patch', () => {
    const store = new Store();
    store.load(state());
    const next = { ...config(), name: 'renamed' };
    const problems = [{ path: 'issues/x.md', message: 'kaputt' }];
    store.applyPatch(patch({ upsert: { config: next }, problems }));
    expect(store.config.value?.name).toBe('renamed');
    expect(store.problems.value).toEqual(problems);
    store.applyPatch(patch({ rev: 3 }));
    expect(store.problems.value).toEqual(problems);
    store.dispose();
  });

  it('the snapshot feeds graph and selection', () => {
    const store = new Store();
    store.load(state());
    const snapshot = store.toSnapshot() as BacklogSnapshot;
    const reference: BacklogSnapshot = {
      config: BacklogConfigSchema.parse(state().config),
      users: new Map(),
      projects: new Map(
        state().projects.map((p) => [p.path, { data: p, extra: [], body: '', path: '' }] as const),
      ),
      sprints: new Map(),
      repos: new Map(),
      issues: new Map(
        issues.map((i) => [i.id, { data: i, extra: [], body: '', path: '' }] as const),
      ),
      problems: [],
      attributes: undefined,
    };
    expect(graphOf(snapshot)).toEqual(graphOf(reference));
    expect(graphOf(snapshot).children.get(id(1))).toEqual([id(2), id(3)]);
    expect(graphOf(snapshot).dependents.get(id(2))).toEqual([id(3)]);
    const query = { states: 'all' as const, filter: {}, tree: true };
    expect(selectIssues(snapshot, query)).toEqual(selectIssues(reference, query));
    store.applyPatch(patch({ remove: { issues: [id(3)] } }));
    expect(store.toSnapshot()?.issues.size).toBe(2);
    store.dispose();
  });

  it('the snapshot ignores users, sprints and repos', () => {
    const store = new Store();
    store.load(state());
    const owner = {};
    let runs = 0;
    createEffect(
      () => {
        store.toSnapshot();
        runs++;
      },
      { attach: owner },
    );
    store.applyPatch(
      patch({
        upsert: {
          users: [{ ...alice, name: 'Alice B.' }],
          sprints: [{ slug: 's2', title: 'S2' } as StateJson['sprints'][number]],
          repos: [{ name: 'x', url: 'u' } as StateJson['repos'][number]],
        },
      }),
    );
    expect(runs).toBe(1);
    store.applyPatch(patch({ rev: 3, upsert: { issues: [issue(2, { title: 'x' })] } }));
    expect(runs).toBe(2);
    SignalGroup.delete(owner);
    store.dispose();
  });

  it('a project patch recomputes the snapshot', () => {
    const store = new Store();
    store.load(state());
    expect([...(store.toSnapshot()?.projects.keys() ?? [])]).toEqual(['web']);
    const owner = {};
    let runs = 0;
    createEffect(
      () => {
        store.toSnapshot();
        runs++;
      },
      { attach: owner },
    );
    store.applyPatch(
      patch({
        upsert: { projects: [{ path: 'api', title: 'API' } as StateJson['projects'][number]] },
      }),
    );
    expect(runs).toBe(2);
    expect([...(store.toSnapshot()?.projects.keys() ?? [])]).toEqual(['web', 'api']);
    SignalGroup.delete(owner);
    store.dispose();
  });

  it('load bumps every existing touch count', () => {
    const store = new Store();
    store.load(state());
    const count = store.touchCount(id(2));
    store.load(state({ rev: 7 }));
    expect(count.value).toBe(1);
    store.dispose();
  });

  it('dispose leaves no signals behind', () => {
    const before = [getSignalsCount(), getEffectsCount(), getLinksCount()];
    const store = new Store();
    store.load(state());
    store.touchCount(id(1));
    store.issues.get('unknown');
    store.applyPatch(patch({ upsert: { issues: [issue(5)] } }));
    store.dispose();
    expect([getSignalsCount(), getEffectsCount(), getLinksCount()]).toEqual(before);
  });
});

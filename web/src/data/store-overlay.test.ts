import type { IssueJson } from '@backe/ui/api.ts';
import { createEffect, SignalGroup } from '@spearwolf/signalize';
import { describe, expect, it } from 'vitest';
import { id, issue, patch, state } from '../test/store-fixtures.ts';
import { hasFields, Store } from './store.ts';

describe('hasFields', () => {
  it('compares objects regardless of key order, arrays in order', () => {
    const value = issue(1, {
      props: { a: 1, b: { x: [1, 2], y: 'z' } },
      depends_on: [id(2), id(3)],
    });
    expect(hasFields(value, { props: { b: { y: 'z', x: [1, 2] }, a: 1 } })).toBe(true);
    expect(hasFields(value, { props: { a: 1, b: { x: [2, 1], y: 'z' } } })).toBe(false);
    expect(hasFields(value, { depends_on: [id(2), id(3)] })).toBe(true);
    expect(hasFields(value, { depends_on: [id(3), id(2)] })).toBe(false);
    expect(hasFields(value, { parent: undefined, state: 'todo' })).toBe(true);
    expect(hasFields(undefined, {})).toBe(false);
  });
});

describe('Store', () => {
  it('an overlay shows over the server value and goes away', () => {
    const store = new Store();
    store.load(state());
    const row = store.issues.get(id(2));
    const before = row.value;
    store.setOverlay(1, new Map<string, Partial<IssueJson>>([[id(2), { state: 'in_progress' }]]));
    expect(row.value?.state).toBe('in_progress');
    expect(row.value?.title).toBe('Issue 2');
    expect(store.issues.server(id(2))).toBe(before);
    store.clearOverlay(1);
    expect(row.value).toBe(before);
    store.clearOverlay(1);
    expect(row.value).toBe(before);
    store.dispose();
  });

  it('a patch under an overlay keeps the overlay on the new server value', () => {
    const store = new Store();
    store.load(state());
    store.setOverlay(1, new Map<string, Partial<IssueJson>>([[id(2), { state: 'in_progress' }]]));
    store.applyPatch(patch({ upsert: { issues: [issue(2, { title: 'neu', parent: id(1) })] } }));
    expect(store.issues.get(id(2)).value).toMatchObject({ title: 'neu', state: 'in_progress' });
    expect(store.issues.server(id(2))?.state).toBe('todo');
    store.load(state({ rev: 5, issues: [issue(2, { title: 'geladen' })] }));
    expect(store.issues.get(id(2)).value).toMatchObject({ title: 'geladen', state: 'in_progress' });
    store.clearOverlay(1);
    expect(store.issues.get(id(2)).value).toMatchObject({ title: 'geladen', state: 'todo' });
    store.dispose();
  });

  it('an overlay field set to undefined removes the field', () => {
    const store = new Store();
    store.load(state());
    store.setOverlay(1, new Map<string, Partial<IssueJson>>([[id(2), { parent: undefined }]]));
    expect(store.issues.get(id(2)).value).not.toHaveProperty('parent');
    store.clearOverlay(1);
    expect(store.issues.get(id(2)).value?.parent).toBe(id(1));
    store.dispose();
  });

  it('an overlay equal to the server value keeps the server object', () => {
    const store = new Store();
    store.load(state());
    const row = store.issues.get(id(3));
    const before = row.value;
    store.setOverlay(
      1,
      new Map<string, Partial<IssueJson>>([[id(3), { state: 'todo', depends_on: [id(2)] }]]),
    );
    expect(row.value).toBe(before);
    store.setOverlay(2, new Map<string, Partial<IssueJson>>([[id(3), { state: 'in_progress' }]]));
    store.applyPatch(
      patch({ upsert: { issues: [issue(3, { state: 'in_progress', depends_on: [id(2)] })] } }),
    );
    expect(row.value).toBe(store.issues.server(id(3)));
    store.dispose();
  });

  it('an overlay with props in another key order keeps the server object', () => {
    const store = new Store();
    store.load(state({ issues: [issue(1, { props: { a: 1, b: 2 } })] }));
    const row = store.issues.get(id(1));
    const before = row.value;
    store.setOverlay(1, new Map<string, Partial<IssueJson>>([[id(1), { props: { b: 2, a: 1 } }]]));
    expect(row.value).toBe(before);
    store.dispose();
  });

  it('an overlay never creates or revives an issue', () => {
    const store = new Store();
    store.load(state());
    const keys = store.issues.keys.value;
    let runs = 0;
    const owner = {};
    createEffect(
      () => {
        store.issues.keys.get();
        runs++;
      },
      { attach: owner },
    );
    store.setOverlay(1, new Map<string, Partial<IssueJson>>([[id(9), { state: 'in_progress' }]]));
    expect(store.issues.get(id(9)).value).toBeUndefined();
    expect(store.issues.keys.value).toBe(keys);
    store.setOverlay(2, new Map<string, Partial<IssueJson>>([[id(3), { state: 'in_progress' }]]));
    store.applyPatch(patch({ remove: { issues: [id(3)] } }));
    expect(store.issues.get(id(3)).value).toBeUndefined();
    expect(store.issues.server(id(3))).toBeUndefined();
    store.clearOverlay(2);
    store.clearOverlay(1);
    expect(store.issues.get(id(3)).value).toBeUndefined();
    expect(runs).toBe(2);
    SignalGroup.delete(owner);
    store.dispose();
  });

  it('overlays stack in token order', () => {
    const store = new Store();
    store.load(state());
    const row = store.issues.get(id(1));
    store.setOverlay(
      2,
      new Map<string, Partial<IssueJson>>([[id(1), { state: 'done', title: 'B' }]]),
    );
    store.setOverlay(1, new Map<string, Partial<IssueJson>>([[id(1), { state: 'in_progress' }]]));
    expect(row.value).toMatchObject({ state: 'done', title: 'B' });
    store.clearOverlay(2);
    expect(row.value).toMatchObject({ state: 'in_progress', title: 'Issue 1' });
    store.setOverlay(1, new Map<string, Partial<IssueJson>>([[id(2), { state: 'done' }]]));
    expect(row.value?.state).toBe('todo');
    expect(store.issues.get(id(2)).value?.state).toBe('done');
    store.dispose();
  });

  it('pendingCount counts overlays per issue', () => {
    const store = new Store();
    store.load(state());
    const one = store.pendingCount(id(1));
    const two = store.pendingCount(id(2));
    expect(store.pendingCount(id(1))).toBe(one);
    store.setOverlay(1, new Map<string, Partial<IssueJson>>([[id(1), { state: 'in_progress' }]]));
    store.setOverlay(
      2,
      new Map<string, Partial<IssueJson>>([
        [id(1), { title: 'x' }],
        [id(2), { state: 'done' }],
      ]),
    );
    expect([one.value, two.value]).toEqual([2, 1]);
    store.clearOverlay(1);
    expect([one.value, two.value]).toEqual([1, 1]);
    store.clearOverlay(2);
    expect([one.value, two.value]).toEqual([0, 0]);
    store.dispose();
  });

  it('an overlay wakes the row once and leaves other rows alone', () => {
    const store = new Store();
    store.load(state());
    const owner = {};
    const seen: string[] = [];
    for (const n of [1, 2]) {
      createEffect(
        () => {
          store.issues.get(id(n)).get();
          store.pendingCount(id(n)).get();
          seen.push(id(n));
        },
        { attach: owner },
      );
    }
    seen.length = 0;
    store.setOverlay(1, new Map<string, Partial<IssueJson>>([[id(2), { state: 'in_progress' }]]));
    expect(seen).toEqual([id(2)]);
    SignalGroup.delete(owner);
    store.dispose();
  });
});

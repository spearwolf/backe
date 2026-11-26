import type { IssueJson } from '@backe/ui/api.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { committed, flush, id, issue, move, patch, setup, state } from '../test/writes-harness.ts';
import { PENDING_TIMEOUT_MS } from './writes.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Writes', () => {
  it('the overlay is set before the call answers', async () => {
    const { store, writes, calls, answer, dispose } = setup();
    const done = writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    expect(calls.map((c) => [c.name, c.args])).toEqual([
      ['issue_move', { id: id(1), to: 'in_progress' }],
    ]);
    expect(store.issues.get(id(1)).value?.state).toBe('in_progress');
    expect(store.pendingCount(id(1)).value).toBe(1);
    await answer(committed('c1'));
    await expect(done).resolves.toEqual(committed('c1'));
    expect(store.pendingCount(id(1)).value).toBe(1);
    dispose();
  });

  it('a matching patch settles the overlay', async () => {
    const { store, writes, refreshes, answer, dispose } = setup();
    void writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    await answer(committed('c1'));
    store.applyPatch(patch(2, 'c1', [issue(1, { state: 'in_progress' })]));
    expect(store.pendingCount(id(1)).value).toBe(0);
    expect(store.issues.get(id(1)).value).toBe(store.issues.server(id(1)));
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS * 2);
    expect(refreshes).toHaveLength(0);
    dispose();
  });

  it('a patch before the answer settles at once', async () => {
    const { store, writes, refreshes, answer, dispose } = setup();
    void writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    store.applyPatch(patch(2, 'c1', [issue(1, { state: 'in_progress' })]));
    // Ein fremder Patch danach verdrängt den `head`; der gesehene `commit` zählt trotzdem.
    store.applyPatch(patch(3, 'h3'));
    expect(store.pendingCount(id(1)).value).toBe(1);
    await answer(committed('c1'));
    expect(store.pendingCount(id(1)).value).toBe(0);
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS);
    expect(refreshes).toHaveLength(0);
    dispose();
  });

  it('a state reload carrying the commit settles', async () => {
    const { store, writes, answer, dispose } = setup();
    void writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    await answer(committed('c1'));
    store.load(state(4, 'c1'));
    expect(store.pendingCount(id(1)).value).toBe(0);
    expect(store.issues.get(id(1)).value?.state).toBe('todo');
    dispose();
  });

  it('a replayed commit settles by its values', async () => {
    const { store, writes, answer, dispose } = setup();
    void writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    await answer(committed('c1'));
    store.applyPatch(patch(2, 'h2', [issue(1, { title: 'anders' })]));
    expect(store.pendingCount(id(1)).value).toBe(1);
    store.applyPatch(patch(3, 'r1', [issue(1, { state: 'in_progress' })]));
    expect(store.pendingCount(id(1)).value).toBe(0);
    dispose();
  });

  it('values settle only when every overlaid field matches', async () => {
    const { store, writes, answer, dispose } = setup();
    const optimistic = new Map<string, Partial<IssueJson>>([
      [id(1), { state: 'in_progress', parent: undefined }],
      [id(2), { state: 'done' }],
    ]);
    void writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic });
    await answer(committed('c1'));
    store.applyPatch(patch(2, 'h2', [issue(1, { state: 'in_progress', parent: id(2) })]));
    store.applyPatch(patch(3, 'h3', [issue(1, { state: 'in_progress' })]));
    expect(store.pendingCount(id(1)).value).toBe(1);
    store.applyPatch(patch(4, 'h4', [issue(2, { state: 'done' })]));
    expect(store.pendingCount(id(2)).value).toBe(0);
    dispose();
  });

  it('a missing server issue never settles by values', async () => {
    const { store, writes, answer, dispose } = setup();
    const optimistic = new Map<string, Partial<IssueJson>>([[id(9), { state: 'in_progress' }]]);
    void writes.run('issue_move', { id: id(9), to: 'in_progress' }, { optimistic });
    await answer(committed('c1'));
    store.applyPatch(patch(2, 'h2'));
    expect(store.pendingCount(id(9)).value).toBe(1);
    dispose();
  });

  it('without a matching patch the state reloads after 5 s', async () => {
    const { store, writes, refreshes, answer, dispose } = setup();
    void writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    await answer(committed('c1'));
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS - 1);
    expect(refreshes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(refreshes).toHaveLength(1);
    expect(store.pendingCount(id(1)).value).toBe(1);
    refreshes[0]?.();
    await flush();
    expect(store.pendingCount(id(1)).value).toBe(0);
    expect(store.issues.get(id(1)).value?.state).toBe('todo');
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS * 2);
    expect(refreshes).toHaveLength(1);
    dispose();
  });

  it('the fallback applies to a write without overlay', async () => {
    const { store, writes, refreshes, answer, dispose } = setup();
    void writes.run('comment_add', { id: id(1), body: 'hi' });
    await answer(committed('c1'));
    // Ohne Überlagerung gibt es keine Felder zum Vergleichen; nur der `commit` zählt.
    store.applyPatch(patch(2, 'h2'));
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS);
    expect(refreshes).toHaveLength(1);
    dispose();
  });

  it('a patch with the commit after the answer cancels the fallback', async () => {
    const { store, writes, refreshes, answer, dispose } = setup();
    void writes.run('comment_add', { id: id(1), body: 'hi' });
    await answer(committed('c1'));
    store.applyPatch(patch(2, 'c1'));
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS);
    expect(refreshes).toHaveLength(0);
    dispose();
  });
});

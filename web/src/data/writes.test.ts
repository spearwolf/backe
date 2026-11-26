import { BacklogConfigSchema } from '@backe/core/schemas.ts';
import type { IssueJson, PatchJson, StateJson, WriteResultJson } from '@backe/ui/api.ts';
import { getEffectsCount, getLinksCount, getSignalsCount } from '@spearwolf/signalize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-client.ts';
import { Store } from './store.ts';
import { PENDING_TIMEOUT_MS, type WriteDeps, Writes } from './writes.ts';

const id = (n: number) => `bk-t000${n}`;

function issue(n: number, extra: Partial<IssueJson> = {}): IssueJson {
  return {
    id: id(n),
    title: `Issue ${n}`,
    state: 'todo',
    creator: 'spw',
    created: '2026-11-18T10:00:00Z',
    ...extra,
  } as IssueJson;
}

function config() {
  const { $schema: _unused, ...rest } = BacklogConfigSchema.parse({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw'],
  });
  return rest;
}

function state(rev: number, head: string, issues: IssueJson[] = [issue(1), issue(2)]): StateJson {
  return {
    rev,
    head,
    context: {},
    config: config(),
    issues,
    projects: [],
    sprints: [],
    repos: [],
    users: [],
    problems: [],
    sync: null,
  };
}

function patch(rev: number, head: string, issues: IssueJson[] = []): PatchJson {
  return { rev, head, upsert: { issues }, remove: {} };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

type Deferred<T> = { resolve: (v: T) => void; reject: (e: unknown) => void };

/** Store mit Rev 1 und Deps, deren Antworten der Test einzeln auflöst. */
function setup() {
  const store = new Store();
  store.load(state(1, 'h1'));
  const calls: Array<{ name: string; args: unknown } & Deferred<unknown>> = [];
  const uploads: Array<{ id: string; name: string; bytes: Blob } & Deferred<WriteResultJson>> = [];
  const refreshes: Array<() => void> = [];
  const deps: WriteDeps = {
    call: (name, args) =>
      new Promise((resolve, reject) => {
        calls.push({ name, args, resolve: resolve as (v: unknown) => void, reject });
      }),
    upload: (issueId, name, bytes) =>
      new Promise((resolve, reject) => {
        uploads.push({ id: issueId, name, bytes, resolve, reject });
      }),
    refresh: () =>
      new Promise<void>((resolve) => {
        refreshes.push(resolve);
      }),
  };
  const writes = new Writes(store, deps);
  const answer = async (result: unknown) => {
    calls.shift()?.resolve(result);
    await flush();
  };
  const dispose = () => {
    writes.dispose();
    store.dispose();
  };
  return { store, writes, calls, uploads, refreshes, answer, dispose };
}

const move = new Map<string, Partial<IssueJson>>([[id(1), { state: 'in_progress' }]]);
const committed = (commit: string | null): WriteResultJson => ({ commit, id: id(1) });

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

  it('a rejected write rolls back at once', async () => {
    const { store, writes, calls, refreshes, dispose } = setup();
    const done = writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    calls[0]?.reject(new ApiError(409, 'conflict', 'nope', 'backe issue move --force'));
    await expect(done).rejects.toMatchObject({ status: 409, hint: 'backe issue move --force' });
    expect(store.pendingCount(id(1)).value).toBe(0);
    expect(store.issues.get(id(1)).value?.state).toBe('todo');
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS);
    expect(refreshes).toHaveLength(0);
    dispose();
  });

  it('other throws become an offline ApiError', async () => {
    const { writes, calls, dispose } = setup();
    const done = writes.run('issue_claim', { id: id(1) });
    calls[0]?.reject(new TypeError('Failed to fetch'));
    const error = await done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 0, code: 'offline', message: 'Failed to fetch' });
    const other = writes.run('issue_claim', { id: id(1) });
    calls[1]?.reject('down');
    await expect(other).rejects.toMatchObject({ code: 'offline', message: 'down' });
    dispose();
  });

  it('a write without commit settles at once', async () => {
    const { store, writes, refreshes, answer, dispose } = setup();
    void writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    await answer(committed(null));
    expect(store.pendingCount(id(1)).value).toBe(0);
    const located = writes.run('repo_locate', { name: 'core' });
    const repo = { name: 'core', url: 'u', canonical: 'c', path: '/src/core' };
    await answer(repo);
    await expect(located).resolves.toEqual(repo);
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS);
    expect(refreshes).toHaveLength(0);
    dispose();
  });

  it('upload follows the commit like a write', async () => {
    const { store, writes, uploads, refreshes, dispose } = setup();
    const bytes = new Blob(['x']);
    const done = writes.upload(id(1), 'shot.png', bytes);
    expect(uploads.map((u) => [u.id, u.name, u.bytes])).toEqual([[id(1), 'shot.png', bytes]]);
    uploads[0]?.resolve(committed('c1'));
    await expect(done).resolves.toEqual(committed('c1'));
    store.applyPatch(patch(2, 'c1'));
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS);
    expect(refreshes).toHaveLength(0);
    const failed = writes.upload(id(1), 'big.png', bytes);
    uploads[1]?.reject(new ApiError(413, 'too_large', 'zu groß'));
    await expect(failed).rejects.toMatchObject({ status: 413 });
    dispose();
  });

  it('report collects failures, dismiss removes them', () => {
    const { writes, dispose } = setup();
    const { report } = writes;
    report(new ApiError(409, 'conflict', 'nope', 'hint'));
    report(new Error('boom'));
    const [first, second] = writes.failures.value;
    expect(first?.error).toMatchObject({ status: 409, hint: 'hint' });
    expect(second?.error).toMatchObject({ status: 0, code: 'offline', message: 'boom' });
    expect(first?.id).not.toBe(second?.id);
    writes.dismiss(first?.id ?? -1);
    expect(writes.failures.value).toEqual([second]);
    writes.dismiss(12345);
    expect(writes.failures.value).toEqual([second]);
    dispose();
  });

  it('dispose clears timers and overlays', async () => {
    const before = [getSignalsCount(), getEffectsCount(), getLinksCount()];
    const { store, writes, calls, refreshes, answer } = setup();
    void writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    void writes.run(
      'issue_move',
      { id: id(2), to: 'in_progress' },
      {
        optimistic: new Map<string, Partial<IssueJson>>([[id(2), { state: 'in_progress' }]]),
      },
    );
    await answer(committed('c1'));
    writes.dispose();
    expect(store.pendingCount(id(1)).value).toBe(0);
    expect(store.pendingCount(id(2)).value).toBe(0);
    expect(store.issues.get(id(1)).value?.state).toBe('todo');
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS);
    expect(refreshes).toHaveLength(0);
    // Eine Antwort nach dem Ende fasst den Store nicht mehr an.
    const late = calls.shift();
    late?.resolve(committed('c2'));
    await flush();
    store.applyPatch(patch(2, 'c2'));
    expect(store.pendingCount(id(2)).value).toBe(0);
    writes.dispose();
    store.dispose();
    expect([getSignalsCount(), getEffectsCount(), getLinksCount()]).toEqual(before);
  });

  it('a write after dispose rejects without call or overlay', async () => {
    const { store, writes, calls, uploads } = setup();
    writes.dispose();
    const done = writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    await expect(done).rejects.toBeInstanceOf(ApiError);
    await expect(done).rejects.toMatchObject({ status: 0, code: 'disposed' });
    await expect(writes.upload(id(1), 'shot.png', new Blob(['x']))).rejects.toMatchObject({
      code: 'disposed',
    });
    expect(calls).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    expect(store.issues.get(id(1)).value?.state).toBe('todo');
    expect(store.pendingCount(id(1)).value).toBe(0);
    store.dispose();
  });

  it('a refresh after dispose does not touch the store', async () => {
    const { store, writes, refreshes, answer } = setup();
    void writes.run('issue_move', { id: id(1), to: 'in_progress' }, { optimistic: move });
    await answer(committed('c1'));
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS);
    writes.dispose();
    refreshes[0]?.();
    await flush();
    expect(store.pendingCount(id(1)).value).toBe(0);
    store.dispose();
  });
});

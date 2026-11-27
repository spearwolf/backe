import type { IssueJson } from '@backe/ui/api.ts';
import { getEffectsCount, getLinksCount, getSignalsCount } from '@spearwolf/signalize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { committed, flush, id, move, patch, setup } from '../test/writes-harness.ts';
import { ApiError } from './api-client.ts';
import { PENDING_TIMEOUT_MS } from './writes.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Writes: errors and lifecycle', () => {
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

  it('other throws become an unexpected ApiError, not offline', async () => {
    const { writes, calls, dispose } = setup();
    const done = writes.run('issue_claim', { id: id(1) });
    // Etwa `res.json()` auf einer 200 ohne JSON: Der Write kam an, ein Ausfall war es nicht.
    calls[0]?.reject(new SyntaxError('Unexpected end of JSON input'));
    const error = await done.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 0,
      code: 'unexpected',
      message: 'Unexpected end of JSON input',
    });
    const other = writes.run('issue_claim', { id: id(1) });
    calls[1]?.reject('down');
    await expect(other).rejects.toMatchObject({ code: 'unexpected', message: 'down' });
    writes.report(new Error('kaputt'));
    expect(writes.failures.value.at(-1)?.error).toMatchObject({ code: 'unexpected' });
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

  it('onSettle runs once when the write settles, whichever way', async () => {
    const { store, writes, uploads, refreshes, dispose } = setup();
    const bytes = new Blob(['x']);
    const settled: string[] = [];
    const track = (name: string) => ({ onSettle: () => settled.push(name) });
    // Mit Commit: erst der Patch beendet den Write.
    const byPatch = writes.upload(id(1), 'a.png', bytes, track('a'));
    uploads[0]?.resolve(committed('c1'));
    await byPatch;
    expect(settled).toEqual([]);
    store.applyPatch(patch(2, 'c1'));
    expect(settled).toEqual(['a']);
    // Ohne Commit sofort, ein Fehler ebenso.
    const unchanged = writes.upload(id(1), 'b.png', bytes, track('b'));
    uploads[1]?.resolve(committed(null));
    await unchanged;
    const failed = writes.upload(id(1), 'c.png', bytes, track('c'));
    uploads[2]?.reject(new ApiError(413, 'too_large', 'zu groß'));
    await failed.catch(() => {});
    expect(settled).toEqual(['a', 'b', 'c']);
    // Kommt kein Patch, nach dem Neuladen.
    const late = writes.upload(id(1), 'd.png', bytes, track('d'));
    uploads[3]?.resolve(committed('c9'));
    await late;
    vi.advanceTimersByTime(PENDING_TIMEOUT_MS);
    expect(settled).toEqual(['a', 'b', 'c']);
    refreshes[0]?.();
    await flush();
    expect(settled).toEqual(['a', 'b', 'c', 'd']);
    dispose();
    expect(settled).toEqual(['a', 'b', 'c', 'd']);
  });

  it('runCall shows its overlay at once and asks for the call only after `after`', async () => {
    const { store, writes, calls, dispose } = setup();
    let open!: () => void;
    const after = new Promise<void>((r) => {
      open = r;
    });
    const settled: string[] = [];
    const asked: number[] = [];
    const done = writes.runCall(
      () => {
        asked.push(store.rev.value);
        return { name: 'issue_move', args: { id: id(1), to: 'in_progress' } };
      },
      { optimistic: move, after, onSettle: () => settled.push('one') },
    );
    expect(store.issues.get(id(1)).value?.state).toBe('in_progress');
    await flush();
    expect(calls).toHaveLength(0);
    store.applyPatch(patch(2, 'h2'));
    open();
    await flush();
    // Erst nach dem Tor gerechnet: Es sieht schon den neueren Serverstand.
    expect(asked).toEqual([2]);
    expect(calls.map((c) => [c.name, c.args])).toEqual([
      ['issue_move', { id: id(1), to: 'in_progress' }],
    ]);
    calls[0]?.resolve(committed(null));
    await done;
    expect(settled).toEqual(['one']);
    dispose();
  });

  it('a runCall still waiting when writes end is never sent', async () => {
    const { writes, calls, store } = setup();
    let open!: () => void;
    const after = new Promise<void>((r) => {
      open = r;
    });
    const request = vi.fn(() => ({ name: 'issue_claim' as const, args: { id: id(1) } }));
    const done = writes.runCall(request, { after });
    writes.dispose();
    open();
    await expect(done).rejects.toMatchObject({ code: 'disposed' });
    expect(request).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    store.dispose();
  });

  it('report collects failures, dismiss removes them', () => {
    const { writes, dispose } = setup();
    const { report } = writes;
    report(new ApiError(409, 'conflict', 'nope', 'hint'));
    report(new Error('boom'));
    const [first, second] = writes.failures.value;
    expect(first?.error).toMatchObject({ status: 409, hint: 'hint' });
    expect(second?.error).toMatchObject({ status: 0, code: 'unexpected', message: 'boom' });
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

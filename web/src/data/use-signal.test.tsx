import type { IssueJson, StateJson } from '@backe/ui/api.ts';
import {
  createMemo,
  createSignal,
  getEffectsCount,
  type Signal,
  SignalGroup,
} from '@spearwolf/signalize';
import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Store } from './store.ts';
import { StoreContext, useStore } from './store-context.tsx';
import { useSignal } from './use-signal.ts';

const id = (n: number) => `bk-t${String(n).padStart(4, '0')}`;
const issue = (n: number, title = `Issue ${n}`): IssueJson =>
  ({
    id: id(n),
    title,
    state: 'todo',
    creator: 'spw',
    created: '2026-11-18T10:00:00Z',
  }) as IssueJson;

function state(count: number): StateJson {
  return {
    rev: 1,
    head: 'h',
    context: {},
    config: {} as StateJson['config'],
    issues: Array.from({ length: count }, (_, i) => issue(i + 1)),
    projects: [],
    sprints: [],
    repos: [],
    users: [],
    problems: [],
    sync: null,
  };
}

type Counts = { rows: Map<string, number>; list: number };

function View({ sig, renders }: { sig: Signal<number>; renders: { view: number } }) {
  renders.view++;
  return <p>{useSignal(sig)}</p>;
}

function Row({ store, rowId, counts }: { store: Store; rowId: string; counts: Counts }) {
  counts.rows.set(rowId, (counts.rows.get(rowId) ?? 0) + 1);
  const row = useSignal(store.issues.get(rowId));
  return <li>{row?.title}</li>;
}

function List({ store, counts }: { store: Store; counts: Counts }) {
  counts.list++;
  const keys = useSignal(store.issues.keys);
  return (
    <ul>
      {keys.map((k) => (
        <Row key={k} store={store} rowId={k} counts={counts} />
      ))}
    </ul>
  );
}

describe('useSignal', () => {
  it('useSignal re-renders on change', () => {
    const sig = createSignal(1);
    const renders = { view: 0 };
    render(<View sig={sig} renders={renders} />);
    expect(screen.getByText('1')).toBeTruthy();
    act(() => sig.set(2));
    expect(screen.getByText('2')).toBeTruthy();
    const after = renders.view;
    act(() => sig.set(2));
    expect(renders.view).toBe(after);
    SignalGroup.delete(sig);
  });

  it('reads a memo reader', () => {
    const sig = createSignal(2);
    const double = createMemo(() => sig.get() * 2);
    const { result } = renderHook(() => useSignal(double));
    expect(result.current).toBe(4);
    act(() => sig.set(5));
    expect(result.current).toBe(10);
    SignalGroup.delete(sig);
  });

  it('a patch re-renders only the subscribers of that issue', () => {
    const store = new Store();
    store.load(state(1000));
    const counts: Counts = { rows: new Map(), list: 0 };
    render(<List store={store} counts={counts} />);
    const rowRenders = counts.rows;
    expect(rowRenders.size).toBe(1000);
    const before = new Map(rowRenders);

    act(() => {
      store.applyPatch({
        rev: 2,
        head: 'h2',
        upsert: { issues: [issue(7, 'geändert')] },
        remove: {},
      });
    });

    expect(screen.getByText('geändert')).toBeTruthy();
    expect(counts.list).toBe(1);
    for (const [key, n] of rowRenders)
      expect(n - (before.get(key) ?? 0)).toBe(key === id(7) ? 1 : 0);
    store.dispose();
  });

  it('unmount releases the effect', () => {
    const sig = createSignal(1);
    const baseline = getEffectsCount();
    const { unmount } = renderHook(() => useSignal(sig));
    expect(getEffectsCount()).toBeGreaterThan(baseline);
    unmount();
    expect(getEffectsCount()).toBe(baseline);
    SignalGroup.delete(sig);
  });
});

describe('useStore', () => {
  it('useStore throws without a provider', () => {
    expect(() => renderHook(() => useStore())).toThrow();
  });

  it('returns the provided store', () => {
    const store = new Store();
    const { result } = renderHook(() => useStore(), {
      wrapper: ({ children }) => (
        <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
      ),
    });
    expect(result.current).toBe(store);
    store.dispose();
  });
});

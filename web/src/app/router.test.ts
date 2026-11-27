import { getEffectsCount, getSignalsCount } from '@spearwolf/signalize';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Router, RouterContext, useRouter } from './router.ts';

describe('Router', () => {
  let router: Router;
  beforeEach(() => {
    window.history.replaceState(null, '', '/b/main/backlog');
    router = new Router();
  });
  afterEach(() => router.dispose());

  it('reads the initial location', () => {
    expect(router.route()).toEqual({ kind: 'backlog', backlog: 'main' });
    expect(router.location.value).toEqual({ pathname: '/b/main/backlog', search: '' });
  });

  it('navigate pushes and replace replaces', () => {
    const start = window.history.length;
    router.navigate('/b/main/board?x=1');
    expect(window.history.length).toBe(start + 1);
    expect(window.location.pathname).toBe('/b/main/board');
    expect(router.route()).toEqual({ kind: 'board', backlog: 'main' });
    expect(router.location.value.search).toBe('?x=1');

    router.navigate('/b/main/issue/bk-1', { replace: true });
    expect(window.history.length).toBe(start + 1);
    expect(router.route()).toEqual({ kind: 'issue', backlog: 'main', id: 'bk-1' });
  });

  it('popstate updates the route', () => {
    router.navigate('/b/main/board');
    window.history.replaceState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.route()).toEqual({ kind: 'home' });
  });

  it('counts every navigation, also to the current url and by popstate', () => {
    expect(router.navigation.value).toBe(0);
    router.navigate('/b/main/board');
    expect(router.navigation.value).toBe(1);

    // Derselbe Ort: kein neuer `location`, aber eine Navigation; ersetzt statt zu stapeln, wie
    // der Browser einen Link auf die aktuelle Seite behandelt.
    const location = router.location.value;
    const length = window.history.length;
    router.navigate('/b/main/board');
    expect(router.navigation.value).toBe(2);
    expect(router.location.value).toBe(location);
    expect(window.history.length).toBe(length);

    router.navigate('/b/main/backlog', { replace: true });
    expect(router.navigation.value).toBe(3);
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(router.navigation.value).toBe(4);
  });

  it('dispose stops listening and frees its signals', () => {
    const signals = getSignalsCount();
    const effects = getEffectsCount();
    const other = new Router();
    other.dispose();
    expect(getSignalsCount()).toBe(signals);
    expect(getEffectsCount()).toBe(effects);
    window.history.replaceState(null, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(other.route()).toEqual({ kind: 'backlog', backlog: 'main' });
  });

  it('useRouter returns the provided router and throws without one', () => {
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(RouterContext.Provider, { value: router }, children);
    const { result } = renderHook(() => useRouter(), { wrapper });
    expect(result.current).toBe(router);
    act(() => {});
    expect(() => renderHook(() => useRouter())).toThrow(/RouterContext/);
  });
});

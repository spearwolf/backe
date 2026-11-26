import { describe, expect, it } from 'vitest';
import { canonicalPath, parseRoute, routeHref } from './routes.ts';

describe('routes', () => {
  it('parseRoute knows every view', () => {
    expect(parseRoute('/')).toEqual({ kind: 'home' });
    expect(parseRoute('/b/main/backlog')).toEqual({ kind: 'backlog', backlog: 'main' });
    expect(parseRoute('/b/main/board')).toEqual({ kind: 'board', backlog: 'main' });
    expect(parseRoute('/b/main/issue/bk-1')).toEqual({
      kind: 'issue',
      backlog: 'main',
      id: 'bk-1',
    });
    expect(parseRoute('/b/main/settings')).toEqual({
      kind: 'settings',
      backlog: 'main',
      section: undefined,
    });
    expect(parseRoute('/b/main/settings/users')).toEqual({
      kind: 'settings',
      backlog: 'main',
      section: 'users',
    });
  });

  it('a bare backlog path is canonicalised', () => {
    expect(parseRoute('/b/main')).toEqual({ kind: 'backlog', backlog: 'main' });
    expect(parseRoute('/b/main/')).toEqual({ kind: 'backlog', backlog: 'main' });
    expect(canonicalPath('/b/main')).toBe('/b/main/backlog');
    expect(canonicalPath('/b/main/')).toBe('/b/main/backlog');
    expect(canonicalPath('/b/a%20b')).toBe('/b/a%20b/backlog');
    expect(canonicalPath('/b/main/board')).toBeUndefined();
    expect(canonicalPath('/')).toBeUndefined();
  });

  it('unknown paths are not found', () => {
    for (const path of [
      '/x',
      '/b',
      '/b/',
      '/b/main/nope',
      '/b/main/issue',
      '/b/main/board/extra',
      '/b/main/settings/a/b',
      '/b/%E0%A4%A/backlog',
    ]) {
      expect(parseRoute(path)).toEqual({ kind: 'not-found', path });
    }
  });

  it('routeHref round-trips through parseRoute', () => {
    const routes = [
      { kind: 'backlog', backlog: 'a b' },
      { kind: 'board', backlog: 'main' },
      { kind: 'issue', backlog: 'main', id: '100%/x?#' },
      { kind: 'settings', backlog: 'main', section: undefined },
      { kind: 'settings', backlog: 'main', section: 'ü/x' },
    ] as const;
    for (const route of routes) expect(parseRoute(routeHref(route))).toEqual(route);
  });
});

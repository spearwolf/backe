/** Die Routen der Oberfläche (ui.md §2.6); rein, ohne Browser-Zugriff. */
export type Route =
  | { kind: 'home' }
  | { kind: 'backlog'; backlog: string }
  | { kind: 'board'; backlog: string }
  | { kind: 'issue'; backlog: string; id: string }
  | { kind: 'settings'; backlog: string; section: string | undefined }
  | { kind: 'not-found'; path: string };

/** Zerlegt einen Pfad in dekodierte Segmente; kaputte Escapes ergeben `undefined`. */
function segmentsOf(pathname: string): string[] | undefined {
  try {
    return pathname
      .split('/')
      .slice(1)
      .map((s) => decodeURIComponent(s));
  } catch {
    return undefined;
  }
}

export function parseRoute(pathname: string): Route {
  const notFound: Route = { kind: 'not-found', path: pathname };
  if (pathname === '/') return { kind: 'home' };
  const segs = segmentsOf(pathname);
  if (segs === undefined || segs[0] !== 'b') return notFound;
  const [, backlog, view, arg, ...rest] = segs;
  if (backlog === undefined || backlog === '' || rest.length > 0) return notFound;
  // `/b/<b>` und `/b/<b>/` sind der Backlog; `canonicalPath` leitet sie auf die volle Form um.
  if (view === undefined || (view === '' && arg === undefined)) return { kind: 'backlog', backlog };
  if (arg === undefined) {
    if (view === 'backlog') return { kind: 'backlog', backlog };
    if (view === 'board') return { kind: 'board', backlog };
    if (view === 'settings') return { kind: 'settings', backlog, section: undefined };
    return notFound;
  }
  if (arg === '') return notFound;
  if (view === 'issue') return { kind: 'issue', backlog, id: arg };
  if (view === 'settings') return { kind: 'settings', backlog, section: arg };
  return notFound;
}

export function routeHref(route: Exclude<Route, { kind: 'home' | 'not-found' }>): string {
  const base = `/b/${encodeURIComponent(route.backlog)}`;
  switch (route.kind) {
    case 'backlog':
    case 'board':
      return `${base}/${route.kind}`;
    case 'issue':
      return `${base}/issue/${encodeURIComponent(route.id)}`;
    case 'settings':
      return route.section === undefined
        ? `${base}/settings`
        : `${base}/settings/${encodeURIComponent(route.section)}`;
  }
}

/** Der Pfad, auf den `/b/<b>` per `replace` umgeleitet wird; sonst `undefined`. */
export function canonicalPath(pathname: string): string | undefined {
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  return match === null ? undefined : `/b/${match[1]}/backlog`;
}

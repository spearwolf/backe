/** Routentabelle der lesenden API von `backe ui` (ui.md §2.3): reine Funktion, kein I/O. */
import { BACKLOG_NAME_RE } from '../core/names.ts';

export type ReadRoute =
  | { kind: 'backlogs' }
  | { kind: 'state'; backlog: string }
  | { kind: 'events'; backlog: string }
  | { kind: 'issue'; backlog: string; id: string }
  | { kind: 'attachment'; backlog: string; id: string; name: string }
  | { kind: 'search'; backlog: string; q: string | undefined };

/** Percent-dekodiertes Segment; `undefined` bei leerem oder ungültig kodiertem Segment. */
function segment(raw: string): string | undefined {
  if (raw === '') return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/**
 * GET/HEAD auf `/api/backlogs` und `/api/b/<b>/…`; Segmente percent-dekodiert; `<b>` muss
 * `BACKLOG_NAME_RE` erfüllen. Alles andere ergibt `undefined`.
 */
export function readRoute(method: string, url: URL): ReadRoute | undefined {
  if (method !== 'GET' && method !== 'HEAD') return undefined;
  const parts = url.pathname.split('/').slice(1);
  if (parts[0] !== 'api') return undefined;
  const rest = parts.slice(1);
  if (rest.length === 1 && rest[0] === 'backlogs') return { kind: 'backlogs' };
  if (rest[0] !== 'b' || rest.length < 3) return undefined;
  const backlog = segment(rest[1] ?? '');
  if (backlog === undefined || !BACKLOG_NAME_RE.test(backlog)) return undefined;
  const [, , area, rawId, sub, rawName] = rest;
  if (rest.length === 3 && area === 'state') return { kind: 'state', backlog };
  if (rest.length === 3 && area === 'events') return { kind: 'events', backlog };
  if (rest.length === 3 && area === 'search') {
    return { kind: 'search', backlog, q: url.searchParams.get('q') ?? undefined };
  }
  if (area !== 'issues' || rawId === undefined) return undefined;
  const id = segment(rawId);
  if (id === undefined) return undefined;
  if (rest.length === 4) return { kind: 'issue', backlog, id };
  if (rest.length === 6 && sub === 'attachments' && rawName !== undefined) {
    const name = segment(rawName);
    return name === undefined ? undefined : { kind: 'attachment', backlog, id, name };
  }
  return undefined;
}

export type WriteRoute =
  | { kind: 'tool'; backlog: string; tool: string }
  | { kind: 'upload'; backlog: string; id: string; name: string };

/**
 * POST auf `/api/b/<b>/tools/<tool>` und PUT auf `/api/b/<b>/issues/<id>/attachments/<name>`
 * (ui.md §2.3.2); Segmente percent-dekodiert, `<b>` nach `BACKLOG_NAME_RE`. Jede andere Methode
 * auf diesen Pfaden ergibt `undefined` und damit 404 wie jeder unbekannte Endpunkt.
 */
export function writeRoute(method: string, url: URL): WriteRoute | undefined {
  const parts = url.pathname.split('/').slice(1);
  if (parts[0] !== 'api' || parts[1] !== 'b') return undefined;
  const backlog = segment(parts[2] ?? '');
  if (backlog === undefined || !BACKLOG_NAME_RE.test(backlog)) return undefined;
  const rest = parts.slice(3);
  if (method === 'POST' && rest.length === 2 && rest[0] === 'tools') {
    const tool = segment(rest[1] ?? '');
    return tool === undefined ? undefined : { kind: 'tool', backlog, tool };
  }
  if (method === 'PUT' && rest.length === 4 && rest[0] === 'issues' && rest[2] === 'attachments') {
    const id = segment(rest[1] ?? '');
    const name = segment(rest[3] ?? '');
    return id === undefined || name === undefined
      ? undefined
      : { kind: 'upload', backlog, id, name };
  }
  return undefined;
}

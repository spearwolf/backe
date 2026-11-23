import { BackeError } from './errors.ts';
import { m } from './url.messages.ts';

const NETWORK_RE = /^(?:https?|ssh):\/\/(?:[^@/\s]*@)?([^/:@\s]+)(?::\d+)?(\/.*)?$/i;
/** Kanonische Form `<host>/<pfad>`: Host mit Punkt, oder ein kleingeschriebener Name ohne Punkt (`localhost`). */
const CANONICAL_RE = /^([^/:@\s]+\.[^/:@\s]+|[a-z0-9-]+)\/(.+)$/;
/** Forges, deren Pfad ohne Rücksicht auf die Schreibweise auflöst; dort wird er kleingeschrieben. */
const CASE_INSENSITIVE_HOSTS = new Set([
  'github.com',
  'gitlab.com',
  'codeberg.org',
  'bitbucket.org',
]);
const SCP_RE = /^(?:[^@/:\s]+@)?([^/:@\s]+):(.*)$/;
const MAX_NAME_LENGTH = 64;

function fail(input: string): never {
  throw new BackeError('validation', m.unrecognizedUrl(input), { hint: m.hint });
}

/**
 * Doppelte Slashes kollabieren, abschließende Slashes und jedes abschließende `.git` entfernen —
 * alle, damit die kanonische Form nie auf `.git` endet und ein zweiter Durchlauf nichts ändert.
 */
function cleanPath(path: string, stripGit = true): string {
  let p = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  while (stripGit && p.endsWith('.git')) p = p.slice(0, -'.git'.length).replace(/\/+$/, '');
  return p;
}

function remote(input: string, host: string, path: string): string {
  const p = cleanPath(path).replace(/^\/+/, '');
  if (p === '') fail(input);
  const h = host.toLowerCase();
  return `${h}/${CASE_INSENSITIVE_HOSTS.has(h) ? p.toLowerCase() : p}`;
}

function local(input: string, path: string, stripGit = true): string {
  const p = cleanPath(path, stripGit);
  if (!p.startsWith('/')) fail(input);
  return `file:${p}`;
}

/**
 * Kanonische Form ohne Schema: `<host>/<pfad>` bzw. `file:<abs-pfad>`; kein I/O. Query und Fragment
 * sind ungültig. Die kanonische Form selbst wird unverändert wiedererkannt (idempotent): `<host>/…`
 * endet nie auf `.git`, und `file:/…` (ein Slash) behält seinen Pfad, wie er ist.
 */
export function normalizeRepoUrl(input: string): string {
  if (input === '' || /\s/.test(input) || /[?#]/.test(input)) fail(input);

  if (/^file:\//i.test(input) && !/^file:\/\//i.test(input)) {
    return local(input, input.slice('file:'.length), false);
  }
  if (input.startsWith('/')) return local(input, input);
  if (/^file:\/\//i.test(input)) return local(input, input.slice('file://'.length));
  if (/^gh:/i.test(input)) return remote(input, 'github.com', input.slice('gh:'.length));

  const net = NETWORK_RE.exec(input);
  if (net) return remote(input, net[1] ?? '', net[2] ?? '');

  if (!input.includes('://')) {
    const canonical = CANONICAL_RE.exec(input);
    if (canonical) return remote(input, canonical[1] ?? '', canonical[2] ?? '');
    const scp = SCP_RE.exec(input);
    if (scp) return remote(input, scp[1] ?? '', scp[2] ?? '');
  }
  return fail(input);
}

function sanitize(segment: string): string {
  const s = segment
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^[^a-z0-9]+/, '');
  return s.slice(0, MAX_NAME_LENGTH);
}

/** Leitet einen Repo-Namen aus der kanonischen URL ab: `<repo>`, dann `<owner>-<repo>`, dann `<owner>-<repo>-2`, … */
export function deriveRepoName(canonical: string, taken: ReadonlySet<string>): string {
  const segments = canonical
    .replace(/^file:/, '')
    .split('/')
    .filter(Boolean);
  const repo = sanitize(segments.at(-1) ?? '') || 'repo';
  if (!taken.has(repo)) return repo;

  const owner = sanitize(segments.at(-2) ?? '');
  const combined = (owner === '' ? repo : `${owner}-${repo}`).slice(0, MAX_NAME_LENGTH - 4);
  if (!taken.has(combined)) return combined;
  for (let n = 2; ; n++) {
    const candidate = `${combined}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

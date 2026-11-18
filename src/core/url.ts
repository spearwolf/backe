import { BackeError } from './errors.ts';

const HINT =
  'Erlaubt: https://…, http://…, ssh://[user@]host[:port]/pfad, [user@]host:pfad, gh:owner/repo, absoluter Pfad (/…) oder file:///…';

const NETWORK_RE = /^(?:https?|ssh):\/\/(?:[^@/\s]*@)?([^/:@\s]+)(?::\d+)?(\/.*)?$/i;
const SCP_RE = /^(?:[^@/:\s]+@)?([^/:@\s]+):(.*)$/;
const MAX_NAME_LENGTH = 64;

function fail(input: string): never {
  throw new BackeError('usage', `Repo-URL nicht erkannt: "${input}"`, { hint: HINT });
}

/** Doppelte Slashes kollabieren, abschließende Slashes und ein `.git` entfernen. */
function cleanPath(path: string): string {
  let p = path.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (p.endsWith('.git')) p = p.slice(0, -'.git'.length).replace(/\/+$/, '');
  return p;
}

function remote(input: string, host: string, path: string): string {
  const p = cleanPath(path).replace(/^\/+/, '');
  if (p === '') fail(input);
  return `${host.toLowerCase()}/${p}`;
}

function local(input: string, path: string): string {
  const p = cleanPath(path);
  if (!p.startsWith('/')) fail(input);
  return `file:${p}`;
}

/** Kanonische Form ohne Schema: `<host>/<pfad>` bzw. `file:<abs-pfad>`; kein I/O. */
export function normalizeRepoUrl(input: string): string {
  if (input === '' || /\s/.test(input)) fail(input);

  if (input.startsWith('/')) return local(input, input);
  if (/^file:\/\//i.test(input)) return local(input, input.slice('file://'.length));
  if (/^gh:/i.test(input)) return remote(input, 'github.com', input.slice('gh:'.length));

  const net = NETWORK_RE.exec(input);
  if (net) return remote(input, net[1] ?? '', net[2] ?? '');

  if (!input.includes('://')) {
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

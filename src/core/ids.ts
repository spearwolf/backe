import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import { BackeError } from './errors.ts';
import { m } from './ids.messages.ts';

export const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

export const PREFIX_RE = /^[a-z]{2,6}$/;
const ID_RE = /^([a-z]{2,6})-([0-9a-hjkmnp-tv-z]{5,6})$/;
const MIN_SHORT_LENGTH = 3;
const LONG_ID_THRESHOLD = 50_000;
const MAX_ID_ATTEMPTS = 100;

export function isValidPrefix(p: string): boolean {
  return PREFIX_RE.test(p);
}

export function isIssueId(s: string, prefix?: string): boolean {
  const m = ID_RE.exec(s);
  if (!m) return false;
  return prefix === undefined || m[1] === prefix;
}

/** Standard-Zufallsquelle für IDs und Dateinamen, wenn der Aufrufer keine eigene mitgibt. */
export function defaultRandomBytes(n: number): Uint8Array {
  return cryptoRandomBytes(n);
}

export function generateIssueId(
  prefix: string,
  opts: {
    exists: (id: string) => boolean;
    issueCount: number;
    randomBytes?: (n: number) => Uint8Array;
  },
): string {
  const length = opts.issueCount > LONG_ID_THRESHOLD ? 6 : 5;
  const source = opts.randomBytes ?? defaultRandomBytes;
  for (let attempt = 0; attempt < MAX_ID_ATTEMPTS; attempt++) {
    const bytes = source(length);
    if (bytes.length < length) {
      throw new BackeError('unexpected', m.shortRandom(bytes.length, length));
    }
    let rand = '';
    for (let i = 0; i < length; i++) {
      // 256 ist durch 32 teilbar, `& 31` ist also gleichverteilt.
      rand += CROCKFORD[(bytes[i] ?? 0) & 31];
    }
    const id = `${prefix}-${rand}`;
    if (!opts.exists(id)) return id;
  }
  throw new BackeError('unexpected', m.noFreeId(MAX_ID_ATTEMPTS));
}

const FULL_SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Kurzform eines Commit-Hashs für Meldungen: 7 Zeichen eines vollen Hashs; alles andere unverändert. */
export function shortSha(sha: string): string {
  return FULL_SHA_RE.test(sha) ? sha.slice(0, 7) : sha;
}

export function shardOf(id: string): string {
  return id.slice(id.indexOf('-') + 1, id.indexOf('-') + 3);
}

const MAX_LISTED_CANDIDATES = 10;

/**
 * Löst eine Eingabe gegen die bekannten IDs auf, ohne Groß-/Kleinschreibung. Eine volle ID
 * gilt exakt; sonst zählt die Eingabe als Anfang des Zufallsteils. Ein Präfix samt Bindestrich
 * wird nur abgeschnitten, wenn er der Präfix der bekannten IDs ist; ein fremder Präfix (etwa
 * `ac-7f3` in einem `bk`-Backlog) passt zu keiner ID, statt still im falschen Backlog zu treffen.
 * Ein Kandidat, dessen Zufallsteil genau der Eingabe entspricht, gewinnt vor jeder Mehrdeutigkeit.
 */
export function resolveShortId(input: string, ids: readonly string[]): string {
  const wanted = input.toLowerCase();
  if (isIssueId(wanted)) {
    if (ids.includes(wanted)) return wanted;
    throw new BackeError('not_found', m.issueNotFound(wanted));
  }
  const notFound = () => new BackeError('not_found', m.noIdMatches(input));
  const prefixed = /^([a-z]{2,6})-(.*)$/s.exec(wanted);
  if (prefixed !== null && !ids.some((id) => id.startsWith(`${prefixed[1]}-`))) throw notFound();
  const short = prefixed === null ? wanted : (prefixed[2] as string);
  if (short.length < MIN_SHORT_LENGTH) {
    throw new BackeError('validation', m.shortIdTooShort(MIN_SHORT_LENGTH, input));
  }
  const randomPart = (id: string) => id.slice(id.indexOf('-') + 1);
  const candidates = ids.filter((id) => randomPart(id).startsWith(short));
  const exact = candidates.find((id) => randomPart(id) === short);
  if (exact !== undefined) return exact;
  const [first] = candidates;
  if (first === undefined) throw notFound();
  if (candidates.length > 1) {
    const listed = candidates.slice(0, MAX_LISTED_CANDIDATES).join(', ');
    const more = candidates.length > MAX_LISTED_CANDIDATES ? ', …' : '';
    throw new BackeError('ambiguous', m.shortIdAmbiguous(input, `${listed}${more}`), {
      details: { candidates },
    });
  }
  return first;
}

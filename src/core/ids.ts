import { randomBytes as cryptoRandomBytes } from 'node:crypto';
import { BackeError } from './errors.ts';

export const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

const PREFIX_RE = /^[a-z]{2,6}$/;
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
      throw new BackeError(
        'unexpected',
        `Zufallsquelle lieferte ${bytes.length} statt ${length} Bytes`,
      );
    }
    let rand = '';
    for (let i = 0; i < length; i++) {
      // 256 ist durch 32 teilbar, `& 31` ist also gleichverteilt.
      rand += CROCKFORD[(bytes[i] ?? 0) & 31];
    }
    const id = `${prefix}-${rand}`;
    if (!opts.exists(id)) return id;
  }
  throw new BackeError(
    'unexpected',
    `Keine freie Issue-ID nach ${MAX_ID_ATTEMPTS} Versuchen gefunden`,
  );
}

export function shardOf(id: string): string {
  return id.slice(id.indexOf('-') + 1, id.indexOf('-') + 3);
}

export function resolveShortId(input: string, ids: readonly string[]): string {
  if (isIssueId(input)) {
    if (ids.includes(input)) return input;
    throw new BackeError('not_found', `Issue ${input} nicht gefunden`);
  }
  if (input.length < MIN_SHORT_LENGTH) {
    throw new BackeError(
      'usage',
      `ID-Kurzform braucht mindestens ${MIN_SHORT_LENGTH} Zeichen: ${input}`,
    );
  }
  const candidates = ids.filter((id) => id.slice(id.indexOf('-') + 1).startsWith(input));
  const [first] = candidates;
  if (first === undefined) throw new BackeError('not_found', `Keine Issue-ID passt zu ${input}`);
  if (candidates.length > 1) {
    throw new BackeError('ambiguous', `ID-Kurzform ${input} ist mehrdeutig`, {
      details: { candidates },
    });
  }
  return first;
}

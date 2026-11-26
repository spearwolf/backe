/**
 * Zugangsschutz von `backe ui` (ui.md §2.15): Sitzungs-Token, Cookie, Host- und Origin-Prüfung,
 * Sicherheits-Header. Reine Funktionen ohne Server-Zustand.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from 'node:http';
import { m } from './security.messages.ts';

export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
/**
 * Name des Sitzungs-Cookies, z. B. `backe_ui_8002`. Cookies unterscheiden nicht nach Port: Mit
 * einem festen Namen überschriebe der Token-Tausch einer zweiten Instanz das Cookie der ersten.
 */
export function cookieName(port: number): string {
  return `backe_ui_${port}`;
}

/** 32 Bytes aus `randomBytes`, hex (64 Zeichen). */
export function newToken(): string {
  return randomBytes(32).toString('hex');
}

/** `timingSafeEqual`; ungleiche Länge oder `undefined` → false. */
export function sameToken(given: string | undefined, token: string): boolean {
  if (given === undefined) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Werte aller Cookies `name` aus einem `Cookie`-Header, in Header-Reihenfolge. Es können mehrere
 * sein: Eine Seite auf einem anderen lokalen Port darf ein gleichnamiges Cookie mit längerem
 * `Path` setzen, das der Browser vor unserem schickt.
 */
export function cookiesOf(header: string | undefined, name: string): string[] {
  const out: string[] = [];
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq >= 0 && part.slice(0, eq).trim() === name) out.push(part.slice(eq + 1).trim());
  }
  return out;
}

export type Gate = { port: number; token: string; origins: readonly string[] };

/** Die beiden Schreibweisen des eigenen Origins. */
export function ownOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

export type Verdict =
  | { kind: 'pass' }
  | { kind: 'session'; location: string; cookie: string }
  | {
      kind: 'deny';
      status: 401 | 403;
      code: 'unauthorized' | 'forbidden';
      message: string;
      hint?: string;
    };

const SAFE_METHODS = new Set(['GET', 'HEAD']);

function forbidden(message: string): Verdict {
  return { kind: 'deny', status: 403, code: 'forbidden', message };
}

function unauthorized(message: string): Verdict {
  return { kind: 'deny', status: 401, code: 'unauthorized', message, hint: m.openConsoleUrl };
}

/**
 * Prüft in dieser Reihenfolge: (1) `Host` gegen `127.0.0.1:<port>`/`localhost:<port>` gegen
 * DNS-Rebinding, (2) `Origin` gegen CSRF, schreibende Methoden nur mit `Origin`, (3) `?token=`
 * öffnet eine Sitzung, (4) sonst muss eines der Cookies `backe_ui_<port>` passen. `Referer` zählt nie.
 */
export function checkRequest(
  req: { method: string; url: URL; headers: IncomingHttpHeaders },
  gate: Gate,
): Verdict {
  const host = req.headers.host ?? '';
  if (host !== `127.0.0.1:${gate.port}` && host !== `localhost:${gate.port}`) {
    return forbidden(m.foreignHost(host));
  }
  const origin = req.headers.origin;
  if (origin !== undefined && !gate.origins.includes(origin)) {
    return forbidden(m.foreignOrigin(origin));
  }
  if (origin === undefined && !SAFE_METHODS.has(req.method)) {
    return forbidden(m.originRequired(req.method));
  }
  const given = req.url.searchParams.get('token');
  if (given !== null) {
    if (!sameToken(given, gate.token)) return unauthorized(m.wrongToken);
    const rest = new URL(req.url);
    rest.searchParams.delete('token');
    // Führende Schrägstriche zusammenfassen: `//host` wäre im `Location` ein fremder Host.
    const location = `/${rest.pathname.replace(/^\/+/, '')}${rest.search}`;
    return {
      kind: 'session',
      location,
      cookie: `${cookieName(gate.port)}=${gate.token}; HttpOnly; SameSite=Strict; Path=/`,
    };
  }
  // Jeder gleichnamige Wert wird verglichen, ohne Abbruch beim ersten Treffer; ein untergeschobenes
  // Cookie sperrt so niemanden aus.
  let session = false;
  for (const value of cookiesOf(req.headers.cookie, cookieName(gate.port))) {
    session = sameToken(value, gate.token) || session;
  }
  if (!session) return unauthorized(m.noSession);
  return { kind: 'pass' };
}

/** Für jede Antwort außer Anhängen: CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`. */
export function appHeaders(): OutgoingHttpHeaders {
  return {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

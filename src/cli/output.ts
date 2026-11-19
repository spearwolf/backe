/**
 * Ausgabe der CLI (backe.md §2.18): Formatwahl, Farben, kompaktes JSON, Spalten, Kopfzeile,
 * Fehler und Write-Ergebnisse. Alles hier ist rein und liefert Text; geschrieben wird im Aufrufer.
 */
import { type Env, envValue } from '../context/paths.ts';
import { BackeError } from '../core/errors.ts';
import type { UserConfig } from '../core/schemas.ts';
import type { Notice } from '../ops/notice.ts';
import { summarizeOp } from '../ops/operation.ts';
import type { WriteOutcome } from '../services/outcome.ts';
import type { CliIo } from './io.ts';

export const FORMATS = ['text', 'json', 'md'] as const;
export type Format = (typeof FORMATS)[number];

const isFormat = (value: string): value is Format => (FORMATS as readonly string[]).includes(value);

function checked(value: string, source: string): Format {
  if (isFormat(value)) return value;
  throw new BackeError('usage', `Unbekanntes Ausgabeformat »${value}« (Quelle: ${source})`, {
    hint: 'text, json oder md',
  });
}

/** `--json` > `--format` > `BACKE_FORMAT` > `output.format` der User-Config > `text`. */
export function resolveFormat(
  opts: { json?: boolean; format?: string },
  env: Env,
  cfg: UserConfig,
): Format {
  if (opts.json === true) return 'json';
  if (opts.format !== undefined) return checked(opts.format, '--format');
  const fromEnv = envValue(env, 'BACKE_FORMAT');
  if (fromEnv !== undefined) return checked(fromEnv, 'BACKE_FORMAT');
  return cfg.output?.format ?? 'text';
}

/**
 * Farben nur auf einem TTY ohne `NO_COLOR` und mit `output.color` ungleich `never`;
 * `output.color: always` erzwingt sie.
 */
export function useColor(io: CliIo, cfg: UserConfig): boolean {
  const mode = cfg.output?.color ?? 'auto';
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return io.isTTY && envValue(io.env, 'NO_COLOR') === undefined;
}

const STYLES = { bold: 1, dim: 2, red: 31, green: 32, yellow: 33, cyan: 36 } as const;
export type Style = keyof typeof STYLES;

/** `s` in ANSI-Farbe, wenn `on`; sonst unverändert. */
export function paint(on: boolean, style: Style, s: string): string {
  return on ? `\x1b[${STYLES[style]}m${s}\x1b[0m` : s;
}

/** Kompaktes JSON in einer Zeile; `undefined`-Felder fallen weg. */
export function json(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

/** Breite in Codepoints, nicht in UTF-16-Einheiten. */
export const width = (s: string): number => [...s].length;

/**
 * Zeilen mit festen Spalten, getrennt durch zwei Leerzeichen: jede Spalte außer der letzten auf die
 * breiteste Zelle gepolstert, ohne Leerzeichen am Zeilenende.
 */
export function columns(rows: readonly (readonly string[])[]): string[] {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, width(cell));
    });
  }
  return rows.map((row) =>
    row
      .map((cell, i) =>
        i === row.length - 1 ? cell : cell + ' '.repeat((widths[i] ?? 0) - width(cell)),
      )
      .join('  ')
      .trimEnd(),
  );
}

/** Body ohne abschließende Zeilenumbrüche als Zeilen, mit Leerzeile davor; leer ergibt nichts. */
export function bodyBlock(body: string): string[] {
  const trimmed = body.replace(/\n+$/, '');
  return trimmed === '' ? [] : ['', ...trimmed.split('\n')];
}

/** Gesetzte Felder als `<label>  <wert>`, Labels auf das breiteste gepolstert. */
export function fieldRows(rows: readonly (readonly [string, string | undefined])[]): string[] {
  return columns(rows.filter((r): r is [string, string] => r[1] !== undefined && r[1] !== ''));
}

/** Zeilen als Text mit abschließendem Zeilenumbruch; ohne Zeilen leer. */
export const lines = (rows: readonly string[]): string => rows.map((row) => `${row}\n`).join('');

/** Ein Feld in `fields`, das nicht in `allowed` steht, ist `usage` mit der Liste der erlaubten. */
export function checkFields(fields: readonly string[], allowed: readonly string[]): void {
  const unknown = fields.filter((f) => !allowed.includes(f));
  if (unknown.length === 0) return;
  throw new BackeError(
    'usage',
    `Unbekannte Felder für --fields: ${unknown.map((f) => `»${f}«`).join(', ')}`,
    { hint: `Erlaubt: ${allowed.join(', ')}`, details: { unknown, allowed } },
  );
}

/** Nur die Felder `fields` von `obj`, in dieser Reihenfolge; ein unbekanntes Feld ist `usage`. */
export function pickFields(
  obj: Readonly<Record<string, unknown>>,
  fields: readonly string[],
  allowed: readonly string[],
): Record<string, unknown> {
  checkFields(fields, allowed);
  const out: Record<string, unknown> = {};
  for (const f of fields) if (obj[f] !== undefined) out[f] = obj[f];
  return out;
}

const HEADER_KEYS = ['backlog', 'project', 'sprint', 'repo'] as const;

/**
 * Kopfzeile einer gefilterten Liste (backe.md §2.14): `backlog=acme project=web/auth repo=webapp`.
 * Ohne einen Filter aus dem Kontext gibt es keine Kopfzeile, auch wenn `backlog` gesetzt ist.
 */
export function headerLine(header: Readonly<Record<string, string>>): string | undefined {
  const filters = HEADER_KEYS.filter((k) => k !== 'backlog' && header[k] !== undefined);
  if (filters.length === 0) return undefined;
  return HEADER_KEYS.filter((k) => header[k] !== undefined)
    .map((k) => `${k}=${header[k]}`)
    .join(' ');
}

/** Exit-Code eines Fehlers: der eines `BackeError`, sonst `1`. */
export function exitCodeOf(err: unknown): number {
  return err instanceof BackeError ? err.exitCode : 1;
}

/**
 * Fehler für stderr. Text: `Fehler: <message>`, optional `Hinweis: <hint>`. JSON: genau ein Objekt
 * `{"error":{code,message,hint?,details?}}`. Ein Fehler, der kein `BackeError` ist, wird `unexpected`
 * ohne Stacktrace.
 */
export function renderError(err: unknown, format: Format): string {
  const e =
    err instanceof BackeError
      ? err
      : new BackeError(
          'unexpected',
          `Unerwarteter Fehler: ${err instanceof Error ? err.message : String(err)}`,
        );
  if (format === 'json') {
    return json({ error: { code: e.code, message: e.message, hint: e.hint, details: e.details } });
  }
  return `Fehler: ${e.message}\n${e.hint === undefined ? '' : `Hinweis: ${e.hint}\n`}`;
}

/**
 * Ergebnis eines Writes für stdout. Text: `issue create` nur die neue ID, sonst die Zusammenfassung
 * der Operation; ohne Commit `unverändert: <zusammenfassung>`. JSON:
 * `{"commit":<sha|null>,"op":<aufgezeichnet>,"id"?:…,"notices"?:[…],"warnings"?:[…]}`.
 */
export function renderOutcome(o: WriteOutcome, format: Format, kind: 'create' | 'other'): string {
  if (format === 'json') {
    return json({
      commit: o.commit ?? null,
      op: o.op,
      id: o.id,
      notices: o.notices.length === 0 ? undefined : o.notices,
      warnings: o.warnings.length === 0 ? undefined : o.warnings,
    });
  }
  if (o.commit === undefined) return `unverändert: ${summarizeOp(o.op)}\n`;
  if (kind === 'create' && o.id !== undefined) return `${o.id}\n`;
  return `${summarizeOp(o.op)}\n`;
}

/** Hinweise und Warnungen für stderr: `Hinweis: …` je Notice, dann `Warnung: …`. */
export function renderNotices(notices: readonly Notice[], warnings: readonly string[]): string {
  return lines([
    ...notices.map((n) => `Hinweis: ${n.message}`),
    ...warnings.map((w) => `Warnung: ${w}`),
  ]);
}

/** Hinweise als Text-Zeilen für stderr. */
export const renderHints = (hints: readonly string[]): string =>
  lines(hints.map((h) => `Hinweis: ${h}`));

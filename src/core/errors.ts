import type { ZodError } from 'zod';

/**
 * Fehlercodes. `usage` heißt: der Aufruf passt nicht (fehlende oder sich ausschließende
 * Angaben, keine Identität). `validation` heißt: ein angegebener Wert oder Dateiinhalt verletzt
 * eine Regel (Format, Schema, Bereich).
 */
export type ErrorCode =
  | 'usage'
  | 'validation'
  | 'ambiguous'
  | 'not_found'
  | 'conflict'
  | 'verify'
  | 'sync'
  | 'unexpected';

export const EXIT_CODES: Readonly<Record<ErrorCode, number>> = {
  usage: 2,
  validation: 2,
  ambiguous: 2,
  not_found: 3,
  conflict: 4,
  verify: 5,
  sync: 6,
  unexpected: 1,
};

export class BackeError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, opts?: { hint?: string; details?: unknown }) {
    super(message);
    this.name = 'BackeError';
    this.code = code;
    if (opts?.hint !== undefined) this.hint = opts.hint;
    if (opts?.details !== undefined) this.details = opts.details;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}

/** Schemafehler als `validation`: je Issue eine Zeile `<datei>: <key.pfad>: <meldung>`. */
export function schemaError(file: string, error: ZodError, hint?: string): BackeError {
  const lines = error.issues.map(
    (issue) => `${file}: ${issue.path.join('.') || '(Wurzel)'}: ${issue.message}`,
  );
  return new BackeError('validation', lines.join('\n'), hint === undefined ? undefined : { hint });
}

import { type ParseError, parse, printParseErrorCode } from 'jsonc-parser';
import { BackeError } from '../core/errors.ts';

/** Liest JSONC (Kommentare und Trailing Commas erlaubt); Syntaxfehler → `validation` mit `file:zeile`. */
export function readJsonc(text: string, file: string): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(text, errors, { allowTrailingComma: true });
  const first = errors[0];
  if (first) {
    const line = text.slice(0, first.offset).split('\n').length;
    throw new BackeError('validation', `${file}:${line}: ${printParseErrorCode(first.error)}`);
  }
  return value;
}

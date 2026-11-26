/** HTTP-Helfer des UI-Servers: Fehler-Mapping und JSON-Antworten. Schreibt nie nach stdout. */
import type { OutgoingHttpHeaders, ServerResponse } from 'node:http';
import { BackeError } from '../core/errors.ts';
import { errorJson } from '../services/views.ts';
import type { ErrorJson } from './api.ts';
import type { Verdict } from './security.ts';

export const JSON_TYPE = 'application/json; charset=utf-8';

const STATUS_BY_EXIT_CODE: Readonly<Record<number, number>> = {
  2: 400,
  3: 404,
  4: 409,
  5: 422,
  6: 502,
  1: 500,
};

/** Exit-Code → Status: 2 → 400, 3 → 404, 4 → 409, 5 → 422, 6 → 502, 1 → 500; Fremdfehler 500. */
export function httpStatus(err: unknown): number {
  return err instanceof BackeError ? (STATUS_BY_EXIT_CODE[err.exitCode] ?? 500) : 500;
}

/**
 * Kompaktes JSON ohne Zeilenende, `Content-Length`, `Cache-Control: no-store`. Sicherheits-Header
 * setzt der Server vor dem Dispatch, nicht dieser Helfer.
 */
export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: OutgoingHttpHeaders = {},
): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': JSON_TYPE,
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

/**
 * Fehler-JSON einer Ablehnung der Zugangsprüfung, in der Form von `errorJson`; `hint` steht nur
 * drin, wenn es einen gibt.
 */
export function deniedJson(
  code: Extract<Verdict, { kind: 'deny' }>['code'],
  message: string,
  hint?: string,
): ErrorJson {
  return { error: { code, message, ...(hint === undefined ? {} : { hint }) } };
}

/** `errorJson(err)` mit `httpStatus(err)`; `headers` wie bei `sendJson`. */
export function sendError(
  res: ServerResponse,
  err: unknown,
  headers: OutgoingHttpHeaders = {},
): void {
  sendJson(res, httpStatus(err), errorJson(err), headers);
}

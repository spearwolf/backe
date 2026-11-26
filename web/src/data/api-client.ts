import type { ErrorJson } from '@backe/ui/api.ts';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** Fehler der API in der Form des Fehler-JSON; `status` 0 heißt: keine Antwort bekommen. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, hint?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    if (hint !== undefined) this.hint = hint;
    if (details !== undefined) this.details = details;
  }
}

function isErrorJson(v: unknown): v is ErrorJson {
  if (typeof v !== 'object' || v === null || !('error' in v)) return false;
  const e = (v as { error: unknown }).error;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}

// Lazy: jsdom kennt kein `fetch` zum Zeitpunkt des Imports garantiert, Tests reichen ein eigenes herein.
const defaultFetch: Fetch = (input, init) => globalThis.fetch(input, init);

/** Eine Anfrage und ihre Auswertung: keine Antwort heißt offline, nicht `ok` wird zum `ApiError`. */
async function request<T>(path: string, init: RequestInit | undefined, fetchFn: Fetch): Promise<T> {
  let res: Response;
  try {
    res = await (init === undefined ? fetchFn(path) : fetchFn(path, init));
  } catch (cause) {
    throw new ApiError(0, 'offline', cause instanceof Error ? cause.message : 'offline');
  }
  if (res.ok) return (await res.json()) as T;
  const body: unknown = await res.json().catch(() => undefined);
  if (isErrorJson(body)) {
    const { code, message, hint, details } = body.error;
    throw new ApiError(res.status, code, message, hint, details);
  }
  throw new ApiError(res.status, 'http', res.statusText);
}

export function getJson<T>(path: string, fetchFn: Fetch = defaultFetch): Promise<T> {
  return request<T>(path, undefined, fetchFn);
}

export function postJson<T>(
  path: string,
  body: unknown,
  fetchFn: Fetch = defaultFetch,
): Promise<T> {
  return request<T>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    fetchFn,
  );
}

export function putBytes<T>(path: string, bytes: Blob, fetchFn: Fetch = defaultFetch): Promise<T> {
  return request<T>(
    path,
    { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes },
    fetchFn,
  );
}

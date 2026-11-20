/**
 * JSON-Ansichten (backe.md §2.18): was CLI und MCP an Objekten ausgeben, damit beide dieselben
 * Bytes liefern. Alles hier ist rein, ohne I/O, und kennt weder Format noch Terminal; `undefined`
 * fällt erst beim Serialisieren weg.
 */
import { BackeError } from '../core/errors.ts';
import { KEY_ORDER } from '../core/schemas.ts';
import type { Notice } from '../ops/notice.ts';
import type { BatchOutcome } from './batch.ts';
import type { ContextInfo } from './context-info.ts';
import type { IssueListItem, IssueListResult } from './issue-list.ts';
import type { IssueDetail } from './issue-show.ts';
import type { NextOutcome } from './next.ts';
import type { WriteOpsOutcome, WriteOutcome } from './outcome.ts';
import type { locateRepo } from './repo-local.ts';
import type { showSprint } from './sprints.ts';
import type { SyncOutcome } from './sync.ts';

/** Felder eines Issues, wie sie in der Datei stehen; Grundlage für `--fields`. */
export const ISSUE_FIELDS: readonly string[] = KEY_ORDER.issue;

/** Erlaubte Felder für `issue list --fields`: Issue-Felder plus Baumtiefe und offene Abhängigkeiten. */
export const LIST_FIELDS: readonly string[] = [...ISSUE_FIELDS, 'depth', 'open_deps'];

/** Erlaubte Felder für `issue show --fields`: alles, was `issueDetailJson` liefern kann. */
export const SHOW_FIELDS: readonly string[] = [
  ...ISSUE_FIELDS,
  'body',
  'parents',
  'dependents',
  'children',
  'progress',
  'comments_count',
  'last_reason',
  'comments',
  'notices',
];

/** Erlaubte Felder für `next --fields`: Issue-Felder plus `open_deps`. */
export const NEXT_FIELDS: readonly string[] = [...ISSUE_FIELDS, 'open_deps'];

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

/** Eine leere Liste fällt im JSON weg. */
export const nonEmpty = <T>(list: readonly T[]): readonly T[] | undefined =>
  list.length === 0 ? undefined : list;

/**
 * Detailansicht als JSON-Objekt: die Felder des Issues (`depends_on` als Referenzen mit State und
 * Titel), dazu Body, Vorfahren, Abhängige, Sub-Issues, Fortschritt, Kommentare und Hinweise.
 * Leere Listen und ein leerer Body fehlen.
 */
export function issueDetailJson(d: IssueDetail): Record<string, unknown> {
  return {
    ...d.issue,
    depends_on: nonEmpty(d.dependsOn),
    body: d.body === '' ? undefined : d.body,
    parents: nonEmpty(d.parents),
    dependents: nonEmpty(d.dependents),
    children: nonEmpty(d.children),
    progress: d.progress,
    comments_count: d.commentsCount,
    last_reason: d.lastReason,
    comments: nonEmpty(d.comments),
    notices: nonEmpty(d.notices),
  };
}

/** Ein Listeneintrag als JSON: das Issue, `depth` in der Baumansicht, `open_deps` nur wenn wahr. */
export function issueListJson(item: IssueListItem): Record<string, unknown> {
  return {
    ...item.issue,
    depth: item.depth,
    open_deps: item.openDeps ? true : undefined,
  };
}

/** Der Kontext-Header, oder nichts, wenn kein Filter gesetzt ist. */
const headerJson = (
  header: Readonly<Record<string, string>>,
): Record<string, string> | undefined =>
  Object.keys(header).length === 0 ? undefined : { ...header };

/**
 * Ergebnis von `issue list` als JSON: `{context?, issues, truncated?, problems?}`. Mit `fields`
 * trägt jedes Issue nur diese Felder; ein unbekanntes ist `usage`.
 */
export function issueListResultJson(
  r: IssueListResult,
  fields?: readonly string[],
): Record<string, unknown> {
  const issues = r.items.map((item) => {
    const obj = issueListJson(item);
    return fields === undefined ? obj : pickFields(obj, fields, LIST_FIELDS);
  });
  return {
    context: headerJson(r.header),
    issues,
    truncated: r.truncated ? true : undefined,
    problems: nonEmpty(r.problems),
  };
}

/** Die TS-Namen, unter denen Services Details ablegen; nur sie werden umbenannt. */
const DETAIL_KEYS: Readonly<Record<string, string>> = {
  exitCode: 'exit_code',
  fromHash: 'from_hash',
  reasonFile: 'reason_file',
};

/**
 * Fehler-Details für JSON: nur die festen Keys aus `DETAIL_KEYS` werden snake_case, überall wo sie
 * als Key stehen. Alle anderen Keys (etwa Nutzer-Keys unter `props`) und alle Werte bleiben.
 */
function detailKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(detailKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      Object.hasOwn(DETAIL_KEYS, k) ? DETAIL_KEYS[k] : k,
      detailKeys(v),
    ]),
  );
}

/** Ein Fehler, der kein `BackeError` ist, wird `unexpected` ohne Stacktrace. */
export function toBackeError(err: unknown): BackeError {
  return err instanceof BackeError
    ? err
    : new BackeError(
        'unexpected',
        `Unerwarteter Fehler: ${err instanceof Error ? err.message : String(err)}`,
      );
}

/** Fehler als `{error:{code,message,hint?,details?}}`, ohne Stacktrace. */
export function errorJson(err: unknown): {
  error: { code: string; message: string; hint?: string | undefined; details?: unknown };
} {
  const e = toBackeError(err);
  const details = e.details === undefined ? undefined : detailKeys(e.details);
  return { error: { code: e.code, message: e.message, hint: e.hint, details } };
}

/**
 * Ergebnis eines Writes: `{commit:<sha|null>, op|ops, id?, notices?, warnings?}`; liefert der Write
 * mehrere Operationen, steht `ops` (Liste) statt `op`.
 */
export function outcomeJson(o: WriteOutcome | WriteOpsOutcome): Record<string, unknown> {
  return {
    commit: o.commit ?? null,
    ...('op' in o ? { op: o.op } : { ops: o.ops }),
    id: o.id,
    notices: nonEmpty(o.notices),
    warnings: nonEmpty(o.warnings),
  };
}

/** Ein Hinweis als Objekt; ein bloßer Text (etwa ein Verify-Grund) wird zu `{message}`. */
export function noticeJson(n: Notice | string): {
  code?: Notice['code'];
  message: string;
  ids?: string[];
} {
  return typeof n === 'string' ? { message: n } : n;
}

/** JSON mit snake_case-Keys: `user.can_write` statt des Service-Namens `canWrite`. */
export function contextJson(info: ContextInfo): Record<string, unknown> {
  const { canWrite, ...user } = info.user;
  return { ...info, user: { ...user, can_write: canWrite } };
}

/**
 * Ergebnis von `next`: Kontext, das Issue (mit `fields` gefiltert), `resumed`; bei einem Claim
 * zusätzlich `commit` und `attempts`; dazu Hinweise und Warnungen.
 */
export function nextJson(
  r: NextOutcome,
  extra: {
    claimed?: { commit: string | undefined; attempts: string[] };
    notices: Notice[];
    warnings: string[];
    fields?: readonly string[];
  },
): Record<string, unknown> {
  const issue = issueListJson({ issue: r.issue, openDeps: r.openDeps });
  return {
    context: headerJson(r.header),
    issue: extra.fields === undefined ? issue : pickFields(issue, extra.fields, NEXT_FIELDS),
    resumed: r.resumed,
    ...(extra.claimed === undefined
      ? {}
      : { commit: extra.claimed.commit ?? null, attempts: extra.claimed.attempts }),
    notices: nonEmpty(extra.notices),
    warnings: nonEmpty(extra.warnings),
  };
}

/** Ein Sprint mit seinen nach State gruppierten Issues. */
export function sprintShowJson(
  slug: string,
  r: Awaited<ReturnType<typeof showSprint>>,
): Record<string, unknown> {
  return {
    context: headerJson(r.header),
    slug,
    ...r.sprint,
    body: r.body === '' ? undefined : r.body,
    groups: r.groups.map((g) => ({ state: g.state, issues: g.items.map(issueListJson) })),
  };
}

/** Ergebnis eines Batches: Commit, Platzhalter-Zuordnung, Anzahl der Operationen. */
export function batchJson(r: BatchOutcome): Record<string, unknown> {
  return {
    commit: r.commit ?? null,
    refs: r.refs,
    ops: r.ops.length,
    notices: nonEmpty(r.notices),
    warnings: nonEmpty(r.warnings),
  };
}

/** Ergebnis einer Sync-Runde. */
export const syncJson = (out: SyncOutcome): Record<string, unknown> => ({
  fetched: out.fetched,
  replayed: out.replayed,
  conflicts: out.conflicts,
  pushed: out.pushed ?? null,
  rounds: out.rounds,
  skipped: out.skipped,
  notices: nonEmpty(out.notices),
});

/** Ein registriertes Repo mit lokalem Pfad (`repo where`). */
export function repoLocateJson(r: Awaited<ReturnType<typeof locateRepo>>): Record<string, unknown> {
  return {
    name: r.name,
    url: r.url,
    canonical: r.canonical,
    default_ref: r.defaultRef,
    path: r.path,
  };
}

/**
 * Ein Anhang (`attach get`): eine URL als `{name,url}`, eine Datei als `{name,file,size,path}`;
 * `path` überschreibt den Pfad, wenn die Datei woandershin kopiert wurde.
 */
export function attachmentJson(
  a: { name: string; url: string } | { name: string; file: string; path: string; size: number },
  path?: string,
): Record<string, unknown> {
  if ('url' in a) return { name: a.name, url: a.url };
  return { name: a.name, file: a.file, size: a.size, path: path ?? a.path };
}

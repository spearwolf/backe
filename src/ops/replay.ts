/**
 * Bausteine fürs Replay (backe.md §2.16.4): ID-Kollisionen umschreiben, Folgeschlüssel einer
 * abgelegten Einheit benennen und Vorbedingungen für »trotzdem anwenden« auf den aktuellen
 * Stand setzen. Rein, ohne I/O.
 */
import { BackeError } from '../core/errors.ts';
import { defaultRandomBytes, generateIssueId } from '../core/ids.ts';
import type { Comment } from '../core/schemas.ts';
import { commentsDir } from '../store/layout.ts';
import type { BacklogSnapshot, StoredEntity } from '../store/snapshot.ts';
import type { ApplyContext } from './apply.ts';
import type { Notice } from './notice.ts';
import { bodyHash, type Operation, referencedIds, substituteIds } from './operation.ts';

/**
 * Schreibt `issue.create`s um, deren ID im Stand schon vergeben ist. Erst gilt `map` (alt → neu
 * aus früheren Einheiten), dann kommen neue Kollisionen dazu; `map` wird dabei ergänzt, damit
 * spätere Einheiten dieselbe Zuordnung sehen. Frische IDs meiden den Stand, bereits vergebene
 * frische IDs und die IDs aller `issue.create`s der Einheit.
 */
export function rewriteCollisions(
  s: BacklogSnapshot,
  ops: readonly Operation[],
  map: Map<string, string>,
  ctx: Pick<ApplyContext, 'randomBytes'>,
): { ops: Operation[]; notices: Notice[] } {
  const reserved = new Set<string>(map.values());
  for (const op of ops) if (op.op === 'issue.create' && op.id !== undefined) reserved.add(op.id);
  const out: Operation[] = [];
  const notices: Notice[] = [];
  for (const op of ops) {
    let current = substituteIds(op, map);
    if (current.op === 'issue.create' && current.id !== undefined && s.issues.has(current.id)) {
      const old = current.id;
      const fresh = generateIssueId(s.config.id_prefix, {
        exists: (id) => s.issues.has(id) || reserved.has(id),
        issueCount: s.issues.size,
        randomBytes: ctx.randomBytes ?? defaultRandomBytes,
      });
      reserved.add(fresh);
      map.set(old, fresh);
      current = { ...current, id: fresh };
      notices.push({
        code: 'id_rewritten',
        message: `ID-Kollision: ${old} heißt jetzt ${fresh}`,
        ids: [old, fresh],
      });
    }
    out.push(current);
  }
  return { ops: out, notices };
}

/** `<kind>:<subjekt>` einer Operation, die keine Issue-Operation ist. */
function entityKeyOf(op: Operation): string | undefined {
  switch (op.op) {
    case 'project.create':
    case 'project.rm':
      return `project:${op.path}`;
    case 'project.mv':
      return `project:${op.from}`;
    case 'sprint.create':
    case 'sprint.close':
      return `sprint:${op.slug}`;
    case 'repo.add':
      return `repo:${op.name ?? op.url}`;
    case 'repo.rm':
      return `repo:${op.name}`;
    case 'user.add':
    case 'user.revoke_key':
    case 'user.rm':
      return `user:${op.handle}`;
    case 'entity.edit':
      return `${op.kind}:${op.key}`;
    default:
      return undefined;
  }
}

/**
 * Schlüssel, die eine abgelegte Einheit belastet: alle Issue-IDs ihrer Operationen, die IDs, die
 * ihre `issue.create`s vergeben haben (`created`), und je Nicht-Issue-Operation
 * `<kind>:<subjekt>`. Ohne Duplikate, in Reihenfolge des ersten Auftretens.
 */
export function taintKeys(ops: readonly Operation[], created: readonly string[]): string[] {
  const keys = new Set<string>();
  const entityKeys: string[] = [];
  for (const op of ops) {
    for (const id of referencedIds(op)) keys.add(id);
    const entityKey = entityKeyOf(op);
    if (entityKey !== undefined) entityKeys.push(entityKey);
  }
  for (const id of created) keys.add(id);
  for (const key of entityKeys) keys.add(key);
  return [...keys];
}

type Change<T> = { from: T | null; to: T | null };

/** Setzt `from` jeder Änderung auf den Ist-Wert aus `current` (fehlend = `null`). */
function rebaseChanges<T extends Change<unknown>>(
  changes: Readonly<Record<string, T>>,
  current: Readonly<Record<string, unknown>>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(changes).map(([field, change]) => [
      field,
      { ...change, from: Object.hasOwn(current, field) ? current[field] : null },
    ]),
  );
}

function rebaseEdit(s: BacklogSnapshot, op: Extract<Operation, { op: 'issue.edit' }>): Operation {
  const issue = s.issues.get(op.id);
  if (issue === undefined) return op;
  const data = issue.data as Record<string, unknown>;
  let out = op;
  if (op.set !== undefined) {
    out = { ...out, set: rebaseChanges(op.set, data) as typeof op.set };
  }
  if (op.props !== undefined) {
    out = { ...out, props: rebaseChanges(op.props, issue.data.props ?? {}) as typeof op.props };
  }
  if (op.body !== undefined) {
    out = { ...out, body: { ...op.body, from_hash: bodyHash(issue.body) } };
  }
  return out;
}

function rebaseEntityEdit(
  s: BacklogSnapshot,
  op: Extract<Operation, { op: 'entity.edit' }>,
): Operation {
  const entity: StoredEntity<unknown> | undefined = s[`${op.kind}s`].get(op.key);
  if (entity === undefined) return op;
  let out = op;
  if (op.set !== undefined) {
    out = { ...out, set: rebaseChanges(op.set, entity.data as Record<string, unknown>) };
  }
  if (op.body !== undefined) {
    out = { ...out, body: { ...op.body, from_hash: bodyHash(entity.body) } };
  }
  return out;
}

const RESUMABLE = ['blocked', 'on_hold'] as const;
const REOPENABLE = ['done', 'cancelled', 'rejected'] as const;

/**
 * Setzt die Vorbedingungen einer Operation auf den Ist-Wert im Stand `s` (»trotzdem anwenden«):
 * `set.*.from` und `props.*.from` von `issue.edit` und `entity.edit`, die Body-Hashes beider,
 * `from` von `issue.move`, `issue.resume`, `issue.reopen` und `issue.rank` sowie der Hash von
 * `comment.edit` (aus `comments`, nur wenn der Kommentar dort geladen ist). Alles andere, auch
 * eine Operation, deren Ziel fehlt, kommt unverändert zurück; die Invarianten prüft erst das Anwenden.
 */
export function rebaseOp(
  s: BacklogSnapshot,
  op: Operation,
  comments?: ReadonlyMap<string, readonly StoredEntity<Comment>[]>,
): Operation {
  switch (op.op) {
    case 'issue.edit':
      return rebaseEdit(s, op);
    case 'entity.edit':
      return rebaseEntityEdit(s, op);
    case 'issue.move': {
      const issue = s.issues.get(op.id);
      return issue === undefined ? op : { ...op, from: issue.data.state };
    }
    case 'issue.resume': {
      const state = s.issues.get(op.id)?.data.state;
      return state !== undefined && (RESUMABLE as readonly string[]).includes(state)
        ? { ...op, from: state as (typeof RESUMABLE)[number] }
        : op;
    }
    case 'issue.reopen': {
      const state = s.issues.get(op.id)?.data.state;
      return state !== undefined && (REOPENABLE as readonly string[]).includes(state)
        ? { ...op, from: state as (typeof REOPENABLE)[number] }
        : op;
    }
    case 'issue.rank': {
      const issue = s.issues.get(op.id);
      return issue === undefined ? op : { ...op, from: issue.data.rank ?? null };
    }
    case 'comment.edit': {
      const path = `${commentsDir(op.id)}/${op.file}`;
      const found = comments?.get(op.id)?.find((c) => c.path === path);
      return found === undefined ? op : { ...op, from_hash: bodyHash(found.body) };
    }
    default:
      return op;
  }
}

/** Eine Regelverletzung des Anwendens: `BackeError` mit `details.reason`. */
export function isViolation(err: unknown): err is BackeError {
  if (!(err instanceof BackeError)) return false;
  const details = err.details;
  return (
    typeof details === 'object' &&
    details !== null &&
    typeof (details as { reason?: unknown }).reason === 'string'
  );
}

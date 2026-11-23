/**
 * Kommentare eines Issues (backe.md §2.7): anlegen, chronologisch listen, per Dateiname oder
 * Index ansprechen, bearbeiten und löschen. Dass nur der Autor ändert, erzwingt die Ops-Schicht.
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { bodyHash } from '../ops/operation.ts';
import { listComments } from '../store/snapshot.ts';
import { m } from './comments.messages.ts';
import { type CommentView, commentView } from './issue-show.ts';
import { type WriteOutcome, writeOp } from './outcome.ts';
import { openSnapshot, resolveIssueRef } from './read.ts';
import type { WriteDeps } from './write.ts';

export type { CommentView };

export function addComment(
  ctx: ResolvedContext,
  ref: string,
  body: string,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  if (body.trim() === '') throw new BackeError('validation', m.commentEmpty);
  return writeOp(ctx, (s) => ({ op: 'comment.add', id: resolveIssueRef(s, ref), body }), deps);
}

export async function listIssueComments(
  ctx: ResolvedContext,
  ref: string,
  opts: { limit?: number } = {},
): Promise<CommentView[]> {
  const { limit } = opts;
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1)) {
    throw new BackeError('validation', m.invalidLimit(limit), {
      hint: m.limitExpects,
    });
  }
  const { root, snapshot: s } = await openSnapshot(ctx);
  const all = (await listComments(root, resolveIssueRef(s, ref))).map(commentView);
  return limit === undefined ? all : all.slice(-limit);
}

/** Dateiname oder 1-basierter Index in die chronologische Liste; sonst `not_found`. */
export function resolveCommentRef(comments: readonly CommentView[], ref: string): string {
  const byFile = comments.find((c) => c.file === ref);
  if (byFile !== undefined) return byFile.file;
  if (/^[1-9]\d*$/.test(ref)) {
    const byIndex = comments[Number(ref) - 1];
    if (byIndex !== undefined) return byIndex.file;
  }
  throw new BackeError('not_found', m.commentNotFound(ref), {
    hint: m.commentRefHint,
  });
}

/**
 * Löst Issue und Kommentar auf und liefert den gelesenen Stand. Das Lesen geschieht vor dem
 * Write-Lock: `derive` bekommt keine Kommentare. Ändert jemand den Kommentar dazwischen, lehnt
 * die Ops-Schicht unter dem Lock wegen des abweichenden `from_hash` ab (Konflikt), statt still
 * zu überschreiben; fremde Kommentare lehnt sie ebenfalls dort ab.
 */
async function target(ctx: ResolvedContext, ref: string, comment: string) {
  const { root, snapshot: s } = await openSnapshot(ctx);
  const id = resolveIssueRef(s, ref);
  const stored = await listComments(root, id);
  const file = resolveCommentRef(stored.map(commentView), comment);
  const found = stored.find((c) => commentView(c).file === file);
  return { id, file, body: found?.body ?? '' };
}

/** Bearbeitet einen Kommentar; Vorbedingung ist der vor dem Lock gelesene Stand (siehe `target`). */
export async function editComment(
  ctx: ResolvedContext,
  ref: string,
  comment: string,
  body: string,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  if (body.trim() === '') throw new BackeError('validation', m.commentEmpty);
  const t = await target(ctx, ref, comment);
  return writeOp(
    ctx,
    () => ({
      op: 'comment.edit',
      id: t.id,
      file: t.file,
      from_hash: bodyHash(t.body),
      body,
    }),
    deps,
  );
}

/** Löscht einen Kommentar; Auflösung wie bei `editComment`, die Ops-Schicht prüft den Autor unter dem Lock. */
export async function deleteComment(
  ctx: ResolvedContext,
  ref: string,
  comment: string,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  const t = await target(ctx, ref, comment);
  return writeOp(ctx, () => ({ op: 'comment.delete', id: t.id, file: t.file }), deps);
}

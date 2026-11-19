/**
 * Kommentare eines Issues (backe.md §2.7): anlegen, chronologisch listen, per Dateiname oder
 * Index ansprechen, bearbeiten und löschen. Dass nur der Autor ändert, erzwingt die Ops-Schicht.
 */
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { bodyHash } from '../ops/operation.ts';
import { listComments } from '../store/snapshot.ts';
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
  if (body.trim() === '') throw new BackeError('validation', 'Kommentar ist leer');
  return writeOp(ctx, (s) => ({ op: 'comment.add', id: resolveIssueRef(s, ref), body }), deps);
}

export async function listIssueComments(
  ctx: ResolvedContext,
  ref: string,
  opts: { limit?: number } = {},
): Promise<CommentView[]> {
  const { limit } = opts;
  if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1)) {
    throw new BackeError('validation', `Ungültiges Limit: »${limit}«`, {
      hint: 'erwartet eine ganze Zahl ab 1',
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
  throw new BackeError('not_found', `Kommentar »${ref}« nicht gefunden`, {
    hint: 'Dateiname oder Nummer ab 1 aus der Kommentarliste angeben',
  });
}

/**
 * Löst Issue und Kommentar auf und liefert den gelesenen Stand. Die Ops-Schicht prüft unter
 * dem Write-Lock gegen diesen Stand (`from_hash`) und lehnt fremde Kommentare ab.
 */
async function target(ctx: ResolvedContext, ref: string, comment: string) {
  const { root, snapshot: s } = await openSnapshot(ctx);
  const id = resolveIssueRef(s, ref);
  const stored = await listComments(root, id);
  const file = resolveCommentRef(stored.map(commentView), comment);
  const found = stored.find((c) => commentView(c).file === file);
  return { file, body: found?.body ?? '' };
}

export async function editComment(
  ctx: ResolvedContext,
  ref: string,
  comment: string,
  body: string,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  if (body.trim() === '') throw new BackeError('validation', 'Kommentar ist leer');
  const t = await target(ctx, ref, comment);
  return writeOp(
    ctx,
    (s) => ({
      op: 'comment.edit',
      id: resolveIssueRef(s, ref),
      file: t.file,
      from_hash: bodyHash(t.body),
      body,
    }),
    deps,
  );
}

export async function deleteComment(
  ctx: ResolvedContext,
  ref: string,
  comment: string,
  deps?: WriteDeps,
): Promise<WriteOutcome> {
  const t = await target(ctx, ref, comment);
  return writeOp(
    ctx,
    (s) => ({ op: 'comment.delete', id: resolveIssueRef(s, ref), file: t.file }),
    deps,
  );
}

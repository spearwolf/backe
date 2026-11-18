/**
 * Kommentare und Anhänge (backe.md §2.7, §2.8, §2.13): `comment.add`, `comment.edit`,
 * `comment.delete`, `attach.add` und `attach.rm`. Kommentare ändert nur ihr Autor.
 */
import { BackeError } from '../core/errors.ts';
import type { Comment, Issue } from '../core/schemas.ts';
import { canonicalBody, serializeEntityFile } from '../store/frontmatter.ts';
import { attachmentsDir, commentsDir } from '../store/layout.ts';
import type { StoredEntity } from '../store/snapshot.ts';
import type { Draft } from './draft.ts';
import { violation } from './invariants.ts';
import { bodyHash, type OpOf } from './operation.ts';

export function commentAdd(d: Draft, op: OpOf<'comment.add'>): OpOf<'comment.add'> {
  if (op.body.trim() === '') {
    throw violation('schema', 'Ein Kommentar braucht einen Text');
  }
  const file = d.addComment(op.id, {}, op.body, op.file);
  return { ...op, file };
}

/** Der Kommentar des Akteurs; geladen sein müssen die Kommentare des Issues (`commentsNeeded`). */
function ownComment(d: Draft, id: string, file: string): StoredEntity<Comment> {
  d.issue(id);
  const loaded = d.ctx.comments?.get(id);
  if (loaded === undefined) {
    throw new BackeError('unexpected', `Kommentare von ${id} wurden nicht geladen`);
  }
  const path = `${commentsDir(id)}/${file}`;
  const found = loaded.find((c) => c.path === path);
  if (found === undefined) {
    throw violation('missing_ref', `Kommentar ${path} nicht gefunden`, { ids: [id] });
  }
  if (found.data.author !== d.ctx.actor) {
    throw violation(
      'policy',
      `Kommentar ${file} gehört ${found.data.author}, nicht ${d.ctx.actor}`,
    );
  }
  return found;
}

export function commentEdit(d: Draft, op: OpOf<'comment.edit'>): OpOf<'comment.edit'> {
  const comment = ownComment(d, op.id, op.file);
  if (comment.body === canonicalBody(op.body)) return op;
  if (bodyHash(comment.body) !== op.from_hash) {
    throw violation('precondition', `${op.id}: Kommentar ${op.file} wurde inzwischen geändert`, {
      ids: [op.id],
    });
  }
  d.putFile(
    comment.path,
    serializeEntityFile('comment', comment.data as Record<string, unknown>, op.body, comment.extra),
  );
  return op;
}

export function commentDelete(d: Draft, op: OpOf<'comment.delete'>): OpOf<'comment.delete'> {
  const comment = ownComment(d, op.id, op.file);
  d.putFile(comment.path, null);
  return op;
}

export function attachAdd(d: Draft, op: OpOf<'attach.add'>): OpOf<'attach.add'> {
  const issue = d.issue(op.id).data;
  const list = issue.attachments ?? [];
  if (list.some((a) => a.name === op.name)) {
    throw violation('exists', `${op.id}: Anhang "${op.name}" existiert bereits`, { ids: [op.id] });
  }
  let entry: NonNullable<Issue['attachments']>[number];
  if (op.file !== undefined) {
    const { content } = op;
    if (content === undefined) {
      throw new BackeError('unexpected', `attach.add für "${op.file}" ohne Dateiinhalt`);
    }
    const max = d.config.attachments.max_bytes;
    if (max !== null && content.byteLength > max) {
      throw violation(
        'too_large',
        `Anhang "${op.file}" hat ${content.byteLength} Bytes, erlaubt sind ${max}`,
        {
          hint: 'Grenze attachments.max_bytes anheben oder attachments.lfs aktivieren (backe.md §2.8).',
        },
      );
    }
    d.putFile(`${attachmentsDir(op.id)}/${op.file}`, content);
    entry = { name: op.name, file: op.file };
  } else {
    entry = { name: op.name, url: op.url as string };
  }
  d.putIssue(op.id, { ...issue, attachments: [...list, entry] });
  return op;
}

export function attachRm(d: Draft, op: OpOf<'attach.rm'>): OpOf<'attach.rm'> {
  const issue = d.issue(op.id).data;
  const list = issue.attachments ?? [];
  const entry = list.find((a) => a.name === op.name);
  if (entry === undefined) {
    throw violation('missing_ref', `${op.id}: Anhang "${op.name}" nicht gefunden`, {
      ids: [op.id],
    });
  }
  const rest = list.filter((a) => a !== entry);
  d.putIssue(op.id, { ...issue, attachments: rest.length > 0 ? rest : undefined });
  if (entry.file !== undefined) d.putFile(`${attachmentsDir(op.id)}/${entry.file}`, null);
  return op;
}

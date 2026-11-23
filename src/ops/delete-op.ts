/**
 * `issue.delete` (backe.md §2.6 »Letzter Blocker gelöscht«, §2.17): Sub-Issues und Verweise auf
 * die gelöschten Issues aufräumen, bevor deren Verzeichnisse entfallen.
 */

import type { Issue } from '../core/schemas.ts';
import { m } from './delete-op.messages.ts';
import type { Draft } from './draft.ts';
import { graphOf } from './graph.ts';
import { violation } from './invariants.ts';
import type { OpOf } from './operation.ts';

/** Die Wurzel und, mit `recursive`, alle Nachfahren; iterativ, ohne Rekursion. */
function deletedSet(d: Draft, id: string, recursive: boolean): Set<string> {
  const doomed = new Set([id]);
  if (!recursive) return doomed;
  const { children } = graphOf(d.snapshot);
  const stack = [id];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    for (const child of children.get(next) ?? []) {
      if (doomed.has(child)) continue;
      doomed.add(child);
      stack.push(child);
    }
  }
  return doomed;
}

function without(list: readonly string[] | undefined, drop: ReadonlySet<string>) {
  const rest = (list ?? []).filter((x) => !drop.has(x));
  return rest.length > 0 ? rest : undefined;
}

export function issueDelete(d: Draft, op: OpOf<'issue.delete'>): OpOf<'issue.delete'> {
  d.issue(op.id);
  const direct = [...(graphOf(d.snapshot).children.get(op.id) ?? [])].sort();
  if (direct.length > 0 && op.children === undefined) {
    throw violation('has_children', m.hasChildren(op.id, direct.join(', ')), {
      ids: direct,
      hint: m.hasChildrenHint,
    });
  }
  const doomed = deletedSet(d, op.id, op.children === 'recursive');

  // Überlebende Issues mit geändertem Stand; ein Issue kann mehrfach betroffen sein.
  const updated = new Map<string, Issue>();
  if (op.children === 'orphan') {
    for (const child of direct) {
      updated.set(child, { ...d.issue(child).data, parent: undefined });
    }
  }
  const referencing: string[] = [];
  for (const [id, { data }] of d.snapshot.issues) {
    if (doomed.has(id)) continue;
    const refs = [...(data.blocked_by ?? []), ...(data.depends_on ?? [])];
    if (refs.some((r) => doomed.has(r))) referencing.push(id);
  }
  if (referencing.length > 0 && op.force !== true) {
    throw violation(
      'references',
      m.stillReferenced([...doomed].sort().join(', '), referencing.join(', ')),
      { ids: referencing, hint: m.stillReferencedHint },
    );
  }

  const onHold: { id: string; blockers: string[] }[] = [];
  for (const id of referencing) {
    const cur = updated.get(id) ?? d.issue(id).data;
    const blockers = (cur.blocked_by ?? []).filter((b) => doomed.has(b)).sort();
    const next: Issue = {
      ...cur,
      blocked_by: without(cur.blocked_by, doomed),
      depends_on: without(cur.depends_on, doomed),
    };
    if (cur.state === 'blocked' && next.blocked_by === undefined) {
      next.state = 'on_hold';
      onHold.push({ id, blockers });
    }
    updated.set(id, next);
  }

  const files: Record<string, string> = {};
  for (const [id, next] of updated) d.putIssue(id, next);
  for (const { id, blockers } of onHold) {
    files[id] = d.addComment(
      id,
      { kind: 'transition', from: 'blocked', to: 'on_hold' },
      `Blocker ${blockers.join(', ')} gelöscht`,
      op.blocker_comments?.[id],
    );
  }
  if (onHold.length > 0) {
    const ids = onHold.map((h) => h.id);
    d.notice({
      code: 'blocker_deleted',
      message: m.lastBlockerDeleted(op.id, ids.join(', ')),
      ids,
    });
  }
  for (const id of [...doomed].sort()) d.removeIssue(id);

  const { blocker_comments: _, ...rest } = op;
  return onHold.length > 0 ? { ...rest, blocker_comments: files } : rest;
}

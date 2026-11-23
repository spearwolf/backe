import type { Issue } from '../core/schemas.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { isUnblockable } from './graph.ts';
import { m } from './notice.messages.ts';

/** Hinweise, die eine Operation neben ihrem Ergebnis meldet. */
export type NoticeCode =
  | 'open_children'
  | 'forced_done'
  | 'blocker_deleted'
  | 'settled_dependency'
  | 'unblockable'
  | 'id_rewritten'
  | 'claim_local'
  | 'hub_created'
  | 'claim_lost'
  | 'unknown_repo';

export type Notice = { code: NoticeCode; message: string; ids: string[] };

/** Hinweis auf abgebrochene oder abgelehnte `depends_on` eines Issues (backe.md §2.22). */
export function settledDependencyNotice(s: BacklogSnapshot, issue: Issue): Notice | undefined {
  const settled = (issue.depends_on ?? []).filter((d) => {
    const state = s.issues.get(d)?.data.state;
    return state === 'cancelled' || state === 'rejected';
  });
  if (settled.length === 0) return undefined;
  return {
    code: 'settled_dependency',
    message: m.settledDependency(issue.id, settled.join(', ')),
    ids: settled,
  };
}

/**
 * Hinweis auf entblockbare Issues (backe.md §2.6): alle Blocker erledigt; war ein Blocker
 * `cancelled` oder `rejected` statt `done`, steht das ausdrücklich dabei. Nicht entblockbare
 * Issues der Eingabe werden ignoriert.
 */
export function unblockableNotice(
  s: BacklogSnapshot,
  issues: readonly Issue[],
): Notice | undefined {
  const unblockable = issues.filter((i) => isUnblockable(s, i.id));
  if (unblockable.length === 0) return undefined;
  const parts = unblockable.map((i) => {
    const odd = (i.blocked_by ?? []).flatMap((b) => {
      const state = s.issues.get(b)?.data.state;
      return state === 'cancelled' || state === 'rejected' ? [`${b} (${state})`] : [];
    });
    return odd.length > 0 ? m.notDone(i.id, odd.join(', ')) : i.id;
  });
  return {
    code: 'unblockable',
    message: m.allBlockersSettled(parts.join('; ')),
    ids: unblockable.map((i) => i.id),
  };
}

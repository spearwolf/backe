/**
 * Erlaubte Zustandswechsel eines Issues (ui.md §2.8): dieselbe Prüfung wie der Server, nämlich
 * `planTransition` aus BK, damit das Menü nur anbietet, was `issue move`, `resume` und `reopen`
 * annehmen.
 */
import { ALL_STATES, isSettled, planTransition, type State } from '@backe/core/state.ts';
import type { IssueJson, ToolArgs } from '@backe/ui/api.ts';

export type StateTool = 'issue_move' | 'issue_resume' | 'issue_reopen';
export type StateAction = { to: State; tool: StateTool; needsBlockedBy: boolean };

/** Ziele von `issue_reopen`: die Hauptlinie ohne `done` (BK §2.6). */
const REOPEN_TARGETS: readonly State[] = ['backlog', 'todo', 'in_progress', 'review'];

/** Platzhalter, damit `planTransition` für `blocked` nicht an der fehlenden Blocker-ID scheitert. */
const PLACEHOLDER_BLOCKER = ['_'];

function allowed(issue: IssueJson, to: State, strict: boolean): boolean {
  try {
    return (
      planTransition(issue, 'move', {
        to,
        strict,
        ...(to === 'blocked' ? { blockedBy: PLACEHOLDER_BLOCKER } : {}),
      }) !== null
    );
  } catch {
    return false;
  }
}

/** Erlaubte Wechsel in `ALL_STATES`-Reihenfolge, geprüft mit `planTransition` (strict aus der Config). */
export function stateActions(issue: IssueJson, strict: boolean): StateAction[] {
  if (isSettled(issue.state)) {
    return REOPEN_TARGETS.map((to) => ({ to, tool: 'issue_reopen', needsBlockedBy: false }));
  }
  const resumeTo =
    (issue.state === 'blocked' || issue.state === 'on_hold') && issue.paused_from !== undefined
      ? issue.paused_from
      : undefined;
  const actions: StateAction[] = [];
  for (const to of ALL_STATES) {
    if (to === resumeTo) {
      actions.push({ to, tool: 'issue_resume', needsBlockedBy: false });
    } else if (allowed(issue, to, strict)) {
      actions.push({ to, tool: 'issue_move', needsBlockedBy: to === 'blocked' });
    }
  }
  return actions;
}

export type StateCall =
  | { name: 'issue_move'; args: ToolArgs['issue_move'] }
  | { name: 'issue_resume'; args: ToolArgs['issue_resume'] }
  | { name: 'issue_reopen'; args: ToolArgs['issue_reopen'] };

/** Was ein Zustandswechsel außer dem Ziel mitbringt: Begründung, Blocker, `force` (Sub-Issues offen). */
export type StateExtra = { reason?: string; blockedBy?: string[]; force?: boolean };

export function stateCall(id: string, action: StateAction, extra: StateExtra = {}): StateCall {
  const reason = extra.reason === undefined ? {} : { reason: extra.reason };
  switch (action.tool) {
    case 'issue_resume':
      return { name: 'issue_resume', args: { id, ...reason } };
    case 'issue_reopen':
      return { name: 'issue_reopen', args: { id, to: action.to, ...reason } };
    case 'issue_move':
      return {
        name: 'issue_move',
        args: {
          id,
          to: action.to,
          ...reason,
          ...(extra.blockedBy === undefined ? {} : { blocked_by: extra.blockedBy }),
          ...(extra.force === undefined ? {} : { force: extra.force }),
        },
      };
  }
}

/** IDs der offenen Sub-Issues, wenn der Server `done` mit `details.reason: 'open_children'` ablehnte. */
export function openChildrenOf(error: unknown): string[] | undefined {
  const details = (error as { details?: unknown } | null)?.details;
  if (typeof details !== 'object' || details === null) return undefined;
  const { reason, ids } = details as { reason?: unknown; ids?: unknown };
  if (reason !== 'open_children' || !Array.isArray(ids)) return undefined;
  const list = ids.filter((x): x is string => typeof x === 'string');
  return list.length > 0 ? list : undefined;
}

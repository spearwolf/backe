/**
 * Zustandsübergänge und Claim (backe.md §2.6, §2.16.5): `issue.move`, `issue.resume`,
 * `issue.reopen` und `issue.claim`. Welcher Übergang erlaubt ist, entscheidet `planTransition`;
 * hier kommen Vorbedingung, offene Sub-Issues, Belegung und der Transition-Kommentar dazu.
 */
import { BackeError } from '../core/errors.ts';
import type { Issue } from '../core/schemas.ts';
import {
  planTransition,
  type State,
  type StateFields,
  type TransitionKind,
  type TransitionOpts,
} from '../core/state.ts';
import type { Draft } from './draft.ts';
import { isClaimable, openChildren } from './graph.ts';
import { violation } from './invariants.ts';
import { expectFrom, settle } from './issue-ops.ts';
import type { OpOf } from './operation.ts';

/** `planTransition` mit Fehlern als `transition`-Verletzung; `null` heißt: nichts zu tun. */
function plan(
  d: Draft,
  cur: Issue,
  kind: TransitionKind,
  opts: Omit<TransitionOpts, 'strict'>,
): StateFields | null {
  try {
    return planTransition(cur, kind, { ...opts, strict: d.config.workflow.strict });
  } catch (err) {
    if (err instanceof BackeError) throw violation('transition', err.message, { ids: [cur.id] });
    throw err;
  }
}

/**
 * Schreibt den neuen Zustand (`paused_from` und `blocked_by` kommen allein aus dem Plan) und, mit
 * `reason`, den Transition-Kommentar des Akteurs. Gibt dessen Dateinamen zurück.
 */
function commit(
  d: Draft,
  cur: Issue,
  next: StateFields,
  extra: Partial<Issue>,
  reason: { text?: string; file?: string },
): string | undefined {
  d.putIssue(cur.id, {
    ...cur,
    ...extra,
    state: next.state,
    // `planTransition` setzt nur Hauptlinien-Zustände als Herkunft; das Schema prüft es erneut.
    paused_from: next.paused_from as Issue['paused_from'],
    blocked_by: next.blocked_by,
  });
  if (reason.text === undefined) return undefined;
  return d.addComment(
    cur.id,
    { kind: 'transition', from: cur.state, to: next.state },
    reason.text,
    reason.file,
  );
}

function withReasonFile<T extends { reason_file?: string }>(op: T, file: string | undefined): T {
  return file === undefined ? op : { ...op, reason_file: file };
}

/** Offene Sub-Issues beim Abschließen: `done` verlangt `force`, `cancelled`/`rejected` warnen. */
function checkOpenChildren(d: Draft, id: string, to: State, force: boolean): void {
  if (to !== 'done' && to !== 'cancelled' && to !== 'rejected') return;
  const open = openChildren(d.snapshot, id);
  if (open.length === 0) return;
  const list = open.join(', ');
  if (to !== 'done') {
    d.notice({
      code: 'open_children',
      message: `${id} ist ${to}, hat aber noch offene Sub-Issues: ${list}`,
      ids: open,
    });
    return;
  }
  if (!force) {
    throw violation('open_children', `${id} hat noch offene Sub-Issues: ${list}`, {
      ids: open,
      hint: 'Mit --force trotzdem abschließen, oder erst die Sub-Issues erledigen.',
    });
  }
  d.notice({
    code: 'forced_done',
    message: `${id} mit force auf done gesetzt, offene Sub-Issues bleiben: ${list}`,
    ids: open,
  });
}

export function issueMove(d: Draft, op: OpOf<'issue.move'>): OpOf<'issue.move'> {
  const cur = d.issue(op.id).data;
  if (!settle(op.id, 'state', cur.state, { from: op.from, to: op.to })) return op;
  const next = plan(d, cur, 'move', {
    to: op.to,
    ...(op.blocked_by === undefined ? {} : { blockedBy: op.blocked_by }),
  });
  if (next === null) return op;
  checkOpenChildren(d, op.id, next.state, op.force === true);
  const file = commit(d, cur, next, {}, { text: op.reason, file: op.reason_file });
  return withReasonFile(op, file);
}

export function issueResume(d: Draft, op: OpOf<'issue.resume'>): OpOf<'issue.resume'> {
  const cur = d.issue(op.id).data;
  expectFrom(op.id, 'state', cur.state, op.from);
  const next = plan(d, cur, 'resume', {});
  if (next === null) return op;
  const file = commit(d, cur, next, {}, { text: op.reason, file: op.reason_file });
  return withReasonFile(op, file);
}

export function issueReopen(d: Draft, op: OpOf<'issue.reopen'>): OpOf<'issue.reopen'> {
  const cur = d.issue(op.id).data;
  const to = op.to ?? 'backlog';
  const recorded = { ...op, to };
  if (!settle(op.id, 'state', cur.state, { from: op.from, to })) return recorded;
  const next = plan(d, cur, 'reopen', { to });
  if (next === null) return recorded;
  const file = commit(d, cur, next, {}, { text: op.reason, file: op.reason_file });
  return withReasonFile(recorded, file);
}

export function issueClaim(d: Draft, op: OpOf<'issue.claim'>): OpOf<'issue.claim'> {
  const cur = d.issue(op.id).data;
  const { actor } = d.ctx;
  const check = isClaimable(d.snapshot, op.id, actor);
  if (!check.ok) {
    const list = check.ids.join(', ');
    if (check.reason === 'occupied') {
      throw violation(
        'occupied',
        `${op.id} liegt unter ${list}, das schon jemand anderes bearbeitet`,
        { ids: check.ids },
      );
    }
    const why = check.ids.length > 0 ? `, wartet auf ${list}` : '';
    throw violation('not_claimable', `${op.id} ist nicht claimbar (State ${cur.state})${why}`, {
      ids: check.ids,
    });
  }
  const next = plan(d, cur, 'claim', {});
  if (next === null) return op;
  commit(d, cur, next, { assignee: actor }, {});
  return op;
}

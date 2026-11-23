import { BackeError } from './errors.ts';
import { m } from './state.messages.ts';

export type State =
  | 'backlog'
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'blocked'
  | 'on_hold'
  | 'cancelled'
  | 'rejected';

export const MAIN_LINE: readonly State[] = ['backlog', 'todo', 'in_progress', 'review', 'done'];
export const PAUSED: readonly State[] = ['blocked', 'on_hold'];

const ALL_STATES: readonly State[] = [...MAIN_LINE, ...PAUSED, 'cancelled', 'rejected'];

export interface StateFields {
  state: State;
  paused_from?: State;
  blocked_by?: string[];
}

export type TransitionKind = 'move' | 'resume' | 'reopen' | 'claim';

export interface TransitionOpts {
  to?: State;
  strict: boolean;
  blockedBy?: string[];
}

/** »Erledigt« im Sinn von backe.md §2.6/§2.22: done, cancelled oder rejected. */
export function isSettled(s: State): boolean {
  return s === 'done' || s === 'cancelled' || s === 'rejected';
}

export function normalizeStateInput(s: string): State {
  const snake = s.trim().replaceAll('-', '_');
  const found = ALL_STATES.find((st) => st === snake);
  if (found === undefined) {
    throw new BackeError('validation', m.unknownState(s), {
      hint: m.unknownStateHint(ALL_STATES.join(', ')),
    });
  }
  return found;
}

const isMain = (s: State): boolean => MAIN_LINE.includes(s);
const isPaused = (s: State): boolean => PAUSED.includes(s);

function isNeighbour(a: State, b: State): boolean {
  return Math.abs(MAIN_LINE.indexOf(a) - MAIN_LINE.indexOf(b)) === 1;
}

function invalid(cur: State, to: State, why: string): BackeError {
  return new BackeError('validation', m.transitionNotAllowed(cur, to, why));
}

function plan(cur: StateFields, opts: TransitionOpts): StateFields | null {
  const { to } = opts;
  if (to === undefined) throw new BackeError('usage', m.targetStateMissing);
  if (to === cur.state) return null;

  const from = cur.state;
  if (opts.blockedBy !== undefined && to !== 'blocked') {
    throw invalid(from, to, m.blockedByNeedsBlocked);
  }
  if (isSettled(from)) {
    throw invalid(from, to, m.leaveOnlyViaReopen(from));
  }

  if (to === 'cancelled' || to === 'rejected') return { state: to };

  if (to === 'blocked') {
    if (opts.blockedBy === undefined || opts.blockedBy.length === 0) {
      throw invalid(from, to, m.blockedNeedsId);
    }
    const origin = isPaused(from) ? cur.paused_from : from;
    return {
      state: 'blocked',
      ...(origin !== undefined ? { paused_from: origin } : {}),
      blocked_by: [...opts.blockedBy],
    };
  }

  if (to === 'on_hold') {
    const origin = isPaused(from) ? cur.paused_from : from;
    return { state: 'on_hold', ...(origin !== undefined ? { paused_from: origin } : {}) };
  }

  // Ziel ist ein Hauptlinien-Zustand.
  if (opts.strict) {
    if (isMain(from)) {
      if (!isNeighbour(from, to)) throw invalid(from, to, m.strictNeighbourOnly);
    } else {
      const anchor = cur.paused_from;
      if (anchor === undefined) throw invalid(from, to, m.pausedFromMissing);
      if (to !== anchor && !isNeighbour(anchor, to)) {
        throw invalid(from, to, m.strictPausedFromOrNeighbour(anchor));
      }
    }
  }
  return { state: to };
}

export function planTransition(
  cur: StateFields,
  kind: TransitionKind,
  opts: TransitionOpts,
): StateFields | null {
  switch (kind) {
    case 'move':
      return plan(cur, opts);
    case 'claim':
      if (cur.state === 'in_progress') return null;
      if (cur.state === 'backlog' || cur.state === 'todo') return { state: 'in_progress' };
      throw new BackeError('validation', m.claimImpossible(cur.state));
    case 'resume':
      if (!isPaused(cur.state))
        throw new BackeError('validation', m.resumeOnlyFromPaused(cur.state));
      if (cur.paused_from === undefined)
        throw new BackeError('validation', m.resumeWithoutPausedFrom);
      return { state: cur.paused_from };
    case 'reopen': {
      if (!isSettled(cur.state))
        throw new BackeError('validation', m.reopenOnlyFromSettled(cur.state));
      const to = opts.to ?? 'backlog';
      if (!isMain(to) || to === 'done') {
        throw new BackeError('validation', m.reopenTargetInvalid(to));
      }
      return { state: to };
    }
  }
}

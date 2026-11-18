import { catchErr } from '../../test/helpers/catch.ts';
import {
  isSettled,
  MAIN_LINE,
  normalizeStateInput,
  PAUSED,
  planTransition,
  type State,
  type StateFields,
  type TransitionKind,
} from './state.ts';

const B = ['bk-a91c0'];
const BAD = 'validation' as const;
type Want = StateFields | null | typeof BAD;
type Opts = { to?: State; strict: boolean; blockedBy?: string[] };

const ALL: State[] = [
  'backlog',
  'todo',
  'in_progress',
  'review',
  'done',
  'blocked',
  'on_hold',
  'cancelled',
  'rejected',
];

interface Row {
  cur: StateFields;
  free: Record<State, Want>;
  strict: Record<State, Want>;
}

const toBlocked = (from: State): Want => ({ state: 'blocked', paused_from: from, blocked_by: B });
const toHold = (from: State): Want => ({ state: 'on_hold', paused_from: from });
const s = (state: State): Want => ({ state });

// Jede Zeile: Quellzustand, Erwartung je Ziel bei strict:false und strict:true. Alle 9x9x2 Paare stehen explizit da.
const rows: Row[] = [
  {
    cur: { state: 'backlog' },
    free: {
      backlog: null,
      todo: s('todo'),
      in_progress: s('in_progress'),
      review: s('review'),
      done: s('done'),
      blocked: toBlocked('backlog'),
      on_hold: toHold('backlog'),
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
    strict: {
      backlog: null,
      todo: s('todo'),
      in_progress: BAD,
      review: BAD,
      done: BAD,
      blocked: toBlocked('backlog'),
      on_hold: toHold('backlog'),
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
  },
  {
    cur: { state: 'todo' },
    free: {
      backlog: s('backlog'),
      todo: null,
      in_progress: s('in_progress'),
      review: s('review'),
      done: s('done'),
      blocked: toBlocked('todo'),
      on_hold: toHold('todo'),
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
    strict: {
      backlog: s('backlog'),
      todo: null,
      in_progress: s('in_progress'),
      review: BAD,
      done: BAD,
      blocked: toBlocked('todo'),
      on_hold: toHold('todo'),
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
  },
  {
    cur: { state: 'in_progress' },
    free: {
      backlog: s('backlog'),
      todo: s('todo'),
      in_progress: null,
      review: s('review'),
      done: s('done'),
      blocked: toBlocked('in_progress'),
      on_hold: toHold('in_progress'),
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
    strict: {
      backlog: BAD,
      todo: s('todo'),
      in_progress: null,
      review: s('review'),
      done: BAD,
      blocked: toBlocked('in_progress'),
      on_hold: toHold('in_progress'),
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
  },
  {
    cur: { state: 'review' },
    free: {
      backlog: s('backlog'),
      todo: s('todo'),
      in_progress: s('in_progress'),
      review: null,
      done: s('done'),
      blocked: toBlocked('review'),
      on_hold: toHold('review'),
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
    strict: {
      backlog: BAD,
      todo: BAD,
      in_progress: s('in_progress'),
      review: null,
      done: s('done'),
      blocked: toBlocked('review'),
      on_hold: toHold('review'),
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
  },
  {
    cur: { state: 'done' },
    free: {
      backlog: BAD,
      todo: BAD,
      in_progress: BAD,
      review: BAD,
      done: null,
      blocked: BAD,
      on_hold: BAD,
      cancelled: BAD,
      rejected: BAD,
    },
    strict: {
      backlog: BAD,
      todo: BAD,
      in_progress: BAD,
      review: BAD,
      done: null,
      blocked: BAD,
      on_hold: BAD,
      cancelled: BAD,
      rejected: BAD,
    },
  },
  {
    cur: { state: 'blocked', paused_from: 'todo', blocked_by: B },
    free: {
      backlog: s('backlog'),
      todo: s('todo'),
      in_progress: s('in_progress'),
      review: s('review'),
      done: s('done'),
      blocked: null,
      on_hold: toHold('todo'),
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
    strict: {
      backlog: s('backlog'),
      todo: s('todo'),
      in_progress: s('in_progress'),
      review: BAD,
      done: BAD,
      blocked: null,
      on_hold: toHold('todo'),
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
  },
  {
    cur: { state: 'on_hold', paused_from: 'review' },
    free: {
      backlog: s('backlog'),
      todo: s('todo'),
      in_progress: s('in_progress'),
      review: s('review'),
      done: s('done'),
      blocked: toBlocked('review'),
      on_hold: null,
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
    strict: {
      backlog: BAD,
      todo: BAD,
      in_progress: s('in_progress'),
      review: s('review'),
      done: s('done'),
      blocked: toBlocked('review'),
      on_hold: null,
      cancelled: s('cancelled'),
      rejected: s('rejected'),
    },
  },
  {
    cur: { state: 'cancelled' },
    free: {
      backlog: BAD,
      todo: BAD,
      in_progress: BAD,
      review: BAD,
      done: BAD,
      blocked: BAD,
      on_hold: BAD,
      cancelled: null,
      rejected: BAD,
    },
    strict: {
      backlog: BAD,
      todo: BAD,
      in_progress: BAD,
      review: BAD,
      done: BAD,
      blocked: BAD,
      on_hold: BAD,
      cancelled: null,
      rejected: BAD,
    },
  },
  {
    cur: { state: 'rejected' },
    free: {
      backlog: BAD,
      todo: BAD,
      in_progress: BAD,
      review: BAD,
      done: BAD,
      blocked: BAD,
      on_hold: BAD,
      cancelled: BAD,
      rejected: null,
    },
    strict: {
      backlog: BAD,
      todo: BAD,
      in_progress: BAD,
      review: BAD,
      done: BAD,
      blocked: BAD,
      on_hold: BAD,
      cancelled: BAD,
      rejected: null,
    },
  },
];

const moveCases = rows.flatMap((row) =>
  (['free', 'strict'] as const).flatMap((mode) =>
    ALL.map((to) => ({
      cur: row.cur,
      to,
      strict: mode === 'strict',
      want: row[mode][to],
      label: `${row.cur.state} -> ${to} (${mode})`,
    })),
  ),
);

test('the move table covers every source x target x strict pair exactly once', () => {
  expect(moveCases).toHaveLength(9 * 9 * 2);
  expect(new Set(moveCases.map((c) => c.label)).size).toBe(9 * 9 * 2);
  expect(rows.map((r) => r.cur.state)).toEqual(ALL);
});

test.each(moveCases)('move $label', ({ cur, to, strict, want }) => {
  const opts: Opts = { to, strict, ...(to === 'blocked' ? { blockedBy: B } : {}) };
  if (want === BAD) {
    expect(catchErr(() => planTransition(cur, 'move', opts)).code).toBe('validation');
  } else {
    expect(planTransition(cur, 'move', opts)).toStrictEqual(want);
  }
});

const ok = (cur: StateFields, kind: TransitionKind, opts: Opts, want: StateFields | null) => ({
  cur,
  kind,
  opts,
  want,
});
test.each([
  ok({ state: 'todo' }, 'claim', { strict: true }, { state: 'in_progress' }),
  ok({ state: 'backlog' }, 'claim', { strict: true }, { state: 'in_progress' }),
  ok({ state: 'backlog' }, 'claim', { strict: false }, { state: 'in_progress' }),
  ok({ state: 'in_progress' }, 'claim', { strict: true }, null),
  ok(
    { state: 'blocked', paused_from: 'review', blocked_by: B },
    'resume',
    { strict: true },
    { state: 'review' },
  ),
  ok({ state: 'on_hold', paused_from: 'review' }, 'resume', { strict: false }, { state: 'review' }),
  ok({ state: 'done' }, 'reopen', { strict: false }, { state: 'backlog' }),
  ok({ state: 'cancelled' }, 'reopen', { strict: true }, { state: 'backlog' }),
  ok({ state: 'rejected' }, 'reopen', { to: 'todo', strict: true }, { state: 'todo' }),
  ok({ state: 'rejected' }, 'reopen', { to: 'review', strict: true }, { state: 'review' }),
])('$cur.state --$kind--> ok', ({ cur, kind, opts, want }) => {
  expect(planTransition(cur, kind, opts)).toStrictEqual(want);
});

const bad = (cur: StateFields, kind: TransitionKind, opts: Opts) => ({ cur, kind, opts });
test.each([
  bad({ state: 'todo' }, 'move', { to: 'blocked', strict: false }),
  bad({ state: 'todo' }, 'move', { to: 'blocked', strict: false, blockedBy: [] }),
  bad({ state: 'todo' }, 'move', { to: 'review', strict: false, blockedBy: B }),
  bad({ state: 'blocked', paused_from: 'todo', blocked_by: B }, 'move', {
    to: 'cancelled',
    strict: false,
    blockedBy: B,
  }),
  bad({ state: 'on_hold', paused_from: 'todo' }, 'move', { to: 'blocked', strict: false }),
  bad({ state: 'blocked', blocked_by: B }, 'move', { to: 'review', strict: true }),
  bad({ state: 'todo' }, 'resume', { strict: false }),
  bad({ state: 'done' }, 'resume', { strict: false }),
  bad({ state: 'blocked', blocked_by: B }, 'resume', { strict: false }),
  bad({ state: 'todo' }, 'reopen', { strict: false }),
  bad({ state: 'blocked', paused_from: 'todo', blocked_by: B }, 'reopen', { strict: false }),
  bad({ state: 'done' }, 'reopen', { to: 'done', strict: false }),
  bad({ state: 'done' }, 'reopen', { to: 'blocked', strict: false }),
  bad({ state: 'done' }, 'reopen', { to: 'cancelled', strict: false }),
  bad({ state: 'review' }, 'claim', { strict: false }),
  bad({ state: 'done' }, 'claim', { strict: false }),
  bad({ state: 'blocked', paused_from: 'todo', blocked_by: B }, 'claim', { strict: false }),
])('$cur.state --$kind--> rejected', ({ cur, kind, opts }) => {
  expect(catchErr(() => planTransition(cur, kind, opts)).code).toBe('validation');
});

test('move without a target is a usage error', () => {
  expect(catchErr(() => planTransition({ state: 'todo' }, 'move', { strict: false })).code).toBe(
    'usage',
  );
});

test('every exit from blocked drops blocked_by', () => {
  const cur: StateFields = { state: 'blocked', paused_from: 'review', blocked_by: B };
  const permitted: State[] = [
    'backlog',
    'todo',
    'in_progress',
    'review',
    'done',
    'on_hold',
    'cancelled',
    'rejected',
  ];
  for (const to of permitted) {
    const res = planTransition(cur, 'move', { to, strict: false });
    expect(res).not.toBeNull();
    expect(res).not.toHaveProperty('blocked_by');
  }
  expect(planTransition(cur, 'move', { to: 'blocked', strict: false })).toBeNull();
  expect(planTransition(cur, 'resume', { strict: false })).not.toHaveProperty('blocked_by');
});

test('constants and isSettled', () => {
  expect(MAIN_LINE).toEqual(['backlog', 'todo', 'in_progress', 'review', 'done']);
  expect(PAUSED).toEqual(['blocked', 'on_hold']);
  expect(ALL.filter(isSettled)).toEqual(['done', 'cancelled', 'rejected']);
});

test('normalizeStateInput accepts kebab-case', () => {
  expect(normalizeStateInput('in-progress')).toBe('in_progress');
  expect(normalizeStateInput('on-hold')).toBe('on_hold');
  expect(normalizeStateInput('done')).toBe('done');
});

test('normalizeStateInput rejects unknown input with usage', () => {
  expect(catchErr(() => normalizeStateInput('wip')).code).toBe('usage');
  expect(catchErr(() => normalizeStateInput('')).code).toBe('usage');
});

import fc from 'fast-check';
import { I, snap } from '../../test/helpers/snapshot.ts';
import { BackeError } from '../core/errors.ts';
import { compareIssues } from './order.ts';
import { RANK_STEP, type RankPosition, rankPlacement } from './rank.ts';

const ranked = (...r: number[]) =>
  snap({ issues: [{ id: I(0) }, ...r.map((rank, i) => ({ id: I(i + 1), rank }))] });

function catchError(fn: () => unknown): BackeError {
  try {
    fn();
  } catch (e) {
    if (e instanceof BackeError) return e;
    throw e;
  }
  throw new Error('kein Fehler geworfen');
}

describe('rankPlacement', () => {
  test('a broken anchor is a validation error naming the problem, not a missing issue', () => {
    const s = ranked(1000);
    s.problems.push({ path: 'x.md', message: 'kaputtes YAML', kind: 'issue', key: I(9) });
    const err = catchError(() => rankPlacement(s, I(0), { before: I(9) }));
    expect([err.code, err.message]).toEqual([
      'validation',
      `Anker ${I(9)} ist nicht lesbar: kaputtes YAML`,
    ]);
    expect(catchError(() => rankPlacement(s, I(0), { after: I(8) })).code).toBe('not_found');
  });

  test('step is 1000', () => expect(RANK_STEP).toBe(1000));

  test('midpoint between neighbours', () =>
    expect(rankPlacement(ranked(1000, 2000), I(0), { before: I(2) })).toEqual(
      new Map([[I(0), 1500]]),
    ));

  test('top, bottom and empty', () => {
    expect(rankPlacement(ranked(1000, 2000), I(0), { top: true })).toEqual(new Map([[I(0), 0]]));
    expect(rankPlacement(ranked(1000, 2000), I(0), { bottom: true })).toEqual(
      new Map([[I(0), 3000]]),
    );
    expect(rankPlacement(ranked(), I(0), { top: true })).toEqual(new Map([[I(0), 1000]]));
  });

  test('after the last ranked issue extends by one step', () =>
    expect(rankPlacement(ranked(1000, 2000), I(0), { after: I(2) })).toEqual(
      new Map([[I(0), 3000]]),
    ));

  test('renumbers only the crowded neighbourhood', () =>
    // Fenster wächst einmal: lo = 1000 (I1), hi = 2002 (I4), n = 3, step = 250; I1, I4, I5 bleiben
    expect(rankPlacement(ranked(1000, 2000, 2001, 2002, 9000), I(0), { after: I(2) })).toEqual(
      new Map([
        [I(2), 1250],
        [I(0), 1500],
        [I(3), 1750],
      ]),
    ));

  test('spreads equal ranks apart', () => {
    const s = ranked(1000, 1000, 1000);
    const result = rankPlacement(s, I(0), { before: I(2) });
    const order = [...s.issues.values()]
      .map((e) => ({ ...e.data, rank: result.get(e.data.id) ?? e.data.rank }))
      .sort(compareIssues)
      .map((i) => i.id);
    expect(order).toEqual([I(1), I(0), I(2), I(3)]);
    expect(new Set([...result.values()]).size).toBe(result.size);
  });

  test('a ranked moved issue changes only when its rank differs', () => {
    const s = snap({
      issues: [
        { id: I(1), rank: 1000 },
        { id: I(2), rank: 2000 },
        { id: I(3), rank: 3000 },
      ],
    });
    expect(rankPlacement(s, I(2), { top: true })).toEqual(new Map([[I(2), 0]]));
    expect(rankPlacement(s, I(2), { before: I(3) })).toEqual(new Map());
    expect(rankPlacement(s, I(2), { after: I(1) })).toEqual(new Map());
  });

  test('value sets the rank directly', () => {
    expect(rankPlacement(ranked(1000), I(0), { value: 1000 })).toEqual(new Map([[I(0), 1000]]));
    expect(rankPlacement(ranked(1000), I(1), { value: 1000 })).toEqual(new Map());
  });

  test('value must be an integer', () => {
    expect(catchError(() => rankPlacement(ranked(1000), I(0), { value: 1.5 })).code).toBe(
      'validation',
    );
  });

  test('missing issue or anchor is not_found', () => {
    expect(catchError(() => rankPlacement(ranked(1000), I(9), { top: true })).code).toBe(
      'not_found',
    );
    expect(catchError(() => rankPlacement(ranked(1000), I(0), { before: I(9) })).code).toBe(
      'not_found',
    );
  });

  test('anchor equal to the issue is a validation error', () =>
    expect(catchError(() => rankPlacement(ranked(1000), I(1), { after: I(1) })).code).toBe(
      'validation',
    ));

  test('anchor without rank is a validation error with hint', () => {
    const s = snap({ issues: [{ id: I(0) }, { id: I(1) }] });
    const err = catchError(() => rankPlacement(s, I(0), { before: I(1) }));
    expect(err.code).toBe('validation');
    expect(err.hint).toBe(`backe issue rank ${I(1)} --bottom`);
  });

  test('property: placement is honoured, others keep their order, values are integers', () => {
    const arbPos = fc.oneof(
      fc.constant<'top'>('top'),
      fc.constant<'bottom'>('bottom'),
      fc.record({ kind: fc.constantFrom('before' as const, 'after' as const), at: fc.nat() }),
      fc.record({
        kind: fc.constant('value' as const),
        value: fc.integer({ min: -5000, max: 5000 }),
      }),
    );
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 6 }), { maxLength: 12 }),
        fc.option(fc.integer({ min: 0, max: 6 }), { nil: undefined }),
        arbPos,
        (ranks, ownRank, rawPos) => {
          const s = snap({
            issues: [
              { id: I(0), ...(ownRank === undefined ? {} : { rank: ownRank }) },
              ...ranks.map((rank, i) => ({ id: I(i + 1), rank })),
            ],
          });
          const order = (m: Map<string, number>) =>
            [...s.issues.values()]
              .map((e) => ({ ...e.data, rank: m.has(e.data.id) ? m.get(e.data.id) : e.data.rank }))
              .filter((i) => i.rank !== undefined)
              .sort(compareIssues)
              .map((i) => i.id);
          const before = order(new Map()).filter((id) => id !== I(0));
          let pos: RankPosition;
          if (rawPos === 'top') pos = { top: true };
          else if (rawPos === 'bottom') pos = { bottom: true };
          else if (rawPos.kind === 'value') pos = { value: rawPos.value };
          else if (before.length === 0) pos = { top: true };
          else {
            const anchor = before[rawPos.at % before.length] as string;
            pos = rawPos.kind === 'before' ? { before: anchor } : { after: anchor };
          }
          const result = rankPlacement(s, I(0), pos);
          for (const v of result.values()) expect(Number.isInteger(v)).toBe(true);
          const after = order(result);
          expect(after.filter((id) => id !== I(0))).toEqual(before);
          if ('value' in pos) {
            expect(result.get(I(0)) ?? ownRank).toBe(pos.value);
          } else {
            const at = after.indexOf(I(0));
            if ('top' in pos) expect(at).toBe(0);
            else if ('bottom' in pos) expect(at).toBe(after.length - 1);
            else if ('before' in pos) expect(after[at + 1]).toBe(pos.before);
            else expect(after[at - 1]).toBe(pos.after);
          }
        },
      ),
    );
  });
});

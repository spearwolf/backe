import { I, type SnapSpec, snap } from '../../test/helpers/snapshot.ts';
import { compareIssues, compareRank } from './order.ts';

const sorted = (issues: SnapSpec['issues']) =>
  [...snap({ issues }).issues.values()]
    .map((e) => e.data)
    .sort(compareIssues)
    .map((i) => i.id);

test('issues without rank sort last, then by created', () => {
  expect(sorted([{ id: I(1) }, { id: I(2), rank: 2000 }, { id: I(3), rank: 1000 }])).toEqual([
    I(3),
    I(2),
    I(1),
  ]);
});

test('issues without rank are ordered by created', () => {
  expect(
    sorted([
      { id: I(1), created: '2026-11-18T12:00:00Z' },
      { id: I(2), created: '2026-11-18T11:00:00Z' },
    ]),
  ).toEqual([I(2), I(1)]);
});

test('equal rank falls back to created, then id', () => {
  expect(
    sorted([
      { id: I(2), rank: 1, created: '2026-11-18T10:00:00Z' },
      { id: I(1), rank: 1, created: '2026-11-18T10:00:00Z' },
      { id: I(3), rank: 1, created: '2026-11-18T09:00:00Z' },
    ]),
  ).toEqual([I(3), I(1), I(2)]);
});

test('compareIssues is antisymmetric for ranked against unranked', () => {
  const [a, b] = [...snap({ issues: [{ id: I(1), rank: 5 }, { id: I(2) }] }).issues.values()].map(
    (e) => e.data,
  ) as [never, never];
  expect(compareIssues(a, b)).toBeLessThan(0);
  expect(compareIssues(b, a)).toBeGreaterThan(0);
});

test('compareRank: ascending, ranked before unranked, unranked equal', () => {
  const byId = new Map(
    [
      ...snap({
        issues: [{ id: I(1), rank: 1 }, { id: I(2), rank: 2 }, { id: I(3) }, { id: I(4) }],
      }).issues,
    ].map(([id, e]) => [id, e.data]),
  );
  const get = (n: number) => {
    const issue = byId.get(I(n));
    if (!issue) throw new Error('Issue fehlt');
    return issue;
  };
  expect(compareRank(get(1), get(2))).toBeLessThan(0);
  expect(compareRank(get(2), get(1))).toBeGreaterThan(0);
  expect(compareRank(get(1), get(3))).toBeLessThan(0);
  expect(compareRank(get(3), get(1))).toBeGreaterThan(0);
  expect(compareRank(get(3), get(4))).toBe(0);
});

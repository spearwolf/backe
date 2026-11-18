import { I, type SnapSpec, snap } from '../../test/helpers/snapshot.ts';
import { compareIssues } from './order.ts';

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

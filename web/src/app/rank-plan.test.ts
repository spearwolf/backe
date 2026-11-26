import { rankPlacement } from '@backe/ops/rank.ts';
import { Store } from '../data/store.ts';
import { testIssue, testState, tid } from '../test/state.ts';
import { rankOverlay } from './optimistic.ts';
import { rankBatchOps, rankSteps } from './rank-plan.ts';

function snapshot(...issues: ReturnType<typeof testIssue>[]) {
  const store = new Store();
  store.load(testState(issues));
  const s = store.toSnapshot();
  if (s === undefined) throw new Error('no snapshot');
  store.dispose();
  return s;
}

/** 1 und 2 mit Rang, 3 bis 5 ohne (in dieser Reihenfolge nach `created`). */
const mixed = () =>
  snapshot(
    testIssue(1),
    testIssue(2),
    testIssue(3, { rank: undefined }),
    testIssue(4, { rank: undefined }),
    testIssue(5, { rank: undefined }),
  );

/** Die Reihenfolge, die eine Überlagerung ergäbe: Rang aufsteigend, ohne Rang zuletzt. */
function orderAfter(s: ReturnType<typeof mixed>, overlay: Map<string, { rank?: number }>) {
  const ranked = [...s.issues.values()].map((e) => ({ ...e.data, ...overlay.get(e.data.id) }));
  return ranked
    .sort((a, b) =>
      a.rank === b.rank
        ? a.created.localeCompare(b.created)
        : a.rank === undefined
          ? 1
          : b.rank === undefined
            ? -1
            : a.rank - b.rank,
    )
    .map((i) => i.id);
}

test('a ranked anchor needs no steps', () => {
  const s = mixed();
  expect(rankSteps(s, tid(1), { after: tid(2) })).toEqual({ pos: { after: tid(2) }, unranked: [] });
  expect(rankSteps(s, tid(4), { top: true })).toEqual({ pos: { top: true }, unranked: [] });
});

test('an unranked anchor first ranks every unranked issue up to it, skipping the moved one', () => {
  const s = mixed();
  expect(rankSteps(s, tid(1), { after: tid(4) })).toEqual({
    pos: { after: tid(4) },
    unranked: [tid(3), tid(4)],
  });
  expect(rankSteps(s, tid(3), { after: tid(4) })).toEqual({
    pos: { after: tid(4) },
    unranked: [tid(4)],
  });
});

test('bottom goes behind the last row when unranked issues exist', () => {
  const s = mixed();
  expect(rankSteps(s, tid(1), { bottom: true })).toEqual({
    pos: { after: tid(5) },
    unranked: [tid(3), tid(4), tid(5)],
  });
  // Ist das bewegte Issue selbst das letzte, gilt das letzte der übrigen als Anker.
  expect(rankSteps(s, tid(5), { bottom: true })).toEqual({
    pos: { after: tid(4) },
    unranked: [tid(3), tid(4)],
  });
  // Ohne weitere Issues ohne Rang bleibt es beim einfachen `bottom`.
  const ranked = snapshot(testIssue(1), testIssue(2), testIssue(3, { rank: undefined }));
  expect(rankSteps(ranked, tid(3), { bottom: true })).toEqual({
    pos: { bottom: true },
    unranked: [],
  });
});

test('an anchor the client does not know is left to the server', () => {
  expect(rankSteps(mixed(), tid(1), { before: 'bk-gone' })).toEqual({
    pos: { before: 'bk-gone' },
    unranked: [],
  });
});

test('the batch ranks the prefix from null, then moves from the server rank', () => {
  expect(
    rankBatchOps(tid(1), 1000, { pos: { after: tid(4) }, unranked: [tid(3), tid(4)] }),
  ).toEqual([
    { op: 'issue.rank', id: tid(3), from: null, bottom: true },
    { op: 'issue.rank', id: tid(4), from: null, bottom: true },
    { op: 'issue.rank', id: tid(1), from: 1000, after: tid(4) },
  ]);
  expect(rankBatchOps(tid(5), undefined, { pos: { before: tid(3) }, unranked: [tid(3)] })).toEqual([
    { op: 'issue.rank', id: tid(3), from: null, bottom: true },
    { op: 'issue.rank', id: tid(5), from: null, before: tid(3) },
  ]);
});

test('the overlay simulates the batch: prefix at the bottom, then the move', () => {
  const s = mixed();
  const steps = rankSteps(s, tid(1), { after: tid(4) });
  const overlay = rankOverlay(s, tid(1), steps.pos, steps.unranked);
  expect(orderAfter(s, overlay)).toEqual([tid(2), tid(3), tid(4), tid(1), tid(5)]);
  // Die Ränge sind die, die der Server Schritt für Schritt vergäbe.
  expect(overlay.get(tid(3))).toEqual({
    rank: rankPlacement(s, tid(3), { bottom: true }).get(tid(3)),
  });
  expect(overlay.has(tid(5))).toBe(false);

  const bottom = rankSteps(s, tid(2), { bottom: true });
  expect(orderAfter(s, rankOverlay(s, tid(2), bottom.pos, bottom.unranked))).toEqual([
    tid(1),
    tid(3),
    tid(4),
    tid(5),
    tid(2),
  ]);
});

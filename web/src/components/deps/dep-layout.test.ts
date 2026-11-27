import type { BacklogSnapshot } from '@backe/store/snapshot.ts';
import { depGraph } from '../../app/dep-graph.ts';
import { Store } from '../../data/store.ts';
import { testIssue, testState, tid } from '../../test/state.ts';
import { DEP_MORE_ID, DEP_NODE_HEIGHT, DEP_NODE_WIDTH, layoutDeps } from './dep-layout.ts';

function snapshot(...issues: ReturnType<typeof testIssue>[]): BacklogSnapshot {
  const store = new Store();
  store.load(testState(issues));
  const s = store.toSnapshot();
  store.dispose();
  if (s === undefined) throw new Error('no snapshot');
  return s;
}

const none: ReadonlySet<string> = new Set();
const pos = (m: ReturnType<typeof layoutDeps>, id: string) => {
  const p = m.get(id);
  if (p === undefined) throw new Error(`no position for ${id}`);
  return p;
};

function overlaps(m: ReturnType<typeof layoutDeps>): boolean {
  const all = [...m.values()];
  return all.some((a, i) =>
    all
      .slice(i + 1)
      .some(
        (b) =>
          a.x < b.x + DEP_NODE_WIDTH &&
          b.x < a.x + DEP_NODE_WIDTH &&
          a.y < b.y + DEP_NODE_HEIGHT &&
          b.y < a.y + DEP_NODE_HEIGHT,
      ),
  );
}

test('prerequisites above the centre, dependents below', () => {
  const s = snapshot(
    testIssue(1, { depends_on: [tid(2)] }),
    testIssue(2),
    testIssue(3, { depends_on: [tid(1)] }),
  );
  const m = layoutDeps(depGraph(s, tid(1), { parents: false, expanded: none }));
  expect(pos(m, tid(2)).y).toBeLessThan(pos(m, tid(1)).y);
  expect(pos(m, tid(1)).y).toBeLessThan(pos(m, tid(3)).y);
  expect(pos(m, tid(1)).y - pos(m, tid(2)).y).toBeGreaterThanOrEqual(DEP_NODE_HEIGHT);
  expect(pos(m, tid(3)).y - pos(m, tid(1)).y).toBeGreaterThanOrEqual(DEP_NODE_HEIGHT);
});

test('nodes of one rank do not overlap', () => {
  const s = snapshot(
    testIssue(1, { depends_on: [tid(2), tid(3), tid(4)] }),
    testIssue(2),
    testIssue(3),
    testIssue(4),
  );
  const m = layoutDeps(depGraph(s, tid(1), { parents: false, expanded: none }));
  const xs = [2, 3, 4].map((n) => pos(m, tid(n)).x);
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      expect(Math.abs((xs[i] as number) - (xs[j] as number))).toBeGreaterThanOrEqual(
        DEP_NODE_WIDTH,
      );
    }
  }
});

test('a cycle still lays out', () => {
  const s = snapshot(
    testIssue(1, { depends_on: [tid(2)] }),
    testIssue(2, { depends_on: [tid(1)] }),
  );
  const m = layoutDeps(depGraph(s, tid(1), { parents: false, expanded: none }));
  expect(m.size).toBe(2);
  for (const p of m.values()) {
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  }
});

test('two edge kinds between one pair do not collide', () => {
  const s = snapshot(
    testIssue(1, { depends_on: [tid(2)], blocked_by: [tid(2)], state: 'blocked' }),
    testIssue(2),
  );
  const g = depGraph(s, tid(1), { parents: false, expanded: none });
  expect(g.edges).toHaveLength(2);
  const m = layoutDeps(g);
  expect(pos(m, tid(2)).y).toBeLessThan(pos(m, tid(1)).y);
});

test('150 nodes and the collector lay out without overlap', () => {
  const dependents = Array.from({ length: 400 }, (_, i) =>
    testIssue(i + 2, { depends_on: [tid(1)] }),
  );
  const s = snapshot(testIssue(1), ...dependents);
  const g = depGraph(s, tid(1), { parents: false, expanded: none });
  expect(g.more).toBeGreaterThan(0);
  const m = layoutDeps(g);
  expect(m.size).toBe(151);
  expect(pos(m, DEP_MORE_ID).y - pos(m, tid(1)).y).toBeGreaterThanOrEqual(DEP_NODE_HEIGHT);
  expect(overlaps(m)).toBe(false);
});

test('the collector sits below the first dependents, under the centre', () => {
  const dependents = Array.from({ length: 400 }, (_, i) =>
    testIssue(i + 2, { depends_on: [tid(1)] }),
  );
  const s = snapshot(testIssue(1), ...dependents);
  const g = depGraph(s, tid(1), { parents: false, expanded: none });
  const m = layoutDeps(g);
  const firstRow = g.nodes.filter((n) => n.role === 'down').map((n) => pos(m, n.id).y);
  const more = pos(m, DEP_MORE_ID);
  expect(more.y).toBeGreaterThanOrEqual(Math.max(...firstRow) + DEP_NODE_HEIGHT);
  expect(more.x).toBe(pos(m, tid(1)).x);
});

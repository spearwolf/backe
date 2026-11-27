import type { BacklogSnapshot } from '@backe/store/snapshot.ts';
import { Store } from '../data/store.ts';
import { testIssue, testState, tid } from '../test/state.ts';
import {
  type DepGraph,
  type DepTreeItem,
  dependentsOf,
  depGraph,
  depTree,
  hasDependencies,
  prerequisitesOf,
} from './dep-graph.ts';

function snapshot(...issues: ReturnType<typeof testIssue>[]): BacklogSnapshot {
  const store = new Store();
  store.load(testState(issues));
  const s = store.toSnapshot();
  store.dispose();
  if (s === undefined) throw new Error('no snapshot');
  return s;
}

const none: ReadonlySet<string> = new Set();
const graph = (s: BacklogSnapshot, id: string, expanded = none, parents = false) =>
  depGraph(s, id, { parents, expanded });
const nodeIds = (g: DepGraph) => g.nodes.map((n) => n.id);
const node = (g: DepGraph, id: string) => g.nodes.find((n) => n.id === id);
const GONE = tid(99);

test('prerequisites and dependents cover depends_on, blocked_by and optionally parent', () => {
  const s = snapshot(
    testIssue(1, { depends_on: [tid(2), GONE], blocked_by: [tid(3)], parent: tid(5) }),
    testIssue(2),
    testIssue(3),
    testIssue(4, { parent: tid(1) }),
    testIssue(5),
    testIssue(6, { depends_on: [tid(1)] }),
    testIssue(7, { blocked_by: [tid(1)], state: 'blocked' }),
  );
  expect(prerequisitesOf(s, tid(1), false)).toEqual([
    { id: tid(2), kind: 'depends_on' },
    { id: GONE, kind: 'depends_on' },
    { id: tid(3), kind: 'blocked_by' },
  ]);
  expect(prerequisitesOf(s, tid(1), true).at(-1)).toEqual({ id: tid(4), kind: 'parent' });
  expect(dependentsOf(s, tid(1), false)).toEqual([
    { id: tid(6), kind: 'depends_on' },
    { id: tid(7), kind: 'blocked_by' },
  ]);
  expect(dependentsOf(s, tid(1), true).at(-1)).toEqual({ id: tid(5), kind: 'parent' });
  expect(prerequisitesOf(s, GONE, true)).toEqual([]);
});

test('the section shows for any dependency edge but not for parent alone', () => {
  const s = snapshot(
    testIssue(1, { depends_on: [tid(2)] }),
    testIssue(2),
    testIssue(3, { blocked_by: [tid(4)], state: 'blocked' }),
    testIssue(4),
    testIssue(5, { parent: tid(6) }),
    testIssue(6),
  );
  expect([1, 2, 3, 4, 5, 6].map((n) => hasDependencies(s, tid(n)))).toEqual([
    true,
    true,
    true,
    true,
    false,
    false,
  ]);
});

// Kette u2 → u1 → c → d1 → d2 → d3
const [U2, U1, C, D1, D2, D3] = [1, 2, 3, 4, 5, 6].map(tid) as [
  string,
  string,
  string,
  string,
  string,
  string,
];
const chain = () =>
  snapshot(
    testIssue(1),
    testIssue(2, { depends_on: [U2] }),
    testIssue(3, { depends_on: [U1] }),
    testIssue(4, { depends_on: [C] }),
    testIssue(5, { depends_on: [D1] }),
    testIssue(6, { depends_on: [D2] }),
  );

test('depth two up and down with roles in layer order', () => {
  const g = graph(chain(), C);
  expect(g.nodes.map((n) => [n.id, n.role])).toEqual([
    [C, 'center'],
    [U1, 'up'],
    [D1, 'down'],
    [U2, 'up'],
    [D2, 'down'],
  ]);
  expect(nodeIds(g)).not.toContain(D3);
  expect(g.nodes.map((n) => n.hidden)).toEqual([0, 0, 0, 0, 1]);
  expect(g.nodes[0]?.issue?.title).toBe('Issue 3');
  expect(g.more).toBe(0);
});

test('edges run from prerequisite to dependent with their kind', () => {
  const s = snapshot(
    testIssue(1),
    testIssue(2),
    testIssue(3, { depends_on: [tid(1)], blocked_by: [tid(2)], state: 'blocked' }),
    testIssue(4, { depends_on: [tid(3)] }),
  );
  expect(graph(s, tid(3)).edges).toEqual([
    { from: tid(1), to: tid(3), kind: 'depends_on' },
    { from: tid(2), to: tid(3), kind: 'blocked_by' },
    { from: tid(3), to: tid(4), kind: 'depends_on' },
  ]);
});

test('parent edges only with parents, from sub-issue to parent', () => {
  const s = snapshot(
    testIssue(1, { parent: tid(4) }),
    testIssue(2, { parent: tid(1) }),
    testIssue(3, { parent: tid(1) }),
    testIssue(4),
  );
  expect(nodeIds(graph(s, tid(1)))).toEqual([tid(1)]);
  const g = graph(s, tid(1), none, true);
  expect(g.nodes.map((n) => [n.id, n.role])).toEqual([
    [tid(1), 'center'],
    [tid(2), 'up'],
    [tid(3), 'up'],
    [tid(4), 'down'],
  ]);
  expect(g.edges).toEqual([
    { from: tid(2), to: tid(1), kind: 'parent' },
    { from: tid(3), to: tid(1), kind: 'parent' },
    { from: tid(1), to: tid(4), kind: 'parent' },
  ]);
});

test('expanding a node adds its neighbours in both directions', () => {
  // d1 hängt an c und an x; x an y; d2 an d1, d3 an d2.
  const [c, d1, d2, d3, x, y] = [1, 2, 3, 4, 5, 6].map(tid) as string[];
  const s = snapshot(
    testIssue(1),
    testIssue(2, { depends_on: [c as string, x as string] }),
    testIssue(3, { depends_on: [d1 as string] }),
    testIssue(4, { depends_on: [d2 as string] }),
    testIssue(5, { depends_on: [y as string] }),
    testIssue(6),
  );
  const closed = graph(s, c as string);
  expect(nodeIds(closed)).toEqual([c, d1, d2]);
  expect(node(closed, d1 as string)?.hidden).toBe(1);

  const g = graph(s, c as string, new Set([d1, d2, x, c] as string[]));
  expect(g.nodes.map((n) => [n.id, n.role])).toEqual([
    [c, 'center'],
    [d1, 'down'],
    [d2, 'down'],
    [x, 'side'],
    [d3, 'down'],
    [y, 'side'],
  ]);
  expect(g.nodes.map((n) => n.expanded)).toEqual([false, true, true, true, false, false]);
  expect(node(g, d1 as string)?.hidden).toBe(0);
  expect(g.edges).toContainEqual({ from: x, to: d1, kind: 'depends_on' });

  expect(graph(s, c as string, new Set([d2 as string]))).toEqual({
    ...closed,
    nodes: [
      ...closed.nodes.slice(0, 2),
      { ...closed.nodes[2], expanded: true, hidden: 0 },
      {
        id: d3,
        issue: s.issues.get(d3 as string)?.data,
        role: 'down',
        open: false,
        hidden: 0,
        expanded: false,
      },
    ],
    edges: [...closed.edges, { from: d2, to: d3, kind: 'depends_on' }],
    key: expect.any(String),
  });
});

test('an expanded node that left the graph expands nothing', () => {
  // u3 → u2 → u1 → c, dazu u4 → u3: u3 liegt außerhalb der Tiefe.
  const s = snapshot(
    testIssue(1, { depends_on: [tid(2)] }),
    testIssue(2, { depends_on: [tid(3)] }),
    testIssue(3, { depends_on: [tid(4)] }),
    testIssue(4, { depends_on: [tid(5)] }),
    testIssue(5),
  );
  const plain = graph(s, tid(1));
  expect(nodeIds(plain)).toEqual([tid(1), tid(2), tid(3)]);
  expect(graph(s, tid(1), new Set([GONE, tid(4)]))).toEqual(plain);
});

test('a missing prerequisite is a node without issue', () => {
  const s = snapshot(testIssue(1, { depends_on: [GONE] }), testIssue(2, { depends_on: [GONE] }));
  const g = graph(s, tid(1), new Set([GONE]));
  expect(nodeIds(g)).toEqual([tid(1), GONE]);
  expect(node(g, GONE)).toEqual({
    id: GONE,
    issue: undefined,
    role: 'up',
    open: true,
    hidden: 0,
    expanded: true,
  });
  expect(g.edges).toEqual([{ from: GONE, to: tid(1), kind: 'depends_on' }]);
});

test('open marks unsettled prerequisites only', () => {
  const s = snapshot(
    testIssue(1, { state: 'done' }),
    testIssue(2),
    testIssue(3, { depends_on: [tid(1), tid(2)] }),
    testIssue(4, { depends_on: [tid(3)] }),
  );
  const g = graph(s, tid(3));
  expect(g.nodes.map((n) => [n.id, n.open])).toEqual([
    [tid(3), false],
    [tid(1), false],
    [tid(2), true],
    [tid(4), false],
  ]);
});

test('a cycle ends and every node appears once', () => {
  const [a, b, c] = [tid(1), tid(2), tid(3)];
  const s = snapshot(
    testIssue(1, { blocked_by: [b], depends_on: [c, c], state: 'blocked' }),
    testIssue(2, { blocked_by: [a], state: 'blocked' }),
    testIssue(3, { depends_on: [a] }),
  );
  const g = graph(s, a, new Set([a, b, c]));
  expect(nodeIds(g)).toEqual([a, c, b]);
  expect(g.edges).toEqual([
    { from: c, to: a, kind: 'depends_on' },
    { from: b, to: a, kind: 'blocked_by' },
    { from: a, to: c, kind: 'depends_on' },
    { from: a, to: b, kind: 'blocked_by' },
  ]);
});

test('over 150 nodes a collector takes the rest', () => {
  const issues = [testIssue(1)];
  for (let n = 2; n <= 401; n++) issues.push(testIssue(n, { depends_on: [tid(1)] }));
  const g = graph(snapshot(...issues), tid(1));
  expect(g.nodes).toHaveLength(150);
  expect(g.more).toBe(251);
  expect(g.edges).toHaveLength(149);
  expect(g.nodes[0]?.hidden).toBe(251);
  expect(g.nodes.at(-1)?.id).toBe(tid(150));
  expect(
    depGraph(snapshot(...issues), tid(1), { parents: false, expanded: none, limit: 3 }).more,
  ).toBe(398);
});

test('the key stays when only fields change', () => {
  const before = graph(chain(), C).key;
  const renamed = snapshot(
    testIssue(1, { title: 'Neu', state: 'done' }),
    testIssue(2, { depends_on: [U2], state: 'in_progress' }),
    testIssue(3, { depends_on: [U1] }),
    testIssue(4, { depends_on: [C] }),
    testIssue(5, { depends_on: [D1] }),
    testIssue(6, { depends_on: [D2] }),
  );
  expect(graph(renamed, C).key).toBe(before);
  const linked = snapshot(
    testIssue(1),
    testIssue(2, { depends_on: [U2] }),
    testIssue(3, { depends_on: [U1] }),
    testIssue(4, { depends_on: [C] }),
    testIssue(5, { depends_on: [D1, C] }),
    testIssue(6, { depends_on: [D2] }),
  );
  expect(graph(linked, C).key).not.toBe(before);
});

const shape = (items: DepTreeItem[]): unknown[] =>
  items.map((i) => [i.key, i.kind, i.open, i.expandable, i.cycle, shape(i.children)]);

test('the tree opens two levels and toggles by path', () => {
  // c hängt an u1, u1 an u2, u2 an u3; d1 hängt an c.
  const [c, u1, u2, u3, d1] = [1, 2, 3, 4, 5].map(tid) as string[];
  const s = snapshot(
    testIssue(1, { depends_on: [u1 as string] }),
    testIssue(2, { depends_on: [u2 as string] }),
    testIssue(3, { depends_on: [u3 as string] }),
    testIssue(4),
    testIssue(5, { depends_on: [c as string] }),
  );
  const tree = (toggled: string[]) =>
    depTree(s, c as string, { parents: false, toggled: new Set(toggled) });
  const t = tree([]);
  expect(shape(t.up)).toEqual([
    [
      `up:${u1}`,
      'depends_on',
      true,
      true,
      false,
      [[`up:${u1}/${u2}`, 'depends_on', false, true, false, []]],
    ],
  ]);
  expect(shape(t.down)).toEqual([[`down:${d1}`, 'depends_on', false, false, false, []]]);
  expect(t.more).toBe(0);
  expect(t.up[0]?.issue?.id).toBe(u1);
  expect(shape(tree([`up:${u1}/${u2}`]).up)).toEqual([
    [
      `up:${u1}`,
      'depends_on',
      true,
      true,
      false,
      [
        [
          `up:${u1}/${u2}`,
          'depends_on',
          true,
          true,
          false,
          [[`up:${u1}/${u2}/${u3}`, 'depends_on', false, false, false, []]],
        ],
      ],
    ],
  ]);
  expect(shape(tree([`up:${u1}`]).up)).toEqual([
    [`up:${u1}`, 'depends_on', false, true, false, []],
  ]);
});

test('the tree marks a cycle and stops there', () => {
  const [a, b] = [tid(1), tid(2)];
  const s = snapshot(
    testIssue(1, { blocked_by: [b], depends_on: [GONE], state: 'blocked' }),
    testIssue(2, { blocked_by: [a], state: 'blocked' }),
  );
  const t = depTree(s, a, { parents: false, toggled: new Set([`up:${b}/${a}`]) });
  expect(shape(t.up)).toEqual([
    [`up:${GONE}`, 'depends_on', false, false, false, []],
    [
      `up:${b}`,
      'blocked_by',
      true,
      true,
      false,
      [[`up:${b}/${a}`, 'blocked_by', false, false, true, []]],
    ],
  ]);
  expect(t.up[0]?.issue).toBeUndefined();
  expect(shape(t.down)).toEqual([
    [
      `down:${b}`,
      'blocked_by',
      true,
      true,
      false,
      [[`down:${b}/${a}`, 'blocked_by', false, false, true, []]],
    ],
  ]);
});

test('the tree stops at the limit and counts the rest', () => {
  // c hängt an p1 und p2, p1 an q1 und q2, p2 an r1; d1 hängt an c.
  const [c, p1, p2, q1, q2, r1] = [1, 2, 3, 4, 5, 6].map(tid) as string[];
  const s = snapshot(
    testIssue(1, { depends_on: [p1 as string, p2 as string] }),
    testIssue(2, { depends_on: [q1 as string, q2 as string] }),
    testIssue(3, { depends_on: [r1 as string] }),
    testIssue(4),
    testIssue(5),
    testIssue(6),
    testIssue(7, { depends_on: [c as string] }),
  );
  const t = depTree(s, c as string, { parents: false, toggled: none, limit: 3 });
  expect(shape(t.up)).toEqual([
    [
      `up:${p1}`,
      'depends_on',
      true,
      true,
      false,
      [
        [`up:${p1}/${q1}`, 'depends_on', false, false, false, []],
        [`up:${p1}/${q2}`, 'depends_on', false, false, false, []],
      ],
    ],
  ]);
  expect(t.down).toEqual([]);
  expect(t.more).toBe(2);
  expect(depTree(s, c as string, { parents: false, toggled: none }).more).toBe(0);
});

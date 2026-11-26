import { catchErr } from '../../test/helpers/catch.ts';
import { I, type SnapSpec, snap } from '../../test/helpers/snapshot.ts';
import type { Issue } from '../core/schemas.ts';
import type { StoredEntity } from '../store/snapshot.ts';
import {
  ancestors,
  childProgress,
  findCycle,
  findPath,
  graphOf,
  isClaimable,
  isReady,
  isUnblockable,
  occupyingAncestor,
  openChildren,
  type Readiness,
  readiness,
} from './graph.ts';
import { LayeredMap } from './layered-map.ts';

type SnapIssue = NonNullable<SnapSpec['issues']>[number];
type CycleField = 'parent' | 'depends_on' | 'blocked_by';

const leaf = { level: 'leaf' } as const;
const top = { level: 'top' } as const;

describe('snap', () => {
  test('provides default users, config and sorted maps', () => {
    const s = snap({
      users: ['bob'],
      projects: ['web', 'api'],
      sprints: ['s1'],
      repos: { core: 'https://example.com/acme/core.git' },
      issues: [{ id: I(2) }, { id: I(1) }],
    });
    expect([...s.users.keys()]).toEqual(['alice', 'bob', 'claude-1', 'spw']);
    expect(s.users.get('claude-1')?.data).toMatchObject({ kind: 'agent', operator: 'spw' });
    expect([...s.projects.keys()]).toEqual(['api', 'web']);
    expect([...s.sprints.keys()]).toEqual(['s1']);
    expect(s.repos.get('core')?.path).toBe('repos/core.md');
    expect([...s.issues.keys()]).toEqual([I(1), I(2)]);
    expect(s.issues.get(I(2))?.data).toMatchObject({
      title: I(2),
      state: 'todo',
      creator: 'spw',
      created: '2026-11-18T10:00:00Z',
    });
    expect(s.issues.get(I(1))?.data.created).toBe('2026-11-18T10:01:00Z');
    expect(s.issues.get(I(1))).toMatchObject({ extra: [], body: '', path: expect.any(String) });
    expect(s.config.id_prefix).toBe('bk');
    expect(s.problems).toEqual([]);
  });

  test('rejects a malformed issue', () => {
    expect(() => snap({ issues: [{ id: 'nope' }] })).toThrow();
  });

  test('I builds four-digit ids', () => {
    expect(I(1)).toBe('bk-t0001');
  });
});

describe('findCycle', () => {
  test.each([
    [
      'parent',
      [
        { id: I(1), parent: I(2) },
        { id: I(2), parent: I(1) },
      ],
      [I(1), I(2), I(1)],
    ],
    [
      'depends_on',
      [
        { id: I(1), depends_on: [I(2)] },
        { id: I(2), depends_on: [I(3)] },
        { id: I(3), depends_on: [I(1)] },
      ],
      [I(1), I(2), I(3), I(1)],
    ],
  ] satisfies [CycleField, SnapIssue[], string[]][])(
    'on %s names the cycle',
    (field, issues, cycle) => expect(findCycle(snap({ issues }), field, I(1))).toEqual(cycle),
  );

  test('finds a cycle on blocked_by', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'blocked', blocked_by: [I(2)] },
        { id: I(2), state: 'blocked', blocked_by: [I(1)] },
      ],
    });
    expect(findCycle(s, 'blocked_by', I(1))).toEqual([I(1), I(2), I(1)]);
  });

  test('backtracks out of dead ends and skips missing and revisited nodes', () => {
    const s = snap({
      issues: [
        { id: I(1), depends_on: [I(9), I(2), I(3)] },
        { id: I(2), depends_on: [I(4)] },
        { id: I(3), depends_on: [I(4)] },
        { id: I(4), depends_on: [I(3)] },
      ],
    });
    // I(3) <-> I(4) bilden einen Zyklus, der I(1) nicht enthält.
    expect(findCycle(s, 'depends_on', I(1))).toBeUndefined();
    const t = snap({
      issues: [
        { id: I(1), depends_on: [I(2), I(3)] },
        { id: I(2) },
        { id: I(3), depends_on: [I(1)] },
      ],
    });
    expect(findCycle(t, 'depends_on', I(1))).toEqual([I(1), I(3), I(1)]);
  });

  test('is undefined for an unknown start and an acyclic chain', () => {
    expect(findCycle(snap(), 'parent', I(1))).toBeUndefined();
    expect(
      findCycle(snap({ issues: [{ id: I(1), parent: I(2) }, { id: I(2) }] }), 'parent', I(1)),
    ).toBeUndefined();
  });

  test('long chains do not overflow the stack', () => {
    const s = longChain();
    expect(findCycle(s, 'parent', I(9_999))).toBeUndefined();
    expect(findCycle(s, 'depends_on', I(9_999))).toBeUndefined();
  });
});

describe('findPath', () => {
  test('returns the path along the field', () => {
    const s = snap({
      issues: [
        { id: I(1), depends_on: [I(4), I(2)] },
        { id: I(2), depends_on: [I(3)] },
        { id: I(3) },
        { id: I(4) },
      ],
    });
    expect(findPath(s, 'depends_on', I(1), I(3))).toEqual([I(1), I(2), I(3)]);
    expect(findPath(s, 'depends_on', I(3), I(1))).toBeUndefined();
    expect(findPath(s, 'parent', I(1), I(3))).toBeUndefined();
  });

  test('a node reaches itself with a one-element path', () => {
    expect(findPath(snap(), 'parent', I(1), I(1))).toEqual([I(1)]);
  });

  test('follows parent and blocked_by', () => {
    const s = snap({
      issues: [
        { id: I(1), parent: I(2), state: 'blocked', blocked_by: [I(3)] },
        { id: I(2), parent: I(3) },
        { id: I(3), state: 'blocked', blocked_by: [I(2)] },
      ],
    });
    expect(findPath(s, 'parent', I(1), I(3))).toEqual([I(1), I(2), I(3)]);
    expect(findPath(s, 'blocked_by', I(1), I(2))).toEqual([I(1), I(3), I(2)]);
  });

  test('ends at missing issues and does not loop on existing cycles', () => {
    const s = snap({
      issues: [
        { id: I(1), depends_on: [I(9), I(2)] },
        { id: I(2), depends_on: [I(1)] },
        { id: I(3) },
      ],
    });
    expect(findPath(s, 'depends_on', I(1), I(3))).toBeUndefined();
    expect(findPath(s, 'depends_on', I(1), I(9))).toEqual([I(1), I(9)]);
    expect(findPath(s, 'depends_on', I(8), I(1))).toBeUndefined();
  });

  test('long chains do not overflow the stack', () => {
    const s = longChain();
    expect(findPath(s, 'parent', I(9_999), I(0))).toHaveLength(10_000);
    expect(findPath(s, 'depends_on', I(0), I(9_999))).toBeUndefined();
  });
});

function longChain() {
  const issues = Array.from({ length: 10_000 }, (_, i) => ({
    id: I(i),
    ...(i > 0 ? { parent: I(i - 1), depends_on: [I(i - 1)] } : {}),
  }));
  return snap({ issues });
}

describe('ancestors', () => {
  test('lists the nearest first and stops at a missing parent', () => {
    const s = snap({
      issues: [
        { id: I(1), parent: I(9) },
        { id: I(2), parent: I(1) },
        { id: I(3), parent: I(2) },
      ],
    });
    expect(ancestors(s, I(3))).toEqual([I(2), I(1)]);
    expect(ancestors(s, I(8))).toEqual([]);
  });

  test('stops at an already visited issue in a cycle', () => {
    const s = snap({
      issues: [
        { id: I(1), parent: I(2) },
        { id: I(2), parent: I(1) },
      ],
    });
    expect(ancestors(s, I(1))).toEqual([I(2)]);
  });

  test('long chains do not overflow the stack', () => {
    expect(ancestors(longChain(), I(9_999))).toHaveLength(9_999);
  });
});

describe('readiness', () => {
  test('long chains do not overflow the stack', () => {
    expect(readiness(longChain(), I(9_999), leaf)).toEqual({
      ready: false,
      reason: 'dependencies',
      ids: [I(9_998)],
    });
  });

  test('missing dependency counts as unsettled', () =>
    expect(readiness(snap({ issues: [{ id: I(1), depends_on: [I(9)] }] }), I(1), leaf)).toEqual({
      ready: false,
      reason: 'dependencies',
      ids: [I(9)],
    }));

  test('a cancelled dependency is settled', () => {
    const s = snap({
      issues: [
        { id: I(1), depends_on: [I(2)] },
        { id: I(2), state: 'cancelled' },
      ],
    });
    expect(readiness(s, I(1), leaf)).toEqual({ ready: true });
    expect(isReady(s, I(1), leaf)).toBe(true);
  });

  test('a parent with an open child is open_children on leaf level and ready on top level', () => {
    const s = snap({ issues: [{ id: I(1) }, { id: I(2), parent: I(1) }] });
    expect(readiness(s, I(1), leaf)).toEqual({
      ready: false,
      reason: 'open_children',
      ids: [I(2)],
    });
    expect(readiness(s, I(1), top)).toEqual({ ready: true });
    expect(isReady(s, I(1), leaf)).toBe(false);
  });

  test('settled children do not count as open', () => {
    const s = snap({
      issues: [{ id: I(1) }, { id: I(2), parent: I(1), state: 'done' }],
    });
    expect(openChildren(s, I(1))).toEqual([]);
    expect(readiness(s, I(1), leaf)).toEqual({ ready: true });
  });

  test('a paused grandparent makes descendants ancestor_paused', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'on_hold' },
        { id: I(2), parent: I(1) },
        { id: I(3), parent: I(2) },
      ],
    });
    expect(readiness(s, I(3), leaf)).toEqual({
      ready: false,
      reason: 'ancestor_paused',
      ids: [I(1)],
    });
  });

  test('a blocked parent pauses its children as well', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'blocked', blocked_by: [I(5)] },
        { id: I(2), parent: I(1) },
        { id: I(5) },
      ],
    });
    expect(readiness(s, I(2), leaf)).toMatchObject({ reason: 'ancestor_paused', ids: [I(1)] });
  });

  test('a parent with an open dependency gives ancestor_dependencies', () => {
    const s = snap({
      issues: [{ id: I(1), depends_on: [I(5)] }, { id: I(2), parent: I(1) }, { id: I(5) }],
    });
    expect(readiness(s, I(2), leaf)).toEqual({
      ready: false,
      reason: 'ancestor_dependencies',
      ids: [I(1)],
    });
  });

  test('a non-ready state gives state', () => {
    const s = snap({ issues: [{ id: I(1), state: 'in_progress', assignee: 'alice' }] });
    expect(readiness(s, I(1), leaf)).toEqual({ ready: false, reason: 'state', ids: [] });
  });

  test('backlog issues are ready', () => {
    expect(isReady(snap({ issues: [{ id: I(1), state: 'backlog' }] }), I(1), leaf)).toBe(true);
  });

  test.each([
    [
      'state wins over an open dependency',
      [{ id: I(1), state: 'in_progress', assignee: 'alice', depends_on: [I(5)] }, { id: I(5) }],
      I(1),
      { ready: false, reason: 'state', ids: [] },
    ],
    [
      'dependencies win over an open child',
      [{ id: I(1), depends_on: [I(5)] }, { id: I(2), parent: I(1) }, { id: I(5) }],
      I(1),
      { ready: false, reason: 'dependencies', ids: [I(5)] },
    ],
    [
      'open children win over a paused ancestor',
      [
        { id: I(1), state: 'on_hold' },
        { id: I(2), parent: I(1) },
        { id: I(3), parent: I(2) },
      ],
      I(2),
      { ready: false, reason: 'open_children', ids: [I(3)] },
    ],
    [
      'the nearest ancestor is reported first',
      [
        { id: I(1), state: 'on_hold' },
        { id: I(2), parent: I(1), depends_on: [I(5)] },
        { id: I(3), parent: I(2) },
        { id: I(5) },
      ],
      I(3),
      { ready: false, reason: 'ancestor_dependencies', ids: [I(2)] },
    ],
    [
      'a paused ancestor with an open dependency reports paused',
      [
        { id: I(1), state: 'on_hold', depends_on: [I(5)] },
        { id: I(2), parent: I(1) },
        { id: I(5) },
      ],
      I(2),
      { ready: false, reason: 'ancestor_paused', ids: [I(1)] },
    ],
  ] satisfies [string, SnapIssue[], string, Readiness][])(
    'reason order: %s',
    (_name, issues, id, expected) =>
      expect(readiness(snap({ issues }), id, leaf)).toEqual(expected),
  );

  test('an unknown id throws not_found', () => {
    for (const call of [
      () => readiness(snap(), I(1), leaf),
      () => isReady(snap(), I(1), leaf),
      () => isUnblockable(snap(), I(1)),
      () => occupyingAncestor(snap(), I(1), 'spw'),
      () => isClaimable(snap(), I(1), 'spw'),
    ]) {
      expect(catchErr(call).code).toBe('not_found');
    }
  });
});

describe('isUnblockable', () => {
  test('blocked with settled blockers is unblockable', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'blocked', blocked_by: [I(2), I(3)] },
        { id: I(2), state: 'done' },
        { id: I(3), state: 'rejected' },
      ],
    });
    expect(isUnblockable(s, I(1))).toBe(true);
  });

  test('a missing or open blocker keeps it blocked', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'blocked', blocked_by: [I(2), I(9)] },
        { id: I(2), state: 'done' },
        { id: I(4), state: 'blocked', blocked_by: [I(5)] },
        { id: I(5) },
      ],
    });
    expect(isUnblockable(s, I(1))).toBe(false);
    expect(isUnblockable(s, I(4))).toBe(false);
  });

  test('a non-blocked issue is not unblockable', () => {
    expect(isUnblockable(snap({ issues: [{ id: I(1) }] }), I(1))).toBe(false);
  });
});

describe('occupation and claim', () => {
  const tree = (parent: SnapIssue) => snap({ issues: [parent, { id: I(2), parent: parent.id }] });

  test('a child of a parent in progress with another assignee is occupied', () => {
    const s = tree({ id: I(1), state: 'in_progress', assignee: 'alice' });
    expect(occupyingAncestor(s, I(2), 'claude-1')).toBe(I(1));
    expect(isClaimable(s, I(2), 'claude-1')).toEqual({
      ok: false,
      reason: 'occupied',
      ids: [I(1)],
    });
    expect(isClaimable(s, I(2), 'alice')).toEqual({ ok: true });
  });

  test('review keeps the occupation', () => {
    const s = tree({ id: I(1), state: 'review', assignee: 'alice' });
    expect(occupyingAncestor(s, I(2), 'claude-1')).toBe(I(1));
  });

  test('a done parent does not occupy', () => {
    const s = tree({ id: I(1), state: 'done', assignee: 'alice' });
    expect(occupyingAncestor(s, I(2), 'claude-1')).toBeUndefined();
    expect(isClaimable(s, I(2), 'claude-1')).toEqual({ ok: true });
  });

  test('an on_hold parent does not occupy but makes the child not ready', () => {
    const s = tree({ id: I(1), state: 'on_hold', assignee: 'alice' });
    expect(occupyingAncestor(s, I(2), 'claude-1')).toBeUndefined();
    expect(isClaimable(s, I(2), 'claude-1')).toEqual({
      ok: false,
      reason: 'not_ready',
      ids: [I(1)],
    });
  });

  test('a parent in progress without assignee does not occupy', () => {
    const s = tree({ id: I(1), state: 'in_progress' });
    expect(occupyingAncestor(s, I(2), 'claude-1')).toBeUndefined();
  });

  test('a farther ancestor can occupy', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'in_progress', assignee: 'alice' },
        { id: I(2), parent: I(1) },
        { id: I(3), parent: I(2) },
      ],
    });
    expect(occupyingAncestor(s, I(3), 'claude-1')).toBe(I(1));
  });

  test('the nearest qualifying ancestor is reported', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'in_progress', assignee: 'alice' },
        { id: I(2), parent: I(1), state: 'review', assignee: 'spw' },
        { id: I(3), parent: I(2) },
      ],
    });
    expect(occupyingAncestor(s, I(3), 'claude-1')).toBe(I(2));
  });

  test('an own nearer ancestor is skipped in favour of a farther foreign one', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'in_progress', assignee: 'alice' },
        { id: I(2), parent: I(1), state: 'in_progress', assignee: 'claude-1' },
        { id: I(3), parent: I(2) },
      ],
    });
    expect(occupyingAncestor(s, I(3), 'claude-1')).toBe(I(1));
  });

  test('a nearer ancestor without assignee is skipped in favour of a farther foreign one', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'in_progress', assignee: 'alice' },
        { id: I(2), parent: I(1), state: 'in_progress' },
        { id: I(3), parent: I(2) },
      ],
    });
    expect(occupyingAncestor(s, I(3), 'claude-1')).toBe(I(1));
  });

  test('a parent with open children is claimable', () => {
    const s = tree({ id: I(1) });
    expect(isClaimable(s, I(1), 'claude-1')).toEqual({ ok: true });
  });

  test('an own in_progress issue is claimable, someone elses is not ready', () => {
    const s = snap({ issues: [{ id: I(1), state: 'in_progress', assignee: 'claude-1' }] });
    expect(isClaimable(s, I(1), 'claude-1')).toEqual({ ok: true });
    expect(isClaimable(s, I(1), 'alice')).toEqual({ ok: false, reason: 'not_ready', ids: [] });
  });

  test('an own in_progress issue below a foreign occupation is occupied', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'in_progress', assignee: 'alice' },
        { id: I(2), parent: I(1), state: 'in_progress', assignee: 'claude-1' },
      ],
    });
    expect(isClaimable(s, I(2), 'claude-1')).toEqual({
      ok: false,
      reason: 'occupied',
      ids: [I(1)],
    });
  });
});

describe('graphOf', () => {
  test('lists dependents and children sorted by compareIssues and caches per snapshot', () => {
    const s = snap({
      issues: [
        { id: I(1) },
        { id: I(2), depends_on: [I(1)], parent: I(1) },
        { id: I(3), depends_on: [I(1)], rank: 10, parent: I(1) },
        { id: I(4), depends_on: [I(1)], rank: 5 },
      ],
    });
    const g = graphOf(s);
    expect(g.dependents.get(I(1))).toEqual([I(4), I(3), I(2)]);
    expect(g.children.get(I(1))).toEqual([I(3), I(2)]);
    expect(g.children.get(I(4))).toBeUndefined();
    expect(graphOf(s)).toBe(g);
  });
});

describe('graphOf on a draft view', () => {
  test('patches the base graph to what a fresh build yields', () => {
    const s = snap({
      issues: [
        { id: I(1) },
        { id: I(2), parent: I(1), rank: 2000 },
        { id: I(3), parent: I(1), rank: 1000, depends_on: [I(4)] },
        { id: I(4), parent: I(2) },
        { id: I(5), depends_on: [I(4)] },
        { id: I(6), parent: I(5) },
      ],
    });
    const at = (id: string, patch: Partial<Issue>): StoredEntity<Issue> => {
      const e = s.issues.get(id) ?? (s.issues.get(I(1)) as StoredEntity<Issue>);
      return { ...e, data: { ...e.data, id, ...patch } };
    };
    graphOf(s);
    const view = new LayeredMap<StoredEntity<Issue>>(
      s.issues,
      new Map<string, StoredEntity<Issue> | undefined>([
        [I(2), at(I(2), { rank: 500 })],
        [I(4), at(I(4), { parent: I(5) })],
        [I(5), at(I(5), { depends_on: undefined })],
        [I(6), undefined],
        [I(7), at(I(7), { parent: I(1), depends_on: [I(4), I(3)] })],
      ]),
    );
    const patched = graphOf({ ...s, issues: view });
    const built = graphOf({ ...s, issues: new Map(view) });
    const sorted = (m: ReadonlyMap<string, readonly string[]>) =>
      [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
    expect(sorted(patched.children)).toEqual(sorted(built.children));
    expect(sorted(patched.dependents)).toEqual(sorted(built.dependents));
    expect(patched.children.get(I(1))).toEqual([I(2), I(3), I(7)]);
    expect([patched.children.has(I(5)), patched.children.has(I(2))]).toEqual([true, false]);
    expect(patched.children.size).toBe(built.children.size);
    expect([...patched.dependents.keys()].sort()).toEqual([...built.dependents.keys()].sort());
    expect([...patched.dependents.values()].length).toBe(built.dependents.size);
    const visited: string[] = [];
    patched.children.forEach((_, key) => {
      visited.push(key);
    });
    expect(visited.sort()).toEqual([...built.children.keys()].sort());
    expect([...patched.children].length).toBe(built.children.size);
  });

  test('a view without edge changes reuses the lists of the base', () => {
    const s = snap({ issues: [{ id: I(1) }, { id: I(2), parent: I(1) }] });
    const e = s.issues.get(I(2)) as StoredEntity<Issue>;
    const view = new LayeredMap(s.issues, new Map([[I(2), { ...e, body: 'neu\n' }]]));
    expect(graphOf({ ...s, issues: view }).children).toBe(graphOf(s).children);
  });
});

describe('childProgress', () => {
  test('counts settled direct children', () => {
    const s = snap({
      issues: [
        { id: I(1) },
        { id: I(2), parent: I(1), state: 'done' },
        { id: I(3), parent: I(1), state: 'cancelled' },
        { id: I(4), parent: I(1) },
        { id: I(5), parent: I(1), state: 'in_progress' },
        { id: I(6), parent: I(1), state: 'rejected' },
        { id: I(7), parent: I(4), state: 'done' },
      ],
    });
    expect(childProgress(s, I(1))).toEqual({ settled: 3, total: 5 });
    expect(childProgress(s, I(4))).toEqual({ settled: 1, total: 1 });
    expect(childProgress(s, I(7))).toBeUndefined();
  });
});

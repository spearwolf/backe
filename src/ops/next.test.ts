import { I, snap } from '../../test/helpers/snapshot.ts';
import type { Issue } from '../core/schemas.ts';
import type { State } from '../core/state.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { matchesContext, type NextQuery, selectNext } from './next.ts';

const q: NextQuery = { actor: 'claude-1', level: 'leaf', filter: {} };

function withState(s: BacklogSnapshot, id: string, state: State): BacklogSnapshot {
  const issues = new Map(s.issues);
  const entity = issues.get(id);
  if (!entity) throw new Error(`unbekannt: ${id}`);
  issues.set(id, { ...entity, data: { ...entity.data, state } });
  return { ...s, issues };
}

describe('selectNext', () => {
  test('order: todo before backlog, then rank, then topology, then created', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'backlog', rank: 1 },
        { id: I(2) },
        { id: I(3) },
        { id: I(4), depends_on: [I(3)] },
        { id: I(5), depends_on: [I(4)] },
        { id: I(6), rank: 5000 },
      ],
    });
    const order: string[] = [];
    let cur = s;
    for (let r = selectNext(cur, q); r.id; r = selectNext(cur, q)) {
      order.push(r.id);
      cur = withState(cur, r.id, 'done');
    }
    expect(order).toEqual([I(6), I(3), I(4), I(2), I(5), I(1)]);
  });

  test('topology counts transitive open dependents once, ignoring settled ones', () => {
    const s = snap({
      issues: [
        { id: I(1) },
        { id: I(2) },
        { id: I(3), depends_on: [I(1)] },
        { id: I(4), depends_on: [I(1), I(3)] },
        { id: I(5), depends_on: [I(2)] },
        { id: I(6), depends_on: [I(2)], state: 'done' },
      ],
    });
    // I(1) gibt I(3) und I(4) frei (2 offene), I(2) nur I(5) (I(6) ist erledigt)
    expect(selectNext(s, q)).toMatchObject({ id: I(1), resumed: false });
  });

  test('own in_progress comes first after a crash', () => {
    const s = snap({
      issues: [
        { id: I(1), rank: 1 },
        { id: I(2), state: 'in_progress', assignee: 'claude-1' },
      ],
    });
    expect(selectNext(s, q)).toMatchObject({ id: I(2), resumed: true });
  });

  test('own in_progress below a paused ancestor is not resumed', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'on_hold' },
        { id: I(2), parent: I(1), state: 'in_progress', assignee: 'claude-1' },
        { id: I(3) },
      ],
    });
    expect(selectNext(s, q)).toMatchObject({ id: I(3), resumed: false });
  });

  test('level top picks a parent with open sub-issues', () => {
    const s = snap({ issues: [{ id: I(1) }, { id: I(2), parent: I(1) }] });
    expect(selectNext(s, { ...q, level: 'top' })).toMatchObject({ id: I(1), resumed: false });
    expect(selectNext(s, q)).toMatchObject({ id: I(2) });
  });

  test('level top ignores sub-issues everywhere', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'done' },
        { id: I(2), parent: I(1), state: 'in_progress', assignee: 'claude-1' },
        { id: I(3), parent: I(1) },
      ],
    });
    expect(selectNext(s, { ...q, level: 'top' })).toMatchObject({ reason: 'nothing_open' });
  });

  test('leaf skips sub-issues occupied by another assignee', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'in_progress', assignee: 'alice' },
        { id: I(2), parent: I(1), rank: 1 },
        { id: I(3), rank: 2 },
      ],
    });
    expect(selectNext(s, q)).toMatchObject({ id: I(3) });
  });

  test('assigned todo of another user is no candidate, own assignment is', () => {
    const s = snap({
      issues: [
        { id: I(1), assignee: 'alice', rank: 1 },
        { id: I(2), assignee: 'claude-1', rank: 2 },
      ],
    });
    expect(selectNext(s, q)).toMatchObject({ id: I(2), resumed: false });
  });

  test('no candidate names waiting ids', () =>
    expect(
      selectNext(
        snap({
          issues: [
            { id: I(1), depends_on: [I(2)] },
            { id: I(2), state: 'in_progress', assignee: 'alice' },
          ],
        }),
        q,
      ),
    ).toMatchObject({ reason: 'waiting', waiting: [I(1)] }));

  test('waiting ids are sorted and include own assigned items', () => {
    const s = snap({
      issues: [
        { id: I(1), depends_on: [I(4)] },
        { id: I(2), assignee: 'claude-1', depends_on: [I(4)], rank: 1 },
        { id: I(3), assignee: 'alice', depends_on: [I(4)] },
        { id: I(4), state: 'review', assignee: 'alice' },
      ],
    });
    expect(selectNext(s, q)).toMatchObject({ reason: 'waiting', waiting: [I(2), I(1)] });
  });

  test('all_assigned when only foreign work is open', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'in_progress', assignee: 'alice' },
        { id: I(2), assignee: 'alice' },
        { id: I(3), state: 'blocked', blocked_by: [I(1)] },
      ],
    });
    const r = selectNext(s, q);
    expect(r).toMatchObject({ reason: 'all_assigned', resumed: false });
    expect(r.id).toBeUndefined();
  });

  test('all_blocked when only paused issues remain', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'blocked', blocked_by: [I(9)] },
        { id: I(2), state: 'on_hold' },
        { id: I(3), state: 'done' },
      ],
    });
    expect(selectNext(s, q)).toMatchObject({ reason: 'all_blocked' });
  });

  test('nothing_open for an empty or settled backlog', () => {
    expect(selectNext(snap(), q)).toMatchObject({ reason: 'nothing_open', notices: [] });
    expect(selectNext(snap({ issues: [{ id: I(1), state: 'done' }] }), q)).toMatchObject({
      reason: 'nothing_open',
    });
  });

  test('context filter limits candidates and the no-candidate reason', () => {
    const s = snap({
      sprints: ['s1'],
      issues: [
        { id: I(1), rank: 1 },
        { id: I(2), sprints: ['s1'] },
      ],
    });
    const f = { ...q, filter: { sprint: 's1' } };
    expect(selectNext(s, f)).toMatchObject({ id: I(2) });
    expect(selectNext(withState(s, I(2), 'done'), f)).toMatchObject({ reason: 'nothing_open' });
  });

  test('settled_dependency notice names cancelled and rejected dependencies', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'cancelled' },
        { id: I(2), state: 'rejected' },
        { id: I(3), state: 'done' },
        { id: I(4), depends_on: [I(1), I(2), I(3)] },
      ],
    });
    const r = selectNext(s, q);
    expect(r.id).toBe(I(4));
    expect(r.notices).toHaveLength(1);
    expect(r.notices[0]).toMatchObject({ code: 'settled_dependency', ids: [I(1), I(2)] });
  });

  test('unblockable notice says which blockers are not done', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'cancelled' },
        { id: I(2), state: 'done' },
        { id: I(3), state: 'blocked', blocked_by: [I(1), I(2)] },
        { id: I(4), state: 'blocked', blocked_by: [I(2)] },
        { id: I(5), state: 'blocked', blocked_by: [I(6)] },
        { id: I(6) },
      ],
    });
    const n = selectNext(s, q).notices.find((x) => x.code === 'unblockable');
    expect(n?.ids).toEqual([I(3), I(4)]);
    expect(n?.message).toContain(I(3));
    expect(n?.message).toContain(`${I(1)} (cancelled)`);
  });

  test('unblockable notice respects the context filter', () => {
    const s = snap({
      sprints: ['s1'],
      issues: [
        { id: I(1), state: 'done' },
        { id: I(2), state: 'blocked', blocked_by: [I(1)] },
      ],
    });
    expect(selectNext(s, { ...q, filter: { sprint: 's1' } }).notices).toEqual([]);
    expect(selectNext(s, q).notices).toHaveLength(1);
  });
});

describe('matchesContext', () => {
  const issue = (over: Partial<Issue>): Issue => {
    const found = snap({ issues: [{ id: I(1), ...over }] }).issues.get(I(1));
    if (!found) throw new Error('Issue fehlt');
    return found.data;
  };

  test('empty filter matches everything', () => {
    expect(matchesContext(issue({}), {})).toBe(true);
  });

  test('project is recursive: web covers web/auth but not webapp', () => {
    const f = { project: 'web' };
    expect(matchesContext(issue({ projects: ['web'] }), f)).toBe(true);
    expect(matchesContext(issue({ projects: ['web/auth'] }), f)).toBe(true);
    expect(matchesContext(issue({ projects: ['webapp'] }), f)).toBe(false);
    expect(matchesContext(issue({}), f)).toBe(false);
  });

  test('projectExact matches only the exact path', () => {
    const f = { project: 'web', projectExact: true };
    expect(matchesContext(issue({ projects: ['web'] }), f)).toBe(true);
    expect(matchesContext(issue({ projects: ['web/auth'] }), f)).toBe(false);
  });

  test('sprint matches membership', () => {
    expect(matchesContext(issue({ sprints: ['s1', 's2'] }), { sprint: 's2' })).toBe(true);
    expect(matchesContext(issue({ sprints: ['s1'] }), { sprint: 's2' })).toBe(false);
  });

  test('repo matches by name before the @', () => {
    expect(matchesContext(issue({ repos: ['webapp@feat/x'] }), { repo: 'webapp' })).toBe(true);
    expect(matchesContext(issue({ repos: ['webapp2'] }), { repo: 'webapp' })).toBe(false);
  });

  test('all given filters must match', () => {
    const i = issue({ projects: ['web'], sprints: ['s1'] });
    expect(matchesContext(i, { project: 'web', sprint: 's1' })).toBe(true);
    expect(matchesContext(i, { project: 'web', sprint: 's2' })).toBe(false);
  });
});

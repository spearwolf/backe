/**
 * Replay (backe.md §2.16.4): Operation A (alice) geht auf den Basisstand S, Operation B
 * (claude-1) wurde gegen S aufgezeichnet und läuft auf S_A.
 */

import { catchErr } from '../../test/helpers/catch.ts';
import { I, seqBytes, snap } from '../../test/helpers/snapshot.ts';
import { BackeError } from '../core/errors.ts';
import type { Comment } from '../core/schemas.ts';
import { serializeEntityFile } from '../store/frontmatter.ts';
import type { BacklogSnapshot, StoredEntity } from '../store/snapshot.ts';
import { type ApplyContext, applyOperation } from './apply.ts';
import { applyBatch } from './batch.ts';
import { bodyHash, type Operation } from './operation.ts';
import { isViolation, rebaseOp, rewriteCollisions, taintKeys } from './replay.ts';

const ctx = (actor: string): ApplyContext => ({
  actor,
  now: '2026-11-19T08:00:00Z',
  randomBytes: seqBytes(),
});

const asAlice = (s: BacklogSnapshot, op: Operation) => applyOperation(s, op, ctx('alice'));
const asAgent = (s: BacklogSnapshot, op: Operation) => applyOperation(s, op, ctx('claude-1'));
const reasonOf = (fn: () => unknown) => (catchErr(fn).details as { reason?: string }).reason;
const dataOf = (s: BacklogSnapshot, id: string) => s.issues.get(id)?.data;
const fileOf = (s: BacklogSnapshot, id: string) => {
  const e = s.issues.get(id);
  if (e === undefined) throw new Error(`Issue ${id} fehlt`);
  return serializeEntityFile('issue', e.data, e.body, e.extra);
};
const setTitle = (id: string, from: string, to: string): Operation => ({
  op: 'issue.edit',
  id,
  set: { title: { from, to } },
});

describe('replay of B recorded against S onto S_A', () => {
  test('conflicting set.title is a precondition conflict', () => {
    const s = snap({ issues: [{ id: I(1), title: 'A' }] });
    const sA = asAlice(s, setTitle(I(1), 'A', 'B')).snapshot;
    expect(reasonOf(() => asAgent(sA, setTitle(I(1), 'A', 'C')))).toBe('precondition');
  });

  test('identical set.title is a no-op', () => {
    const s = snap({ issues: [{ id: I(1), title: 'A' }] });
    const sA = asAlice(s, setTitle(I(1), 'A', 'C')).snapshot;
    const r = asAgent(sA, setTitle(I(1), 'A', 'C'));
    expect([r.noop, r.changes]).toEqual([true, []]);
  });

  test('props on different keys both apply', () => {
    const s = snap({ issues: [{ id: I(1), props: { x: 1 } }] });
    const sA = asAlice(s, {
      op: 'issue.edit',
      id: I(1),
      props: { x: { from: 1, to: 2 } },
    }).snapshot;
    const r = asAgent(sA, { op: 'issue.edit', id: I(1), props: { y: { from: null, to: 3 } } });
    expect(dataOf(r.snapshot, I(1))?.props).toEqual({ x: 2, y: 3 });
  });

  test('depends_on edges that close a cycle are refused', () => {
    const s = snap({ issues: [{ id: I(1) }, { id: I(2) }] });
    const sA = asAlice(s, {
      op: 'issue.edit',
      id: I(1),
      add: { depends_on: [I(2)] },
    }).snapshot;
    const b: Operation = { op: 'issue.edit', id: I(2), add: { depends_on: [I(1)] } };
    expect(reasonOf(() => asAgent(sA, b))).toBe('cycle');
  });

  test('add and remove on a list commute', () => {
    const s = snap({ projects: ['web', 'api'], issues: [{ id: I(1), projects: ['web'] }] });
    const a: Operation = { op: 'issue.edit', id: I(1), add: { projects: ['api'] } };
    const b: Operation = { op: 'issue.edit', id: I(1), remove: { projects: ['web'] } };
    const ab = asAgent(asAlice(s, a).snapshot, b).snapshot;
    const ba = asAlice(asAgent(s, b).snapshot, a).snapshot;
    expect(dataOf(ab, I(1))?.projects).toEqual(['api']);
    expect(fileOf(ab, I(1))).toBe(fileOf(ba, I(1)));
  });

  test('project.mv carries an issue that another writer attached to the old path', () => {
    const s = snap({ projects: ['web', 'web/auth'], issues: [{ id: I(2) }] });
    const sA = asAlice(s, {
      op: 'issue.edit',
      id: I(2),
      add: { projects: ['web/auth'] },
    }).snapshot;
    const r = asAgent(sA, { op: 'project.mv', from: 'web', to: 'platform' });
    expect(dataOf(r.snapshot, I(2))?.projects).toEqual(['platform/auth']);
  });

  test('rank before is computed against the new neighbours', () => {
    const s = snap({
      issues: [{ id: I(1), rank: 3000 }, { id: I(2), rank: 2000 }, { id: I(3) }],
    });
    const sA = asAlice(s, { op: 'issue.rank', id: I(3), from: null, value: 1500 }).snapshot;
    const r = asAgent(sA, { op: 'issue.rank', id: I(1), from: 3000, before: I(2) });
    const rank = dataOf(r.snapshot, I(1))?.rank as number;
    expect(rank).toBeGreaterThan(1500);
    expect(rank).toBeLessThan(2000);
  });

  test('deleting an issue that A made a dependency target is refused with references', () => {
    const s = snap({ issues: [{ id: I(1) }] });
    const sA = asAlice(s, {
      op: 'issue.create',
      id: I(9),
      title: 'neu',
      depends_on: [I(1)],
    }).snapshot;
    expect(reasonOf(() => asAgent(sA, { op: 'issue.delete', id: I(1) }))).toBe('references');
  });

  test('moving a parent to done after A added an open child is refused', () => {
    const s = snap({ issues: [{ id: I(1), state: 'review' }] });
    const sA = asAlice(s, { op: 'issue.create', id: I(9), title: 'Kind', parent: I(1) }).snapshot;
    const b: Operation = { op: 'issue.move', id: I(1), from: 'review', to: 'done' };
    expect(reasonOf(() => asAgent(sA, b))).toBe('open_children');
  });

  test('two creates with the same explicit id collide', () => {
    const sA = asAlice(snap({}), { op: 'issue.create', id: I(7), title: 'A' }).snapshot;
    const b: Operation = { op: 'issue.create', id: I(7), title: 'B' };
    expect(reasonOf(() => asAgent(sA, b))).toBe('id_collision');
  });

  test('commenting on an issue A deleted is a missing_ref', () => {
    const s = snap({ issues: [{ id: I(1) }] });
    const sA = asAlice(s, { op: 'issue.delete', id: I(1) }).snapshot;
    const b: Operation = { op: 'comment.add', id: I(1), body: 'hallo' };
    expect(reasonOf(() => asAgent(sA, b))).toBe('missing_ref');
  });

  test('a batch whose second operation fails on S_A fails as a whole', () => {
    const s = snap({ issues: [{ id: I(1), title: 'A' }, { id: I(2) }] });
    const sA = asAlice(s, setTitle(I(1), 'A', 'B')).snapshot;
    const err = catchErr(() =>
      applyBatch(
        sA,
        [{ op: 'issue.create', title: 'neu' }, setTitle(I(1), 'A', 'C')],
        ctx('claude-1'),
      ),
    );
    expect([err.code, (err.details as { reason?: string }).reason, err.message]).toEqual([
      'conflict',
      'precondition',
      expect.stringMatching(/^Zeile 2: /),
    ]);
    expect(sA.issues.size).toBe(2);
  });
});

const F = '20261119T080000Z-alice-abc.md';
const create = (id: string, title: string): Operation => ({ op: 'issue.create', id, title });

describe('rewriteCollisions', () => {
  test('a colliding create gets a fresh id and later ops follow', () => {
    const s = snap({ issues: [{ id: I(1), title: 'remote' }] });
    const map = new Map<string, string>();
    const r = rewriteCollisions(
      s,
      [create(I(1), 'lokal'), { op: 'comment.add', id: I(1), file: F, body: 'x' }],
      map,
      { randomBytes: seqBytes(9) },
    );
    const fresh = map.get(I(1));
    expect(fresh).toBeDefined();
    expect(fresh).not.toBe(I(1));
    expect(r.ops.map((o) => 'id' in o && o.id)).toEqual([fresh, fresh]);
    expect(r.notices).toEqual([
      {
        code: 'id_rewritten',
        message: `ID-Kollision: ${I(1)} heißt jetzt ${fresh}`,
        ids: [I(1), fresh],
      },
    ]);
  });

  test('an existing map applies to ops of later units without new notices', () => {
    const s = snap();
    const r = rewriteCollisions(s, [setTitle(I(1), 'A', 'B')], new Map([[I(1), I(2)]]), {
      randomBytes: seqBytes(),
    });
    expect([r.ops, r.notices]).toEqual([[setTitle(I(2), 'A', 'B')], []]);
  });

  test('creates without collision stay untouched', () => {
    const s = snap({ issues: [{ id: I(1) }] });
    const ops: Operation[] = [create(I(2), 'neu'), { op: 'issue.create', title: 'ohne id' }];
    const map = new Map<string, string>();
    expect(rewriteCollisions(s, ops, map, { randomBytes: seqBytes() })).toEqual({
      ops,
      notices: [],
    });
    expect(map.size).toBe(0);
  });

  test('a fresh id avoids ids that other creates of the unit carry', () => {
    const s = snap({ issues: [{ id: I(1) }] });
    // seqBytes(0) liefert zuerst 0,1,2,3,4 -> »01234«; genau diese ID nimmt die zweite Create.
    const taken = 'bk-01234';
    const map = new Map<string, string>();
    const r = rewriteCollisions(s, [create(I(1), 'a'), create(taken, 'b')], map, {
      randomBytes: seqBytes(0),
    });
    expect(map.get(I(1))).not.toBe(taken);
    expect(r.ops[1]).toEqual(create(taken, 'b'));
  });
});

describe('taintKeys', () => {
  test('names issue ids, created ids and entity subjects', () => {
    expect(
      taintKeys(
        [
          { op: 'comment.add', id: I(1), body: 'x' },
          { op: 'issue.edit', id: I(2), set: { parent: { from: null, to: I(1) } } },
          { op: 'sprint.close', slug: '2026-w47' },
          { op: 'project.create', path: 'api', title: 'API' },
          { op: 'repo.rm', name: 'api' },
          { op: 'user.rm', handle: 'claude-1' },
          {
            op: 'entity.edit',
            kind: 'project',
            key: 'web',
            set: { title: { from: 'a', to: 'b' } },
          },
          { op: 'repo.add', url: 'https://github.com/acme/webapp.git' },
        ],
        [I(9)],
      ),
    ).toEqual([
      I(1),
      I(2),
      I(9),
      'sprint:2026-w47',
      'project:api',
      'repo:api',
      'user:claude-1',
      'project:web',
      'repo:webapp',
    ]);
  });

  test('project.mv taints both the old and the new path', () => {
    expect(taintKeys([{ op: 'project.mv', from: 'web/auth', to: 'platform/auth' }], [])).toEqual([
      'project:web/auth',
      'project:platform/auth',
    ]);
  });

  test('project.rm with reassign taints the target too', () => {
    expect(taintKeys([{ op: 'project.rm', path: 'web', reassign: 'platform' }], [])).toEqual([
      'project:web',
      'project:platform',
    ]);
    expect(taintKeys([{ op: 'project.rm', path: 'web', detach: true }], [])).toEqual([
      'project:web',
    ]);
  });

  test('repo.add without a name taints the derived name', () => {
    expect(taintKeys([{ op: 'repo.add', url: 'https://github.com/acme/WebApp.git' }], [])).toEqual([
      'repo:webapp',
    ]);
    expect(
      taintKeys([{ op: 'repo.add', url: 'https://github.com/acme/webapp', name: 'web' }], []),
    ).toEqual(['repo:web']);
  });

  test('taint over created ids reaches ids the operations do not name', () => {
    expect(
      taintKeys(
        [
          { op: 'issue.create', title: 'Neu' },
          { op: 'comment.add', id: I(3), body: 'x' },
        ],
        [I(4)],
      ),
    ).toEqual([I(3), I(4)]);
  });
});

describe('rebaseOp', () => {
  test('moves preconditions to the current values', () => {
    const s = snap({
      issues: [{ id: I(1), title: 'B', state: 'review', assignee: 'alice', props: { x: 1 } }],
    });
    expect(rebaseOp(s, setTitle(I(1), 'A', 'C'))).toEqual(setTitle(I(1), 'B', 'C'));
    expect(rebaseOp(s, { op: 'issue.move', id: I(1), from: 'todo', to: 'done' })).toMatchObject({
      from: 'review',
    });
    expect(
      rebaseOp(s, {
        op: 'issue.edit',
        id: I(1),
        set: { assignee: { from: null, to: 'spw' }, parent: { from: I(2), to: null } },
        props: { x: { from: 5, to: 6 }, y: { from: 1, to: 2 } },
      }),
    ).toEqual({
      op: 'issue.edit',
      id: I(1),
      set: { assignee: { from: 'alice', to: 'spw' }, parent: { from: null, to: null } },
      props: { x: { from: 1, to: 6 }, y: { from: null, to: 2 } },
    });
  });

  test('rebases the body hash of issues and entities', () => {
    const base = snap({ projects: ['web'], issues: [{ id: I(1) }] });
    const withBody = <T>(e: StoredEntity<T> | undefined, body: string) => {
      if (e === undefined) throw new Error('Entität fehlt');
      return { ...e, body };
    };
    const s = {
      ...base,
      issues: new Map([[I(1), withBody(base.issues.get(I(1)), 'neu')]]),
      projects: new Map([['web', withBody(base.projects.get('web'), 'p neu')]]),
    };
    expect(
      rebaseOp(s, { op: 'issue.edit', id: I(1), body: { from_hash: bodyHash('alt'), to: 'x' } }),
    ).toEqual({
      op: 'issue.edit',
      id: I(1),
      body: { from_hash: bodyHash('neu'), to: 'x' },
    });
    expect(
      rebaseOp(s, {
        op: 'entity.edit',
        kind: 'project',
        key: 'web',
        set: { title: { from: 'x', to: 'y' } },
        body: { from_hash: bodyHash('alt'), to: 'x' },
      }),
    ).toEqual({
      op: 'entity.edit',
      kind: 'project',
      key: 'web',
      set: { title: { from: 'web', to: 'y' } },
      body: { from_hash: bodyHash('p neu'), to: 'x' },
    });
  });

  test('rebases resume, reopen and rank preconditions', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'on_hold', paused_from: 'todo' },
        { id: I(2), state: 'cancelled', rank: 5 },
      ],
    });
    expect(rebaseOp(s, { op: 'issue.resume', id: I(1), from: 'blocked' })).toMatchObject({
      from: 'on_hold',
    });
    expect(rebaseOp(s, { op: 'issue.reopen', id: I(2), from: 'done' })).toMatchObject({
      from: 'cancelled',
    });
    expect(rebaseOp(s, { op: 'issue.rank', id: I(2), from: null, top: true })).toMatchObject({
      from: 5,
    });
    // Passt der Ist-Zustand nicht zur Form der Operation, bleibt sie, wie sie ist.
    const resume: Operation = { op: 'issue.resume', id: I(2), from: 'blocked' };
    expect(rebaseOp(s, resume)).toBe(resume);
  });

  test('rebases comment.edit hash from the loaded comments', () => {
    const s = snap({ issues: [{ id: I(1) }] });
    const path = `issues/${I(1).slice(3, 5)}/${I(1)}/comments/${F}`;
    const comments = new Map<string, StoredEntity<Comment>[]>([
      [
        I(1),
        [
          {
            path,
            body: 'jetzt',
            extra: [],
            data: { author: 'alice', created: '2026-11-19T08:00:00Z' },
          },
        ],
      ],
    ]);
    const op: Operation = {
      op: 'comment.edit',
      id: I(1),
      file: F,
      from_hash: bodyHash('alt'),
      body: 'x',
    };
    expect(rebaseOp(s, op, comments)).toEqual({ ...op, from_hash: bodyHash('jetzt') });
    expect(rebaseOp(s, op)).toBe(op);
    expect(rebaseOp(s, { ...op, file: 'fehlt.md' }, comments)).toMatchObject({
      from_hash: bodyHash('alt'),
    });
  });

  test('ops without preconditions or for missing targets come back unchanged', () => {
    const s = snap();
    const ops: Operation[] = [
      { op: 'issue.claim', id: I(1) },
      { op: 'issue.move', id: I(1), from: 'todo', to: 'done' },
      { op: 'issue.edit', id: I(1), add: { projects: ['web'] } },
      { op: 'entity.edit', kind: 'repo', key: 'api', set: { url: { from: 'a', to: 'b' } } },
      { op: 'project.mv', from: 'a', to: 'b' },
    ];
    for (const op of ops) expect(rebaseOp(s, op)).toBe(op);
  });

  test('a rebased op still fails on invariants', () => {
    const s = snap({
      issues: [
        { id: I(1), title: 'B' },
        { id: I(2), depends_on: [I(1)] },
      ],
    });
    const op = rebaseOp(s, {
      op: 'issue.edit',
      id: I(1),
      set: { title: { from: 'A', to: 'C' } },
      add: { depends_on: [I(2)] },
    });
    expect(reasonOf(() => asAlice(s, op))).toBe('cycle');
  });
});

describe('isViolation', () => {
  test('recognises BackeErrors that carry a reason', () => {
    const s = snap({ issues: [{ id: I(1), title: 'A' }] });
    const err = catchErr(() => asAlice(s, setTitle(I(1), 'X', 'Y')));
    expect(isViolation(err)).toBe(true);
    expect(isViolation(new BackeError('usage', 'x'))).toBe(false);
    expect(isViolation(new Error('x'))).toBe(false);
    expect(isViolation(null)).toBe(false);
  });
});

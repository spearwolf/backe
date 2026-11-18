import { catchErr } from '../../test/helpers/catch.ts';
import { I, type SnapSpec, seqBytes, snap, withExtra } from '../../test/helpers/snapshot.ts';
import type { Issue } from '../core/schemas.ts';
import { serializeEntityFile } from '../store/frontmatter.ts';
import { issueFile } from '../store/layout.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { type ApplyContext, applyOperation } from './apply.ts';
import { bodyHash, type OpOf } from './operation.ts';

const ctx = (actor = 'spw', extra: Partial<ApplyContext> = {}): ApplyContext => ({
  actor,
  now: '2026-11-19T08:00:00Z',
  randomBytes: seqBytes(),
  ...extra,
});

const reasonOf = (err: { details?: unknown }) => (err.details as { reason?: string }).reason;

function edit(
  s: BacklogSnapshot,
  fields: Omit<OpOf<'issue.edit'>, 'op' | 'id'>,
  id = I(1),
): ReturnType<typeof applyOperation> {
  return applyOperation(s, { op: 'issue.edit', id, ...fields } as OpOf<'issue.edit'>, ctx());
}

function editErr(s: BacklogSnapshot, fields: Omit<OpOf<'issue.edit'>, 'op' | 'id'>, id = I(1)) {
  return catchErr(() => edit(s, fields, id));
}

const data = (r: { snapshot: BacklogSnapshot }, id = I(1)): Issue => {
  const found = r.snapshot.issues.get(id);
  if (found === undefined) throw new Error(`${id} fehlt`);
  return found.data;
};

const REPOS = {
  webapp: 'https://example.com/acme/webapp.git',
  infra: 'https://example.com/acme/infra.git',
};

describe('issue.create', () => {
  test('create writes a canonical file and records generated values', () => {
    const r = applyOperation(snap({}), { op: 'issue.create', title: 'Neu' }, ctx());
    const id = (r.recorded as OpOf<'issue.create'>).id as string;
    expect(id).toBe('bk-01234');
    expect(r.recorded).toMatchObject({
      id,
      state: 'backlog',
      created: '2026-11-19T08:00:00Z',
      projects: [],
      sprints: [],
      repos: [],
    });
    expect(r.changes).toEqual([
      {
        path: issueFile(id),
        content: serializeEntityFile('issue', r.snapshot.issues.get(id)?.data ?? {}, ''),
      },
    ]);
    expect(data(r, id)).toEqual({
      id,
      title: 'Neu',
      state: 'backlog',
      creator: 'spw',
      created: '2026-11-19T08:00:00Z',
    });
    expect(r.noop).toBe(false);
    expect(r.notices).toEqual([]);
  });

  test('generated ids skip existing issues and unreadable issue files', () => {
    const s = snap({ issues: [{ id: 'bk-01234' }] });
    s.problems.push({
      path: 'issues/56/bk-56789/issue.md',
      message: 'kaputt',
      kind: 'issue',
      key: 'bk-56789',
    });
    const r = applyOperation(s, { op: 'issue.create', title: 'Neu' }, ctx());
    expect((r.recorded as OpOf<'issue.create'>).id).toBe('bk-abcde');
  });

  test('creator is the actor, given created and body are kept', () => {
    const r = applyOperation(
      snap({}),
      { op: 'issue.create', id: I(5), title: 'T', body: 'Text\n', created: '2026-01-02T03:04:05Z' },
      ctx('alice'),
    );
    expect(data(r, I(5))).toMatchObject({ creator: 'alice', created: '2026-01-02T03:04:05Z' });
    expect(r.snapshot.issues.get(I(5))?.body).toBe('Text\n');
    expect(r.changes[0]?.content).toMatch(/---\nText\n$/);
  });

  test('sub-issue inherits projects, sprints and repos unless given', () => {
    const s = snap({
      projects: ['web', 'api'],
      sprints: ['s1'],
      repos: REPOS,
      issues: [{ id: I(1), projects: ['web'], sprints: ['s1'], repos: ['webapp@main'] }],
    });
    const inherited = applyOperation(
      s,
      { op: 'issue.create', id: I(2), title: 'Sub', parent: I(1) },
      ctx(),
    );
    expect(inherited.recorded).toMatchObject({
      projects: ['web'],
      sprints: ['s1'],
      repos: ['webapp@main'],
    });
    expect(data(inherited, I(2))).toMatchObject({
      parent: I(1),
      projects: ['web'],
      sprints: ['s1'],
      repos: ['webapp@main'],
    });

    const own = applyOperation(
      s,
      {
        op: 'issue.create',
        id: I(2),
        title: 'Sub',
        parent: I(1),
        projects: ['api'],
        sprints: [],
        repos: [],
      },
      ctx(),
    );
    expect(own.recorded).toMatchObject({ projects: ['api'], sprints: [], repos: [] });
    const created = data(own, I(2));
    expect(created.projects).toEqual(['api']);
    expect(created).not.toHaveProperty('sprints');
    expect(created).not.toHaveProperty('repos');
  });

  test('create with an existing id is an id collision', () =>
    expect(
      catchErr(() =>
        applyOperation(
          snap({ issues: [{ id: I(1) }] }),
          { op: 'issue.create', id: I(1), title: 'x' },
          ctx(),
        ),
      ).details,
    ).toMatchObject({ reason: 'id_collision', ids: [I(1)] }));

  test('a blocked issue can be created with blockers and paused_from', () => {
    const s = snap({ issues: [{ id: I(1) }] });
    const r = applyOperation(
      s,
      {
        op: 'issue.create',
        id: I(2),
        title: 'B',
        state: 'blocked',
        blocked_by: [I(1)],
        paused_from: 'todo',
      },
      ctx(),
    );
    expect(data(r, I(2))).toMatchObject({
      state: 'blocked',
      blocked_by: [I(1)],
      paused_from: 'todo',
    });
    expect(r.recorded).toMatchObject({ state: 'blocked' });
  });

  test('schema violations of the new issue are reported as schema', () => {
    const err = catchErr(() =>
      applyOperation(
        snap({}),
        { op: 'issue.create', id: I(2), title: 'B', state: 'blocked' },
        ctx(),
      ),
    );
    expect([err.code, reasonOf(err)]).toEqual(['validation', 'schema']);
    expect(err.message).toContain('blocked_by');
  });

  test.each<[string, Partial<OpOf<'issue.create'>>, string[]]>([
    ['parent', { parent: I(9) }, [I(9)]],
    ['dependency', { depends_on: [I(8), I(9)] }, [I(8), I(9)]],
    ['assignee', { assignee: 'nobody' }, ['nobody']],
    ['project', { projects: ['web'] }, ['web']],
    ['sprint', { sprints: ['s9'] }, ['s9']],
    ['repo', { repos: ['ghost@main'] }, ['ghost']],
  ])('a missing %s is a missing reference', (_, fields, ids) => {
    const err = catchErr(() =>
      applyOperation(snap({}), { op: 'issue.create', id: I(2), title: 'x', ...fields }, ctx()),
    );
    expect([err.code, err.details]).toEqual(['not_found', { reason: 'missing_ref', ids }]);
  });

  test('declared props are type-checked on create', () => {
    const s = snap({
      config: { props: { estimate_h: { type: 'integer', description: 'Stunden' } } },
    });
    const ok = applyOperation(
      s,
      { op: 'issue.create', id: I(2), title: 'x', props: { estimate_h: 4 } },
      ctx(),
    );
    expect(data(ok, I(2)).props).toEqual({ estimate_h: 4 });
    const err = catchErr(() =>
      applyOperation(
        s,
        { op: 'issue.create', id: I(2), title: 'x', props: { estimate_h: 'viel' } },
        ctx(),
      ),
    );
    expect([err.code, reasonOf(err)]).toEqual(['validation', 'prop']);
  });

  test('creating the missing target of an existing dependency can close a cycle', () => {
    const s = snap({ issues: [{ id: I(1), depends_on: [I(2)] }] });
    const err = catchErr(() =>
      applyOperation(s, { op: 'issue.create', id: I(2), title: 'x', depends_on: [I(1)] }, ctx()),
    );
    expect([err.code, reasonOf(err)]).toEqual(['validation', 'cycle']);
    expect(err.message).toContain(`${I(2)} -> ${I(1)} -> ${I(2)}`);
  });
});

describe('issue.edit', () => {
  test('a missing issue is a missing reference', () => {
    const err = editErr(snap({}), { set: { title: { from: 'a', to: 'b' } } });
    expect([err.code, err.details]).toEqual(['not_found', { reason: 'missing_ref', ids: [I(1)] }]);
  });

  test('set with stale from is a precondition conflict', () => {
    const err = catchErr(() =>
      applyOperation(
        snap({ issues: [{ id: I(1), title: 'B' }] }),
        { op: 'issue.edit', id: I(1), set: { title: { from: 'A', to: 'C' } } },
        ctx(),
      ),
    );
    expect([err.code, (err.details as { reason: string }).reason]).toEqual([
      'conflict',
      'precondition',
    ]);
  });

  test('set to the current value is a no-op', () => {
    const s = snap({ issues: [{ id: I(1), title: 'B', assignee: 'alice' }] });
    const r = edit(s, {
      set: { title: { from: 'A', to: 'B' }, assignee: { from: 'claude-1', to: 'alice' } },
    });
    expect(r.noop).toBe(true);
    expect(r.changes).toEqual([]);
    expect(r.snapshot.issues.get(I(1))).toBe(s.issues.get(I(1)));
  });

  test('set changes title, assignee and parent', () => {
    const s = snap({ issues: [{ id: I(1), title: 'A' }, { id: I(2) }] });
    const r = edit(s, {
      set: {
        title: { from: 'A', to: 'C' },
        assignee: { from: null, to: 'claude-1' },
        parent: { from: null, to: I(2) },
      },
    });
    expect(data(r)).toMatchObject({ title: 'C', assignee: 'claude-1', parent: I(2) });
    expect(r.recorded).toEqual({
      op: 'issue.edit',
      id: I(1),
      set: {
        title: { from: 'A', to: 'C' },
        assignee: { from: null, to: 'claude-1' },
        parent: { from: null, to: I(2) },
      },
    });
    expect(r.changes.map((c) => c.path)).toEqual([issueFile(I(1))]);
  });

  test('set to null removes the field', () => {
    const s = snap({ issues: [{ id: I(1), assignee: 'alice', parent: I(2) }, { id: I(2) }] });
    const r = edit(s, {
      set: { assignee: { from: 'alice', to: null }, parent: { from: I(2), to: null } },
    });
    expect(data(r)).not.toHaveProperty('assignee');
    expect(data(r)).not.toHaveProperty('parent');
  });

  test('a stale null precondition conflicts', () => {
    const s = snap({ issues: [{ id: I(1), assignee: 'alice' }] });
    expect(reasonOf(editErr(s, { set: { assignee: { from: null, to: 'spw' } } }))).toBe(
      'precondition',
    );
  });

  test('a new assignee must exist', () => {
    const err = editErr(snap({ issues: [{ id: I(1) }] }), {
      set: { assignee: { from: null, to: 'bob' } },
    });
    expect(err.details).toEqual({ reason: 'missing_ref', ids: ['bob'] });
  });

  test('unknown keys survive an edit', () => {
    const s = withExtra(snap({ issues: [{ id: I(1) }] }), I(1), [['legacy', 1]]);
    const r = applyOperation(
      s,
      { op: 'issue.edit', id: I(1), set: { title: { from: I(1), to: 'Neu' } } },
      ctx(),
    );
    expect(r.changes[0]?.content).toContain('legacy: 1\n');
    expect(r.snapshot.issues.get(I(1))?.extra).toEqual([['legacy', 1]]);
  });

  test('existing dangling refs do not block unrelated edits', () => {
    const s = snap({
      issues: [{ id: I(1), depends_on: [I(9)], assignee: 'ghost', projects: ['gone'] }],
    });
    const r = edit(s, { set: { title: { from: I(1), to: 'Neu' } } });
    expect(data(r)).toMatchObject({
      title: 'Neu',
      depends_on: [I(9)],
      assignee: 'ghost',
      projects: ['gone'],
    });
  });

  test('adding a dependency that closes a cycle names it', () => {
    const s = snap({ issues: [{ id: I(1) }, { id: I(2), depends_on: [I(1)] }] });
    const err = editErr(s, { add: { depends_on: [I(2)] } });
    expect([err.code, reasonOf(err)]).toEqual(['validation', 'cycle']);
    expect(err.message).toContain('bk-t0001 -> bk-t0002 -> bk-t0001');
    expect(err.details).toMatchObject({ ids: [I(1), I(2), I(1)] });
  });

  test('an existing cycle the new edge is not part of does not block', () => {
    const s = snap({
      issues: [{ id: I(1), depends_on: [I(2)] }, { id: I(2), depends_on: [I(1)] }, { id: I(3) }],
    });
    const r = edit(s, { add: { depends_on: [I(3)] } });
    expect(data(r).depends_on).toEqual([I(2), I(3)]);
    const err = editErr(r.snapshot, { add: { depends_on: [I(1)] } }, I(3));
    expect([err.code, reasonOf(err)]).toEqual(['validation', 'cycle']);
    expect(err.message).toContain('bk-t0003 -> bk-t0001 -> bk-t0003');
    expect(err.details).toMatchObject({ ids: [I(3), I(1), I(3)] });
  });

  test('setting a parent that closes a cycle is rejected', () => {
    const s = snap({ issues: [{ id: I(1) }, { id: I(2), parent: I(1) }] });
    const err = editErr(s, { set: { parent: { from: null, to: I(2) } } });
    expect(reasonOf(err)).toBe('cycle');
    expect(err.message).toContain('parent');
  });

  test('add appends, remove drops, both are idempotent', () => {
    const s = snap({
      projects: ['web', 'api', 'ops'],
      issues: [{ id: I(1), projects: ['web', 'api'] }],
    });
    const r = edit(s, { add: { projects: ['web', 'ops'] }, remove: { projects: ['api', 'nope'] } });
    expect(data(r).projects).toEqual(['web', 'ops']);
  });

  test('adding present and removing absent entries is a no-op', () => {
    const s = snap({ projects: ['web'], issues: [{ id: I(1), projects: ['web'] }] });
    const r = edit(s, { add: { projects: ['web'] }, remove: { sprints: ['s1'] } });
    expect(r.noop).toBe(true);
    expect(r.changes).toEqual([]);
  });

  test('removing the last project drops projects', () => {
    const s = snap({ projects: ['web'], issues: [{ id: I(1), projects: ['web'] }] });
    const r = edit(s, { remove: { projects: ['web'] } });
    expect(data(r)).not.toHaveProperty('projects');
    expect(r.changes[0]?.content).not.toContain('projects');
  });

  test('sprints and dependencies can be added and removed', () => {
    const s = snap({
      sprints: ['s1', 's2'],
      issues: [{ id: I(1), sprints: ['s1'], depends_on: [I(2)] }, { id: I(2) }, { id: I(3) }],
    });
    const r = edit(s, {
      add: { sprints: ['s2'], depends_on: [I(3)] },
      remove: { sprints: ['s1'], depends_on: [I(2)] },
    });
    expect(data(r)).toMatchObject({ sprints: ['s2'], depends_on: [I(3)] });
  });

  test('a second repos entry with the same name is a schema violation', () => {
    const s = snap({ repos: REPOS, issues: [{ id: I(1), repos: ['webapp@main'] }] });
    const err = editErr(s, { add: { repos: ['webapp@feat'] } });
    expect([err.code, reasonOf(err)]).toEqual(['validation', 'schema']);
    expect(err.message).toContain('webapp');
  });

  test('replacing a repos entry keeps one per name', () => {
    const s = snap({ repos: REPOS, issues: [{ id: I(1), repos: ['webapp@main'] }] });
    const r = edit(s, {
      add: { repos: ['webapp@feat', 'infra'] },
      remove: { repos: ['webapp@main'] },
    });
    expect(data(r).repos).toEqual(['webapp@feat', 'infra']);
  });

  test('a new repos entry needs a registered repo', () => {
    const err = editErr(snap({ issues: [{ id: I(1) }] }), { add: { repos: ['webapp@main'] } });
    expect(err.details).toEqual({ reason: 'missing_ref', ids: ['webapp'] });
  });

  describe('props', () => {
    const declared = {
      config: { props: { estimate_h: { type: 'integer' as const, description: 'Stunden' } } },
    } satisfies SnapSpec;

    test('set, change and remove props with preconditions', () => {
      const s = snap({ ...declared, issues: [{ id: I(1), props: { a: 'x', tags: ['p', 'q'] } }] });
      const r = edit(s, {
        props: {
          a: { from: 'x', to: null },
          tags: { from: ['p', 'q'], to: ['q'] },
          estimate_h: { from: null, to: 3 },
        },
      });
      expect(data(r).props).toEqual({ tags: ['q'], estimate_h: 3 });
    });

    test('removing the last prop drops props', () => {
      const s = snap({ issues: [{ id: I(1), props: { a: 'x' } }] });
      expect(data(edit(s, { props: { a: { from: 'x', to: null } } }))).not.toHaveProperty('props');
    });

    test('structurally equal values are a no-op', () => {
      const s = snap({ issues: [{ id: I(1), props: { m: { b: 1, a: [true] } } }] });
      const r = edit(s, { props: { m: { from: null, to: { a: [true], b: 1 } } } });
      expect(r.noop).toBe(true);
    });

    test('a stale prop precondition conflicts', () => {
      const s = snap({ issues: [{ id: I(1), props: { a: 'x' } }] });
      expect(reasonOf(editErr(s, { props: { a: { from: 'y', to: 'z' } } }))).toBe('precondition');
    });

    test('an invalid value for a declared prop is rejected', () => {
      const s = snap({ ...declared, issues: [{ id: I(1) }] });
      const err = editErr(s, { props: { estimate_h: { from: null, to: 1.5 } } });
      expect([err.code, err.details]).toEqual([
        'validation',
        { reason: 'prop', key: 'estimate_h' },
      ]);
    });

    test('an already invalid untouched prop does not block', () => {
      const s = snap({ ...declared, issues: [{ id: I(1), props: { estimate_h: 'viel' } }] });
      const r = edit(s, { props: { other: { from: null, to: 1 } } });
      expect(data(r).props).toEqual({ estimate_h: 'viel', other: 1 });
      const titled = edit(s, { set: { title: { from: I(1), to: 'Neu' } } });
      expect(data(titled).title).toBe('Neu');
    });
  });

  describe('body', () => {
    const s = () => {
      const base = snap({ issues: [{ id: I(1) }] });
      const entity = base.issues.get(I(1));
      if (entity) base.issues.set(I(1), { ...entity, body: 'alt\n' });
      return base;
    };

    test('body.to replaces the body', () => {
      const r = edit(s(), { body: { from_hash: bodyHash('alt\n'), to: 'neu\n' } });
      expect(r.snapshot.issues.get(I(1))?.body).toBe('neu\n');
      expect(r.changes[0]?.content).toMatch(/---\nneu\n$/);
    });

    test('a stale from_hash is a precondition conflict', () => {
      const err = editErr(s(), { body: { from_hash: bodyHash('anders\n'), to: 'neu\n' } });
      expect([err.code, reasonOf(err)]).toEqual(['conflict', 'precondition']);
    });

    test('the current body is a no-op even with a stale hash', () => {
      expect(edit(s(), { body: { from_hash: bodyHash('anders\n'), to: 'alt\n' } }).noop).toBe(true);
      expect(edit(s(), { body: { from_hash: bodyHash('anders\n'), to: 'alt' } }).noop).toBe(true);
      expect(edit(s(), { body: { from_hash: bodyHash('anders\n'), to: 'alt\r\n' } }).noop).toBe(
        true,
      );
    });
  });

  describe('blocked_by', () => {
    const blocked = () =>
      snap({
        issues: [{ id: I(1), state: 'blocked', blocked_by: [I(2)] }, { id: I(2) }, { id: I(3) }],
      });

    test('blockers can be replaced while blocked', () => {
      const r = edit(blocked(), { add: { blocked_by: [I(3)] }, remove: { blocked_by: [I(2)] } });
      expect(data(r).blocked_by).toEqual([I(3)]);
    });

    test('removing the last blocker is a transition violation', () => {
      const err = editErr(blocked(), { remove: { blocked_by: [I(2)] } });
      expect([err.code, reasonOf(err)]).toEqual(['validation', 'transition']);
    });

    test('blockers outside of blocked are a transition violation', () => {
      const s = snap({ issues: [{ id: I(1) }, { id: I(2) }] });
      expect(reasonOf(editErr(s, { add: { blocked_by: [I(2)] } }))).toBe('transition');
      expect(reasonOf(editErr(s, { remove: { blocked_by: [I(2)] } }))).toBe('transition');
    });

    test('a new blocker must exist', () => {
      const err = editErr(blocked(), { add: { blocked_by: [I(9)] } });
      expect(err.details).toEqual({ reason: 'missing_ref', ids: [I(9)] });
    });
  });
});

test('without a random source issue ids come from the default source', () => {
  const r = applyOperation(
    snap({}),
    { op: 'issue.create', title: 'x' },
    { actor: 'spw', now: '2026-11-19T08:00:00Z' },
  );
  expect((r.recorded as OpOf<'issue.create'>).id).toMatch(/^bk-[0-9a-hjkmnp-tv-z]{5}$/);
});

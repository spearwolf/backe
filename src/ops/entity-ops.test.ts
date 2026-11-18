import { catchErr } from '../../test/helpers/catch.ts';
import { I, seqBytes, snap } from '../../test/helpers/snapshot.ts';
import type { Sprint, User } from '../core/schemas.ts';
import { serializeEntityFile } from '../store/frontmatter.ts';
import { issueFile, projectFile, repoFile, sprintFile, userFile } from '../store/layout.ts';
import type { BacklogSnapshot } from '../store/snapshot.ts';
import { type ApplyContext, applyOperation } from './apply.ts';
import { bodyHash, type Operation } from './operation.ts';

const NOW = '2026-11-19T08:00:00Z';
const ctx = (actor = 'spw'): ApplyContext => ({ actor, now: NOW, randomBytes: seqBytes() });
const run = (s: BacklogSnapshot, op: Operation, actor = 'spw') => applyOperation(s, op, ctx(actor));
const fail = (s: BacklogSnapshot, op: Operation, actor = 'spw') =>
  catchErr(() => run(s, op, actor));
const reasonOf = (err: { details?: unknown }) => (err.details as { reason: string }).reason;
const paths = (r: { changes: { path: string }[] }) => r.changes.map((c) => c.path);

/** Snapshot, in dem eine Entität unbekannte Keys und einen Body trägt. */
function withStored(
  s: BacklogSnapshot,
  map: 'projects' | 'sprints' | 'repos',
  key: string,
  patch: { extra?: [string, unknown][]; body?: string },
): BacklogSnapshot {
  const entity = s[map].get(key);
  if (entity === undefined) throw new Error(`fehlt: ${key}`);
  return { ...s, [map]: new Map<string, unknown>(s[map]).set(key, { ...entity, ...patch }) };
}

describe('project.create', () => {
  test('writes the project with lead and body', () => {
    const r = run(snap({ projects: ['web'] }), {
      op: 'project.create',
      path: 'web/auth',
      title: 'Auth',
      lead: 'alice',
      body: 'Text',
    });
    expect(r.changes).toEqual([
      {
        path: projectFile('web/auth'),
        content: serializeEntityFile('project', { title: 'Auth', lead: 'alice' }, 'Text'),
      },
    ]);
    expect(r.snapshot.projects.has('web/auth')).toBe(true);
    expect(r.noop).toBe(false);
  });

  test('rejects a missing parent project', () => {
    const err = fail(snap(), { op: 'project.create', path: 'web/auth', title: 'Auth' });
    expect(reasonOf(err)).toBe('missing_ref');
    expect(err.details).toMatchObject({ ids: ['web'] });
  });

  test('rejects an existing path', () => {
    const err = fail(snap({ projects: ['web'] }), {
      op: 'project.create',
      path: 'web',
      title: 'W',
    });
    expect(reasonOf(err)).toBe('exists');
  });

  test('rejects an unknown lead', () => {
    const err = fail(snap(), { op: 'project.create', path: 'web', title: 'W', lead: 'nobody' });
    expect(reasonOf(err)).toBe('missing_ref');
  });

  test.each(['Web', 'a/b/c/d/e/f', 'web//x'])('rejects the invalid path %s', (path) => {
    const err = fail(snap(), { op: 'project.create', path, title: 'W' });
    expect(reasonOf(err)).toBe('schema');
  });
});

describe('project.mv', () => {
  test('moves the subtree and rewrites issues in one result', () => {
    const s = snap({
      projects: ['web', 'web/auth', 'platform', 'api'],
      issues: [{ id: I(1), projects: ['web/auth', 'api'] }],
    });
    const r = run(s, { op: 'project.mv', from: 'web', to: 'platform/web' });
    expect(r.changes.map((c) => [c.path, c.content === null])).toEqual([
      [issueFile(I(1)), false],
      ['projects/platform/web.md', false],
      ['projects/platform/web/auth.md', false],
      ['projects/web.md', true],
      ['projects/web/auth.md', true],
    ]);
    expect(r.snapshot.issues.get(I(1))?.data.projects).toEqual(['platform/web/auth', 'api']);
    expect([...r.snapshot.projects.keys()]).toEqual([
      'api',
      'platform',
      'platform/web',
      'platform/web/auth',
    ]);
  });

  test('keeps data, unknown keys and body of every moved project', () => {
    let s = snap({ projects: ['web', 'web/auth'] });
    s = withStored(s, 'projects', 'web', { extra: [['x_note', 'keep']], body: 'Wurzel\n' });
    s = withStored(s, 'projects', 'web/auth', { body: 'Kind\n' });
    const r = run(s, { op: 'project.mv', from: 'web', to: 'shop' });
    expect(r.snapshot.projects.get('shop')).toMatchObject({
      data: { title: 'web' },
      extra: [['x_note', 'keep']],
      body: 'Wurzel\n',
    });
    expect(r.snapshot.projects.get('shop/auth')?.body).toBe('Kind\n');
    expect(r.changes.find((c) => c.path === 'projects/shop.md')?.content).toBe(
      serializeEntityFile('project', { title: 'web' }, 'Wurzel\n', [['x_note', 'keep']]),
    );
  });

  test('only touches issues that list a path in the subtree', () => {
    const s = snap({
      projects: ['web', 'api'],
      issues: [{ id: I(1), projects: ['api'] }, { id: I(2) }],
    });
    const r = run(s, { op: 'project.mv', from: 'web', to: 'shop' });
    expect(paths(r)).toEqual(['projects/shop.md', 'projects/web.md']);
  });

  test('moving a project into its own subtree is rejected', () => {
    const s = snap({ projects: ['web', 'web/auth'] });
    expect(reasonOf(fail(s, { op: 'project.mv', from: 'web', to: 'web/auth/x' }))).toBe('schema');
    expect(reasonOf(fail(s, { op: 'project.mv', from: 'web', to: 'web' }))).toBe('schema');
  });

  test('rejects a missing source, an existing target and a missing parent of the target', () => {
    const s = snap({ projects: ['web', 'api'] });
    expect(reasonOf(fail(s, { op: 'project.mv', from: 'nope', to: 'x' }))).toBe('missing_ref');
    expect(reasonOf(fail(s, { op: 'project.mv', from: 'web', to: 'api' }))).toBe('exists');
    expect(reasonOf(fail(s, { op: 'project.mv', from: 'web', to: 'none/web' }))).toBe(
      'missing_ref',
    );
  });

  test('rejects a target path that is too deep once the subtree moves along', () => {
    const s = snap({ projects: ['a', 'a/b', 'a/b/c', 'a/b/c/d', 'x', 'x/y', 'x/y/z'] });
    expect(reasonOf(fail(s, { op: 'project.mv', from: 'a', to: 'x/y/z/a' }))).toBe('schema');
    expect(reasonOf(fail(s, { op: 'project.mv', from: 'a', to: 'Bad' }))).toBe('schema');
  });

  test('rejects a moved subproject that would land on an existing path', () => {
    const s = snap({ projects: ['web', 'web/auth', 'shop/auth'] });
    expect(reasonOf(fail(s, { op: 'project.mv', from: 'web', to: 'shop' }))).toBe('exists');
  });
});

describe('project.rm', () => {
  const base = () =>
    snap({
      projects: ['web', 'api', 'web/auth'],
      issues: [
        { id: I(1), projects: ['api', 'web'] },
        { id: I(2), projects: ['web/auth'] },
      ],
    });

  test('refuses while subprojects exist', () => {
    const err = fail(base(), { op: 'project.rm', path: 'web' });
    expect(reasonOf(err)).toBe('has_subprojects');
    expect(err.details).toMatchObject({ ids: ['web/auth'] });
  });

  test('with references it needs reassign or detach', () => {
    const err = fail(base(), { op: 'project.rm', path: 'web/auth' });
    expect(reasonOf(err)).toBe('references');
    expect(err.details).toMatchObject({ ids: [I(2)] });
  });

  test('removes an unreferenced project', () => {
    const r = run(snap({ projects: ['web'] }), { op: 'project.rm', path: 'web' });
    expect(r.changes).toEqual([{ path: projectFile('web'), content: null }]);
  });

  test('reassign substitutes in place and drops duplicates', () => {
    const s = snap({
      projects: ['web', 'api'],
      issues: [
        { id: I(1), projects: ['web'] },
        { id: I(3), projects: ['web', 'api'] },
        { id: I(4), projects: ['api', 'web'] },
      ],
    });
    const r = run(s, { op: 'project.rm', path: 'web', reassign: 'api' });
    expect(r.snapshot.issues.get(I(1))?.data.projects).toEqual(['api']);
    expect(r.snapshot.issues.get(I(3))?.data.projects).toEqual(['api']);
    expect(r.snapshot.issues.get(I(4))?.data.projects).toEqual(['api']);
    expect(r.snapshot.projects.has('web')).toBe(false);
  });

  test('reassign keeps the position of the removed entry', () => {
    const s = snap({ projects: ['a', 'b', 'c'], issues: [{ id: I(1), projects: ['a', 'b'] }] });
    const r = run(s, { op: 'project.rm', path: 'a', reassign: 'c' });
    expect(r.snapshot.issues.get(I(1))?.data.projects).toEqual(['c', 'b']);
  });

  test('detach removes the entry and an emptied list disappears', () => {
    const r = run(base(), { op: 'project.rm', path: 'web/auth', detach: true });
    expect(r.snapshot.issues.get(I(2))?.data.projects).toBeUndefined();
    expect(r.changes.find((c) => c.path === issueFile(I(2)))?.content).not.toContain('projects');
  });

  test('reassign target must exist and differ from the path', () => {
    const s = base();
    expect(reasonOf(fail(s, { op: 'project.rm', path: 'web/auth', reassign: 'none' }))).toBe(
      'missing_ref',
    );
    expect(reasonOf(fail(s, { op: 'project.rm', path: 'web/auth', reassign: 'web/auth' }))).toBe(
      'schema',
    );
  });

  test('rejects a missing project', () => {
    expect(reasonOf(fail(snap(), { op: 'project.rm', path: 'web' }))).toBe('missing_ref');
  });
});

describe('sprint.create', () => {
  test('writes the sprint', () => {
    const r = run(snap(), {
      op: 'sprint.create',
      slug: 'sp-1',
      title: 'Sprint 1',
      start: '2026-11-20',
      end: '2026-12-01',
      body: 'Ziel',
    });
    expect(r.changes).toEqual([
      {
        path: sprintFile('sp-1'),
        content: serializeEntityFile(
          'sprint',
          { title: 'Sprint 1', start: '2026-11-20', end: '2026-12-01' } satisfies Sprint,
          'Ziel',
        ),
      },
    ]);
  });

  test('rejects an existing slug and an end before the start', () => {
    const exists = fail(snap({ sprints: ['sp-1'] }), {
      op: 'sprint.create',
      slug: 'sp-1',
      title: 'x',
    });
    expect(reasonOf(exists)).toBe('exists');
    const err = fail(snap(), {
      op: 'sprint.create',
      slug: 'sp-1',
      title: 'x',
      start: '2026-12-01',
      end: '2026-11-20',
    });
    expect(reasonOf(err)).toBe('schema');
  });
});

describe('sprint.close', () => {
  test('carries over open issues only', () => {
    const s = snap({
      sprints: ['sp-1', 'sp-2'],
      issues: [
        { id: I(1), state: 'todo', sprints: ['sp-1'] },
        { id: I(2), state: 'done', sprints: ['sp-1'] },
        { id: I(3), state: 'review', sprints: ['sp-1', 'sp-2'] },
        { id: I(4), state: 'todo', sprints: ['sp-2'] },
        { id: I(5), state: 'blocked', blocked_by: [I(1)], sprints: ['sp-1'] },
        { id: I(6), state: 'cancelled', sprints: ['sp-1'] },
      ],
    });
    const r = run(s, { op: 'sprint.close', slug: 'sp-1', carry_over: 'sp-2' });
    const sprints = (id: string) => r.snapshot.issues.get(id)?.data.sprints;
    expect(sprints(I(1))).toEqual(['sp-1', 'sp-2']);
    expect(sprints(I(2))).toEqual(['sp-1']);
    expect(sprints(I(3))).toEqual(['sp-1', 'sp-2']);
    expect(sprints(I(4))).toEqual(['sp-2']);
    expect(sprints(I(5))).toEqual(['sp-1', 'sp-2']);
    expect(sprints(I(6))).toEqual(['sp-1']);
    expect(r.snapshot.sprints.get('sp-1')?.data.closed).toBe(true);
    expect(paths(r)).toEqual([issueFile(I(1)), issueFile(I(5)), sprintFile('sp-1')]);
  });

  test('closes without carry over', () => {
    const r = run(snap({ sprints: ['sp-1'] }), { op: 'sprint.close', slug: 'sp-1' });
    expect(r.snapshot.sprints.get('sp-1')?.data.closed).toBe(true);
    expect(r.noop).toBe(false);
  });

  test('closing a closed sprint without carry over is a no-op', () => {
    const closed = run(snap({ sprints: ['sp-1'] }), { op: 'sprint.close', slug: 'sp-1' }).snapshot;
    const r = run(closed, { op: 'sprint.close', slug: 'sp-1' });
    expect(r.noop).toBe(true);
    expect(r.changes).toEqual([]);
  });

  test('a closed sprint can still carry over', () => {
    const closed = run(
      snap({ sprints: ['sp-1', 'sp-2'], issues: [{ id: I(1), sprints: ['sp-1'] }] }),
      { op: 'sprint.close', slug: 'sp-1' },
    ).snapshot;
    const r = run(closed, { op: 'sprint.close', slug: 'sp-1', carry_over: 'sp-2' });
    expect(r.snapshot.issues.get(I(1))?.data.sprints).toEqual(['sp-1', 'sp-2']);
    expect(paths(r)).toEqual([issueFile(I(1))]);
  });

  test('rejects a missing sprint, a missing carry over and carry over to itself', () => {
    const s = snap({ sprints: ['sp-1'] });
    expect(reasonOf(fail(s, { op: 'sprint.close', slug: 'nope' }))).toBe('missing_ref');
    expect(reasonOf(fail(s, { op: 'sprint.close', slug: 'sp-1', carry_over: 'nope' }))).toBe(
      'missing_ref',
    );
    expect(reasonOf(fail(s, { op: 'sprint.close', slug: 'sp-1', carry_over: 'sp-1' }))).toBe(
      'schema',
    );
  });
});

describe('repo.add', () => {
  test('derives the name and records it', () => {
    const r = run(snap(), {
      op: 'repo.add',
      url: 'https://github.com/acme/webapp.git',
      default_ref: 'main',
      body: 'Doku',
    });
    expect(r.recorded).toMatchObject({ op: 'repo.add', name: 'webapp' });
    expect(r.changes).toEqual([
      {
        path: repoFile('webapp'),
        content: serializeEntityFile(
          'repo',
          { url: 'https://github.com/acme/webapp.git', default_ref: 'main' },
          'Doku',
        ),
      },
    ]);
  });

  test('uses the given name', () => {
    const r = run(snap(), { op: 'repo.add', url: 'gh:acme/webapp', name: 'shop' });
    expect(r.recorded).toMatchObject({ name: 'shop' });
    expect(r.snapshot.repos.has('shop')).toBe(true);
  });

  test('derives a longer name when the short one is taken', () => {
    const s = snap({ repos: { webapp: 'gh:other/webapp' } });
    const r = run(s, { op: 'repo.add', url: 'gh:acme/webapp' });
    expect(r.recorded).toMatchObject({ name: 'acme-webapp' });
  });

  test('a known canonical url names the existing repo', () => {
    const s = snap({ repos: { webapp: 'https://github.com/acme/webapp' } });
    const err = fail(s, { op: 'repo.add', url: 'git@github.com:acme/webapp.git' });
    expect(reasonOf(err)).toBe('exists');
    expect(err.message).toContain('webapp');
    expect(err.details).toMatchObject({ ids: ['webapp'] });
  });

  test('skips registered repos whose url cannot be normalized', () => {
    const s = snap({ repos: { broken: 'gh:acme/x' } });
    const broken = s.repos.get('broken');
    if (broken === undefined) throw new Error('setup');
    const bad: BacklogSnapshot = {
      ...s,
      repos: new Map(s.repos).set('broken', { ...broken, data: { url: 'kaputt' } }),
    };
    const r = run(bad, { op: 'repo.add', url: 'gh:acme/webapp' });
    expect(r.recorded).toMatchObject({ name: 'webapp' });
  });

  test('rejects a taken name', () => {
    const s = snap({ repos: { webapp: 'gh:acme/webapp' } });
    const err = fail(s, { op: 'repo.add', url: 'gh:acme/other', name: 'webapp' });
    expect(reasonOf(err)).toBe('exists');
  });
});

describe('repo.rm', () => {
  test('refuses while issues reference the repo', () => {
    const s = snap({
      repos: { webapp: 'gh:acme/webapp', api: 'gh:acme/api' },
      issues: [
        { id: I(1), repos: ['webapp@main'] },
        { id: I(2), repos: ['api'] },
      ],
    });
    const err = fail(s, { op: 'repo.rm', name: 'webapp' });
    expect(reasonOf(err)).toBe('references');
    expect(err.details).toMatchObject({ ids: [I(1)] });
  });

  test('removes an unreferenced repo', () => {
    const r = run(snap({ repos: { webapp: 'gh:acme/webapp' } }), { op: 'repo.rm', name: 'webapp' });
    expect(r.changes).toEqual([{ path: repoFile('webapp'), content: null }]);
  });

  test('rejects a missing repo', () => {
    expect(reasonOf(fail(snap(), { op: 'repo.rm', name: 'webapp' }))).toBe('missing_ref');
  });
});

const KEY = 'ssh-ed25519 AAAAbob bob';

describe('user.add', () => {
  test('an admin adds a human', () => {
    const r = run(snap(), {
      op: 'user.add',
      handle: 'bob',
      name: 'Bob',
      kind: 'human',
      keys: [KEY],
      body: 'Hi',
    });
    expect(r.changes).toEqual([
      {
        path: userFile('bob'),
        content: serializeEntityFile(
          'user',
          { name: 'Bob', kind: 'human', keys: [KEY] } satisfies User,
          'Hi',
        ),
      },
    ]);
  });

  test('a non-admin adds an agent for themselves only', () => {
    const agent = (operator: string): Operation => ({
      op: 'user.add',
      handle: 'a-1',
      name: 'A',
      kind: 'agent',
      keys: [KEY],
      operator,
    });
    expect(run(snap(), agent('alice'), 'alice').snapshot.users.has('a-1')).toBe(true);
    expect(reasonOf(fail(snap(), agent('spw'), 'alice'))).toBe('policy');
    const human: Operation = {
      op: 'user.add',
      handle: 'bob',
      name: 'B',
      kind: 'human',
      keys: [KEY],
    };
    expect(reasonOf(fail(snap(), human, 'alice'))).toBe('policy');
  });

  test('rejects an existing handle and an unknown operator', () => {
    const add = (handle: string, operator: string): Operation => ({
      op: 'user.add',
      handle,
      name: 'X',
      kind: 'agent',
      keys: [KEY],
      operator,
    });
    expect(reasonOf(fail(snap(), add('alice', 'spw')))).toBe('exists');
    expect(reasonOf(fail(snap(), add('a-1', 'nobody')))).toBe('missing_ref');
  });

  test('an agent needs an operator', () => {
    const err = fail(snap(), {
      op: 'user.add',
      handle: 'a-1',
      name: 'A',
      kind: 'agent',
      keys: [KEY],
    });
    expect(reasonOf(err)).toBe('schema');
  });
});

describe('user.revoke_key', () => {
  const alice = 'ssh-ed25519 AAAAalice alice';

  test('moves the key with the given time', () => {
    const r = run(snap(), {
      op: 'user.revoke_key',
      handle: 'alice',
      key: alice,
      revoked: '2026-11-18T12:00:00Z',
    });
    expect(r.snapshot.users.get('alice')?.data).toMatchObject({
      keys: [],
      revoked_keys: [{ key: alice, revoked: '2026-11-18T12:00:00Z' }],
    });
    expect(r.recorded).toMatchObject({ revoked: '2026-11-18T12:00:00Z' });
  });

  test('defaults the time to now and records it', () => {
    const r = run(snap(), { op: 'user.revoke_key', handle: 'alice', key: alice });
    expect(r.snapshot.users.get('alice')?.data.revoked_keys).toEqual([
      { key: alice, revoked: NOW },
    ]);
    expect(r.recorded).toMatchObject({ revoked: NOW });
  });

  test('appends to the revoked keys and keeps the other keys', () => {
    const second = 'ssh-ed25519 AAAAzwei zwei';
    const base = snap();
    const a = base.users.get('alice');
    if (a === undefined) throw new Error('setup');
    const s: BacklogSnapshot = {
      ...base,
      users: new Map(base.users).set('alice', {
        ...a,
        data: {
          ...a.data,
          keys: [alice, second],
          revoked_keys: [{ key: 'ssh-ed25519 AAAAalt', revoked: '2026-01-01T00:00:00Z' }],
        },
      }),
    };
    const r = run(s, { op: 'user.revoke_key', handle: 'alice', key: alice });
    expect(r.snapshot.users.get('alice')?.data).toMatchObject({
      keys: [second],
      revoked_keys: [{ key: 'ssh-ed25519 AAAAalt' }, { key: alice, revoked: NOW }],
    });
  });

  test('revoking an already revoked key is a no-op', () => {
    const first = run(snap(), { op: 'user.revoke_key', handle: 'alice', key: alice }).snapshot;
    const r = run(first, {
      op: 'user.revoke_key',
      handle: 'alice',
      key: alice,
      revoked: '2030-01-01T00:00:00Z',
    });
    expect(r.noop).toBe(true);
    expect(r.recorded).toMatchObject({ revoked: NOW });
  });

  test('rejects an unknown key and a missing user', () => {
    const unknown = fail(snap(), {
      op: 'user.revoke_key',
      handle: 'alice',
      key: 'ssh-ed25519 AAAAnone',
    });
    expect(reasonOf(unknown)).toBe('missing_ref');
    const nobody = fail(snap(), { op: 'user.revoke_key', handle: 'nobody', key: alice });
    expect(reasonOf(nobody)).toBe('missing_ref');
  });

  test('the identity rule applies', () => {
    const own = run(snap(), { op: 'user.revoke_key', handle: 'alice', key: alice }, 'alice');
    expect(own.noop).toBe(false);
    const foreign = fail(
      snap(),
      { op: 'user.revoke_key', handle: 'spw', key: 'ssh-ed25519 AAAAspw spw' },
      'alice',
    );
    expect(reasonOf(foreign)).toBe('policy');
  });
});

describe('user.rm', () => {
  test('an admin removes a user', () => {
    const r = run(snap(), { op: 'user.rm', handle: 'alice' });
    expect(r.changes).toEqual([{ path: userFile('alice'), content: null }]);
  });

  test('removing an admin is a conflict', () => {
    const err = fail(snap(), { op: 'user.rm', handle: 'spw' });
    expect(reasonOf(err)).toBe('admin');
    expect(err.code).toBe('conflict');
  });

  test('a non-admin cannot remove users', () => {
    expect(reasonOf(fail(snap(), { op: 'user.rm', handle: 'claude-1' }, 'alice'))).toBe('policy');
  });

  test('rejects a missing user', () => {
    expect(reasonOf(fail(snap(), { op: 'user.rm', handle: 'nobody' }))).toBe('missing_ref');
  });

  test('refuses while agents name the user as operator, so nobody can take them over', () => {
    const s = snap({ users: ['bob'] });
    const withAgent = run(s, {
      op: 'user.add',
      handle: 'x',
      name: 'X',
      kind: 'agent',
      keys: [KEY],
      operator: 'bob',
    }).snapshot;
    const err = fail(withAgent, { op: 'user.rm', handle: 'bob' });
    expect(reasonOf(err)).toBe('references');
    expect(err.details).toMatchObject({ ids: ['x'] });
  });
});

describe('orphaned operator', () => {
  /** `bob-1` ist Agent von `bob`, `users/bob.md` fehlt (etwa nach einem rohen Admin-Commit). */
  function orphanSnap(): BacklogSnapshot {
    const base = snap();
    const data: User = {
      name: 'bob-1',
      kind: 'agent',
      operator: 'bob',
      keys: ['ssh-ed25519 AAAAbob1 bob-1'],
    };
    const users = new Map(base.users).set('bob-1', {
      data,
      extra: [],
      body: '',
      path: userFile('bob-1'),
    });
    return { ...base, users: new Map([...users].sort(([a], [b]) => (a < b ? -1 : 1))) };
  }
  const addBob: Operation = {
    op: 'user.add',
    handle: 'bob',
    name: 'Bob',
    kind: 'agent',
    keys: [KEY],
    operator: 'alice',
  };

  test('a non-admin cannot take over the handle of an orphaned operator', () => {
    const err = fail(orphanSnap(), addBob, 'alice');
    expect(reasonOf(err)).toBe('policy');
  });

  test('an agent carrying the handle of an orphaned operator cannot edit its agents', () => {
    const withBob = run(orphanSnap(), addBob, 'spw').snapshot;
    const err = fail(
      withBob,
      {
        op: 'entity.edit',
        kind: 'user',
        key: 'bob-1',
        set: {
          keys: {
            from: ['ssh-ed25519 AAAAbob1 bob-1'],
            to: ['ssh-ed25519 AAAAbob1 bob-1', KEY],
          },
        },
      },
      'bob',
    );
    expect(reasonOf(err)).toBe('policy');
  });
});

describe('entity.edit', () => {
  test('sets a field with its precondition', () => {
    const r = run(snap({ projects: ['web'] }), {
      op: 'entity.edit',
      kind: 'project',
      key: 'web',
      set: { title: { from: 'web', to: 'Webshop' }, lead: { from: null, to: 'alice' } },
    });
    expect(r.snapshot.projects.get('web')?.data).toEqual({ title: 'Webshop', lead: 'alice' });
    expect(paths(r)).toEqual([projectFile('web')]);
  });

  test('a field already at the target is a no-op, a mismatch is a precondition conflict', () => {
    const s = snap({ projects: ['web'] });
    const done = run(s, {
      op: 'entity.edit',
      kind: 'project',
      key: 'web',
      set: { title: { from: 'alt', to: 'web' } },
    });
    expect(done.noop).toBe(true);
    const err = fail(s, {
      op: 'entity.edit',
      kind: 'project',
      key: 'web',
      set: { title: { from: 'alt', to: 'neu' } },
    });
    expect(reasonOf(err)).toBe('precondition');
  });

  test('null unsets an optional field', () => {
    const s = run(snap({ sprints: ['sp-1'] }), {
      op: 'entity.edit',
      kind: 'sprint',
      key: 'sp-1',
      set: { start: { from: null, to: '2026-11-20' } },
    }).snapshot;
    const r = run(s, {
      op: 'entity.edit',
      kind: 'sprint',
      key: 'sp-1',
      set: { start: { from: '2026-11-20', to: null } },
    });
    expect(r.snapshot.sprints.get('sp-1')?.data.start).toBeUndefined();
  });

  test('compares structurally', () => {
    const k1 = 'ssh-ed25519 AAAAalice alice';
    const k2 = 'ssh-ed25519 AAAAneu neu';
    const r = run(snap(), {
      op: 'entity.edit',
      kind: 'user',
      key: 'alice',
      set: { keys: { from: [k1], to: [k1, k2] } },
    });
    expect(r.snapshot.users.get('alice')?.data.keys).toEqual([k1, k2]);
  });

  test('edits the body through its hash', () => {
    const s = withStored(snap({ projects: ['web'] }), 'projects', 'web', { body: 'alt\n' });
    const edit: Operation = {
      op: 'entity.edit',
      kind: 'project',
      key: 'web',
      body: { from_hash: bodyHash('alt\n'), to: 'neu' },
    };
    const r = run(s, edit);
    expect(r.snapshot.projects.get('web')?.body).toBe('neu\n');
    expect(run(r.snapshot, edit).noop).toBe(true);
    const stale = fail(s, {
      op: 'entity.edit',
      kind: 'project',
      key: 'web',
      body: { from_hash: bodyHash('anders\n'), to: 'neu' },
    });
    expect(reasonOf(stale)).toBe('precondition');
  });

  test('rejects a missing entity', () => {
    const err = fail(snap(), {
      op: 'entity.edit',
      kind: 'repo',
      key: 'nope',
      set: { default_ref: { from: null, to: 'main' } },
    });
    expect(reasonOf(err)).toBe('missing_ref');
  });

  test('rejects an invalid result', () => {
    const err = fail(snap({ sprints: ['sp-1'] }), {
      op: 'entity.edit',
      kind: 'sprint',
      key: 'sp-1',
      set: { start: { from: null, to: '2026-13-40' } },
    });
    expect(reasonOf(err)).toBe('schema');
  });

  test('a newly set lead must exist', () => {
    const err = fail(snap({ projects: ['web'] }), {
      op: 'entity.edit',
      kind: 'project',
      key: 'web',
      set: { lead: { from: null, to: 'nobody' } },
    });
    expect(reasonOf(err)).toBe('missing_ref');
  });

  test('a repo url change keeps canonical urls unique', () => {
    const s = snap({ repos: { webapp: 'gh:acme/webapp', api: 'gh:acme/api' } });
    const clash = fail(s, {
      op: 'entity.edit',
      kind: 'repo',
      key: 'api',
      set: { url: { from: 'gh:acme/api', to: 'https://github.com/acme/webapp.git' } },
    });
    expect(reasonOf(clash)).toBe('exists');
    expect(clash.details).toMatchObject({ ids: ['webapp'] });
    const ok = run(s, {
      op: 'entity.edit',
      kind: 'repo',
      key: 'api',
      set: { url: { from: 'gh:acme/api', to: 'https://git.example.org/acme/api' } },
    });
    expect(ok.snapshot.repos.get('api')?.data.url).toBe('https://git.example.org/acme/api');
  });

  test('a repo edit that keeps its url does not collide with itself', () => {
    const r = run(snap({ repos: { api: 'gh:acme/api' } }), {
      op: 'entity.edit',
      kind: 'repo',
      key: 'api',
      set: { default_ref: { from: null, to: 'main' } },
    });
    expect(r.snapshot.repos.get('api')?.data.default_ref).toBe('main');
  });

  test('the identity rule applies to users', () => {
    const edit = (key: string): Operation => ({
      op: 'entity.edit',
      kind: 'user',
      key,
      set: { name: { from: key, to: 'Neu' } },
    });
    expect(run(snap(), edit('alice'), 'alice').snapshot.users.get('alice')?.data.name).toBe('Neu');
    expect(reasonOf(fail(snap(), edit('spw'), 'alice'))).toBe('policy');
    expect(run(snap(), edit('claude-1'), 'spw').noop).toBe(false);
  });

  test('a body-only edit of another user file is a policy violation', () => {
    const err = fail(
      snap({ users: ['bob'] }),
      {
        op: 'entity.edit',
        kind: 'user',
        key: 'spw',
        body: { from_hash: bodyHash(''), to: 'übernommen' },
      },
      'bob',
    );
    expect(reasonOf(err)).toBe('policy');
    const own = run(
      snap({ users: ['bob'] }),
      {
        op: 'entity.edit',
        kind: 'user',
        key: 'bob',
        body: { from_hash: bodyHash(''), to: 'ich' },
      },
      'bob',
    );
    expect(own.snapshot.users.get('bob')?.body).toBe('ich\n');
  });

  test('an agent is not accepted as a new operator', () => {
    const err = fail(snap(), {
      op: 'entity.edit',
      kind: 'user',
      key: 'claude-1',
      set: { operator: { from: 'spw', to: 'claude-1' } },
    });
    expect(reasonOf(err)).toBe('schema');
  });

  test('a new operator must exist', () => {
    const err = fail(snap(), {
      op: 'entity.edit',
      kind: 'user',
      key: 'claude-1',
      set: { operator: { from: 'spw', to: 'nobody' } },
    });
    expect(reasonOf(err)).toBe('missing_ref');
  });
});

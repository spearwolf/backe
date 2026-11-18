import { catchErr } from '../../test/helpers/catch.ts';
import { I, seqBytes, snap } from '../../test/helpers/snapshot.ts';
import type { Issue, Project } from '../core/schemas.ts';
import { serializeEntityFile } from '../store/frontmatter.ts';
import { commentsDir, issueDir, issueFile, projectFile, userFile } from '../store/layout.ts';
import { type ApplyContext, applyOperation, commentsNeeded } from './apply.ts';
import { Draft } from './draft.ts';
import { graphOf } from './graph.ts';
import { type Violation, violation } from './invariants.ts';
import type { Operation } from './operation.ts';

const ctx = (actor = 'spw', extra: Partial<ApplyContext> = {}): ApplyContext => ({
  actor,
  now: '2026-11-19T08:00:00Z',
  randomBytes: seqBytes(),
  ...extra,
});

const reasonOf = (err: { details?: unknown }) => (err.details as { reason?: string }).reason;

const issueData = (id: string, extra: Partial<Issue> = {}): Issue => ({
  id,
  title: id,
  state: 'todo',
  creator: 'spw',
  created: '2026-11-18T10:00:00Z',
  ...extra,
});

describe('violation', () => {
  test.each<[Violation, string]>([
    ['precondition', 'conflict'],
    ['exists', 'conflict'],
    ['id_collision', 'conflict'],
    ['open_children', 'conflict'],
    ['has_children', 'conflict'],
    ['references', 'conflict'],
    ['has_subprojects', 'conflict'],
    ['admin', 'conflict'],
    ['occupied', 'conflict'],
    ['not_claimable', 'conflict'],
    ['missing_ref', 'not_found'],
    ['cycle', 'validation'],
    ['policy', 'validation'],
    ['prop', 'validation'],
    ['schema', 'validation'],
    ['transition', 'validation'],
    ['too_large', 'validation'],
  ])('%s maps to %s', (reason, code) => {
    const err = violation(reason, 'Nachricht');
    expect([err.code, err.message, err.details, err.hint]).toEqual([
      code,
      'Nachricht',
      { reason },
      undefined,
    ]);
  });

  test('ids and hint are carried', () => {
    const err = violation('cycle', 'm', { ids: [I(1)], hint: 'h' });
    expect([err.details, err.hint]).toEqual([{ reason: 'cycle', ids: [I(1)] }, 'h']);
  });
});

describe('applyOperation', () => {
  const create: Operation = { op: 'issue.create', title: 'x' };

  test('an unknown actor is a policy violation', () => {
    const err = catchErr(() => applyOperation(snap({}), create, ctx('bob')));
    expect([err.code, reasonOf(err)]).toEqual(['validation', 'policy']);
  });

  test('an invalid timestamp is unexpected', () => {
    expect(
      catchErr(() => applyOperation(snap({}), create, ctx('spw', { now: '2026-11-19' }))).code,
    ).toBe('unexpected');
  });

  test('remaining placeholders are a schema violation', () => {
    const err = catchErr(() =>
      applyOperation(snap({}), { op: 'issue.create', title: 'x', parent: '$p1' }, ctx()),
    );
    expect([err.code, reasonOf(err)]).toEqual(['validation', 'schema']);
    expect(err.message).toContain('$p1');
  });

  test('a ref label on create is not a remaining placeholder', () => {
    const r = applyOperation(snap({}), { op: 'issue.create', ref: '$f1', title: 'x' }, ctx());
    expect(r.recorded).toMatchObject({ ref: '$f1' });
  });

  test('operations of later stages are not implemented yet', () => {
    const err = catchErr(() =>
      applyOperation(snap({ issues: [{ id: I(1) }] }), { op: 'issue.delete', id: I(1) }, ctx()),
    );
    expect([err.code, err.message]).toEqual([
      'unexpected',
      'issue.delete noch nicht implementiert',
    ]);
  });

  test('the input snapshot is left untouched', () => {
    const s = snap({ issues: [{ id: I(1) }] });
    const before = s.issues;
    const r = applyOperation(
      s,
      { op: 'issue.edit', id: I(1), set: { title: { from: I(1), to: 'x' } } },
      ctx(),
    );
    expect(s.issues).toBe(before);
    expect(s.issues.get(I(1))?.data.title).toBe(I(1));
    expect(r.snapshot.issues.get(I(1))?.data.title).toBe('x');
  });
});

describe('commentsNeeded', () => {
  test('names the issue for comment edits and deletes only', () => {
    const file = '20261118T100000Z-spw-abc.md';
    expect(
      commentsNeeded({ op: 'comment.edit', id: I(1), file, from_hash: '0'.repeat(64), body: '' }),
    ).toEqual([I(1)]);
    expect(commentsNeeded({ op: 'comment.delete', id: I(2), file })).toEqual([I(2)]);
    expect(commentsNeeded({ op: 'comment.add', id: I(1), body: 'x' })).toEqual([]);
  });
});

describe('Draft', () => {
  test('snapshot reflects changes with fresh maps, unchanged reads are stable', () => {
    const base = snap({ issues: [{ id: I(1) }, { id: I(2) }] });
    const d = new Draft(base, ctx());
    expect(d.snapshot.issues).toBe(base.issues);
    expect(graphOf(d.snapshot).children.get(I(1))).toBeUndefined();
    d.putIssue(I(2), issueData(I(2), { parent: I(1) }));
    const first = d.snapshot;
    expect(first.issues).not.toBe(base.issues);
    expect(d.snapshot).toBe(first);
    expect(graphOf(first).children.get(I(1))).toEqual([I(2)]);
    d.putIssue(I(3), issueData(I(3), { parent: I(1) }));
    expect(d.snapshot.issues).not.toBe(first.issues);
    expect(graphOf(d.snapshot).children.get(I(1))).toEqual([I(2), I(3)]);
    expect([...d.snapshot.issues.keys()]).toEqual([I(1), I(2), I(3)]);
    expect(d.snapshot.config).toBe(base.config);
    expect(d.snapshot.problems).toBe(base.problems);
  });

  test('new keys keep the maps sorted', () => {
    const d = new Draft(snap({ issues: [{ id: I(5) }] }), ctx());
    d.putIssue(I(1), issueData(I(1)));
    expect([...d.snapshot.issues.keys()]).toEqual([I(1), I(5)]);
  });

  test('revision counts effective changes only', () => {
    const base = snap({ issues: [{ id: I(1) }] });
    const d = new Draft(base, ctx());
    d.putIssue(I(1), { ...(base.issues.get(I(1))?.data as Issue) });
    d.putIssue(I(1), base.issues.get(I(1))?.data as Issue, '');
    expect(d.revision).toBe(0);
    d.putIssue(I(1), base.issues.get(I(1))?.data as Issue, 'Text\n');
    expect(d.revision).toBe(1);
    expect(d.issue(I(1)).body).toBe('Text\n');
    d.putIssue(I(1), base.issues.get(I(1))?.data as Issue, 'Text');
    expect(d.revision).toBe(1);
  });

  test('a write that is reverted inside one draft leaves no file change', () => {
    const base = snap({ issues: [{ id: I(1) }] });
    const d = new Draft(base, ctx());
    const original = base.issues.get(I(1))?.data as Issue;
    d.putIssue(I(1), { ...original, title: 'anders' });
    d.putIssue(I(1), original);
    expect(d.revision).toBe(2);
    expect(d.finish().changes).toEqual([]);
  });

  test('the config is the one of the base snapshot', () => {
    const base = snap({});
    const d = new Draft(base, ctx());
    d.putIssue(I(1), issueData(I(1)));
    expect(d.config).toBe(base.config);
  });

  test('bodies are stored the way the serializer writes them', () => {
    const d = new Draft(snap({ issues: [{ id: I(1) }], projects: ['web'] }), ctx());
    d.putIssue(I(1), d.issue(I(1)).data, 'a\r\nb');
    d.putEntity('project', 'web', { title: 'web' }, 'c\r');
    expect(d.snapshot.issues.get(I(1))?.body).toBe('a\nb\n');
    expect(d.snapshot.projects.get('web')?.body).toBe('c\n');
    const [issue, project] = d.finish().changes;
    expect(issue?.content).toMatch(/---\na\nb\n$/);
    expect(project?.content).toMatch(/---\nc\n$/);
  });

  test('putIssue rejects data that does not fit the id or the schema', () => {
    const d = new Draft(snap({}), ctx());
    expect(reasonOf(catchErr(() => d.putIssue(I(1), issueData(I(2)))))).toBe('schema');
    expect(reasonOf(catchErr(() => d.putIssue(I(1), issueData(I(1), { title: '' }))))).toBe(
      'schema',
    );
  });

  test('a change back to the base state writes nothing', () => {
    const base = snap({ issues: [{ id: I(1) }] });
    const d = new Draft(base, ctx());
    d.putIssue(
      I(1),
      issueData(I(1), { title: 'x', created: base.issues.get(I(1))?.data.created as string }),
    );
    d.putIssue(I(1), base.issues.get(I(1))?.data as Issue);
    expect(d.finish().changes).toEqual([]);
  });

  test('issue lookups report missing issues', () => {
    const d = new Draft(snap({}), ctx());
    expect(d.findIssue(I(1))).toBeUndefined();
    const err = catchErr(() => d.issue(I(1)));
    expect([err.code, err.details]).toEqual(['not_found', { reason: 'missing_ref', ids: [I(1)] }]);
  });

  test('a removed issue becomes one recursive change, files below it are dropped', () => {
    const d = new Draft(snap({ issues: [{ id: I(1) }, { id: I(2) }] }), ctx());
    d.putFile(`${issueDir(I(1))}/attachments/a.txt`, 'x');
    d.putFile(`${issueDir(I(2))}/attachments/b.txt`, new Uint8Array([1]));
    d.removeIssue(I(1));
    expect(d.findIssue(I(1))).toBeUndefined();
    expect(d.snapshot.issues.has(I(1))).toBe(false);
    expect(d.finish().changes).toEqual([
      { path: issueDir(I(1)), content: null, recursive: true },
      { path: `${issueDir(I(2))}/attachments/b.txt`, content: new Uint8Array([1]) },
    ]);
  });

  test('an issue created and removed in the same draft leaves no trace', () => {
    const d = new Draft(snap({}), ctx());
    d.putIssue(I(1), issueData(I(1)));
    d.addComment(I(1), {}, 'x');
    d.removeIssue(I(1));
    expect(d.finish().changes).toEqual([]);
    expect(d.revision).toBe(3);
  });

  test('removing a missing issue is a missing reference', () => {
    expect(reasonOf(catchErr(() => new Draft(snap({}), ctx()).removeIssue(I(1))))).toBe(
      'missing_ref',
    );
  });

  test('entities can be read, written and removed', () => {
    const base = snap({ projects: ['web', 'api'] });
    const d = new Draft(base, ctx());
    expect(d.entity('project', 'web').data).toEqual({ title: 'web' });
    expect(d.findEntity('project', 'ops')).toBeUndefined();
    const err = catchErr(() => d.entity('sprint', 's1'));
    expect([err.code, err.details]).toEqual(['not_found', { reason: 'missing_ref', ids: ['s1'] }]);

    d.putEntity('project', 'web', { title: 'web' });
    expect(d.revision).toBe(0);
    d.putEntity('project', 'ops', { title: 'Ops', lead: 'alice' } satisfies Project, 'Betrieb\n');
    d.removeEntity('project', 'api');
    expect(d.snapshot.projects.has('api')).toBe(false);
    expect([...d.snapshot.projects.keys()]).toEqual(['ops', 'web']);
    expect(d.snapshot.projects).not.toBe(base.projects);
    expect(d.snapshot.users).toBe(base.users);
    expect(d.finish().changes).toEqual([
      { path: projectFile('api'), content: null },
      {
        path: projectFile('ops'),
        content: serializeEntityFile('project', { title: 'Ops', lead: 'alice' }, 'Betrieb\n'),
      },
    ]);
  });

  test('entity writes are schema-checked and keep extra keys', () => {
    const base = snap({});
    const spw = base.users.get('spw');
    if (spw) base.users.set('spw', { ...spw, extra: [['legacy', true]] });
    const d = new Draft(base, ctx());
    expect(
      reasonOf(
        catchErr(() => d.putEntity('user', 'spw', { ...spw?.data, kind: 'agent' } as never)),
      ),
    ).toBe('schema');
    d.putEntity('user', 'spw', { ...(spw?.data as NonNullable<typeof spw>['data']), name: 'S' });
    const [change] = d.finish().changes;
    expect(change?.path).toBe(userFile('spw'));
    expect(change?.content).toContain('legacy: true\n');
    expect(reasonOf(catchErr(() => d.removeEntity('repo', 'nope')))).toBe('missing_ref');
  });

  test('addComment names the file after now, actor and random bytes', () => {
    const d = new Draft(snap({ issues: [{ id: I(1) }] }), ctx('alice'));
    const file = d.addComment(
      I(1),
      { kind: 'transition', from: 'todo', to: 'in_progress' },
      'Los\n',
    );
    expect(file).toBe('20261119T080000Z-alice-012.md');
    expect(d.finish().changes).toEqual([
      {
        path: `${commentsDir(I(1))}/${file}`,
        content: serializeEntityFile(
          'comment',
          {
            author: 'alice',
            created: '2026-11-19T08:00:00Z',
            kind: 'transition',
            from: 'todo',
            to: 'in_progress',
          },
          'Los\n',
        ),
      },
    ]);
  });

  test('addComment avoids names the draft has already given', () => {
    const bytes = [
      [0, 0, 0],
      [0, 0, 0],
      [1, 1, 1],
    ];
    const d = new Draft(
      snap({ issues: [{ id: I(1) }] }),
      ctx('spw', { randomBytes: () => Uint8Array.from(bytes.shift() ?? []) }),
    );
    expect(d.addComment(I(1), {}, 'a')).toBe('20261119T080000Z-spw-000.md');
    expect(d.addComment(I(1), {}, 'b')).toBe('20261119T080000Z-spw-111.md');
  });

  test('addComment gives up when the random source keeps colliding', () => {
    const d = new Draft(
      snap({ issues: [{ id: I(1) }] }),
      ctx('spw', { randomBytes: (n) => new Uint8Array(n) }),
    );
    d.addComment(I(1), {}, 'a');
    expect(catchErr(() => d.addComment(I(1), {}, 'b')).code).toBe('unexpected');
  });

  test('addComment rejects a random source that delivers too few bytes', () => {
    const d = new Draft(
      snap({ issues: [{ id: I(1) }] }),
      ctx('spw', { randomBytes: () => new Uint8Array(2) }),
    );
    expect(catchErr(() => d.addComment(I(1), {}, 'a')).message).toContain('2 statt 3 Bytes');
  });

  test('addComment with a given file takes created from the name', () => {
    const d = new Draft(snap({ issues: [{ id: I(1) }] }), ctx('claude-1'));
    const name = '20261118T093000Z-claude-1-xyz.md';
    expect(d.addComment(I(1), {}, 'Hallo', name)).toBe(name);
    const [change] = d.finish().changes;
    expect(change?.content).toBe(
      serializeEntityFile(
        'comment',
        { author: 'claude-1', created: '2026-11-18T09:30:00Z' },
        'Hallo',
      ),
    );
  });

  test('addComment rejects foreign or reused file names and missing issues', () => {
    const d = new Draft(snap({ issues: [{ id: I(1) }] }), ctx());
    expect(
      reasonOf(catchErr(() => d.addComment(I(1), {}, 'x', '20261118T093000Z-alice-xyz.md'))),
    ).toBe('policy');
    expect(reasonOf(catchErr(() => d.addComment(I(1), {}, 'x', 'kein-name.md')))).toBe('schema');
    d.addComment(I(1), {}, 'x', '20261118T093000Z-spw-xyz.md');
    expect(
      reasonOf(catchErr(() => d.addComment(I(1), {}, 'y', '20261118T093000Z-spw-xyz.md'))),
    ).toBe('exists');
    expect(reasonOf(catchErr(() => d.addComment(I(2), {}, 'x')))).toBe('missing_ref');
  });

  test('without a random source comment names are still well-formed', () => {
    const d = new Draft(snap({ issues: [{ id: I(1) }] }), {
      actor: 'spw',
      now: '2026-11-19T08:00:00Z',
    });
    expect(d.addComment(I(1), {}, 'x')).toMatch(/^20261119T080000Z-spw-[0-9a-hjkmnp-tv-z]{3}\.md$/);
  });

  test('putFile changes are sorted by path, notices are collected', () => {
    const d = new Draft(snap({ issues: [{ id: I(1) }] }), ctx());
    d.putFile(`${issueDir(I(1))}/z.txt`, null);
    d.putFile(`${issueDir(I(1))}/a.txt`, 'a');
    d.putIssue(I(1), issueData(I(1), { title: 'neu' }));
    d.notice({ code: 'open_children', message: 'm', ids: [I(1)] });
    const { changes, notices } = d.finish();
    expect(changes.map((c) => c.path)).toEqual([
      `${issueDir(I(1))}/a.txt`,
      issueFile(I(1)),
      `${issueDir(I(1))}/z.txt`,
    ]);
    expect(notices).toEqual([{ code: 'open_children', message: 'm', ids: [I(1)] }]);
    expect(d.revision).toBe(3);
  });
});

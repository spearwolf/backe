import fc from 'fast-check';
import { arbIssueEdit, EDIT_ISSUE } from '../../test/helpers/arbitraries.ts';
import { catchErr } from '../../test/helpers/catch.ts';
import { I, seqBytes, snap } from '../../test/helpers/snapshot.ts';
import { type Issue, validateEntity } from '../core/schemas.ts';
import { entriesInFileOrder, parseEntityFile, serializeEntityFile } from '../store/frontmatter.ts';
import {
  attachmentsDir,
  commentsDir,
  issueFile,
  projectFile,
  repoFile,
  sprintFile,
  userFile,
} from '../store/layout.ts';
import type { BacklogSnapshot, StoredEntity } from '../store/snapshot.ts';
import type { ApplyContext } from './apply.ts';
import { applyBatch } from './batch.ts';
import { bodyHash } from './operation.ts';
import { type EditedFile, translateEdits } from './translate.ts';

const ctx = (): ApplyContext => ({
  actor: 'spw',
  now: '2026-11-19T08:00:00Z',
  randomBytes: seqBytes(),
});
const asSpw = { actor: 'spw' };

/** Kopie von `s`, in der Issue `id` die Felder aus `patch` trägt (ohne Schema-Prüfung). */
function withIssue(
  s: BacklogSnapshot,
  id: string,
  patch: Partial<StoredEntity<Issue>>,
): BacklogSnapshot {
  const entity = s.issues.get(id);
  if (entity === undefined) throw new Error(`Issue ${id} fehlt`);
  return { ...s, issues: new Map(s.issues).set(id, { ...entity, ...patch }) };
}

const s = withIssue(
  snap({
    projects: ['web', 'ops'],
    sprints: ['w47'],
    repos: { webapp: 'https://github.com/acme/webapp' },
    issues: [
      { id: I(1), title: 'T', rank: 1000, assignee: 'alice', projects: ['web'] },
      { id: I(2), title: 'Zwei' },
      { id: I(3), title: 'Drei', state: 'blocked', blocked_by: [I(2)] },
    ],
  }),
  I(1),
  { body: 'Body.\n' },
);

const base = withIssue(snap({ issues: [{ id: EDIT_ISSUE.data.id, title: 'T' }] }), I(1), {
  data: EDIT_ISSUE.data,
  extra: EDIT_ISSUE.extra,
  body: EDIT_ISSUE.body,
});

/** Kanonischer Inhalt der Datei `path` im Snapshot. */
function textAt(snapshot: BacklogSnapshot, path: string): string {
  const maps = [
    ['issue', snapshot.issues],
    ['user', snapshot.users],
    ['project', snapshot.projects],
    ['sprint', snapshot.sprints],
    ['repo', snapshot.repos],
  ] as const;
  for (const [kind, map] of maps) {
    for (const e of (map as Map<string, StoredEntity<unknown>>).values()) {
      if (e.path === path) {
        return serializeEntityFile(kind, e.data as Record<string, unknown>, e.body, e.extra);
      }
    }
  }
  throw new Error(`${path} fehlt im Snapshot`);
}

function edit(path: string, fn: (text: string) => string, from = s): EditedFile {
  const before = textAt(from, path);
  return { path, before, after: fn(before) };
}

/** Hand-Edit an den Daten eines Issues in `s`; `body` ersetzt den Body. */
function editIssue(id: string, patch: Partial<Issue>, body?: string): EditedFile {
  const e = s.issues.get(id);
  if (e === undefined) throw new Error(`Issue ${id} fehlt`);
  const path = issueFile(id);
  const after = serializeEntityFile('issue', { ...e.data, ...patch }, body ?? e.body, e.extra);
  return { path, before: textAt(s, path), after };
}

function added(path: string, after: string): EditedFile {
  return { path, before: null, after };
}

function removed(path: string, from = s): EditedFile {
  return { path, before: textAt(from, path), after: null };
}

function issueText(data: Record<string, unknown>, body = ''): string {
  return serializeEntityFile('issue', data, body);
}

const reasonOf = (fn: () => unknown) => (catchErr(fn).details as { reason?: string }).reason;

const commentPath = (name: string, id = I(1)) => `${commentsDir(id)}/${name}`;
const commentText = (head: string, body: string) => `---\n${head}---\n${body}`;
const SPW_COMMENT = '20261119T080000Z-spw-abc.md';

describe('translateEdits', () => {
  test('frontmatter, body and a new comment become operations', () => {
    const r = translateEdits(
      s,
      [
        edit(issueFile(I(1)), (f) =>
          f.replace('title: T', 'title: Neu').replace('Body.\n', 'Neuer Body.\n'),
        ),
        {
          path: `${commentsDir(I(1))}/20261119T080000Z-spw-abc.md`,
          before: null,
          after: '---\nauthor: spw\ncreated: 2026-11-19T08:00:00Z\n---\nHallo\n',
        },
      ],
      { actor: 'spw' },
    );
    expect(r.ops).toEqual([
      {
        op: 'issue.edit',
        id: I(1),
        set: { title: { from: 'T', to: 'Neu' } },
        body: { from_hash: bodyHash('Body.\n'), to: 'Neuer Body.\n' },
      },
      { op: 'comment.add', id: I(1), file: '20261119T080000Z-spw-abc.md', body: 'Hallo\n' },
    ]);
    expect([r.manual, r.warnings]).toEqual([[], []]);
  });

  test('crlf body edit is not a conflict', () => {
    const crlfOnly = translateEdits(
      s,
      [edit(issueFile(I(1)), (f) => f.replaceAll('\n', '\r\n'))],
      asSpw,
    );
    expect(crlfOnly).toEqual({ ops: [], manual: [], warnings: [] });

    const changed = translateEdits(
      s,
      [edit(issueFile(I(1)), (f) => f.replace('Body.\n', 'Zeile 1\r\nZeile 2'))],
      asSpw,
    );
    expect(changed.ops).toEqual([
      {
        op: 'issue.edit',
        id: I(1),
        body: { from_hash: bodyHash('Body.\n'), to: 'Zeile 1\nZeile 2\n' },
      },
    ]);
  });

  describe('state changes', () => {
    test('state change becomes issue.move', () => {
      const r = translateEdits(s, [editIssue(I(1), { state: 'in_progress' })], asSpw);
      expect(r.ops).toEqual([{ op: 'issue.move', id: I(1), from: 'todo', to: 'in_progress' }]);
    });

    test('a move to blocked carries the new blocked_by', () => {
      const r = translateEdits(
        s,
        [editIssue(I(1), { state: 'blocked', blocked_by: [I(2)], paused_from: 'todo' })],
        asSpw,
      );
      expect(r.ops).toEqual([
        { op: 'issue.move', id: I(1), from: 'todo', to: 'blocked', blocked_by: [I(2)] },
      ]);
      const out = applyBatch(s, r.ops, ctx()).snapshot.issues.get(I(1))?.data;
      expect(out).toMatchObject({ state: 'blocked', blocked_by: [I(2)], paused_from: 'todo' });
    });

    test('move, edit and rank come in that order', () => {
      const r = translateEdits(
        s,
        [editIssue(I(1), { state: 'in_progress', title: 'Neu', rank: 5 })],
        asSpw,
      );
      expect(r.ops).toEqual([
        { op: 'issue.move', id: I(1), from: 'todo', to: 'in_progress' },
        { op: 'issue.edit', id: I(1), set: { title: { from: 'T', to: 'Neu' } } },
        { op: 'issue.rank', id: I(1), from: 1000, value: 5 },
      ]);
    });

    test('a new rank on an unranked issue starts from null', () => {
      const r = translateEdits(s, [editIssue(I(2), { rank: 7 })], asSpw);
      expect(r.ops).toEqual([{ op: 'issue.rank', id: I(2), from: null, value: 7 }]);
    });

    test('paused_from that the transition would not produce is a transition error', () => {
      const file = editIssue(I(1), { state: 'on_hold', paused_from: 'review' });
      expect(reasonOf(() => translateEdits(s, [file], asSpw))).toBe('transition');
    });

    test('changing paused_from without a state change is a transition error', () => {
      const err = catchErr(() =>
        translateEdits(s, [editIssue(I(3), { paused_from: 'review' })], asSpw),
      );
      expect((err.details as { reason?: string }).reason).toBe('transition');
      expect(err.hint).toContain(`backe issue resume ${I(3)}`);
    });

    test('a transition planTransition rejects is a transition error', () => {
      const strict = { ...s, config: { ...s.config, workflow: { strict: true } } };
      const file = editIssue(I(1), { state: 'done' });
      expect(reasonOf(() => translateEdits(strict, [file], asSpw))).toBe('transition');
      expect(translateEdits(s, [file], asSpw).ops).toEqual([
        { op: 'issue.move', id: I(1), from: 'todo', to: 'done' },
      ]);
    });

    test('leaving blocked drops blocked_by and paused_from with the move', () => {
      const r = translateEdits(
        s,
        [editIssue(I(3), { state: 'todo', blocked_by: undefined, paused_from: undefined })],
        asSpw,
      );
      expect(r.ops).toEqual([{ op: 'issue.move', id: I(3), from: 'blocked', to: 'todo' }]);
    });
  });

  describe('issue.edit', () => {
    test('lists become set differences, a pure reorder is no change', () => {
      const r = translateEdits(
        s,
        [
          editIssue(I(1), {
            projects: ['ops', 'web'],
            sprints: ['w47'],
            repos: ['webapp'],
            depends_on: [I(2)],
          }),
          editIssue(I(3), { blocked_by: [I(1)] }),
        ],
        asSpw,
      );
      expect(r.ops).toEqual([
        {
          op: 'issue.edit',
          id: I(1),
          add: { projects: ['ops'], sprints: ['w47'], repos: ['webapp'], depends_on: [I(2)] },
        },
        { op: 'issue.edit', id: I(3), add: { blocked_by: [I(1)] }, remove: { blocked_by: [I(2)] } },
      ]);
      const reordered = withIssue(s, I(1), {
        data: { ...(s.issues.get(I(1))?.data as Issue), projects: ['web', 'ops'] },
      });
      const file = edit(issueFile(I(1)), (f) => f.replace('[web, ops]', '[ops, web]'), reordered);
      expect(file.after).not.toBe(file.before);
      expect(translateEdits(reordered, [file], asSpw).ops).toEqual([]);
    });

    test('removed fields become null, props compare structurally', () => {
      const withProps = withIssue(s, I(1), {
        data: {
          ...(s.issues.get(I(1))?.data as Issue),
          parent: I(2),
          props: { a: { x: 1, y: [1, 2] }, b: 'weg', c: true },
        },
      });
      const before = textAt(withProps, issueFile(I(1)));
      const data = { ...(withProps.issues.get(I(1))?.data as Issue) };
      data.props = { a: { y: [1, 2], x: 1 }, c: false, d: 'neu' };
      delete data.assignee;
      delete data.parent;
      delete data.projects;
      const after = serializeEntityFile('issue', data, 'Body.\n');
      const r = translateEdits(withProps, [{ path: issueFile(I(1)), before, after }], asSpw);
      expect(r.ops).toEqual([
        {
          op: 'issue.edit',
          id: I(1),
          set: { parent: { from: I(2), to: null }, assignee: { from: 'alice', to: null } },
          remove: { projects: ['web'] },
          props: {
            b: { from: 'weg', to: null },
            c: { from: true, to: false },
            d: { from: null, to: 'neu' },
          },
        },
      ]);
    });
  });

  describe('manual files', () => {
    test('attachments and changed unknown keys are manual', () => {
      const legacy = withIssue(s, I(2), { extra: [['legacy', 1]] });
      const r = translateEdits(
        legacy,
        [
          { path: `${attachmentsDir(I(1))}/shot.png`, before: null, after: 'png' },
          { path: '.backe/backlog.jsonc', before: '{}', after: '{"x":1}' },
          { path: `issues/${I(1).slice(3, 5)}/${I(1)}/notes.txt`, before: null, after: 'x' },
          edit(issueFile(I(2)), (f) => f.replace('legacy: 1', 'legacy: 2'), legacy),
          edit(issueFile(I(1)), (f) => f.replace('---\nBody', 'neu: x\n---\nBody')),
          editIssue(I(3), {
            attachments: [{ name: 'log', url: 'https://example.com/log' }],
            title: 'auch neu',
          }),
        ],
        asSpw,
      );
      expect(r.ops).toEqual([]);
      expect(r.manual).toEqual([
        '.backe/backlog.jsonc',
        `${attachmentsDir(I(1))}/shot.png`,
        issueFile(I(1)),
        `issues/${I(1).slice(3, 5)}/${I(1)}/notes.txt`,
        issueFile(I(2)),
        issueFile(I(3)),
      ]);
      expect(r.warnings).toEqual([
        { path: issueFile(I(1)), unknownKeys: ['neu'] },
        { path: issueFile(I(2)), unknownKeys: ['legacy'] },
      ]);
    });

    test('unchanged unknown keys are kept and only warned about', () => {
      const legacy = withIssue(s, I(2), { extra: [['legacy', 1]] });
      const r = translateEdits(
        legacy,
        [edit(issueFile(I(2)), (f) => f.replace('title: Zwei', 'title: Zwo'), legacy)],
        asSpw,
      );
      expect(r.ops).toEqual([
        { op: 'issue.edit', id: I(2), set: { title: { from: 'Zwei', to: 'Zwo' } } },
      ]);
      expect(r.warnings).toEqual([{ path: issueFile(I(2)), unknownKeys: ['legacy'] }]);
      const out = applyBatch(legacy, r.ops, ctx()).changes[0]?.content;
      expect(out).toContain('legacy: 1');
    });

    test('removing unknown keys, removing the rank and new issues with attachments are manual', () => {
      const legacy = withIssue(s, I(2), { extra: [['legacy', 1]] });
      const r = translateEdits(
        legacy,
        [
          edit(issueFile(I(2)), (f) => f.replace('legacy: 1\n', ''), legacy),
          editIssue(I(1), { rank: undefined }),
          added(
            issueFile(I(9)),
            issueText({
              id: I(9),
              title: 'Neu',
              state: 'todo',
              creator: 'spw',
              attachments: [{ name: 'log', url: 'https://example.com/log' }],
              created: '2026-11-19T08:00:00Z',
            }),
          ),
        ],
        asSpw,
      );
      expect(r.ops).toEqual([]);
      expect(r.manual).toEqual([issueFile(I(1)), issueFile(I(2)), issueFile(I(9))]);
    });

    test('deleting a file with unknown keys is no manual edit', () => {
      const legacy = withIssue(s, I(2), { extra: [['legacy', 1]] });
      const r = translateEdits(legacy, [removed(issueFile(I(2)), legacy)], asSpw);
      expect(r).toEqual({
        ops: [{ op: 'issue.delete', id: I(2), force: true }],
        manual: [],
        warnings: [],
      });
    });

    test('a deleted sprint and a changed comment head are manual', () => {
      const name = SPW_COMMENT;
      const r = translateEdits(
        s,
        [
          removed(sprintFile('w47')),
          {
            path: commentPath(name),
            before: commentText('author: spw\ncreated: 2026-11-19T08:00:00Z\n', 'Hallo\n'),
            after: commentText('author: alice\ncreated: 2026-11-19T08:00:00Z\n', 'Hallo\n'),
          },
        ],
        asSpw,
      );
      expect(r.ops).toEqual([]);
      expect(r.manual).toEqual([commentPath(name), sprintFile('w47')]);
    });
  });

  describe('identity and validation', () => {
    test('changing creator is a policy error', () => {
      expect(
        reasonOf(() => translateEdits(s, [editIssue(I(1), { creator: 'alice' })], asSpw)),
      ).toBe('policy');
      expect(
        reasonOf(() =>
          translateEdits(s, [editIssue(I(1), { created: '2026-01-01T00:00:00Z' })], asSpw),
        ),
      ).toBe('policy');
      expect(reasonOf(() => translateEdits(s, [editIssue(I(1), { id: I(8) })], asSpw))).toBe(
        'policy',
      );
    });

    test('parse and validation errors name the file and line', () => {
      const broken = catchErr(() =>
        translateEdits(
          s,
          [edit(issueFile(I(1)), (f) => f.replace('title: T', 'title: [x'))],
          asSpw,
        ),
      );
      expect(broken.message).toMatch(new RegExp(`^${issueFile(I(1))}:\\d+: `));
      const invalid = catchErr(() =>
        translateEdits(
          s,
          [edit(issueFile(I(1)), (f) => f.replace('state: todo', 'state: nope'))],
          asSpw,
        ),
      );
      expect([invalid.code, invalid.message.startsWith(`${issueFile(I(1))}: state: `)]).toEqual([
        'validation',
        true,
      ]);
    });

    test('a new issue whose id does not match its path is rejected', () => {
      const file = added(
        issueFile(I(9)),
        issueText({
          id: I(8),
          title: 'X',
          state: 'todo',
          creator: 'spw',
          created: '2026-11-19T08:00:00Z',
        }),
      );
      expect(reasonOf(() => translateEdits(s, [file], asSpw))).toBe('schema');
    });
  });

  describe('new and deleted issues', () => {
    test('new hand-written issue lists empty fields explicitly', () => {
      const r = translateEdits(
        s,
        [
          added(
            issueFile(I(9)),
            issueText(
              {
                id: I(9),
                title: 'Neu',
                state: 'blocked',
                blocked_by: [I(2)],
                paused_from: 'todo',
                parent: I(1),
                creator: 'spw',
                created: '2026-11-19T08:00:00Z',
              },
              'Text',
            ),
          ),
        ],
        asSpw,
      );
      expect(r.ops).toEqual([
        {
          op: 'issue.create',
          id: I(9),
          title: 'Neu',
          state: 'blocked',
          blocked_by: [I(2)],
          paused_from: 'todo',
          parent: I(1),
          projects: [],
          sprints: [],
          repos: [],
          created: '2026-11-19T08:00:00Z',
          body: 'Text\n',
        },
      ]);
      const out = applyBatch(s, r.ops, ctx()).snapshot.issues.get(I(9))?.data;
      expect(out?.projects).toBeUndefined();
    });

    test('every field of a new issue goes into issue.create', () => {
      const data = {
        id: I(9),
        title: 'Voll',
        state: 'todo',
        parent: I(1),
        depends_on: [I(2)],
        rank: 3,
        creator: 'spw',
        assignee: 'alice',
        projects: ['ops'],
        sprints: ['w47'],
        repos: ['webapp@main'],
        created: '2026-11-19T08:00:00Z',
        props: { size: 2 },
      };
      const after = issueText(data);
      const r = translateEdits(s, [added(issueFile(I(9)), after)], asSpw);
      const { id: _, creator: __, ...fields } = data;
      expect(r.ops).toEqual([{ op: 'issue.create', id: I(9), ...fields, body: '' }]);
      const change = applyBatch(s, r.ops, ctx()).changes.find((c) => c.path === issueFile(I(9)));
      expect(change?.content).toBe(after);
    });

    test('a new issue by someone else is a policy error', () => {
      const file = added(
        issueFile(I(9)),
        issueText({
          id: I(9),
          title: 'X',
          state: 'todo',
          creator: 'alice',
          created: '2026-11-19T08:00:00Z',
        }),
      );
      expect(reasonOf(() => translateEdits(s, [file], asSpw))).toBe('policy');
    });

    test('new issues are created in dependency order, ties by id', () => {
      const issue = (n: number, extra: Record<string, unknown>) =>
        added(
          issueFile(I(n)),
          issueText({
            id: I(n),
            title: `N${n}`,
            state: 'todo',
            creator: 'spw',
            created: '2026-11-19T08:00:00Z',
            ...extra,
          }),
        );
      const r = translateEdits(
        s,
        [
          issue(10, { parent: I(13) }),
          issue(11, { depends_on: [I(10), I(2)] }),
          issue(12, {}),
          issue(13, {}),
          issue(14, { state: 'blocked', blocked_by: [I(12)], paused_from: 'todo' }),
        ],
        asSpw,
      );
      expect(r.ops.map((o) => (o as { id: string }).id)).toEqual([
        I(12),
        I(13),
        I(10),
        I(11),
        I(14),
      ]);
      expect(() => applyBatch(s, r.ops, ctx())).not.toThrow();
    });

    test('new issues that reference each other in a cycle cannot be ordered', () => {
      const issue = (n: number, extra: Record<string, unknown>) =>
        added(
          issueFile(I(n)),
          issueText({
            id: I(n),
            title: 'N',
            state: 'todo',
            creator: 'spw',
            created: '2026-11-19T08:00:00Z',
            ...extra,
          }),
        );
      const files = [issue(10, { parent: I(11) }), issue(11, { depends_on: [I(10)] })];
      expect(reasonOf(() => translateEdits(s, files, asSpw))).toBe('cycle');
    });

    test('a deleted issue becomes issue.delete and takes its comments and attachments along', () => {
      const r = translateEdits(
        s,
        [
          removed(issueFile(I(2))),
          {
            path: commentPath('20261118T100000Z-alice-abc.md', I(2)),
            before: commentText('author: alice\ncreated: 2026-11-18T10:00:00Z\n', 'x\n'),
            after: null,
          },
          { path: `${attachmentsDir(I(2))}/shot.png`, before: 'png', after: null },
        ],
        asSpw,
      );
      expect(r).toEqual({
        ops: [{ op: 'issue.delete', id: I(2), force: true }],
        manual: [],
        warnings: [],
      });
    });

    test('deleted sub-issues go before their parent', () => {
      const family = snap({
        issues: [
          { id: I(1), title: 'A' },
          { id: I(2), title: 'B', parent: I(3) },
          { id: I(3), title: 'C', parent: I(1) },
        ],
      });
      const r = translateEdits(
        family,
        [
          removed(issueFile(I(1)), family),
          removed(issueFile(I(2)), family),
          removed(issueFile(I(3)), family),
        ],
        asSpw,
      );
      expect(r.ops.map((o) => (o as { id: string }).id)).toEqual([I(2), I(3), I(1)]);
      expect(applyBatch(family, r.ops, ctx()).snapshot.issues.size).toBe(0);
    });
  });

  describe('comments', () => {
    const head = 'author: spw\ncreated: 2026-11-19T08:00:00Z\n';

    test('edited and deleted comments', () => {
      const name = SPW_COMMENT;
      const other = '20261119T090000Z-spw-def.md';
      const r = translateEdits(
        s,
        [
          {
            path: commentPath(name),
            before: commentText(head, 'Alt\n'),
            after: commentText(head, 'Neu'),
          },
          {
            path: commentPath(other),
            before: commentText('author: spw\ncreated: 2026-11-19T09:00:00Z\n', 'x\n'),
            after: null,
          },
          {
            path: commentPath('20261119T100000Z-spw-ghj.md'),
            before: commentText('author: spw\ncreated: 2026-11-19T10:00:00Z\n', 'gleich\n'),
            after: commentText('author: spw\ncreated: 2026-11-19T10:00:00Z\n', 'gleich\r\n'),
          },
        ],
        asSpw,
      );
      expect(r.ops).toEqual([
        { op: 'comment.edit', id: I(1), file: name, from_hash: bodyHash('Alt\n'), body: 'Neu\n' },
        { op: 'comment.delete', id: I(1), file: other },
      ]);
    });

    test.each([
      ['an author in the name that is not the actor', '20261119T080000Z-alice-abc.md', head],
      [
        'an author in the frontmatter that is not the actor',
        SPW_COMMENT,
        'author: alice\ncreated: 2026-11-19T08:00:00Z\n',
      ],
      [
        'created not matching the name',
        SPW_COMMENT,
        'author: spw\ncreated: 2026-11-19T08:00:01Z\n',
      ],
    ])('a new comment with %s is a policy error', (_, name, frontmatter) => {
      const file = added(commentPath(name), commentText(frontmatter, 'x\n'));
      expect(reasonOf(() => translateEdits(s, [file], asSpw))).toBe('policy');
    });

    test('a hand-written transition comment is a transition error', () => {
      const file = added(
        commentPath(SPW_COMMENT),
        commentText(`${head}kind: transition\nfrom: todo\nto: done\n`, 'x\n'),
      );
      expect(reasonOf(() => translateEdits(s, [file], asSpw))).toBe('transition');
    });
  });

  describe('projects, sprints, repos and users', () => {
    const key = 'ssh-ed25519 AAAAbob bob';

    test('new entities become their create operations', () => {
      const r = translateEdits(
        s,
        [
          added(projectFile('web/auth'), '---\ntitle: Auth\nlead: alice\n---\nText\n'),
          added(projectFile('data'), '---\ntitle: Data\n---\n'),
          added(
            sprintFile('w48'),
            '---\ntitle: W48\nstart: 2026-11-23\nend: 2026-11-29\nclosed: true\n---\n',
          ),
          added(repoFile('api'), '---\nurl: https://github.com/acme/api\ndefault_ref: main\n---\n'),
          added(
            userFile('bob'),
            `---\nname: Bob\nkind: human\nkeys:\n  - ${key}\nrevoked_keys:\n  - key: ssh-ed25519 AAAAold bob\n    revoked: 2026-11-01T00:00:00Z\n---\n`,
          ),
        ],
        asSpw,
      );
      expect(r.ops).toEqual([
        { op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [key] },
        {
          op: 'entity.edit',
          kind: 'user',
          key: 'bob',
          set: {
            revoked_keys: {
              from: null,
              to: [{ key: 'ssh-ed25519 AAAAold bob', revoked: '2026-11-01T00:00:00Z' }],
            },
          },
        },
        { op: 'project.create', path: 'data', title: 'Data' },
        { op: 'project.create', path: 'web/auth', title: 'Auth', lead: 'alice', body: 'Text\n' },
        { op: 'sprint.create', slug: 'w48', title: 'W48', start: '2026-11-23', end: '2026-11-29' },
        {
          op: 'entity.edit',
          kind: 'sprint',
          key: 'w48',
          set: { closed: { from: null, to: true } },
        },
        { op: 'repo.add', url: 'https://github.com/acme/api', name: 'api', default_ref: 'main' },
      ]);
      const changes = applyBatch(s, r.ops, ctx()).changes;
      expect(changes.map((c) => c.path)).toEqual([
        projectFile('data'),
        projectFile('web/auth'),
        repoFile('api'),
        sprintFile('w48'),
        userFile('bob'),
      ]);
    });

    test('changed and deleted entities', () => {
      const withBob = snap({
        users: ['bob', 'carl'],
        projects: ['web', 'web/auth', 'ops'],
        repos: { api: 'https://github.com/acme/api' },
      });
      const r = translateEdits(
        withBob,
        [
          edit(
            projectFile('ops'),
            (f) => f.replace('title: ops', 'title: Ops\nlead: alice').concat('Neu\n'),
            withBob,
          ),
          edit(userFile('carl'), (f) => f.replace('name: carl', 'name: Carl'), withBob),
          removed(projectFile('web'), withBob),
          removed(projectFile('web/auth'), withBob),
          removed(repoFile('api'), withBob),
          removed(userFile('bob'), withBob),
        ],
        asSpw,
      );
      expect(r.ops).toEqual([
        {
          op: 'entity.edit',
          kind: 'user',
          key: 'carl',
          set: { name: { from: 'carl', to: 'Carl' } },
        },
        {
          op: 'entity.edit',
          kind: 'project',
          key: 'ops',
          set: { title: { from: 'ops', to: 'Ops' }, lead: { from: null, to: 'alice' } },
          body: { from_hash: bodyHash(''), to: 'Neu\n' },
        },
        { op: 'repo.rm', name: 'api' },
        { op: 'project.rm', path: 'web/auth' },
        { op: 'project.rm', path: 'web' },
        { op: 'user.rm', handle: 'bob' },
      ]);
    });

    test('a field removed from an entity is set to null', () => {
      const r = translateEdits(
        s,
        [
          {
            path: projectFile('x'),
            before: '---\ntitle: X\nlead: alice\n---\n',
            after: '---\ntitle: X\n---\n',
          },
        ],
        asSpw,
      );
      expect(r.ops).toEqual([
        {
          op: 'entity.edit',
          kind: 'project',
          key: 'x',
          set: { lead: { from: 'alice', to: null } },
        },
      ]);
    });
  });

  test('new humans come before new agents, so a new operator exists first', () => {
    const r = translateEdits(
      s,
      [
        added(
          userFile('a-1'),
          '---\nname: A1\nkind: agent\noperator: zed\nkeys:\n  - ssh-ed25519 AAAAa1 a-1\n---\n',
        ),
        added(
          userFile('zed'),
          '---\nname: Zed\nkind: human\nkeys:\n  - ssh-ed25519 AAAAzed zed\n---\n',
        ),
      ],
      asSpw,
    );
    expect(r.ops.map((o) => (o as { handle: string }).handle)).toEqual(['zed', 'a-1']);
    expect(applyBatch(s, r.ops, ctx()).snapshot.users.get('a-1')?.data.operator).toBe('zed');
  });

  test('a path given twice is a usage error naming the path', () => {
    const file = editIssue(I(1), { title: 'Neu' });
    const err = catchErr(() => translateEdits(s, [file, { ...file, after: null }], asSpw));
    expect([err.code, err.message.includes(issueFile(I(1)))]).toEqual(['usage', true]);
  });

  describe('order of dependent edits', () => {
    const agentText = (operator: string) =>
      `---\nname: Z1\nkind: agent\noperator: ${operator}\nkeys:\n  - ssh-ed25519 AAAAz1 zz-1\n---\n`;
    const humanText = '---\nname: Zed\nkind: human\nkeys:\n  - ssh-ed25519 AAAAzed zed\n---\n';

    test('a deleted agent goes before its deleted operator', () => {
      const withAgent = applyBatch(
        s,
        [
          {
            op: 'user.add',
            handle: 'zz-1',
            name: 'Z1',
            kind: 'agent',
            operator: 'alice',
            keys: ['ssh-ed25519 AAAAz1 zz-1'],
          },
        ],
        ctx(),
      ).snapshot;
      const r = translateEdits(
        withAgent,
        [removed(userFile('alice'), withAgent), removed(userFile('zz-1'), withAgent)],
        asSpw,
      );
      expect(r.ops).toEqual([
        { op: 'user.rm', handle: 'zz-1' },
        { op: 'user.rm', handle: 'alice' },
      ]);
      expect(applyBatch(withAgent, r.ops, ctx()).snapshot.users.has('alice')).toBe(false);
    });

    test('an existing agent may get a new human as operator', () => {
      const r = translateEdits(
        s,
        [
          edit(userFile('claude-1'), (f) => f.replace('operator: spw', 'operator: zed')),
          added(userFile('zed'), humanText),
          added(userFile('zz-1'), agentText('zed')),
        ],
        asSpw,
      );
      expect(r.ops.map((o) => o.op)).toEqual(['user.add', 'user.add', 'entity.edit']);
      const users = applyBatch(s, r.ops, ctx()).snapshot.users;
      expect([users.get('claude-1')?.data.operator, users.get('zz-1')?.data.operator]).toEqual([
        'zed',
        'zed',
      ]);
    });

    test('sub-issues settle before their parent', () => {
      const family = snap({
        issues: [
          { id: I(20), title: 'Parent' },
          { id: I(21), title: 'Kind', parent: I(20) },
          { id: I(22), title: 'Enkel', parent: I(21) },
        ],
      });
      const done = (id: string) => {
        const path = issueFile(id);
        return edit(path, (f) => f.replace('state: todo', 'state: done'), family);
      };
      const r = translateEdits(family, [done(I(20)), done(I(21)), done(I(22))], asSpw);
      expect(r.ops.map((o) => (o as { id: string }).id)).toEqual([I(22), I(21), I(20)]);
      const out = applyBatch(family, r.ops, ctx()).snapshot.issues;
      expect([...out.values()].map((e) => e.data.state)).toEqual(['done', 'done', 'done']);
    });

    test.each([
      ['a new comment', null],
      ['a changed comment', commentText('author: spw\ncreated: 2026-11-19T08:00:00Z\n', 'Alt\n')],
    ])('%s under a deleted issue is a usage error', (_, before) => {
      const path = commentPath(SPW_COMMENT, I(2));
      const err = catchErr(() =>
        translateEdits(
          s,
          [
            removed(issueFile(I(2))),
            {
              path,
              before,
              after: commentText('author: spw\ncreated: 2026-11-19T08:00:00Z\n', 'Neu\n'),
            },
          ],
          asSpw,
        ),
      );
      expect([err.code, err.message.includes(path), err.message.includes(I(2))]).toEqual([
        'usage',
        true,
        true,
      ]);
    });
  });

  test('operations follow the global order', () => {
    const files: EditedFile[] = [
      removed(userFile('alice')),
      removed(issueFile(I(2))),
      added(
        commentPath(SPW_COMMENT),
        commentText('author: spw\ncreated: 2026-11-19T08:00:00Z\n', 'x\n'),
      ),
      editIssue(I(1), { title: 'Neu' }),
      added(
        issueFile(I(9)),
        issueText({
          id: I(9),
          title: 'N',
          state: 'todo',
          creator: 'spw',
          created: '2026-11-19T08:00:00Z',
        }),
      ),
      removed(repoFile('webapp')),
      removed(projectFile('ops')),
      added(repoFile('api'), '---\nurl: https://github.com/acme/api\n---\n'),
      added(sprintFile('w48'), '---\ntitle: W48\n---\n'),
      added(projectFile('web/auth'), '---\ntitle: Auth\n---\n'),
      added(projectFile('zz'), '---\ntitle: ZZ\n---\n'),
      added(
        userFile('bob'),
        '---\nname: Bob\nkind: human\nkeys:\n  - ssh-ed25519 AAAAbob bob\n---\n',
      ),
      { path: '.unchanged', before: 'x', after: 'x' },
      { path: 'gone', before: null, after: null },
    ];
    const r = translateEdits(s, files, asSpw);
    expect(r.ops.map((o) => o.op)).toEqual([
      'user.add',
      'project.create',
      'project.create',
      'sprint.create',
      'repo.add',
      'issue.create',
      'issue.edit',
      'comment.add',
      'issue.delete',
      'repo.rm',
      'project.rm',
      'user.rm',
    ]);
    expect([r.ops[1], r.ops[2]]).toMatchObject([{ path: 'zz' }, { path: 'web/auth' }]);
    expect(r.manual).toEqual([]);
  });

  test('applying the translation reproduces the canonical edit (property)', () => {
    fc.assert(
      fc.property(arbIssueEdit(), ({ before, after }) => {
        const r = translateEdits(base, [{ path: issueFile(I(1)), before, after }], {
          actor: 'spw',
        });
        expect(r.manual).toEqual([]);
        const out =
          r.ops.length === 0
            ? undefined
            : applyBatch(base, r.ops, ctx()).changes.find((c) => c.path === issueFile(I(1)));
        const p = parseEntityFile(after, 'f');
        const { data } = validateEntity('issue', p.data, 'f');
        expect(out?.content ?? before).toBe(
          serializeEntityFile(
            'issue',
            data as Record<string, unknown>,
            p.body,
            entriesInFileOrder(p, ['legacy']),
          ),
        );
      }),
    );
  });

  test('a new project and a new issue in it replay to the edited files', () => {
    const project = '---\ntitle: Neu\n---\nWorum es geht.\n';
    const issue = issueText(
      {
        id: I(9),
        title: 'Im neuen Projekt',
        state: 'todo',
        creator: 'spw',
        projects: ['neu'],
        created: '2026-11-19T08:00:00Z',
      },
      'Text\n',
    );
    const r = translateEdits(
      s,
      [added(issueFile(I(9)), issue), added(projectFile('neu'), project)],
      asSpw,
    );
    expect(r.ops.map((o) => o.op)).toEqual(['project.create', 'issue.create']);
    expect(applyBatch(s, r.ops, ctx()).changes).toEqual([
      { path: issueFile(I(9)), content: issue },
      { path: projectFile('neu'), content: project },
    ]);
  });
});

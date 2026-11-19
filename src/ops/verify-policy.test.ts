import { cfg, I, testKey } from '../../test/helpers/snapshot.ts';
import type { User } from '../core/schemas.ts';
import { serializeEntityFile } from '../store/frontmatter.ts';
import { commentFileName, commentsDir, issueFile, userFile } from '../store/layout.ts';
import { checkCommitPolicy, type PolicyState, type TreeChange } from './verify-policy.ts';

const ID = I(1);
const OTHER = '2026-01-01T00:00:00Z';
const CREATED = '2026-11-18T10:00:00Z';

const human = (name: string, keys = [testKey(name)]): User => ({ name, kind: 'human', keys });
const state = (admins: string[], users: User[] = []): PolicyState => ({
  config: cfg({ admins }),
  users: new Map([
    ['root', human('root')],
    ['spw', human('spw')],
    ['alice', human('alice')],
    ...users.map((u): [string, User] => [u.name, u]),
  ]),
});

const issueText = (over: Record<string, unknown> = {}) =>
  serializeEntityFile(
    'issue',
    { id: ID, title: 'T', state: 'todo', creator: 'spw', created: CREATED, ...over },
    '',
  );
const addIssue = (id = ID, over: Record<string, unknown> = {}): TreeChange => ({
  path: issueFile(id),
  status: 'A',
  oldMode: '000000',
  newMode: '100644',
  before: null,
  after: issueText({ id, ...over }),
});
const editIssue = (id = ID, over: Record<string, unknown> = {}): TreeChange => ({
  path: issueFile(id),
  status: 'M',
  oldMode: '100644',
  newMode: '100644',
  before: issueText({ id }),
  after: issueText({ id, ...over }),
});
const editConfig = (): TreeChange => ({
  path: '.backe/backlog.jsonc',
  status: 'M',
  oldMode: '100644',
  newMode: '100644',
  before: '{}',
  after: '{ }',
});
const commentText = (author: string, body = 'x') =>
  serializeEntityFile('comment', { author, created: CREATED }, body);
const COMMENT = commentFileName(CREATED, 'bob', 'abc');
const commentPath = `${commentsDir(ID)}/${COMMENT}`;
const comment = (status: 'A' | 'M' | 'D', author: string): TreeChange => ({
  path: commentPath,
  status,
  oldMode: status === 'A' ? '000000' : '100644',
  newMode: status === 'D' ? '000000' : '100644',
  before: status === 'A' ? null : commentText(author),
  after: status === 'D' ? null : commentText(author, 'y'),
});
const deleteIssue = (): TreeChange => ({
  path: issueFile(ID),
  status: 'D',
  oldMode: '100644',
  newMode: '000000',
  before: issueText(),
  after: null,
});
const userChange = (
  handle: string,
  status: 'A' | 'M' | 'D',
  before: User | null,
  after: User | null,
  raw?: string,
): TreeChange => ({
  path: userFile(handle),
  status,
  oldMode: status === 'A' ? '000000' : '100644',
  newMode: status === 'D' ? '000000' : '100644',
  before: before && serializeEntityFile('user', before, ''),
  after: raw ?? (after && serializeEntityFile('user', after, '')),
});

function check(o: {
  actor?: string;
  admins?: string[];
  changes: TreeChange[];
  after?: PolicyState;
  removed?: string[];
}) {
  const parent = state(o.admins ?? ['spw']);
  return checkCommitPolicy({
    actor: o.actor ?? 'spw',
    parent,
    after: o.after ?? parent,
    changes: o.changes,
    removedHandles: new Set(o.removed ?? []),
  });
}

describe('checkCommitPolicy', () => {
  test('a valid issue create by its creator passes', () =>
    expect(check({ actor: 'spw', changes: [addIssue(ID, { creator: 'spw' })] })).toEqual([]));

  test.each<[string, TreeChange[], string[]]>([
    ['symlink', [{ ...addIssue(ID), newMode: '120000' }], [`Symlink: ${issueFile(ID)}`]],
    [
      'submodule',
      [
        {
          path: 'vendor',
          status: 'A',
          oldMode: '000000',
          newMode: '160000',
          before: null,
          after: null,
        },
      ],
      ['Submodule: vendor'],
    ],
    [
      'foreign creator',
      [addIssue(ID, { creator: 'bob' })],
      [`creator von ${ID} ist bob, Akteur ist spw`],
    ],
    ['created changed', [editIssue(ID, { created: OTHER })], [`created von ${ID} geändert`]],
    ['config by non-admin', [editConfig()], ['nur Admins ändern .backe/backlog.jsonc']],
  ])('%s', (_, changes, reasons) =>
    expect(check({ actor: 'spw', admins: ['root'], changes })).toEqual(reasons),
  );

  test('a config change by an admin passes', () =>
    expect(check({ actor: 'root', admins: ['root'], changes: [editConfig()] })).toEqual([]));

  test('the quarantine file is protected like the config', () =>
    expect(
      check({
        actor: 'alice',
        changes: [{ ...editConfig(), path: '.backe/quarantine.jsonc' }],
      }),
    ).toEqual(['nur Admins ändern .backe/quarantine.jsonc']));

  test('a new issue with an id different from its path is reported', () =>
    expect(check({ changes: [{ ...addIssue(ID), after: issueText({ id: I(2) }) }] })).toEqual([
      `id von ${issueFile(ID)} ist ${I(2)}`,
    ]));

  test('a changed id or creator is reported by field', () =>
    expect(check({ changes: [editIssue(ID, { creator: 'alice', id: I(2) })] })).toEqual([
      `creator von ${ID} geändert`,
      `id von ${ID} geändert`,
    ]));

  test('an unparseable issue is not checkable', () => {
    const reasons = check({ changes: [{ ...addIssue(ID), after: 'kaputt' }] });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(new RegExp(`^nicht prüfbar: ${issueFile(ID)}: `));
  });

  test('a comment of another author may not be edited or deleted alone, but goes with its issue', () => {
    const msg = `Kommentar ${COMMENT} von bob, Akteur ist spw`;
    expect(check({ changes: [comment('M', 'bob')] })).toEqual([msg]);
    expect(check({ changes: [comment('D', 'bob')] })).toEqual([msg]);
    expect(check({ changes: [comment('D', 'bob'), deleteIssue()] })).toEqual([]);
    expect(check({ actor: 'bob', changes: [comment('M', 'bob')] })).toEqual([]);
  });

  test('a new comment must be authored by the actor', () => {
    expect(check({ changes: [comment('A', 'bob')] })).toEqual([
      `Kommentar ${COMMENT} von bob, Akteur ist spw`,
    ]);
    expect(check({ actor: 'bob', changes: [comment('A', 'bob')] })).toEqual([]);
  });

  test('an unparseable user file is not checkable', () => {
    const reasons = check({
      changes: [userChange('bob', 'A', null, null, 'kein frontmatter')],
    });
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toMatch(new RegExp(`^nicht prüfbar: ${userFile('bob')}: `));
  });

  test('user changes follow checkUserChange on the state after the commit', () => {
    const bob = human('bob');
    const after = state(['spw'], [bob]);
    expect(check({ actor: 'alice', after, changes: [userChange('bob', 'A', null, bob)] })).toEqual([
      expect.stringContaining('bob'),
    ]);
    expect(check({ actor: 'spw', after, changes: [userChange('bob', 'A', null, bob)] })).toEqual(
      [],
    );
  });

  test('a removed handle re-created by a non-admin is reported', () => {
    const agent: User = {
      name: 'a-1',
      kind: 'agent',
      operator: 'alice',
      keys: [testKey('a-1')],
    };
    const after = state(['spw'], [agent]);
    const changes = [userChange('a-1', 'A', null, agent)];
    expect(check({ actor: 'alice', after, changes })).toEqual([]);
    expect(check({ actor: 'alice', after, changes, removed: ['a-1'] })).toHaveLength(1);
  });

  test('attachments, projects and other files have no rule', () =>
    expect(
      check({
        changes: [
          {
            path: 'projects/x.md',
            status: 'M',
            oldMode: '100644',
            newMode: '100644',
            before: null,
            after: null,
          },
          {
            path: 'README.md',
            status: 'D',
            oldMode: '100644',
            newMode: '000000',
            before: null,
            after: null,
          },
        ],
      }),
    ).toEqual([]));
});

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import {
  logTrailers,
  rawCommit,
  revParse,
  sigOf,
  statusShort,
  type TestBacklog,
  testBacklog,
  testKey,
} from '../../test/helpers/git.ts';
import { git } from '../git/exec.ts';
import { BACKLOG_CONFIG, QUARANTINE } from '../store/layout.ts';
import { quarantineCommit } from './quarantine.ts';
import { verifyRange } from './verify.ts';
import { executeWrite } from './write.ts';

const USER_FILE = 'users/spw.md';
let FOREIGN_EDIT = '';

let b: TestBacklog;
let bob: Awaited<ReturnType<typeof testKey>>;

beforeEach(async () => {
  b = await testBacklog();
  bob = await testKey('bob');
  FOREIGN_EDIT = `${await readFile(join(b.root, USER_FILE), 'utf8')}\nTampered by bob.\n`;
  await executeWrite(await b.context(), {
    kind: 'op',
    op: { op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [bob.line] },
  });
});

const badCommit = (files: Record<string, string | null> = { [USER_FILE]: FOREIGN_EDIT }) =>
  rawCommit(b.root, { files, key: bob, actor: 'bob' });

test('accept lets a stuck history verify again with the commit as quarantined', async () => {
  const bad = await badCommit();
  expect((await verifyRange(b.root)).invalid.map((f) => f.sha)).toEqual([bad]);
  await quarantineCommit(await b.context(), { sha: bad, decision: 'accepted', reason: 'harmlos' });
  const r = await verifyRange(b.root);
  expect(r.invalid).toEqual([]);
  expect(r.quarantined).toMatchObject([{ sha: bad, decision: 'accepted', note: 'harmlos' }]);
  const [last] = await logTrailers(b.root);
  expect(last).toMatchObject({ op: 'manual', actor: 'spw' });
  expect(last?.subject).toBe(`verify accept ${bad.slice(0, 7)}`);
  expect(await sigOf(b.root, 'HEAD', { spw: b.key })).toEqual(['G', 'spw']);
});

test('revert restores the files and records the entry in the same commit', async () => {
  const before = await readFile(join(b.root, USER_FILE), 'utf8');
  const bad = await badCommit({ [USER_FILE]: FOREIGN_EDIT, 'notes/new.txt': 'x\n' });
  expect(await readFile(join(b.root, USER_FILE), 'utf8')).toBe(FOREIGN_EDIT);
  const r = await quarantineCommit(await b.context(), {
    sha: bad,
    decision: 'reverted',
    reason: 'fremde Änderung',
  });
  expect(await readFile(join(b.root, USER_FILE), 'utf8')).toBe(before);
  await expect(readFile(join(b.root, 'notes/new.txt'))).rejects.toThrow();
  expect(r.paths).toEqual(expect.arrayContaining([QUARANTINE, USER_FILE, 'notes/new.txt']));
  expect(await statusShort(b.root)).toEqual([]);
  expect(await revParse(b.root, 'HEAD^')).toBe(bad);
  const report = await verifyRange(b.root);
  expect(report.invalid).toEqual([]);
  expect(report.quarantined).toMatchObject([{ sha: bad, decision: 'reverted' }]);
  expect((await logTrailers(b.root))[0]?.subject).toBe(`verify revert ${bad.slice(0, 7)}`);
});

test('revert brings back a file the commit deleted', async () => {
  await rawCommit(b.root, { files: { 'notes/keep.txt': 'keep\n' }, key: b.key, actor: 'spw' });
  const bad = await badCommit({ 'notes/keep.txt': null });
  await quarantineCommit(await b.context(), { sha: bad, decision: 'reverted', reason: 'weg' });
  expect(await readFile(join(b.root, 'notes/keep.txt'), 'utf8')).toBe('keep\n');
});

test('revert of a path changed later is a conflict and writes nothing', async () => {
  const bad = await badCommit();
  await rawCommit(b.root, {
    files: { [USER_FILE]: `${FOREIGN_EDIT}later\n` },
    key: bob,
    actor: 'bob',
  });
  const head = await revParse(b.root, 'HEAD');
  const err = await catchErrAsync(async () =>
    quarantineCommit(await b.context(), { sha: bad, decision: 'reverted', reason: 'x' }),
  );
  expect(err).toMatchObject({
    code: 'conflict',
    message: `${USER_FILE} wurde nach ${bad.slice(0, 7)} geändert; Umkehr von Hand`,
  });
  expect(await revParse(b.root, 'HEAD')).toBe(head);
  expect(await statusShort(b.root)).toEqual([]);
});

test('the anchor commit cannot be reverted', async () => {
  const root = (await git(['rev-list', '--max-parents=0', 'HEAD'], { cwd: b.root })).stdout.trim();
  const err = await catchErrAsync(async () =>
    quarantineCommit(await b.context(), { sha: root, decision: 'reverted', reason: 'x' }),
  );
  expect(err).toMatchObject({
    code: 'conflict',
    message: 'Der Vertrauensanker lässt sich nicht umkehren',
  });
});

test('a non-admin may not quarantine', async () => {
  const bad = await badCommit();
  await rawCommit(b.root, {
    files: {
      [BACKLOG_CONFIG]: JSON.stringify({
        version: 1,
        name: 'acme',
        id_prefix: 'bk',
        admins: ['bob'],
      }),
    },
    key: b.key,
    actor: 'spw',
  });
  const head = await revParse(b.root, 'HEAD');
  const err = await catchErrAsync(async () =>
    quarantineCommit(await b.context(), { sha: bad, decision: 'accepted', reason: 'x' }),
  );
  expect(err).toMatchObject({ code: 'validation', message: 'Quarantäne ändern nur Admins' });
  expect(await revParse(b.root, 'HEAD')).toBe(head);
});

test('an unknown or foreign sha is not_found, a second entry for it a conflict', async () => {
  const ctx = await b.context();
  const unknown = await catchErrAsync(() =>
    quarantineCommit(ctx, { sha: 'f'.repeat(40), decision: 'accepted', reason: 'x' }),
  );
  expect(unknown).toMatchObject({ code: 'not_found' });
  const bad = await badCommit();
  await quarantineCommit(ctx, { sha: bad, decision: 'accepted', reason: 'x' });
  const twice = await catchErrAsync(() =>
    quarantineCommit(ctx, { sha: bad, decision: 'reverted', reason: 'y' }),
  );
  expect(twice).toMatchObject({ code: 'conflict' });
});

test('comments in an existing quarantine.jsonc survive', async () => {
  await rawCommit(b.root, {
    files: { [QUARANTINE]: '{\n  // Notiz bleibt\n  "entries": []\n}\n' },
    key: b.key,
    actor: 'spw',
  });
  const bad = await badCommit();
  await quarantineCommit(await b.context(), { sha: bad, decision: 'accepted', reason: 'ok' });
  const text = await readFile(join(b.root, QUARANTINE), 'utf8');
  expect(text).toContain('// Notiz bleibt');
  expect(text).toContain(bad);
});

const FORGED = JSON.stringify({
  entries: [{ sha: 'a'.repeat(40), decision: 'accepted', reason: 'gefälscht' }],
});

describe('a commit that changed quarantine.jsonc itself', () => {
  test.each(['reverted', 'accepted'] as const)(
    '%s keeps only the admin entry',
    async (decision) => {
      const before = await readFile(join(b.root, USER_FILE), 'utf8');
      const bad = await badCommit({ [USER_FILE]: FOREIGN_EDIT, [QUARANTINE]: FORGED });
      await quarantineCommit(await b.context(), { sha: bad, decision, reason: 'echt' });
      const text = await readFile(join(b.root, QUARANTINE), 'utf8');
      expect(JSON.parse(text).entries).toEqual([{ sha: bad, decision, reason: 'echt' }]);
      expect(await readFile(join(b.root, USER_FILE), 'utf8')).toBe(
        decision === 'reverted' ? before : FOREIGN_EDIT,
      );
      expect((await verifyRange(b.root)).invalid).toEqual([]);
    },
  );
});

test('a revert whose own commit would be invalid is a conflict and writes nothing', async () => {
  const comment = 'issues/ab/bk-abcde/comments/20260101T000000Z-bob-abc.md';
  const bad = await badCommit({
    [USER_FILE]: FOREIGN_EDIT,
    [comment]: '---\nauthor: bob\ncreated: 2026-01-01T00:00:00Z\n---\nhi\n',
  });
  const head = await revParse(b.root, 'HEAD');
  const err = await catchErrAsync(async () =>
    quarantineCommit(await b.context(), { sha: bad, decision: 'reverted', reason: 'x' }),
  );
  expect(err).toMatchObject({ code: 'conflict' });
  expect(err.message).toMatch(/^Umkehr von Hand nötig: /);
  expect(await revParse(b.root, 'HEAD')).toBe(head);
  expect(await statusShort(b.root)).toEqual([]);
});

test('a revert of a commit with a symlink is a conflict', async () => {
  const bad = await rawCommit(b.root, {
    files: { 'notes/link': { symlink: 'x' } },
    key: bob,
    actor: 'bob',
  });
  const err = await catchErrAsync(async () =>
    quarantineCommit(await b.context(), { sha: bad, decision: 'reverted', reason: 'x' }),
  );
  expect(err).toMatchObject({
    code: 'conflict',
    message: 'Umkehr von Hand nötig: Symlink oder Submodule notes/link',
  });
});

test('a commit outside the history of HEAD is not_found', async () => {
  const tree = (await git(['rev-parse', 'HEAD^{tree}'], { cwd: b.root })).stdout.trim();
  const orphan = (
    await git(['commit-tree', tree, '-m', 'orphan'], {
      cwd: b.root,
      env: {
        GIT_AUTHOR_NAME: 'x',
        GIT_AUTHOR_EMAIL: 'x@x.invalid',
        GIT_COMMITTER_NAME: 'x',
        GIT_COMMITTER_EMAIL: 'x@x.invalid',
      },
    })
  ).stdout.trim();
  const err = await catchErrAsync(async () =>
    quarantineCommit(await b.context(), { sha: orphan, decision: 'accepted', reason: 'x' }),
  );
  expect(err).toMatchObject({ code: 'not_found' });
});

test('an invalid quarantine.jsonc in the history does not govern', async () => {
  await rawCommit(b.root, {
    files: { [QUARANTINE]: '{"entries": [{"sha": "nope"}]}' },
    key: b.key,
    actor: 'spw',
  });
  const bad = await badCommit();
  await quarantineCommit(await b.context(), { sha: bad, decision: 'accepted', reason: 'x' });
  const entries = JSON.parse(await readFile(join(b.root, QUARANTINE), 'utf8')).entries;
  expect(entries).toEqual([{ sha: bad, decision: 'accepted', reason: 'x' }]);
});

test('reverting commits that touch users and the config re-checks the planned state', async () => {
  const ctx = await b.context();
  const add = await executeWrite(ctx, {
    kind: 'op',
    op: {
      op: 'user.add',
      handle: 'eve',
      name: 'Eve',
      kind: 'human',
      keys: [(await testKey('eve')).line],
    },
  });
  await quarantineCommit(ctx, { sha: add.commit as string, decision: 'reverted', reason: 'a' });
  await expect(readFile(join(b.root, 'users/eve.md'))).rejects.toThrow();
  const config = JSON.stringify({
    version: 1,
    name: 'acme',
    id_prefix: 'bk',
    admins: ['spw', 'bob'],
  });
  const widen = await rawCommit(b.root, {
    files: { [BACKLOG_CONFIG]: config },
    key: b.key,
    actor: 'spw',
  });
  await quarantineCommit(ctx, { sha: widen, decision: 'reverted', reason: 'b' });
  const restored = JSON.parse(await readFile(join(b.root, BACKLOG_CONFIG), 'utf8'));
  expect(restored.admins).toEqual(['spw']);
  expect((await verifyRange(b.root)).invalid).toEqual([]);
});

test('reverting the removal of a user brings the user file back', async () => {
  const ctx = await b.context();
  await executeWrite(ctx, {
    kind: 'op',
    op: {
      op: 'user.add',
      handle: 'eve',
      name: 'Eve',
      kind: 'human',
      keys: [(await testKey('eve')).line],
    },
  });
  const rm = await executeWrite(ctx, { kind: 'op', op: { op: 'user.rm', handle: 'eve' } });
  await quarantineCommit(ctx, { sha: rm.commit as string, decision: 'reverted', reason: 'c' });
  expect(await readFile(join(b.root, 'users/eve.md'), 'utf8')).toContain('Eve');
});

describe('two invalid commits, the first one touching quarantine.jsonc', () => {
  test.each(['accepted', 'reverted'] as const)(
    '%s for the later one, then accepted for the first keeps both admin entries',
    async (decision) => {
      const ctx = await b.context();
      const b1 = await badCommit({ [USER_FILE]: FOREIGN_EDIT, [QUARANTINE]: FORGED });
      const b2 = await badCommit({ [USER_FILE]: `${FOREIGN_EDIT}more\n`, 'notes/x.txt': 'x\n' });
      await quarantineCommit(ctx, { sha: b2, decision, reason: 'zwei' });
      await quarantineCommit(ctx, { sha: b1, decision: 'accepted', reason: 'eins' });
      const entries = JSON.parse(await readFile(join(b.root, QUARANTINE), 'utf8')).entries;
      expect(entries).toEqual([
        { sha: b2, decision, reason: 'zwei' },
        { sha: b1, decision: 'accepted', reason: 'eins' },
      ]);
      expect((await verifyRange(b.root)).invalid).toEqual([]);
    },
  );
});

test('a revert that would restore an unreadable user file is a conflict', async () => {
  await rawCommit(b.root, { files: { 'users/broken.md': 'kaputt\n' }, key: b.key, actor: 'spw' });
  const bad = await badCommit({ 'users/broken.md': null });
  const err = await catchErrAsync(async () =>
    quarantineCommit(await b.context(), { sha: bad, decision: 'reverted', reason: 'x' }),
  );
  expect(err).toMatchObject({ code: 'conflict' });
  expect(err.message).toMatch(/^Umkehr von Hand nötig: /);
});

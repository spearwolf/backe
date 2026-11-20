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
import { nextCommitBasis, verifyRange, writeCommitBasis } from './verify.ts';
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

test('a revert while another invalid commit stays open may restore content of a later valid commit', async () => {
  const ctx = await b.context();
  // Unsigniert: friert den Stand ein und bleibt offen.
  const first = await rawCommit(b.root, { files: { 'notes/x.txt': '1\n' }, actor: 'spw' });
  const valid = await executeWrite(ctx, { kind: 'op', op: { op: 'issue.create', title: 'V' } });
  const file = valid.paths[0] as string;
  const content = await readFile(join(b.root, file), 'utf8');
  const bad = await badCommit({ [file]: content.replace('title: V', 'title: W') });
  expect((await verifyRange(b.root)).invalid.map((f) => f.sha)).toEqual([first, bad]);

  await quarantineCommit(ctx, { sha: bad, decision: 'reverted', reason: 'zurück auf V' });

  const r = await verifyRange(b.root);
  expect(r.invalid.map((f) => f.sha)).toEqual([first]);
  expect(r.quarantined.map((f) => f.sha)).toEqual([bad]);
  expect(await readFile(join(b.root, file), 'utf8')).toBe(content);
});

test('the write basis walked from verified matches the full walk', async () => {
  const ctx = await b.context();
  const quarantined = await badCommit();
  await quarantineCommit(ctx, { sha: quarantined, decision: 'accepted', reason: 'harmlos' });
  const verified = await revParse(b.root, 'HEAD');
  expect((await verifyRange(b.root, { record: true })).invalid).toEqual([]);
  const open = await rawCommit(b.root, { files: { 'notes/x.txt': '1\n' }, actor: 'spw' });

  const full = await nextCommitBasis(b.root);
  const since = await writeCommitBasis(b.root);
  expect(since.frozen).toEqual({ at: verified, firstOpen: open, open: [open] });
  expect(since.frozen).toEqual(full.frozen);
  expect(since.state.usersTree).toBe(full.state.usersTree);
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
  const bad = await rawCommit(b.root, { files: { 'notes/x.txt': 'x\n' }, actor: 'bob' });
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

test.each(['', ' '])(
  'an empty reason is a validation error and writes nothing: %j',
  async (reason) => {
    const bad = await badCommit();
    const err = await catchErrAsync(async () =>
      quarantineCommit(await b.context(), { sha: bad, decision: 'accepted', reason }),
    );
    expect(err).toMatchObject({ code: 'validation', message: 'Grund darf nicht leer sein' });
    expect(await revParse(b.root, 'HEAD')).toBe(bad);
  },
);

test('a revert that would restore a config failing the schema names the problem', async () => {
  await rawCommit(b.root, {
    files: { [BACKLOG_CONFIG]: '{ "version": 1 }\n' },
    key: b.key,
    actor: 'spw',
  });
  const bad = await badCommit({
    [BACKLOG_CONFIG]: `${JSON.stringify({ version: 1, name: 'acme', id_prefix: 'bk', admins: ['spw'] })}\n`,
  });
  const err = await catchErrAsync(async () =>
    quarantineCommit(await b.context(), { sha: bad, decision: 'reverted', reason: 'x' }),
  );
  expect(err.code).toBe('conflict');
  expect(err.message).toMatch(/^Umkehr von Hand nötig: \.backe\/backlog\.jsonc: \S+: /);
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

const quarantineOf = (sha: string) =>
  `${JSON.stringify({ entries: [{ sha, decision: 'accepted', reason: 'passt' }] }, null, 2)}\n`;

/** bob trägt sich selbst als Admin ein; der Commit ist ungültig. */
async function escalate(): Promise<string> {
  const config = JSON.parse(await readFile(join(b.root, BACKLOG_CONFIG), 'utf8'));
  return rawCommit(b.root, {
    files: { [BACKLOG_CONFIG]: `${JSON.stringify({ ...config, admins: ['spw', 'bob'] })}\n` },
    key: bob,
    actor: 'bob',
    op: 'manual',
  });
}

/** bob setzt seinen Key bei spw ein und nimmt sich selbst einen neuen; der Commit ist ungültig. */
async function hijack(): Promise<string> {
  const spare = await testKey('bob-spare');
  const blob = (line: string) => line.split(' ').slice(0, 2).join(' ');
  const spwFile = await readFile(join(b.root, USER_FILE), 'utf8');
  const bobFile = await readFile(join(b.root, 'users/bob.md'), 'utf8');
  return rawCommit(b.root, {
    files: {
      [USER_FILE]: spwFile.replace(blob(b.key.line), blob(bob.line)),
      'users/bob.md': bobFile.replace(blob(bob.line), blob(spare.line)),
    },
    key: bob,
    actor: 'bob',
    op: 'manual',
  });
}

test('a member made admin only by an invalid commit may not quarantine', async () => {
  const bad = await escalate();
  const ctx = await b.context();
  const err = await catchErrAsync(() =>
    quarantineCommit(
      {
        ...ctx,
        backlog: { ...ctx.backlog, boundTo: 'bob' },
        user: { ...ctx.user, value: 'bob', key: bob.priv },
      },
      { sha: bad, decision: 'accepted', reason: 'x' },
    ),
  );
  expect(err).toMatchObject({ code: 'validation', message: 'Quarantäne ändern nur Admins' });
});

describe('a member who signs a quarantine for her own invalid commit', () => {
  test.each([
    ['makes herself admin', escalate, 'bob', `nur Admins ändern ${QUARANTINE}`],
    ['takes over the admin key', hijack, 'spw', 'signiert von bob, Backe-Actor ist spw'],
  ] as const)(
    '%s: both commits stay invalid and the admin can still quarantine them',
    async (_, attack, actor, reason) => {
      const bad = await attack();
      const self = await rawCommit(b.root, {
        files: { [QUARANTINE]: quarantineOf(bad) },
        key: bob,
        actor,
        op: 'manual',
      });

      const before = await verifyRange(b.root);
      expect(before.invalid.map((f) => f.sha)).toEqual([bad, self]);
      expect(before.invalid[1]?.reasons).toEqual([reason]);
      expect(before.quarantined).toEqual([]);

      const ctx = await b.context();
      await quarantineCommit(ctx, { sha: bad, decision: 'reverted', reason: 'Übernahme' });
      await quarantineCommit(ctx, { sha: self, decision: 'accepted', reason: 'wirkungslos' });

      const after = await verifyRange(b.root);
      expect(after.invalid).toEqual([]);
      expect(after.quarantined.map((f) => f.sha)).toEqual([bad, self]);
    },
  );
});

test('quarantine needs the signing key to be active in the governing state', async () => {
  const bad = await badCommit();
  const fresh = await testKey('spw-new');
  const spwFile = await readFile(join(b.root, USER_FILE), 'utf8');
  // Gültig, aber nach dem ungültigen Commit: Der neue Key gilt erst nach der Quarantäne.
  await rawCommit(b.root, {
    files: { [USER_FILE]: spwFile.replace(b.key.line, `${b.key.line}\n  - ${fresh.line}`) },
    key: b.key,
    actor: 'spw',
    op: 'manual',
  });
  const head = await revParse(b.root, 'HEAD');
  const ctx = await b.context();
  const err = await catchErrAsync(() =>
    quarantineCommit(
      { ...ctx, user: { ...ctx.user, key: fresh.priv } },
      { sha: bad, decision: 'accepted', reason: 'x' },
    ),
  );
  expect(err).toMatchObject({
    code: 'conflict',
    message: 'Umkehr von Hand nötig: der Signier-Key von spw gilt im maßgeblichen Stand nicht',
  });
  expect(await revParse(b.root, 'HEAD')).toBe(head);
});

test('verify accept refuses when HEAD moved after the check', async () => {
  const bad = await badCommit();
  let moved = '';
  const err = await catchErrAsync(async () =>
    quarantineCommit(
      await b.context(),
      { sha: bad, decision: 'accepted', reason: 'harmlos' },
      {
        hooks: {
          beforeLock: async () => {
            moved = await rawCommit(b.root, {
              files: { 'notes/later.txt': 'x\n' },
              key: b.key,
              actor: 'spw',
            });
          },
        },
      },
    ),
  );
  expect(err.code).toBe('conflict');
  expect(err.message).toBe('Stand hat sich seit der Prüfung geändert');
  expect(await revParse(b.root, 'HEAD')).toBe(moved);
  expect(await statusShort(b.root)).toEqual([]);
});

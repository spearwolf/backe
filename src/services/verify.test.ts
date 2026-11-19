import { readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErr, catchErrAsync } from '../../test/helpers/catch.ts';
import {
  type RawCommitSpec,
  rawCommit,
  revParse,
  type TestBacklog,
  type TestKey,
  testBacklog,
  testKey,
} from '../../test/helpers/git.ts';
import { I } from '../../test/helpers/snapshot.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import type { User } from '../core/schemas.ts';
import { sshFingerprint } from '../core/ssh.ts';
import { git } from '../git/exec.ts';
import { readLocalState, stateDir, writeLocalState } from '../git/local-state.ts';
import { encodeOp, type Operation } from '../ops/operation.ts';
import { serializeEntityFile } from '../store/frontmatter.ts';
import { BACKLOG_CONFIG, issueFile, QUARANTINE, userFile } from '../store/layout.ts';
import { assertVerified, signatureReasons, verifyRange } from './verify.ts';
import { executeWrite } from './write.ts';

const ID = I(1);
const NAMES = ['spw', 'bob', 'mallory'] as const;
type Name = (typeof NAMES)[number];

let b: TestBacklog;
let ctx: ResolvedContext;
let anchor: string;
let KEYS: Record<Name, TestKey>;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
  anchor = await revParse(b.root, 'HEAD');
  const keys = await Promise.all(NAMES.map((n) => testKey(n)));
  KEYS = Object.fromEntries(NAMES.map((n, i) => [n, keys[i]])) as Record<Name, TestKey>;
});

const short = (sha: string) => sha.slice(0, 7);

/** Ein gültiger, signierter Commit von `who` an `executeWrite` vorbei. */
const signed = (who: Name, files: RawCommitSpec['files'], subject = 'raw') =>
  rawCommit(b.root, { files, key: KEYS[who], actor: who, op: 'manual', subject });

async function addUser(handle: Name, keys = [KEYS[handle].line]): Promise<void> {
  await executeWrite(ctx, {
    kind: 'op',
    op: { op: 'user.add', handle, name: handle, kind: 'human', keys },
  });
}

test('a clean history verifies and records the verified mark', async () => {
  await addUser('bob');
  await executeWrite(ctx, { kind: 'op', op: { op: 'issue.create', title: 'A' } });

  const r = await verifyRange(b.root, { record: true });

  expect(r.invalid).toEqual([]);
  expect(r.quarantined).toEqual([]);
  expect(r.notices).toEqual([]);
  expect(r).toMatchObject({ anchor, to: await revParse(b.root, 'HEAD'), checked: 3 });
  expect(await readLocalState(b.root, 'verified')).toBe(await revParse(b.root, 'HEAD'));
});

type Spec = Omit<RawCommitSpec, 'key'> & { key?: Name };

test.each<[string, Spec, (string | RegExp)[]]>([
  ['unsigned', { files: { x: '1' }, actor: 'spw' }, ['unsigniert']],
  [
    'unknown key',
    { files: { x: '1' }, key: 'mallory', actor: 'spw' },
    [/^Key SHA256:\S+ gehört zu keinem User$/],
  ],
  [
    'actor mismatch',
    { files: { x: '1' }, key: 'spw', actor: 'bob' },
    ['signiert von spw, Backe-Actor ist bob'],
  ],
  ['missing actor', { files: { x: '1' }, key: 'spw' }, ['Backe-Actor fehlt']],
  [
    'symlink to a secret',
    {
      files: { [issueFile(ID)]: { symlink: '/home/x/.ssh/id_ed25519' } },
      key: 'spw',
      actor: 'spw',
    },
    [`Symlink: ${issueFile(ID)}`],
  ],
])('%s is invalid', async (_, spec, reasons) => {
  const { key, ...rest } = spec;
  const sha = await rawCommit(b.root, {
    op: 'manual',
    ...rest,
    ...(key === undefined ? {} : { key: KEYS[key] }),
  });

  const r = await verifyRange(b.root, { record: true });

  expect(r.invalid).toEqual([{ sha, subject: 'raw', reasons: reasons.map(matcher) }]);
  expect(await readLocalState(b.root, 'verified')).toBe(anchor);
});

function matcher(reason: string | RegExp) {
  return typeof reason === 'string' ? reason : expect.stringMatching(reason);
}

test('several Backe-Actor trailers are invalid', async () => {
  const sha = await rawCommit(b.root, { files: { x: '1' }, key: KEYS.spw });
  const message = 'raw\n\nBacke-Actor: spw\nBacke-Actor: bob\nBacke-Op: manual\n';
  const tree = (await git(['rev-parse', `${sha}^{tree}`], { cwd: b.root })).stdout.trim();
  const twice = (
    await git(
      [
        '-c',
        'gpg.format=ssh',
        '-c',
        `user.signingkey=${KEYS.spw.priv}`,
        'commit-tree',
        '-S',
        tree,
        '-p',
        anchor,
        '-F',
        '-',
      ],
      {
        cwd: b.root,
        input: message,
        env: {
          GIT_AUTHOR_NAME: 'Raw',
          GIT_AUTHOR_EMAIL: 'raw@backe.invalid',
          GIT_COMMITTER_NAME: 'Raw',
          GIT_COMMITTER_EMAIL: 'raw@backe.invalid',
        },
      },
    )
  ).stdout.trim();
  await git(['reset', '-q', '--hard', twice], { cwd: b.root });

  const r = await verifyRange(b.root);

  expect(r.invalid).toEqual([{ sha: twice, subject: 'raw', reasons: ['Backe-Actor mehrfach'] }]);
});

test.each(['-----BEGIN PGP SIGNATURE-----', '-----BEGIN FAKE SIGNATURE-----'])(
  'a signature that is no SSH signature is invalid: %s',
  async (header) => {
    const tree = (await git(['rev-parse', `${anchor}^{tree}`], { cwd: b.root })).stdout.trim();
    const object = [
      `tree ${tree}`,
      `parent ${anchor}`,
      'author Raw <raw@backe.invalid> 1763550000 +0000',
      'committer Raw <raw@backe.invalid> 1763550000 +0000',
      `gpgsig ${header}`,
      ' ',
      ' aWdub3JpZXJ0',
      ` ${header.replace('BEGIN', 'END')}`,
      '',
      'raw',
      '',
      'Backe-Actor: spw',
      'Backe-Op: manual',
      '',
    ].join('\n');
    const sha = (
      await git(['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: b.root, input: object })
    ).stdout.trim();
    await git(['reset', '-q', '--hard', sha], { cwd: b.root });

    const r = await verifyRange(b.root);

    expect(r.invalid).toEqual([
      { sha, subject: 'raw', reasons: ['Signatur ist keine SSH-Signatur'] },
    ]);
  },
);

describe('signatureReasons', () => {
  const SSH = '-----BEGIN SSH SIGNATURE-----';
  const user = (keys: TestKey[], revoked: TestKey[] = []): User => ({
    name: 'x',
    kind: 'human',
    keys: keys.map((k) => k.line),
    ...(revoked.length > 0 && {
      revoked_keys: revoked.map((k) => ({ key: k.line, revoked: '2026-11-19T12:00:00Z' })),
    }),
  });
  const good = (key: TestKey, principal: string) => ({
    status: 'G',
    fingerprint: sshFingerprint(key.line),
    principal,
  });
  let users: Map<string, User>;
  beforeEach(() => {
    users = new Map([
      ['spw', user([KEYS.spw])],
      ['bob', user([KEYS.bob], [KEYS.mallory])],
    ]);
  });

  test('a good signature by a key of the principal passes', () =>
    expect(signatureReasons(good(KEYS.spw, 'spw'), SSH, users)).toEqual([]));

  test.each<[string, Name, string]>([
    ['a key of another user', 'bob', 'spw'],
    ['a revoked key of the principal', 'mallory', 'bob'],
    ['a principal that is no user', 'spw', 'eve'],
  ])('a good status with %s is invalid', (_, name, principal) =>
    expect(signatureReasons(good(KEYS[name], principal), SSH, users)).toEqual([
      `Key ${sshFingerprint(KEYS[name].line)} gehört nicht zu ${principal}`,
    ]),
  );

  test('the signature header decides before the status', () => {
    expect(signatureReasons(undefined, undefined, users)).toEqual(['unsigniert']);
    expect(signatureReasons(good(KEYS.spw, 'spw'), '-----BEGIN PGP SIGNATURE-----', users)).toEqual(
      ['Signatur ist keine SSH-Signatur'],
    );
    expect(signatureReasons({ status: 'B', fingerprint: '', principal: '' }, SSH, users)).toEqual([
      'Signatur ungültig',
    ]);
  });
});

test('a merge commit is invalid', async () => {
  const left = await signed('spw', { x: '1' });
  const right = await rawCommit(b.root, {
    files: { y: '1' },
    key: KEYS.spw,
    actor: 'spw',
    op: 'manual',
    parents: [anchor],
  });
  const merge = await rawCommit(b.root, {
    files: { x: '1' },
    key: KEYS.spw,
    actor: 'spw',
    op: 'manual',
    subject: 'merge',
    parents: [right, left],
  });

  const r = await verifyRange(b.root);

  expect(r.checked).toBe(4);
  expect(r.invalid).toEqual([{ sha: merge, subject: 'merge', reasons: ['Merge-Commit'] }]);
});

test('a key revoked in the parent is invalid regardless of commit date', async () => {
  const spare = await testKey('bob-spare');
  await addUser('bob', [KEYS.bob.line, spare.line]);
  const revoked = '2026-11-19T12:00:00Z';
  const op: Operation = { op: 'user.revoke_key', handle: 'bob', key: KEYS.bob.line, revoked };
  const bobFile = serializeEntityFile(
    'user',
    {
      name: 'bob',
      kind: 'human',
      keys: [spare.line],
      revoked_keys: [{ key: KEYS.bob.line, revoked }],
    },
    '',
  );
  await rawCommit(b.root, {
    files: { [userFile('bob')]: bobFile },
    key: KEYS.bob,
    actor: 'bob',
    op: encodeOp(op),
    date: revoked,
  });
  const late = await rawCommit(b.root, {
    files: { x: '1' },
    key: KEYS.bob,
    actor: 'bob',
    op: 'manual',
    date: '2026-01-01T00:00:00Z',
  });

  const r = await verifyRange(b.root);

  expect(r.invalid).toEqual([
    {
      sha: late,
      subject: 'raw',
      reasons: [`Key ${sshFingerprint(KEYS.bob.line)} von bob ist widerrufen`],
    },
  ]);
});

test('a non-admin changing another user is invalid', async () => {
  await addUser('bob');
  const spwFile = await readFile(join(b.root, userFile('spw')), 'utf8');
  const forged = spwFile.replace('name: spw', 'name: Bob war hier');
  expect(forged).not.toBe(spwFile);

  const sha = await signed('bob', { [userFile('spw')]: forged });

  expect((await verifyRange(b.root)).invalid).toEqual([
    { sha, subject: 'raw', reasons: ['bob darf den User spw nicht ändern'] },
  ]);
});

test('a changed creator is invalid', async () => {
  await addUser('bob');
  const r = await executeWrite(ctx, { kind: 'op', op: { op: 'issue.create', title: 'A' } });
  const id = (r.recorded[0] as Extract<Operation, { op: 'issue.create' }>).id as string;
  const text = await readFile(join(b.root, issueFile(id)), 'utf8');
  const forged = text.replace('creator: spw', 'creator: bob');
  expect(forged).not.toBe(text);

  const sha = await signed('spw', { [issueFile(id)]: forged });

  expect((await verifyRange(b.root)).invalid).toEqual([
    { sha, subject: 'raw', reasons: [`creator von ${id} geändert`] },
  ]);
});

test('rewritten history is rejected against the verified mark', async () => {
  const verified = await signed('spw', { x: '1' });
  await verifyRange(b.root, { record: true });
  expect(await readLocalState(b.root, 'verified')).toBe(verified);
  await git(['reset', '-q', '--hard', 'HEAD~1'], { cwd: b.root });
  await signed('spw', { x: '2' });

  const err = await catchErrAsync(() => verifyRange(b.root));

  expect(err.code).toBe('verify');
  expect(err.message).toBe(
    `HEAD ist kein Nachfahre des zuletzt verifizierten Stands ${short(verified)}`,
  );
});

test('another root than the anchor is rejected', async () => {
  await rawCommit(b.root, {
    files: { x: '1' },
    key: KEYS.spw,
    actor: 'spw',
    op: 'manual',
    parents: [],
  });

  const err = await catchErrAsync(() => verifyRange(b.root));

  expect(err.code).toBe('verify');
  expect(err.message).toBe('Historie von HEAD passt nicht zum Vertrauensanker');
});

test('a missing anchor is rejected', async () => {
  await rm(join(await stateDir(b.root), 'anchor'));

  const err = await catchErrAsync(() => verifyRange(b.root));

  expect(err.code).toBe('verify');
  expect(err.message).toBe(`Kein Vertrauensanker in ${b.root}`);
});

test('since limits the range', async () => {
  const bad = await rawCommit(b.root, { files: { x: '1' }, actor: 'spw', op: 'manual' });
  const good = await signed('spw', { x: '2' });

  const all = await verifyRange(b.root);
  expect(all.checked).toBe(3);
  expect(all.invalid.map((f) => f.sha)).toEqual([bad]);

  const r = await verifyRange(b.root, { since: bad, to: good });
  expect(r).toMatchObject({ anchor, to: good, checked: 1, invalid: [] });
});

test('record with since needs since within the verified state', async () => {
  const first = await signed('spw', { x: '1' });
  const second = await signed('spw', { x: '2' });

  const err = await catchErrAsync(() => verifyRange(b.root, { since: first, record: true }));
  expect(err.code).toBe('usage');
  expect(await readLocalState(b.root, 'verified')).toBe(anchor);

  await verifyRange(b.root, { since: anchor, record: true });
  expect(await readLocalState(b.root, 'verified')).toBe(second);
});

test('a missing Backe-Op is a notice, not a violation', async () => {
  const missing = await rawCommit(b.root, { files: { x: '1' }, key: KEYS.spw, actor: 'spw' });
  const garbled = await rawCommit(b.root, {
    files: { x: '2' },
    key: KEYS.spw,
    actor: 'spw',
    op: '{"op":"gibtsnicht"}',
  });

  const r = await verifyRange(b.root);

  expect(r.invalid).toEqual([]);
  expect(r.notices).toEqual([
    `${short(missing)}: Backe-Op fehlt`,
    `${short(garbled)}: Backe-Op nicht dekodierbar`,
  ]);
});

const quarantine = (sha: string, reason: string) =>
  `${JSON.stringify({ entries: [{ sha, decision: 'accepted', reason }] }, null, 2)}\n`;

test('a quarantined commit passes as a notice; a quarantine entry by a non-admin does not count', async () => {
  await addUser('bob');
  const bad = await rawCommit(b.root, {
    files: { x: '1' },
    actor: 'spw',
    op: 'manual',
    subject: 'ohne Signatur',
  });
  const byBob = await signed('bob', { [QUARANTINE]: quarantine(bad, 'von bob') });

  const before = await verifyRange(b.root, { record: true });
  expect(before.invalid.map((f) => [f.sha, f.reasons])).toEqual([
    [bad, ['unsigniert']],
    [byBob, [`nur Admins ändern ${QUARANTINE}`]],
  ]);
  expect(before.quarantined).toEqual([]);

  const entries = {
    entries: [
      { sha: bad, decision: 'accepted', reason: 'harmlos' },
      { sha: byBob, decision: 'reverted', reason: 'zurückgenommen' },
    ],
  };
  await signed('spw', { [QUARANTINE]: JSON.stringify(entries) });

  const r = await verifyRange(b.root, { record: true });

  expect(r.invalid).toEqual([]);
  expect(r.quarantined).toEqual([
    {
      sha: bad,
      subject: 'ohne Signatur',
      reasons: ['unsigniert'],
      decision: 'accepted',
      note: 'harmlos',
    },
    {
      sha: byBob,
      subject: 'raw',
      reasons: [`nur Admins ändern ${QUARANTINE}`],
      decision: 'reverted',
      note: 'zurückgenommen',
    },
  ]);
  expect(await readLocalState(b.root, 'verified')).toBe(await revParse(b.root, 'HEAD'));
});

test('the quarantine at since governs when the range does not change it', async () => {
  const bad = await rawCommit(b.root, { files: { x: '1' }, actor: 'spw', op: 'manual' });
  // `since` liegt auf einem Seitenzweig ab dem Anker; der Bereich `since..bad` ist nur `bad`.
  const since = await rawCommit(b.root, {
    files: { [QUARANTINE]: quarantine(bad, 'harmlos') },
    key: KEYS.spw,
    actor: 'spw',
    op: 'manual',
    parents: [anchor],
  });

  const r = await verifyRange(b.root, { since, to: bad });

  expect(r.invalid).toEqual([]);
  expect(r.quarantined.map((f) => [f.sha, f.note])).toEqual([[bad, 'harmlos']]);
  expect((await verifyRange(b.root, { since: anchor, to: bad })).invalid.map((f) => f.sha)).toEqual(
    [bad],
  );
});

test('an invalid quarantine file is a reason at its commit and does not count', async () => {
  const bad = await rawCommit(b.root, { files: { x: '1' }, actor: 'spw', op: 'manual' });
  await signed('spw', { [QUARANTINE]: quarantine(bad, 'harmlos') });
  const broken = await signed('spw', { [QUARANTINE]: '{ "entries": [{ "sha": "kurz" }] }' });

  const r = await verifyRange(b.root);

  expect(r.quarantined.map((f) => f.sha)).toEqual([bad]);
  expect(r.invalid).toEqual([
    {
      sha: broken,
      subject: 'raw',
      reasons: [expect.stringMatching(/^quarantine\.jsonc ungültig: entries\.0\.sha: /)],
    },
  ]);
});

test('an unreadable backlog config makes the commit uncheckable', async () => {
  const sha = await signed('spw', { [BACKLOG_CONFIG]: '{ "version": 1 }' });

  const r = await verifyRange(b.root);

  expect(r.invalid).toEqual([
    {
      sha,
      subject: 'raw',
      reasons: [expect.stringMatching(/^nicht prüfbar: \.backe\/backlog\.jsonc: /)],
    },
  ]);
});

test('an anchor without init op or admin actor is invalid', async () => {
  const wc = await realpath(await tempDir());
  await git(['init', '-q', '-b', 'main'], { cwd: wc });
  const config = JSON.stringify({ version: 1, name: 'acme', id_prefix: 'bk', admins: ['root'] });
  const user = serializeEntityFile(
    'user',
    { name: 'spw', kind: 'human', keys: [KEYS.spw.line] },
    '',
  );
  const sha = await rawCommit(wc, {
    files: { [BACKLOG_CONFIG]: config, [userFile('spw')]: user },
    key: KEYS.spw,
    actor: 'spw',
    op: 'manual',
  });
  await writeLocalState(wc, 'anchor', sha);

  const r = await verifyRange(wc);

  expect(r.invalid).toEqual([
    {
      sha,
      subject: 'raw',
      reasons: [
        'Vertrauensanker ohne Backe-Op init',
        'Akteur spw ist im Vertrauensanker kein Admin',
      ],
    },
  ]);
});

test('assertVerified throws verify with the report', async () => {
  assertVerified(await verifyRange(b.root));
  await rawCommit(b.root, { files: { x: '1' }, actor: 'spw', op: 'manual' });
  const report = await verifyRange(b.root);

  const err = catchErr(() => assertVerified(report));

  expect(err.code).toBe('verify');
  expect(err.message).toBe(`1 ungültige Commits seit ${short(anchor)}`);
  expect(err.details).toBe(report);
});

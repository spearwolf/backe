import { mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
import { sshFingerprint } from '../core/fingerprint.ts';
import type { User } from '../core/schemas.ts';
import { git } from '../git/exec.ts';
import { readLocalState, stateDir, writeLocalState } from '../git/local-state.ts';
import { encodeOp, type Operation } from '../ops/operation.ts';
import { serializeEntityFile } from '../store/frontmatter.ts';
import { BACKLOG_CONFIG, issueFile, QUARANTINE, userFile } from '../store/layout.ts';
import { listIssueIds } from '../store/snapshot.ts';
import {
  assertVerified,
  nextCommitBasis,
  trustedVerifyMode,
  verifyBacklog,
  verifyRange,
} from './verify.ts';
import { signatureReasons } from './verify-state.ts';
import { executeWrite } from './write.ts';

vi.mock('../git/exec.ts', async (orig) => {
  const actual = await orig<typeof import('../git/exec.ts')>();
  return { ...actual, git: vi.fn(actual.git) };
});

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
  expect(await readLocalState(b.root, 'clean')).toBe(await revParse(b.root, 'HEAD'));
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
  expect(await readLocalState(b.root, 'clean')).toBe(anchor);
});

function matcher(reason: string | RegExp) {
  return typeof reason === 'string' ? reason : expect.stringMatching(reason);
}

test('an allowed_signers cache under the unversioned name has no effect', async () => {
  await addUser('bob');
  const dir = await stateDir(b.root);
  await rm(join(dir, 'allowed_signers'), { recursive: true, force: true });
  await rm(join(dir, 'allowed_signers.v1'), { recursive: true, force: true });
  // Ein leerer Cache im alten Namen ließe jede Signatur scheitern, würde er gelesen.
  await mkdir(join(dir, 'allowed_signers'));
  const shas = (await git(['rev-list', 'HEAD'], { cwd: b.root })).stdout.trim().split('\n');
  for (const sha of shas)
    await writeFile(join(dir, 'allowed_signers', await revParse(b.root, `${sha}:users`)), '');

  expect((await verifyRange(b.root)).invalid).toEqual([]);
  expect(await readdir(join(dir, 'allowed_signers.v1'))).not.toEqual([]);
});

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

describe('signatures in a range', () => {
  test('a signature that does not cover the commit content is invalid', async () => {
    const sha = await signed('spw', { x: '1' });
    const raw = (await git(['cat-file', 'commit', sha], { cwd: b.root })).stdout;
    const tampered = raw.replace('\n\nraw\n', '\n\nverändert\n');
    expect(tampered).not.toBe(raw);
    const forged = (
      await git(['hash-object', '-t', 'commit', '-w', '--stdin'], { cwd: b.root, input: tampered })
    ).stdout.trim();
    await git(['reset', '-q', '--hard', forged], { cwd: b.root });

    const r = await verifyRange(b.root);

    expect(r.invalid).toEqual([
      { sha: forged, subject: 'verändert', reasons: ['Signatur ungültig'] },
    ]);
  });

  test('a key added in a commit signs only the commits after it', async () => {
    await addUser('bob');
    const [spare, late] = await Promise.all([testKey('bob-spare'), testKey('bob-late')]);
    const bobWith = (...keys: TestKey[]) =>
      serializeEntityFile(
        'user',
        { name: 'bob', kind: 'human', keys: keys.map((k) => k.line) },
        '',
      );
    await signed('bob', { [userFile('bob')]: bobWith(KEYS.bob, spare) });
    await rawCommit(b.root, { files: { x: '1' }, key: spare, actor: 'bob', op: 'manual' });
    const self = await rawCommit(b.root, {
      files: { [userFile('bob')]: bobWith(KEYS.bob, spare, late) },
      key: late,
      actor: 'bob',
      op: 'manual',
    });

    const r = await verifyRange(b.root);

    expect(r.invalid).toEqual([
      {
        sha: self,
        subject: 'raw',
        reasons: [`Key ${sshFingerprint(late.line)} gehört zu keinem User`],
      },
    ]);
  });

  test('commits are checked in one git call per users state of their parent', async () => {
    await signed('spw', { a: '1' });
    await addUser('bob');
    await signed('bob', { b: '1' });
    await signed('spw', { c: '1' });
    await addUser('mallory');
    await signed('mallory', { d: '1' });
    await signed('bob', { e: '1' });
    const cache = join(await stateDir(b.root), 'allowed_signers.v1');
    await rm(cache, { recursive: true, force: true });
    const calls = vi.mocked(git).mock.calls;
    const before = calls.length;

    const r = await verifyRange(b.root);

    expect(r).toMatchObject({ checked: 8, invalid: [] });
    const signatureCalls = calls.slice(before).filter(([args]) => args.includes('--stdin'));
    // Anker samt erstem Commit gegen T0, dann je ein Aufruf für T1 und T2.
    expect(signatureCalls).toHaveLength(3);
    const trees = await Promise.all(
      ['HEAD~7', 'HEAD~4', 'HEAD~1'].map((rev) => revParse(b.root, `${rev}:users`)),
    );
    expect((await readdir(cache)).sort()).toEqual([...new Set(trees)].sort());
  });
});

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

  test.each([
    ['status E', 'E', true],
    ['no fingerprint', 'U', false],
  ])('a signature that cannot be checked says so: %s', (_, status, withFingerprint) => {
    const fingerprint = withFingerprint ? sshFingerprint(KEYS.spw.line) : '';
    expect(signatureReasons({ status, fingerprint, principal: '' }, SSH, users)).toEqual([
      'Signatur nicht prüfbar (ssh-keygen?)',
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

test('revoking the only key is valid and the revoked key signs nothing afterwards', async () => {
  await addUser('bob');
  const revoked = '2026-11-19T12:00:00Z';
  const op: Operation = { op: 'user.revoke_key', handle: 'bob', key: KEYS.bob.line, revoked };
  const bobFile = serializeEntityFile(
    'user',
    { name: 'bob', kind: 'human', revoked_keys: [{ key: KEYS.bob.line, revoked }] },
    '',
  );
  await rawCommit(b.root, {
    files: { [userFile('bob')]: bobFile },
    key: KEYS.bob,
    actor: 'bob',
    op: encodeOp(op),
    date: revoked,
  });
  expect((await verifyRange(b.root)).invalid).toEqual([]);
  const late = await rawCommit(b.root, {
    files: { x: '1' },
    key: KEYS.bob,
    actor: 'bob',
    op: 'manual',
    date: '2026-12-01T00:00:00Z',
  });
  expect((await verifyRange(b.root)).invalid).toEqual([
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
  const good = await signed('spw', { y: '2' });

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
  expect(err.code).toBe('validation');
  expect(await readLocalState(b.root, 'verified')).toBe(anchor);

  await verifyRange(b.root, { since: anchor, record: true });
  expect(await readLocalState(b.root, 'verified')).toBe(second);
  expect(await readLocalState(b.root, 'clean')).toBe(second);

  // Ein Gang ab einem anderen Stand als `clean` belegt nicht, dass der Stand dort aufgetaut war.
  const third = await signed('spw', { x: '3' });
  await verifyRange(b.root, { since: first, record: true });
  expect(await readLocalState(b.root, 'verified')).toBe(third);
  expect(await readLocalState(b.root, 'clean')).toBe(second);
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

test('a commit quarantined before since stays out of the range', async () => {
  const bad = await rawCommit(b.root, { files: { x: '1' }, actor: 'spw', op: 'manual' });
  const since = await signed('spw', { [QUARANTINE]: quarantine(bad, 'harmlos') });
  await signed('spw', { x: '2' });

  const r = await verifyRange(b.root, { since });

  expect(r).toMatchObject({ checked: 1, invalid: [], quarantined: [] });
  expect((await verifyRange(b.root, { since: anchor })).quarantined.map((f) => f.sha)).toEqual([
    bad,
  ]);
});

test('since must be an ancestor of to', async () => {
  const main = await signed('spw', { x: '1' });
  const side = await rawCommit(b.root, {
    files: { x: '2' },
    key: KEYS.spw,
    actor: 'spw',
    op: 'manual',
    parents: [anchor],
  });

  const err = await catchErrAsync(() => verifyRange(b.root, { since: side, to: main }));

  expect(err.code).toBe('validation');
  expect(err.message).toBe(`since ${short(side)} ist kein Vorfahre von ${short(main)}`);
  expect((await verifyRange(b.root, { since: main, to: main })).checked).toBe(0);
});

describe('after an invalid commit', () => {
  /** spw macht bob zum Admin; danach ändert bob als Admin den User spw. */
  async function widenThenUse(): Promise<string> {
    const config = JSON.parse(await readFile(join(b.root, BACKLOG_CONFIG), 'utf8'));
    await signed('spw', {
      [BACKLOG_CONFIG]: JSON.stringify({ ...config, admins: ['spw', 'bob'] }),
    });
    const spwFile = await readFile(join(b.root, userFile('spw')), 'utf8');
    return signed('bob', { [userFile('spw')]: spwFile.replace('name: spw', 'name: S. P. W.') });
  }

  test('later commits are judged by the last trusted state until a quarantine covers it', async () => {
    await addUser('bob');
    const bad = await rawCommit(b.root, { files: { x: '1' }, actor: 'spw', op: 'manual' });
    const byBob = await widenThenUse();

    const r = await verifyRange(b.root);

    expect(r.invalid.map((f) => [f.sha, f.reasons])).toEqual([
      [bad, ['unsigniert']],
      [byBob, ['bob darf den User spw nicht ändern']],
    ]);
  });

  test('a covering quarantine lets later commits be judged by their own parent again', async () => {
    await addUser('bob');
    const bad = await rawCommit(b.root, { files: { x: '1' }, actor: 'spw', op: 'manual' });
    await signed('spw', { [QUARANTINE]: quarantine(bad, 'harmlos') });
    await widenThenUse();

    const r = await verifyRange(b.root);

    expect(r.invalid).toEqual([]);
    expect(r.quarantined.map((f) => f.sha)).toEqual([bad]);
  });
});

describe('paths changed by an open invalid commit', () => {
  let agentKey: TestKey;
  let eveKey: TestKey;

  beforeEach(async () => {
    [agentKey, eveKey] = await Promise.all([testKey('claude-1'), testKey('eve')]);
    await addUser('mallory');
    await executeWrite(ctx, {
      kind: 'op',
      op: {
        op: 'user.add',
        handle: 'claude-1',
        name: 'claude-1',
        kind: 'agent',
        operator: 'spw',
        keys: [agentKey.line],
      },
    });
  });

  const agentFile = (operator: string, keys: TestKey[]) =>
    serializeEntityFile(
      'user',
      { name: 'claude-1', kind: 'agent', operator, keys: keys.map((k) => k.line) },
      '',
    );

  /** B (unsigniert) macht mallory zum Operator von claude-1. */
  const takeOver = () =>
    rawCommit(b.root, {
      files: { [userFile('claude-1')]: agentFile('mallory', [agentKey]) },
      actor: 'spw',
      op: 'manual',
      subject: 'B',
    });

  /** C (gültig signiert von spw) trägt einen weiteren Key bei claude-1 ein, auf B aufbauend. */
  const addKey = () =>
    signed('spw', { [userFile('claude-1')]: agentFile('mallory', [agentKey, eveKey]) }, 'C');

  test('a commit building on a path changed by an open invalid commit is itself invalid', async () => {
    const B = await takeOver();
    const C = await addKey();

    const r = await verifyRange(b.root);

    expect(r.invalid.map((f) => f.sha)).toEqual([B, C]);
    expect(r.invalid[1]?.reasons).toEqual([`baut auf ungültigem Commit ${short(B)} auf`]);
  });

  test('nextCommitBasis names the frozen commit and the first open invalid commit', async () => {
    expect((await nextCommitBasis(b.root)).frozen).toBeUndefined();
    const frozen = await revParse(b.root, 'HEAD');
    const B = await takeOver();
    const C = await addKey();

    expect((await nextCommitBasis(b.root)).frozen).toEqual({
      at: frozen,
      firstOpen: B,
      open: [B, C],
    });
  });

  test('a commit on untouched paths after an invalid one stays valid', async () => {
    const B = await takeOver();
    await executeWrite(ctx, { kind: 'op', op: { op: 'issue.create', title: 'C' } });

    const r = await verifyRange(b.root);

    expect(r.checked).toBe(5);
    expect(r.invalid.map((f) => f.sha)).toEqual([B]);
  });

  test('a path set back to the frozen content is still built on the invalid commit', async () => {
    const B = await takeOver();
    const C = await signed(
      'spw',
      { [userFile('claude-1')]: agentFile('spw', [agentKey]) },
      'zurück',
    );

    const r = await verifyRange(b.root);

    expect(r.invalid.map((f) => [f.sha, f.reasons])).toEqual([
      [B, ['unsigniert']],
      [C, [`baut auf ungültigem Commit ${short(B)} auf`]],
    ]);
  });

  test('after a covering quarantine, paths are judged against their parent again', async () => {
    const B = await takeOver();
    await signed('spw', { [QUARANTINE]: quarantine(B, 'Operator-Wechsel war abgesprochen') });
    await addKey();

    const r = await verifyRange(b.root);

    expect(r.invalid).toEqual([]);
    expect(r.quarantined.map((f) => f.sha)).toEqual([B]);
  });

  test('a quarantine commit that does not thaw stays bound by changes on tainted paths', async () => {
    const B = await takeOver();
    const Q = await signed('spw', {
      [QUARANTINE]: quarantine(anchor, 'nebenbei'),
      [userFile('claude-1')]: agentFile('mallory', [agentKey, eveKey]),
    });
    const entries = [{ sha: B, decision: 'reverted', reason: 'angeblich umgekehrt' }];
    await signed('spw', { [QUARANTINE]: JSON.stringify({ entries }) });

    const r = await verifyRange(b.root);

    expect(r.invalid.map((f) => [f.sha, f.reasons])).toEqual([
      [Q, [`baut auf ungültigem Commit ${short(B)} auf`]],
    ]);
    expect(r.quarantined.map((f) => f.sha)).toEqual([B]);
  });

  test('a quarantine commit that does not thaw may set paths back to the frozen state', async () => {
    const B = await takeOver();
    const C = await rawCommit(b.root, { files: { x: '1' }, actor: 'spw', op: 'manual' });
    const entries = [{ sha: B, decision: 'reverted', reason: 'zurück' }];
    await signed('spw', {
      [QUARANTINE]: JSON.stringify({ entries }),
      [userFile('claude-1')]: agentFile('spw', [agentKey]),
    });

    const r = await verifyRange(b.root);

    expect(r.invalid.map((f) => f.sha)).toEqual([C]);
    expect(r.quarantined.map((f) => f.sha)).toEqual([B]);
  });

  test('a quarantine commit restoring paths of open invalid commits is not built on them', async () => {
    const B = await takeOver();
    const C = await rawCommit(b.root, {
      files: {
        [userFile('claude-1')]: agentFile('mallory', [agentKey, eveKey]),
        [QUARANTINE]: quarantine(anchor, 'untergeschoben'),
      },
      actor: 'spw',
      op: 'manual',
      subject: 'C',
    });
    const entries = [
      { sha: C, decision: 'reverted', reason: 'zurück auf B' },
      { sha: B, decision: 'accepted', reason: 'abgesprochen' },
    ];
    await signed('spw', {
      [userFile('claude-1')]: agentFile('mallory', [agentKey]),
      [QUARANTINE]: JSON.stringify({ entries }),
    });

    const r = await verifyRange(b.root);

    expect(r.invalid).toEqual([]);
    expect(r.quarantined.map((f) => f.sha)).toEqual([B, C]);
  });
});

test('ancestor overrides verified in the descent check', async () => {
  const upstream = await signed('spw', { x: '1' });
  await signed('spw', { x: '2' }, 'lokal');
  await verifyRange(b.root, { record: true });
  const tip = await rawCommit(b.root, {
    files: { y: '1' },
    key: KEYS.spw,
    actor: 'spw',
    op: 'manual',
    parents: [upstream],
  });

  expect((await verifyRange(b.root, { to: tip, ancestor: upstream })).invalid).toEqual([]);
  expect((await catchErrAsync(() => verifyRange(b.root, { to: tip }))).code).toBe('verify');
  const err = await catchErrAsync(() => verifyRange(b.root, { to: upstream, ancestor: tip }));
  expect(err.code).toBe('verify');
  expect(err.message).toBe(
    `${upstream} ist kein Nachfahre des zuletzt verifizierten Stands ${short(tip)}`,
  );
});

describe('trustedVerifyMode', () => {
  /** Config-Text mit `verify: <mode>`. */
  async function withMode(mode: 'warn' | 'off'): Promise<string> {
    const config = JSON.parse(await readFile(join(b.root, BACKLOG_CONFIG), 'utf8'));
    return JSON.stringify({ ...config, verify: mode });
  }

  test('trustedVerifyMode reads the frozen state, not the parent of the first remaining invalid commit', async () => {
    const A = await rawCommit(b.root, {
      files: { [BACKLOG_CONFIG]: await withMode('off') },
      actor: 'spw',
      op: 'manual',
    });
    const B = await rawCommit(b.root, { files: { x: '1' }, actor: 'spw', op: 'manual' });
    await signed('spw', { [QUARANTINE]: quarantine(A, 'nur A geprüft') });

    const r = await verifyRange(b.root);
    expect(r.invalid.map((f) => f.sha)).toEqual([B]);
    expect(r.quarantined.map((f) => f.sha)).toEqual([A]);

    expect(await trustedVerifyMode(b.root)).toBe('strict');
  });

  test('the mode of the trusted state counts, whatever the invalid commits set', async () => {
    await signed('spw', { [BACKLOG_CONFIG]: await withMode('warn') });
    const warned = await revParse(b.root, 'HEAD');
    await rawCommit(b.root, {
      files: { [BACKLOG_CONFIG]: await withMode('off') },
      actor: 'spw',
      op: 'manual',
    });

    expect(await trustedVerifyMode(b.root)).toBe('warn');
    expect(await trustedVerifyMode(b.root, warned)).toBe('warn');
  });

  test('without invalid commits the mode of to counts', async () => {
    expect(await trustedVerifyMode(b.root)).toBe('strict');
    await signed('spw', { [BACKLOG_CONFIG]: await withMode('off') });
    expect(await trustedVerifyMode(b.root)).toBe('off');
  });

  test.each([
    ['unreadable', { [BACKLOG_CONFIG]: '{ "verify": "warn"' }],
    ['missing', { x: '1' }],
  ])('a %s config in the trusted state means strict', async (_, files) => {
    const wc = await realpath(await tempDir());
    await git(['init', '-q', '-b', 'main'], { cwd: wc });
    const sha = await rawCommit(wc, { files, actor: 'spw', op: 'init' });
    await writeLocalState(wc, 'anchor', sha);

    expect(await trustedVerifyMode(wc)).toBe('strict');
  });

  test('the descent check is left to the caller', async () => {
    const upstream = await signed('spw', { x: '1' });
    await signed('spw', { x: '2' });
    await verifyRange(b.root, { record: true });
    const tip = await rawCommit(b.root, {
      files: { y: '1' },
      actor: 'spw',
      op: 'manual',
      parents: [upstream],
    });

    expect(await trustedVerifyMode(b.root, tip)).toBe('strict');
  });
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

describe('verifyBacklog', () => {
  test('verifyBacklog reports values that no longer fit a tightened declaration', async () => {
    await executeWrite(ctx, {
      kind: 'op',
      op: { op: 'issue.create', title: 'A', props: { sev: 'hoch', note: 'frei' } },
    });
    const file = join(b.root, BACKLOG_CONFIG);
    const config = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    config.props = { sev: { type: 'integer', description: 'Schwere' } };
    await signed('spw', { [BACKLOG_CONFIG]: `${JSON.stringify(config, null, 2)}\n` });

    const r = await verifyBacklog(ctx, { record: true });

    expect(r.invalid).toEqual([]);
    expect(r.checked).toBe(3);
    const [id] = await listIssueIds(b.root);
    expect(r.propNotices).toHaveLength(1);
    expect(r.propNotices[0]).toMatch(new RegExp(`^${id} sev: \\S`));
    expect(await readLocalState(b.root, 'verified')).toBe(await revParse(b.root, 'HEAD'));
  });

  test('a clean backlog has no prop notices; invalid commits stay in the report', async () => {
    await rawCommit(b.root, { files: { x: '1' }, actor: 'spw', op: 'manual' });

    const r = await verifyBacklog(ctx, {});

    expect(r.propNotices).toEqual([]);
    expect(r.invalid).toHaveLength(1);
  });

  test('without a working copy it is not_found', async () => {
    const bare: ResolvedContext = {
      ...ctx,
      backlog: { ...ctx.backlog, root: undefined, workingCopy: undefined },
    };
    const err = await catchErrAsync(() => verifyBacklog(bare, {}));
    expect(err.code).toBe('not_found');
  });
});

describe('unknown keys', () => {
  test('verifyBacklog lists files with unknown keys', async () => {
    const text = await readFile(
      join(
        import.meta.dirname,
        '../../test/fixtures/backlog-unknown-key/issues/7f/bk-7f3k2/issue.md',
      ),
      'utf8',
    );
    await signed('spw', { [issueFile('bk-7f3k2')]: text });
    const r = await verifyBacklog(ctx);
    expect(r.unknownKeys).toEqual([{ path: issueFile('bk-7f3k2'), keys: ['legacy', '2'] }]);
  });

  test('verifyBacklog lists comments with unknown keys from a hand edit', async () => {
    const created = await executeWrite(ctx, { kind: 'op', op: { op: 'issue.create', title: 'A' } });
    const id = (created.recorded[0] as { id: string }).id;
    await executeWrite(ctx, { kind: 'op', op: { op: 'comment.add', id, body: 'Eins.\n' } });
    await executeWrite(ctx, { kind: 'op', op: { op: 'comment.add', id, body: 'Zwei.\n' } });
    const dir = join(b.root, issueFile(id), '..', 'comments');
    const [first, second] = (await readdir(dir)).sort() as [string, string];
    const text = await readFile(join(dir, first), 'utf8');
    await writeFile(join(dir, first), text.replace(/^---\n/, '---\nlegacy: 1\n'));
    // Ein kaputter Kommentar daneben bricht die Prüfung nicht ab.
    await writeFile(join(dir, second), '---\nnicht: [yaml\n---\n');

    const r = await verifyBacklog(ctx);

    const path = `${issueFile(id).replace(/issue\.md$/, '')}comments/${first}`;
    expect(r.unknownKeys).toEqual([{ path, keys: ['legacy'] }]);
  });

  test('a clean backlog has no unknown keys', async () => {
    expect((await verifyBacklog(ctx)).unknownKeys).toEqual([]);
  });
});

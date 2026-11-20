/**
 * Semantisches Replay (backe.md §2.16.4) mit zwei Arbeitskopien: `spw` schreibt und pusht den
 * Remote-Stand, der Agent `claude-1` hat lokale Commits, die auf den Remote-Stand neu aufgebaut
 * werden.
 */
import { catchErrAsync } from '../../test/helpers/catch.ts';
import {
  rawCommit,
  revParse,
  sigOf,
  statusShort,
  type TestKey,
  testKey,
  twoClones,
} from '../../test/helpers/git.ts';
import { seqBytes } from '../../test/helpers/snapshot.ts';
import { BackeError } from '../core/errors.ts';
import { git } from '../git/exec.ts';
import { parseCommitMessage, TRAILER_ACTOR, TRAILER_OP } from '../git/message.ts';
import { gitTreeSource } from '../git/tree-source.ts';
import { bodyHash, encodeOp, type Operation } from '../ops/operation.ts';
import { attachmentsDir } from '../store/layout.ts';
import { listCommentsFrom, loadSnapshotFrom } from '../store/snapshot.ts';
import { authorOf } from './env.ts';
import { type ManualResolver, type ReplayResult, readUnits, replayOnto } from './replay.ts';
import { listConflicts, writeConflicts } from './sync-state.ts';
import { executeWrite, type WriteDeps, type WriteInput } from './write.ts';

let t: Awaited<ReturnType<typeof twoClones>>;
let wc: string;
let agentKey: TestKey;
/** Gemeinsamer Stand beider Arbeitskopien; ab hier zählen die lokalen Commits des Agents. */
let base: string;

beforeEach(async () => {
  t = await twoClones();
  wc = t.agent.wc;
  agentKey = await testKey('claude-1');
  base = await revParse(wc, 'HEAD');
});

const op = (o: Operation): WriteInput => ({ kind: 'op', op: o });
const remote = (input: WriteInput, deps?: WriteDeps) => executeWrite(t.spw.ctx, input, deps);
const local = (input: WriteInput, deps?: WriteDeps) => executeWrite(t.agent.ctx, input, deps);
const idOf = (r: { recorded: Operation[] }) => (r.recorded[0] as { id: string }).id;
const setTitle = (id: string, from: string, to: string): Operation => ({
  op: 'issue.edit',
  id,
  set: { title: { from, to } },
});

async function pushRemote(): Promise<void> {
  await git(['push', '-q', 'origin', 'main'], { cwd: t.spw.root });
}

/** Pusht `spw` und bringt den Agent per Fast-Forward darauf; das ist die neue Basis. */
async function share(): Promise<void> {
  await pushRemote();
  await git(['fetch', '-q', 'origin'], { cwd: wc });
  await git(['merge', '-q', '--ff-only', 'origin/main'], { cwd: wc });
  base = await revParse(wc, 'HEAD');
}

async function sharedIssue(title = 'A'): Promise<string> {
  const id = idOf(await remote(op({ op: 'issue.create', title })));
  await share();
  return id;
}

/** Pusht `spw`, holt den Remote-Stand in den Agent und spielt dessen lokale Commits darauf. */
async function replay(
  opts: Partial<Parameters<typeof replayOnto>[1]> = {},
): Promise<ReplayResult & { onto: string }> {
  await pushRemote();
  await git(['fetch', '-q', 'origin'], { cwd: wc });
  const onto = await revParse(wc, 'origin/main');
  const units = await readUnits(wc, { base, head: 'HEAD' }, 'claude-1');
  const r = await replayOnto(wc, {
    onto,
    units,
    actor: 'claude-1',
    key: agentKey.priv,
    author: authorOf('claude-1', 'Claude'),
    env: t.agent.ctx.env,
    now: () => new Date('2026-11-19T08:00:00Z'),
    ...opts,
  });
  return { ...r, onto };
}

async function snapshotAt(rev: string) {
  return loadSnapshotFrom(await gitTreeSource(wc, rev));
}

async function showFile(rev: string, path: string): Promise<string> {
  return (await git(['show', `${rev}:${path}`], { cwd: wc })).stdout;
}

async function messageOf(rev: string) {
  const { stdout } = await git(['log', '-1', '--format=%B', rev], { cwd: wc });
  return parseCommitMessage(stdout);
}

/** Commits von `from` (exklusiv) bis `to`, älteste zuerst. */
async function commitsBetween(from: string, to: string): Promise<string[]> {
  const { stdout } = await git(['rev-list', '--reverse', `${from}..${to}`], { cwd: wc });
  return stdout.split('\n').filter((l) => l !== '');
}

test('parallel edits of different fields replay without conflict', async () => {
  const id = await sharedIssue();
  await remote(op(setTitle(id, 'A', 'B')));
  await local(op({ op: 'issue.edit', id, set: { assignee: { from: null, to: 'claude-1' } } }));
  const r = await replay();
  expect([r.replayed, r.conflicts, r.claimLost]).toEqual([1, [], undefined]);
  expect(await commitsBetween(r.onto, r.head)).toHaveLength(1);
  const issue = (await snapshotAt(r.head)).issues.get(id)?.data;
  expect([issue?.title, issue?.assignee]).toEqual(['B', 'claude-1']);
});

test('the same field edited on both sides lands in the conflict store', async () => {
  const id = await sharedIssue();
  await remote(op(setTitle(id, 'A', 'B')));
  const mine = await local(op(setTitle(id, 'A', 'C')));
  const r = await replay();
  expect([r.replayed, r.head]).toEqual([0, r.onto]);
  expect(r.conflicts).toHaveLength(1);
  const [entry] = r.conflicts;
  expect(entry?.reason).toMatchObject({ code: 'conflict', reason: 'precondition' });
  expect(entry).toMatchObject({
    version: 1,
    created: '2026-11-19T08:00:00Z',
    onto: r.onto,
    units: [{ sha: mine.commit, kind: 'op', ops: [setTitle(id, 'A', 'C')] }],
  });
  expect(entry?.id).toMatch(/^20261119T080000Z-[0-9a-f]{6}$/);
});

test('two clean depends_on additions forming a cycle are shelved with their followers', async () => {
  const x = idOf(await remote(op({ op: 'issue.create', title: 'X' })));
  const y = await sharedIssue('Y');
  await remote(op({ op: 'issue.edit', id: x, add: { depends_on: [y] } }));
  await local(op({ op: 'issue.edit', id: y, add: { depends_on: [x] } }));
  await local(op({ op: 'comment.add', id: y, body: 'Folgt.\n' }));
  const z = idOf(await local(op({ op: 'issue.create', title: 'Z' })));
  const r = await replay();
  expect(r.conflicts).toHaveLength(1);
  expect(r.conflicts[0]?.units.map((u) => u.kind)).toEqual(['op', 'op']);
  expect(r.conflicts[0]?.units[1]?.ops[0]).toMatchObject({ op: 'comment.add', id: y });
  expect(r.conflicts[0]?.reason.reason).toBe('cycle');
  expect(r.replayed).toBe(1);
  const s = await snapshotAt(r.head);
  expect(s.issues.has(z)).toBe(true);
  expect(s.issues.get(y)?.data.depends_on ?? []).toEqual([]);
});

test('project.mv in replay also moves an issue assigned to the old path meanwhile', async () => {
  await remote(op({ op: 'project.create', path: 'web', title: 'Web' }));
  await share();
  const id = idOf(await remote(op({ op: 'issue.create', title: 'Neu', projects: ['web'] })));
  await local(op({ op: 'project.mv', from: 'web', to: 'platform' }));
  const r = await replay();
  expect([r.replayed, r.conflicts]).toEqual([1, []]);
  const s = await snapshotAt(r.head);
  expect(s.issues.get(id)?.data.projects).toEqual(['platform']);
  expect([...s.projects.keys()]).toEqual(['platform']);
});

test('replayed commits are signed with the own key and carry the own actor', async () => {
  const id = await sharedIssue();
  await remote(op(setTitle(id, 'A', 'B')));
  const claim = await local(op({ op: 'issue.claim', id }));
  const r = await replay();
  expect(r.replayed).toBe(1);
  expect(await sigOf(wc, r.head, { 'claude-1': agentKey })).toEqual(['G', 'claude-1']);
  const message = await messageOf(r.head);
  const original = await messageOf(claim.commit as string);
  expect(message.subject).toBe(original.subject);
  expect(message.trailers.get(TRAILER_ACTOR)).toEqual(['claude-1']);
  expect(message.trailers.get(TRAILER_OP)).toEqual([encodeOp({ op: 'issue.claim', id })]);
  const { stdout } = await git(['log', '-1', '--format=%an <%ae>%x00%P', r.head], { cwd: wc });
  expect(stdout.trim()).toBe(`Claude <claude-1@backe.invalid>\0${r.onto}`);
  // Die neu gebauten Commits sind selbst wieder gültige lokale Einheiten.
  const again = await readUnits(wc, { base: r.onto, head: r.head }, 'claude-1');
  expect(again.map((u) => [u.kind, u.ops])).toEqual([['op', [{ op: 'issue.claim', id }]]]);
});

test('a batch is replayed as one unit and shelved as one', async () => {
  const x = idOf(await remote(op({ op: 'issue.create', title: 'A' })));
  const y = await sharedIssue('Y');
  await remote(op(setTitle(x, 'A', 'B')));
  await local({
    kind: 'batch',
    ops: [setTitle(y, 'Y', 'Y1'), { op: 'comment.add', id: y, body: 'Eins.\n' }],
  });
  await local({
    kind: 'batch',
    ops: [setTitle(x, 'A', 'C'), setTitle(y, 'Y1', 'Y2')],
  });
  const units = await readUnits(wc, { base, head: 'HEAD' }, 'claude-1');
  expect(units.map((u) => [u.kind, u.ops.length])).toEqual([
    ['batch', 2],
    ['batch', 2],
  ]);
  const r = await replay();
  expect(r.replayed).toBe(1);
  const [commit] = await commitsBetween(r.onto, r.head);
  const message = await messageOf(commit as string);
  expect(message.trailers.get(TRAILER_OP)).toEqual(['batch']);
  expect(message.body?.split('\n')).toHaveLength(2);
  expect(r.conflicts).toHaveLength(1);
  expect(r.conflicts[0]?.units.map((u) => [u.kind, u.ops.length])).toEqual([['batch', 2]]);
  expect(r.conflicts[0]?.reason).toMatchObject({ code: 'conflict', reason: 'precondition' });
  expect(r.conflicts[0]?.reason.message).toMatch(/^Zeile 1: /);
  const s = await snapshotAt(r.head);
  expect([s.issues.get(x)?.data.title, s.issues.get(y)?.data.title]).toEqual(['B', 'Y1']);
});

test('taint over created ids shelves a follower of an issue a shelved unit created', async () => {
  const x = await sharedIssue('A');
  await remote(op(setTitle(x, 'A', 'B')));
  const shelved = await local({
    kind: 'batch',
    ops: [setTitle(x, 'A', 'C'), { op: 'issue.create', title: 'Neu' }],
  });
  const created = (shelved.recorded[1] as { id: string }).id;
  await local(op({ op: 'comment.add', id: created, body: 'Folgt.\n' }));
  const other = idOf(await local(op({ op: 'issue.create', title: 'Unabhängig' })));
  const r = await replay();
  expect(r.conflicts).toHaveLength(1);
  expect(r.conflicts[0]?.units.map((u) => u.ops[0]?.op)).toEqual(['issue.edit', 'comment.add']);
  expect(r.replayed).toBe(1);
  const s = await snapshotAt(r.head);
  expect([s.issues.has(created), s.issues.has(other)]).toEqual([false, true]);
});

test('an id collision rewrites the issue and every later reference', async () => {
  const theirs = idOf(
    await remote(op({ op: 'issue.create', title: 'remote' }), { randomBytes: seqBytes() }),
  );
  const mine = idOf(
    await local(op({ op: 'issue.create', title: 'lokal' }), { randomBytes: seqBytes() }),
  );
  expect(mine).toBe(theirs);
  await local(op({ op: 'comment.add', id: mine, body: 'Zu lokal.\n' }));
  const w = idOf(await local(op({ op: 'issue.create', title: 'W', depends_on: [mine] })));
  const r = await replay({ randomBytes: seqBytes(100) });
  expect([r.replayed, r.conflicts]).toEqual([3, []]);
  const [notice] = r.notices;
  const fresh = notice?.ids[1] as string;
  expect(r.notices).toEqual([
    {
      code: 'id_rewritten',
      message: `ID-Kollision: ${mine} heißt jetzt ${fresh}`,
      ids: [mine, fresh],
    },
  ]);
  expect(fresh).not.toBe(mine);
  const s = await snapshotAt(r.head);
  expect(s.issues.get(theirs)?.data.title).toBe('remote');
  expect(s.issues.get(fresh)?.data.title).toBe('lokal');
  expect(s.issues.get(w)?.data.depends_on).toEqual([fresh]);
  const comments = await listCommentsFrom(await gitTreeSource(wc, r.head), fresh);
  expect(comments.map((c) => c.body)).toEqual(['Zu lokal.\n']);
  expect(await listCommentsFrom(await gitTreeSource(wc, r.head), theirs)).toEqual([]);
  const ops = await Promise.all(
    (await commitsBetween(r.onto, r.head)).map(
      async (c) => (await messageOf(c)).trailers.get(TRAILER_OP)?.[0],
    ),
  );
  expect(ops.every((o) => o?.includes(fresh) && !o.includes(mine))).toBe(true);
});

test('attach.add takes its content from the original commit', async () => {
  await remote(op({ op: 'issue.create', title: 'remote' }), { randomBytes: seqBytes() });
  const mine = idOf(
    await local(op({ op: 'issue.create', title: 'lokal' }), { randomBytes: seqBytes() }),
  );
  const bytes = Buffer.from([0, 1, 2, 255, 10]);
  await local(op({ op: 'attach.add', id: mine, name: 'log', file: 'log.bin', content: bytes }));
  const r = await replay({ randomBytes: seqBytes(100) });
  expect([r.replayed, r.conflicts]).toEqual([2, []]);
  const fresh = r.notices[0]?.ids[1] as string;
  const blob = await git(['rev-parse', `${r.head}:${attachmentsDir(fresh)}/log.bin`], { cwd: wc });
  const original = await git(['rev-parse', `HEAD:${attachmentsDir(mine)}/log.bin`], { cwd: wc });
  expect(blob.stdout).toBe(original.stdout);
  expect((await snapshotAt(r.head)).issues.get(fresh)?.data.attachments).toEqual([
    { name: 'log', file: 'log.bin' },
  ]);
});

const manual = (subject: string, files: Record<string, string | null>): WriteInput => ({
  kind: 'manual',
  subject,
  changes: Object.entries(files).map(([path, content]) => ({ path, content })),
});

const LINES = 'eins\nzwei\ndrei\nvier\nfünf\n';

test('a manual commit on untouched paths is cherry-picked and re-signed', async () => {
  const id = await sharedIssue();
  await remote(op(setTitle(id, 'A', 'B')));
  const mine = await local(manual('Notizen anlegen', { 'notes.md': 'x\n' }));
  const r = await replay();
  expect([r.replayed, r.conflicts]).toEqual([1, []]);
  expect(await showFile(r.head, 'notes.md')).toBe('x\n');
  expect((await snapshotAt(r.head)).issues.get(id)?.data.title).toBe('B');
  const message = await messageOf(r.head);
  expect(message.subject).toBe('Notizen anlegen');
  expect(message.trailers.get(TRAILER_OP)).toEqual(['manual']);
  expect(message.trailers.get(TRAILER_ACTOR)).toEqual(['claude-1']);
  expect(await sigOf(wc, r.head, { 'claude-1': agentKey })).toEqual(['G', 'claude-1']);
  expect(r.head).not.toBe(mine.commit);
});

test('a manual commit merges text cleanly and skips what the remote already has', async () => {
  await remote(manual('Notizen', { 'notes.md': LINES, 'same.md': 'a\n', 'gone.md': 'g\n' }));
  await share();
  await remote(manual('remote', { 'notes.md': LINES.replace('eins', 'EINS'), 'same.md': 'b\n' }));
  await local(
    manual('lokal', {
      'notes.md': LINES.replace('fünf', 'FÜNF'),
      'same.md': 'b\n',
      'gone.md': null,
      'neu.md': 'n\n',
    }),
  );
  const r = await replay();
  expect(r.replayed).toBe(1);
  expect(await showFile(r.head, 'notes.md')).toBe(
    LINES.replace('eins', 'EINS').replace('fünf', 'FÜNF'),
  );
  expect(await showFile(r.head, 'same.md')).toBe('b\n');
  expect(await showFile(r.head, 'neu.md')).toBe('n\n');
  const { stdout } = await git(['ls-tree', '--name-only', r.head, '--', 'gone.md'], { cwd: wc });
  expect(stdout).toBe('');
});

test('a manual commit whose change the remote already made produces no commit', async () => {
  await remote(manual('remote', { 'notes.md': 'x\n' }));
  await local(manual('lokal', { 'notes.md': 'x\n' }));
  const r = await replay();
  expect([r.replayed, r.head, r.conflicts]).toEqual([0, r.onto, []]);
});

test('a manual text conflict aborts without writing conflicts', async () => {
  await remote(manual('Notizen', { 'notes.md': LINES }));
  await share();
  await remote(manual('remote', { 'notes.md': LINES.replace('eins', 'EINS') }));
  const mine = await local(manual('lokal', { 'notes.md': LINES.replace('eins', 'Eins') }));
  const err = await catchErrAsync(() => replay());
  expect(err.code).toBe('conflict');
  expect(err.message).toMatch(/^Textkonflikt in manual-Commit [0-9a-f]{7}: notes\.md$/);
  expect(err.message).toContain((mine.commit as string).slice(0, 7));
  expect(await listConflicts(wc)).toEqual([]);
});

test('binary content and delete against modify are text conflicts too', async () => {
  await remote(manual('Basis', { 'bin.dat': 'a\0b\n', 'del.md': 'x\n' }));
  await share();
  await remote(manual('remote', { 'bin.dat': 'a\0c\n', 'del.md': 'y\n' }));
  await local(manual('lokal', { 'bin.dat': 'a\0d\n', 'del.md': null }));
  const err = await catchErrAsync(() => replay());
  expect(err.message).toMatch(/^Textkonflikt in manual-Commit [0-9a-f]{7}: bin\.dat, del\.md$/);
});

test('a resolver choosing local, remote and edit is honoured', async () => {
  const files = { 'a.md': LINES, 'b.md': LINES, 'c.md': LINES };
  await remote(manual('Basis', files));
  await share();
  const upper = Object.fromEntries(
    Object.keys(files).map((f) => [f, LINES.replace('eins', 'EINS')]),
  );
  await remote(manual('remote', upper));
  await local(manual('A', { 'a.md': LINES.replace('eins', 'Eins') }));
  await local(manual('B', { 'b.md': LINES.replace('eins', 'Eins'), 'b2.md': 'mit\n' }));
  await local(manual('C', { 'c.md': LINES.replace('eins', 'Eins') }));
  await local(manual('D', { 'b.md': LINES.replace('eins', 'eiNs') }));
  const seen: Parameters<ManualResolver>[0][] = [];
  const resolver: ManualResolver = async (c) => {
    seen.push(c);
    if (c.subject === 'A') return { kind: 'local' };
    if (c.subject === 'C') return { kind: 'edit', files: new Map([['c.md', Buffer.from('ed\n')]]) };
    return { kind: 'remote' };
  };
  const r = await replay({ resolveManual: resolver });
  expect(seen.map((c) => [c.subject, c.paths.map((p) => p.path)])).toEqual([
    ['A', ['a.md']],
    ['B', ['b.md']],
    ['C', ['c.md']],
    ['D', ['b.md']],
  ]);
  const [a] = seen[0]?.paths ?? [];
  expect(a?.base?.toString()).toBe(LINES);
  expect(a?.ours?.toString()).toBe(LINES.replace('eins', 'EINS'));
  expect(a?.theirs?.toString()).toBe(LINES.replace('eins', 'Eins'));
  expect(a?.merged?.toString()).toMatch(/^<<<<<<< remote\n/m);
  expect(a?.merged?.toString()).toMatch(/^>>>>>>> lokal\n/m);
  // A und C werden Commits; B und D fallen ganz weg, auch B mit seinem konfliktfreien Pfad.
  expect(r.replayed).toBe(2);
  expect(await showFile(r.head, 'a.md')).toBe(LINES.replace('eins', 'Eins'));
  expect(await showFile(r.head, 'b.md')).toBe(LINES.replace('eins', 'EINS'));
  const b2 = await git(['ls-tree', '--name-only', r.head, '--', 'b2.md'], { cwd: wc });
  expect(b2.stdout).toBe('');
  expect(await showFile(r.head, 'c.md')).toBe('ed\n');

  const err = await catchErrAsync(() => replay({ resolveManual: async () => ({ kind: 'abort' }) }));
  expect(err.message).toMatch(/^Textkonflikt in manual-Commit [0-9a-f]{7}: a\.md$/);
});

test('nothing changes before the final reset', async () => {
  const id = await sharedIssue();
  await remote(op(setTitle(id, 'A', 'B')));
  await local(op(setTitle(id, 'A', 'C')));
  await local(manual('Notizen', { 'notes.md': 'x\n' }));
  await local(op({ op: 'comment.add', id, body: 'Text.\n' }));
  await pushRemote();
  await git(['fetch', '-q', 'origin'], { cwd: wc });
  const refs = async () => (await git(['for-each-ref'], { cwd: wc })).stdout;
  const before = {
    head: await revParse(wc, 'HEAD'),
    status: await statusShort(wc),
    refs: await refs(),
  };
  const r = await replay();
  expect(r.conflicts).toHaveLength(1);
  expect(r.replayed).toBe(1);
  expect({
    head: await revParse(wc, 'HEAD'),
    status: await statusShort(wc),
    refs: await refs(),
  }).toEqual(before);
  expect(await listConflicts(wc)).toEqual([]);
});

test('a lost claim unit is reported as claimLost, not shelved', async () => {
  const id = await sharedIssue();
  await remote(op({ op: 'issue.claim', id }));
  const z = idOf(await local(op({ op: 'issue.create', title: 'Z' })));
  const claim = await local(op({ op: 'issue.claim', id }));
  const r = await replay({ claimSha: claim.commit as string });
  expect([r.replayed, r.conflicts, r.claimSha]).toEqual([1, [], undefined]);
  expect(r.claimLost?.id).toBe(id);
  expect(r.claimLost?.error).toBeInstanceOf(BackeError);
  expect(r.claimLost?.error.code).toBe('conflict');
  expect((await snapshotAt(r.head)).issues.has(z)).toBe(true);
});

test('a claim unit without issue.claim is a caller error', async () => {
  const id = await sharedIssue();
  await remote(op(setTitle(id, 'A', 'B')));
  const mine = await local(op(setTitle(id, 'A', 'C')));
  const err = await catchErrAsync(() => replay({ claimSha: mine.commit as string }));
  expect([err.code, err.message]).toEqual([
    'unexpected',
    `Claim-Einheit ${(mine.commit as string).slice(0, 7)} enthält kein issue.claim`,
  ]);
});

test('a claim unit that still applies is replayed normally', async () => {
  const id = await sharedIssue();
  await remote(op({ op: 'issue.create', title: 'anderes' }));
  const claim = await local(op({ op: 'issue.claim', id }));
  const r = await replay({ claimSha: claim.commit as string });
  expect([r.replayed, r.claimLost]).toEqual([1, undefined]);
  expect((await snapshotAt(r.head)).issues.get(id)?.data.assignee).toBe('claude-1');
  // Der Claim ist neu signiert; nur dieser SHA erkennt ihn in einer weiteren Runde wieder.
  expect(r.claimSha).toBe(r.head);
  expect(r.claimSha).not.toBe(claim.commit);
});

test('readUnits refuses a foreign local commit with a resign hint', async () => {
  const spwKey = await testKey('spw');
  const cases = [
    { files: { 'a.md': 'x\n' }, actor: 'claude-1', op: 'manual' },
    { files: { 'a.md': 'x\n' }, actor: 'claude-1', op: 'manual', key: spwKey },
    { files: { 'a.md': 'x\n' }, actor: 'spw', op: 'manual', key: agentKey },
    { files: { 'a.md': 'x\n' }, actor: 'claude-1', op: '{kaputt', key: agentKey },
    { files: { 'a.md': 'x\n' }, actor: 'claude-1', op: 'init', key: agentKey },
    { files: { 'a.md': 'x\n' }, actor: 'claude-1', key: agentKey },
  ];
  for (const spec of cases) {
    await git(['reset', '-q', '--hard', base], { cwd: wc });
    const sha = await rawCommit(wc, spec);
    const err = await catchErrAsync(() => readUnits(wc, { base, head: 'HEAD' }, 'claude-1'));
    expect([err.code, err.message, err.hint]).toEqual([
      'verify',
      `Lokaler Commit ${sha.slice(0, 7)} ist nicht von backe signiert`,
      'backe commit --resign',
    ]);
  }
});

test('readUnits accepts a raw commit signed like backe and refuses merges', async () => {
  await git(['reset', '-q', '--hard', base], { cwd: wc });
  const op1: Operation = { op: 'issue.create', id: 'bk-a1b2c', title: 'roh' };
  const good = await rawCommit(wc, {
    files: { 'a.md': 'x\n' },
    actor: 'claude-1',
    op: encodeOp(op1),
    key: agentKey,
    subject: 'roh',
  });
  expect(await readUnits(wc, { base, head: good }, 'claude-1')).toEqual([
    { sha: good, subject: 'roh', kind: 'op', ops: [op1] },
  ]);
  const side = await rawCommit(wc, {
    files: { 'b.md': 'y\n' },
    actor: 'claude-1',
    op: 'manual',
    key: agentKey,
    parents: [base],
  });
  const merge = await rawCommit(wc, {
    files: {},
    actor: 'claude-1',
    op: 'manual',
    key: agentKey,
    parents: [good, side],
  });
  const err = await catchErrAsync(() => readUnits(wc, { base, head: merge }, 'claude-1'));
  expect([err.code, err.message]).toEqual([
    'verify',
    `Lokaler Commit ${merge.slice(0, 7)} ist ein Merge-Commit`,
  ]);
});

test('readUnits from the root skips the init commit', async () => {
  const units = await readUnits(t.spw.root, { base: undefined, head: 'HEAD' }, 'spw');
  expect(units.map((u) => [u.kind, u.ops.map((o) => o.op)])).toEqual([['op', ['user.add']]]);
});

const hasLfs = await git(['lfs', 'version'], { cwd: process.cwd() }).then(
  () => true,
  () => false,
);
if (!hasLfs) console.warn('git-lfs fehlt: LFS-Tests übersprungen');

test.runIf(hasLfs)('a unit introducing the lfs rule takes over renormalized pointers', async () => {
  const id = idOf(await remote(op({ op: 'issue.create', title: 'A' })));
  for (const file of ['old1.txt', 'old2.txt']) {
    await remote(op({ op: 'attach.add', id, name: file, file, content: Buffer.from(`${file}\n`) }));
  }
  const config = (await git(['show', 'HEAD:.backe/backlog.jsonc'], { cwd: t.spw.root })).stdout;
  await remote(
    manual('lfs an', {
      '.backe/backlog.jsonc': config.replace(/\n}\n$/, ',\n  "attachments": { "lfs": true }\n}\n'),
    }),
  );
  await share();
  await remote(op({ op: 'attach.rm', id, name: 'old2.txt' }));
  const mine = await local(
    op({ op: 'attach.add', id, name: 'new', file: 'new.txt', content: Buffer.from('neu\n') }),
  );
  const dir = attachmentsDir(id);
  const blob = async (rev: string, file: string) =>
    (await git(['rev-parse', `${rev}:${dir}/${file}`], { cwd: wc })).stdout;
  expect(await showFile(mine.commit as string, `${dir}/old1.txt`)).toMatch(/^version https:/);

  const r = await replay();
  expect(r.replayed).toBe(1);
  expect(await showFile(r.head, '.gitattributes')).toContain('filter=lfs');
  expect(await blob(r.head, 'new.txt')).toBe(await blob(mine.commit as string, 'new.txt'));
  expect(await blob(r.head, 'old1.txt')).toBe(await blob(mine.commit as string, 'old1.txt'));
  const { stdout } = await git(['ls-tree', '--name-only', r.head, '--', `${dir}/old2.txt`], {
    cwd: wc,
  });
  expect(stdout).toBe('');
});

test('a unit the remote already reached produces no commit', async () => {
  const id = await sharedIssue();
  await remote(op(setTitle(id, 'A', 'C')));
  await local(op(setTitle(id, 'A', 'C')));
  const r = await replay();
  expect([r.replayed, r.head, r.conflicts]).toEqual([0, r.onto, []]);
});

test('a comment edit sees comments added by earlier units of the round', async () => {
  const id = await sharedIssue();
  await remote(op(setTitle(id, 'A', 'B')));
  const added = await local(op({ op: 'comment.add', id, body: 'Erst.\n' }));
  const file = (added.recorded[0] as { file: string }).file;
  await local(
    op({ op: 'comment.edit', id, file, from_hash: bodyHash('Erst.\n'), body: 'Dann.\n' }),
  );
  const r = await replay();
  expect([r.replayed, r.conflicts]).toEqual([2, []]);
  const comments = await listCommentsFrom(await gitTreeSource(wc, r.head), id);
  expect(comments.map((c) => c.body)).toEqual(['Dann.\n']);
});

test('independent violations get entries of their own with distinct ids', async () => {
  const x = idOf(await remote(op({ op: 'issue.create', title: 'A' })));
  const y = await sharedIssue('Y');
  await remote(op(setTitle(x, 'A', 'B')));
  await remote(op(setTitle(y, 'Y', 'Y1')));
  await local(op(setTitle(x, 'A', 'C')));
  await local(op(setTitle(y, 'Y', 'Y2')));
  const r = await replay({ randomBytes: () => new Uint8Array([0xff, 0xff, 0xff]) });
  expect(r.conflicts.map((e) => [e.id, e.units[0]?.ops[0]])).toEqual([
    ['20261119T080000Z-ffffff', setTitle(x, 'A', 'C')],
    ['20261119T080000Z-000000', setTitle(y, 'Y', 'Y2')],
  ]);
});

test('shelved units keep the original attachment source under a rewritten id', async () => {
  const y = await sharedIssue();
  const theirs = idOf(
    await remote(op({ op: 'issue.create', title: 'remote' }), { randomBytes: seqBytes() }),
  );
  await remote(op(setTitle(y, 'A', 'B')));
  const batch = await local(
    {
      kind: 'batch',
      ops: [
        { op: 'issue.create', ref: '$x', title: 'lokal' },
        { op: 'attach.add', id: '$x', name: 'a', file: 'a.txt', content: Buffer.from('a\n') },
        setTitle(y, 'A', 'C'),
      ],
    },
    { randomBytes: seqBytes() },
  );
  const mine = batch.refs.$x as string;
  expect(mine).toBe(theirs);
  const follower = await local(
    op({ op: 'attach.add', id: mine, name: 'b', file: 'b.txt', content: Buffer.from('b\n') }),
  );
  const r = await replay({ randomBytes: seqBytes(100) });
  expect([r.replayed, r.notices]).toEqual([0, []]);
  expect(r.conflicts).toHaveLength(1);
  const [shelved, followed] = r.conflicts[0]?.units ?? [];
  const fresh = (shelved?.ops[0] as { id: string } | undefined)?.id;
  expect(fresh).not.toBe(mine);
  expect(shelved).toMatchObject({
    sha: batch.commit,
    kind: 'batch',
    sources: { 1: `${batch.commit}:${attachmentsDir(mine)}/a.txt` },
  });
  expect(shelved?.ops[1]).toEqual({ op: 'attach.add', id: fresh, name: 'a', file: 'a.txt' });
  expect(followed).toEqual({
    sha: follower.commit,
    subject: expect.any(String),
    kind: 'op',
    ops: [{ op: 'attach.add', id: fresh, name: 'b', file: 'b.txt' }],
    sources: { 0: `${follower.commit}:${attachmentsDir(mine)}/b.txt` },
  });
  await writeConflicts(wc, r.conflicts);
  expect(await listConflicts(wc)).toEqual(r.conflicts);
});

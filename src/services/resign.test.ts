/**
 * `commit --resign` (backe.md §2.13 »Hand-Edits«): lokale, noch nicht gepushte Commits, die keine
 * gültigen backe-Commits der eigenen Identität sind, werden in Operationen übersetzt und neu
 * signiert; gültige bleiben Einheiten wie im Replay.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import {
  logTrailers,
  rawCommit,
  revParse,
  statusShort,
  testBacklog,
  testKey,
  twoClones,
} from '../../test/helpers/git.ts';
import { seqBytes } from '../../test/helpers/snapshot.ts';
import { setIdentity } from '../context/registry.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { git } from '../git/exec.ts';
import { clearLocalState, stateDir, writeLocalState } from '../git/local-state.ts';
import { exists } from '../store/files.ts';
import { issueFile } from '../store/layout.ts';
import { loadSnapshot } from '../store/snapshot.ts';
import { resignCommits } from './resign.ts';
import { syncNow } from './sync.ts';
import { verifyRange } from './verify.ts';
import { executeWrite } from './write.ts';

let b: Awaited<ReturnType<typeof testBacklog>>;
let ctx: ResolvedContext;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
});

async function create(c: ResolvedContext, title: string): Promise<string> {
  const r = await executeWrite(c, { kind: 'op', op: { op: 'issue.create', title } });
  return (r.recorded[0] as { id: string }).id;
}

async function retitled(root: string, id: string, from: string, to: string): Promise<string> {
  const text = await readFile(join(root, issueFile(id)), 'utf8');
  return text.replace(`title: ${from}`, `title: ${to}`);
}

const head = () => revParse(b.root, 'HEAD');

test('resign translates a bare git commit into operations and signs it', async () => {
  const a = await create(ctx, 'A');
  await rawCommit(b.root, {
    files: { [issueFile(a)]: await retitled(b.root, a, 'A', 'A2'), 'notes.md': 'notiz\n' },
    subject: 'von Hand',
  });
  expect((await verifyRange(b.root)).invalid).toHaveLength(1);

  const r = await resignCommits(ctx);

  expect(r.rewritten).toBe(1);
  expect(r.commits.map((c) => [c.kind, c.summary])).toEqual([
    ['manual', 'von Hand'],
    ['op', `issue edit ${a}`],
  ]);
  expect(r.commits.at(-1)?.commit).toBe(await head());
  const [opCommit, manualCommit] = await logTrailers(b.root);
  expect(manualCommit).toMatchObject({ actor: 'spw', op: 'manual' });
  expect(opCommit?.actor).toBe('spw');
  expect(JSON.parse(opCommit?.op as string)).toEqual({
    op: 'issue.edit',
    id: a,
    set: { title: { from: 'A', to: 'A2' } },
  });
  expect((await verifyRange(b.root)).invalid).toEqual([]);
  expect((await loadSnapshot(b.root)).issues.get(a)?.data.title).toBe('A2');
  expect(await readFile(join(b.root, 'notes.md'), 'utf8')).toBe('notiz\n');
  expect(await statusShort(b.root)).toEqual([]);
});

test('resign keeps valid backe commits as they are', async () => {
  const a = await create(ctx, 'A');
  const before = await head();
  await rawCommit(b.root, { files: { [issueFile(a)]: await retitled(b.root, a, 'A', 'A2') } });
  const c = await create(ctx, 'C');
  const valid = await head();

  const r = await resignCommits(ctx);

  expect(r.rewritten).toBe(1);
  expect(r.commits.map((x) => x.kind)).toEqual(['op', 'op']);
  expect(r.commits[1]?.summary).toBe(`issue create ${c}`);
  expect(r.commits[1]?.commit).not.toBe(valid);
  const { stdout } = await git(['rev-list', '--count', `${before}..HEAD`], { cwd: b.root });
  expect(Number(stdout.trim())).toBe(2);
  expect(await git(['merge-base', '--is-ancestor', before, 'HEAD'], { cwd: b.root })).toMatchObject(
    { exitCode: 0 },
  );
  const s = await loadSnapshot(b.root);
  expect(s.issues.get(a)?.data.title).toBe('A2');
  expect(s.issues.get(c)?.data.title).toBe('C');
  expect((await verifyRange(b.root)).invalid).toEqual([]);
});

test('resign translates a commit signed by another identity', async () => {
  const a = await create(ctx, 'A');
  const other = await testKey('fremd');
  await rawCommit(b.root, {
    files: { [issueFile(a)]: await retitled(b.root, a, 'A', 'A3') },
    key: other,
    actor: 'spw',
    op: 'manual',
  });

  const r = await resignCommits(ctx);

  expect(r.rewritten).toBe(1);
  expect((await verifyRange(b.root)).invalid).toEqual([]);
});

test('a foreign commit without any effect disappears', async () => {
  const a = await create(ctx, 'A');
  const before = await head();
  // Nur eine andere Reihenfolge im Frontmatter: kanonisch ist das nichts.
  const lines = (await readFile(join(b.root, issueFile(a)), 'utf8')).split('\n');
  [lines[1], lines[2]] = [lines[2] as string, lines[1] as string];
  await rawCommit(b.root, { files: { [issueFile(a)]: lines.join('\n') } });

  const r = await resignCommits(ctx);

  expect(r).toEqual({ commits: [], rewritten: 1 });
  expect(await head()).toBe(before);
});

test('resign with nothing foreign reports nothing to do', async () => {
  await create(ctx, 'A');
  const before = await head();

  expect(await resignCommits(ctx)).toEqual({ commits: [], rewritten: 0 });
  expect(await head()).toBe(before);
});

test('resign with hand edits in the working copy is a usage error', async () => {
  const a = await create(ctx, 'A');
  await rawCommit(b.root, { files: { 'notes.md': 'x\n' } });
  const before = await head();
  await writeFile(join(b.root, issueFile(a)), await retitled(b.root, a, 'A', 'B'));

  const err = await catchErrAsync(() => resignCommits(ctx));

  expect(err).toMatchObject({
    code: 'usage',
    message: '--resign geht nicht zusammen mit Hand-Edits',
    hint: 'erst backe commit',
  });
  expect(await head()).toBe(before);
});

test('a foreign commit that verify would reject is not re-signed', async () => {
  await create(ctx, 'A');
  // Erst gibt spw die Admin-Rolle ab (das darf er), dann ändert er die Config trotzdem.
  const config = await readFile(join(b.root, '.backe/backlog.jsonc'), 'utf8');
  const demoted = config.replace(/"admins": \[[^\]]*\]/, '"admins": ["bob"]');
  await rawCommit(b.root, { files: { '.backe/backlog.jsonc': demoted } });
  await rawCommit(b.root, {
    files: {
      '.backe/backlog.jsonc': demoted.replace(/\n}\n$/, ',\n  "workflow": { "strict": true }\n}\n'),
    },
  });
  const before = await head();

  const err = await catchErrAsync(() => resignCommits(ctx));

  expect(err.code).toBe('validation');
  expect(err.message).toMatch(/^verify würde den Commit ablehnen: /);
  expect(await head()).toBe(before);
});

test('a frozen state that began before the re-signed commits still counts', async () => {
  const config = await readFile(join(b.root, '.backe/backlog.jsonc'), 'utf8');
  await executeWrite(ctx, {
    kind: 'manual',
    subject: 'verify: warn',
    changes: [
      {
        path: '.backe/backlog.jsonc',
        content: config.replace(/\n}\n$/, ',\n  "verify": "warn"\n}\n'),
      },
    ],
  });
  const a = await create(ctx, 'A');
  const text = await readFile(join(b.root, issueFile(a)), 'utf8');
  // Ein ungültiger Commit, den die Arbeitskopie schon vom Remote hat: Ab ihm ist der Stand eingefroren.
  const bad = await rawCommit(b.root, { files: { [issueFile(a)]: `${text}Fremd.\n` } });
  await writeLocalState(b.root, 'upstream', bad);
  await rawCommit(b.root, {
    files: { [issueFile(a)]: (await retitled(b.root, a, 'A', 'A2')).replace('Fremd.', 'X.') },
  });
  const before = await head();

  const err = await catchErrAsync(() => resignCommits(ctx));

  expect(err.code).toBe('validation');
  expect(err.message).toContain('baut auf ungültigem Commit');
  expect(await head()).toBe(before);
});

test('resign first recovers the journal of a crashed write', async () => {
  const a = await create(ctx, 'A');
  await rawCommit(b.root, { files: { [issueFile(a)]: await retitled(b.root, a, 'A', 'A2') } });
  const c = await create(ctx, 'C');
  // Absturz nach dem Ref-Update, bevor das Journal entfernt war.
  const journal = join(await stateDir(b.root), 'write.journal');
  await writeFile(
    journal,
    JSON.stringify({ head: await revParse(b.root, 'HEAD^'), paths: [issueFile(c)] }),
  );

  const r = await resignCommits(ctx);

  expect(r.rewritten).toBe(1);
  expect(await exists(journal)).toBe(false);
  await create(ctx, 'D');
  expect(await statusShort(b.root)).toEqual([]);
});

test('a claim that no longer applies after re-signing is dropped with a notice', async () => {
  const a = await create(ctx, 'A');
  const text = await readFile(join(b.root, issueFile(a)), 'utf8');
  await rawCommit(b.root, {
    files: { [issueFile(a)]: text.replace('state: backlog', 'state: done') },
  });
  await rawCommit(b.root, {
    files: { [issueFile(a)]: text.replace('state: backlog', 'state: in_progress') },
    key: b.key,
    actor: 'spw',
    op: JSON.stringify({ op: 'issue.claim', id: a }),
    subject: `issue claim ${a}`,
  });

  const r = await resignCommits(ctx);

  expect(r.rewritten).toBe(1);
  expect(r.notices).toEqual([
    expect.objectContaining({
      code: 'claim_lost',
      ids: [a],
      message: expect.stringMatching(new RegExp(`^Claim ${a} verloren: `)),
    }),
  ]);
  expect((await loadSnapshot(b.root)).issues.get(a)?.data.state).toBe('done');
});

test('after a sync stopped at a foreign commit, resign lets the next sync through', async () => {
  const t = await twoClones();
  const x = await create(t.spw.ctx, 'X');
  await syncNow(t.spw.ctx);
  await syncNow(t.agent.ctx);
  await create(t.spw.ctx, 'Y');
  await syncNow(t.spw.ctx);
  await rawCommit(t.agent.wc, {
    files: { [issueFile(x)]: await retitled(t.agent.wc, x, 'X', 'X2') },
  });
  expect((await catchErrAsync(() => syncNow(t.agent.ctx))).code).toBe('verify');

  const r = await resignCommits(t.agent.ctx);

  expect(r.rewritten).toBe(1);
  const out = await syncNow(t.agent.ctx);
  expect(out.pushed).toBe(await revParse(t.remote, 'refs/heads/main'));
  const s = await loadSnapshot(t.agent.wc);
  expect(s.issues.get(x)?.data.title).toBe('X2');
  expect([...s.issues.values()].map((i) => i.data.title).sort()).toEqual(['X2', 'Y']);
});

test('a foreign commit touching two issues becomes one batch', async () => {
  const a = await create(ctx, 'A');
  const c = await create(ctx, 'C');
  await clearLocalState(b.root, 'verified');
  await rawCommit(b.root, {
    files: {
      [issueFile(a)]: await retitled(b.root, a, 'A', 'A2'),
      [issueFile(c)]: await retitled(b.root, c, 'C', 'C2'),
    },
  });

  const r = await resignCommits(ctx, {
    now: () => new Date('2026-11-20T08:00:00Z'),
    randomBytes: seqBytes(),
  });

  expect(r.commits.map((x) => x.kind)).toEqual(['batch']);
  expect((await logTrailers(b.root))[0]?.op).toBe('batch');
  expect((await verifyRange(b.root)).invalid).toEqual([]);
});

test('a foreign commit with only foreign files and no subject is a manual commit', async () => {
  await rawCommit(b.root, { files: { 'notes.md': 'x\n' } });
  // Dieselbe Änderung als Commit ohne Message, wie `git commit --allow-empty-message`.
  const tree = await revParse(b.root, 'HEAD^{tree}');
  const { stdout } = await git(['commit-tree', tree, '-p', 'HEAD~1'], {
    cwd: b.root,
    input: '',
    env: {
      GIT_AUTHOR_NAME: 'Raw',
      GIT_AUTHOR_EMAIL: 'raw@backe.invalid',
      GIT_COMMITTER_NAME: 'Raw',
      GIT_COMMITTER_EMAIL: 'raw@backe.invalid',
    },
  });
  await git(['reset', '-q', '--hard', stdout.trim()], { cwd: b.root });

  const r = await resignCommits(ctx);

  expect(r.commits.map((x) => [x.kind, x.summary])).toEqual([['manual', 'manual: 1 Dateien']]);
});

test('a foreign commit adding a user becomes user.add', async () => {
  const bot = await testKey('bot');
  await executeWrite(ctx, {
    kind: 'op',
    op: {
      op: 'user.add',
      handle: 'bot',
      name: 'Bot',
      kind: 'agent',
      operator: 'spw',
      keys: [bot.line],
    },
  });
  const file = await readFile(join(b.root, 'users/bot.md'), 'utf8');
  await git(['reset', '-q', '--hard', 'HEAD~1'], { cwd: b.root });
  await rawCommit(b.root, { files: { 'users/bot.md': file } });

  const r = await resignCommits(ctx);

  expect(r.commits.map((x) => x.summary)).toEqual(['user add bot']);
  expect((await verifyRange(b.root)).invalid).toEqual([]);
});

test('a symlink in a foreign commit is validation', async () => {
  await rawCommit(b.root, { files: { 'link.md': { symlink: '/etc/passwd' } } });
  const before = await head();

  const err = await catchErrAsync(() => resignCommits(ctx));

  expect(err.code).toBe('validation');
  expect(err.message).toContain('link.md ist keine reguläre Datei');
  expect(await head()).toBe(before);
});

test('a broken entity file in a foreign commit names the commit', async () => {
  const a = await create(ctx, 'A');
  const bad = await rawCommit(b.root, { files: { [issueFile(a)]: '---\ntitle: [\n---\n' } });

  const err = await catchErrAsync(() => resignCommits(ctx));

  expect(err.message).toMatch(new RegExp(`^Commit ${bad.slice(0, 7)}: `));
});

test('an identity without working copy has nothing to re-sign', async () => {
  const claude = await testKey('claude-1');
  await executeWrite(ctx, {
    kind: 'op',
    op: {
      op: 'user.add',
      handle: 'claude-1',
      name: 'Claude',
      kind: 'agent',
      operator: 'spw',
      keys: [claude.line],
    },
  });
  await setIdentity(b.homes, 'acme', 'claude-1', claude.priv);
  const agent = await b.context({ as: 'claude-1', backlog: 'acme' });

  expect(await resignCommits(agent)).toEqual({ commits: [], rewritten: 0 });
});

test('local commits without a common ancestor with upstream are verify', async () => {
  await rawCommit(b.root, { files: { 'notes.md': 'x\n' } });
  const empty = await git(['hash-object', '-t', 'tree', '--stdin', '-w'], {
    cwd: b.root,
    input: '',
  });
  const orphan = await git(['commit-tree', empty.stdout.trim()], {
    cwd: b.root,
    input: 'fremd\n',
    env: {
      GIT_AUTHOR_NAME: 'Raw',
      GIT_AUTHOR_EMAIL: 'raw@backe.invalid',
      GIT_COMMITTER_NAME: 'Raw',
      GIT_COMMITTER_EMAIL: 'raw@backe.invalid',
    },
  });
  await writeLocalState(b.root, 'upstream', orphan.stdout.trim());
  const before = await head();

  const err = await catchErrAsync(() => resignCommits(ctx));

  expect(err.code).toBe('verify');
  expect(await head()).toBe(before);
});

test('a manual text conflict while re-signing points to backe commit', async () => {
  const a = await create(ctx, 'A');
  const lines = (await readFile(join(b.root, issueFile(a)), 'utf8')).split('\n');
  [lines[1], lines[2]] = [lines[2] as string, lines[1] as string];
  const swapped = lines.join('\n');
  // Fremd und nicht kanonisch; die Übersetzung schreibt die Datei kanonisch neu.
  await rawCommit(b.root, { files: { [issueFile(a)]: swapped.replace('title: A', 'title: A2') } });
  // Danach ein gültiger manual-Commit von spw auf denselben Zeilen.
  await rawCommit(b.root, {
    files: { [issueFile(a)]: swapped.replace('title: A', 'title: A3') },
    key: b.key,
    actor: 'spw',
    op: 'manual',
    subject: 'von Hand weiter',
  });
  const before = await head();

  const err = await catchErrAsync(() => resignCommits(ctx));

  expect(err).toMatchObject({ code: 'conflict', hint: 'Hand-Edits per backe commit neu anlegen' });
  expect(await head()).toBe(before);
});

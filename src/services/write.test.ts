import { appendFile, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import {
  logTrailers,
  rawCommit,
  revParse,
  sigOf,
  statusShort,
  type TestBacklog,
  type TestKey,
  testBacklog,
  testKey,
} from '../../test/helpers/git.ts';
import { seqBytes } from '../../test/helpers/snapshot.ts';
import { withFileLock } from '../context/lock.ts';
import { managedClonePath, setIdentity, workingCopyPath } from '../context/registry.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { BackeError } from '../core/errors.ts';
import { git } from '../git/exec.ts';
import { readLocalState, stateDir, writeLocalState } from '../git/local-state.ts';
import { parseCommitMessage } from '../git/message.ts';
import {
  encodeBatchBody,
  encodeOp,
  type Operation,
  summarizeBatch,
  summarizeOp,
} from '../ops/operation.ts';
import { commentsDir, issueFile } from '../store/layout.ts';
import { executeWrite, type WriteInput } from './write.ts';

const NOW = new Date('2026-11-19T10:00:00Z');
const CREATE: WriteInput = { kind: 'op', op: { op: 'issue.create', title: 'A' } };
const CREATE_A = CREATE;
const CREATE_B: WriteInput = { kind: 'op', op: { op: 'issue.create', title: 'B' } };

let b: TestBacklog;
let ctx: ResolvedContext;
let head: string;

beforeEach(async () => {
  b = await testBacklog({ userName: 'S. P. W.' });
  ctx = await b.context();
  head = await revParse(b.root, 'HEAD');
});

async function createdId(input: WriteInput = CREATE): Promise<string> {
  const r = await executeWrite(ctx, input, { now: () => NOW, randomBytes: seqBytes() });
  const op = r.recorded[0] as Extract<Operation, { op: 'issue.create' }>;
  return op.id as string;
}

test('an op becomes one signed commit with actor and op trailer', async () => {
  const r = await executeWrite(
    await b.context(),
    { kind: 'op', op: { op: 'issue.create', title: 'A' } },
    { now: () => NOW, randomBytes: seqBytes() },
  );
  const [last] = await logTrailers(b.root);
  expect(last).toEqual({
    subject: summarizeOp(r.recorded[0] as Operation),
    actor: 'spw',
    op: encodeOp(r.recorded[0] as Operation),
  });
  expect(await sigOf(b.root, r.commit as string, { spw: b.key })).toEqual(['G', 'spw']);
  expect(await statusShort(b.root)).toEqual([]);
  expect(r.commit).toBe(await revParse(b.root, 'HEAD'));
  expect(r.paths).toEqual([issueFile((r.recorded[0] as { id: string }).id)]);
  const author = await git(['log', '-1', '--format=%an <%ae>'], { cwd: b.root });
  expect(author.stdout.trim()).toBe('S. P. W. <spw@backe.invalid>');
});

test('a batch carries its ops as body and Backe-Op: batch', async () => {
  const r = await executeWrite(
    ctx,
    {
      kind: 'batch',
      ops: [
        { op: 'issue.create', ref: '$a', title: 'A' },
        { op: 'issue.create', title: 'B', parent: '$a' },
      ],
    },
    { now: () => NOW, randomBytes: seqBytes() },
  );
  expect(r.recorded).toHaveLength(2);
  expect(Object.keys(r.refs)).toEqual(['$a']);
  const [last] = await logTrailers(b.root);
  expect(last).toEqual({ subject: summarizeBatch(r.recorded), actor: 'spw', op: 'batch' });
  const raw = (await git(['log', '-1', '--format=%B'], { cwd: b.root })).stdout;
  expect(parseCommitMessage(raw).body).toBe(encodeBatchBody(r.recorded).replace(/\n$/, ''));
  expect(await statusShort(b.root)).toEqual([]);
});

test('a manual change carries Backe-Op: manual', async () => {
  const r = await executeWrite(ctx, {
    kind: 'manual',
    subject: 'Notiz von Hand',
    changes: [{ path: 'notes.md', content: 'x\n' }],
  });
  expect(r).toEqual({
    commit: await revParse(b.root, 'HEAD'),
    recorded: [],
    refs: {},
    notices: [],
    paths: ['notes.md'],
    verifyNotices: [],
  });
  expect((await logTrailers(b.root))[0]).toEqual({
    subject: 'Notiz von Hand',
    actor: 'spw',
    op: 'manual',
  });
  expect(await statusShort(b.root)).toEqual([]);
});

test('a no-op writes no commit', async () => {
  const id = await createdId();
  const before = await revParse(b.root, 'HEAD');
  const r = await executeWrite(ctx, {
    kind: 'op',
    op: { op: 'issue.edit', id, set: { title: { from: 'A', to: 'A' } } },
  });
  expect(r).toEqual({
    commit: undefined,
    recorded: [],
    refs: {},
    notices: [],
    paths: [],
    verifyNotices: [],
  });
  expect(await revParse(b.root, 'HEAD')).toBe(before);
});

test('a failure after writing restores the working copy', async () => {
  const err = await catchErrAsync(() =>
    executeWrite(ctx, CREATE, {
      hooks: {
        afterFiles: async () => {
          throw new BackeError('unexpected', 'boom');
        },
      },
    }),
  );
  expect(err.message).toBe('boom');
  expect(await statusShort(b.root)).toEqual([]);
  expect(await revParse(b.root, 'HEAD')).toBe(head);
  expect(await readdir(await stateDir(b.root))).not.toContain('write.journal');
  await executeWrite(ctx, CREATE);
  expect(await logTrailers(b.root)).toHaveLength(2);
});

test('SIGINT is deferred until the write finished', async () => {
  const raised: string[] = [];
  const listeners = process.listenerCount('SIGINT');
  await executeWrite(ctx, CREATE, {
    hooks: {
      afterFiles: async () => {
        expect(process.listenerCount('SIGINT')).toBe(listeners + 1);
        process.emit('SIGINT');
      },
    },
    raise: (s) => raised.push(s),
  });
  expect(raised).toEqual(['SIGINT']);
  expect(await statusShort(b.root)).toEqual([]);
  expect(await logTrailers(b.root)).toHaveLength(2);
  expect(process.listenerCount('SIGINT')).toBe(listeners);
});

test('SIGTERM during a failing write is raised after the rollback', async () => {
  const raised: string[] = [];
  const listeners = process.listenerCount('SIGTERM');
  const err = await catchErrAsync(() =>
    executeWrite(ctx, CREATE, {
      hooks: {
        afterFiles: async () => {
          process.emit('SIGTERM');
          throw new BackeError('unexpected', 'boom');
        },
      },
      raise: (s) => raised.push(s),
    }),
  );
  expect(err.message).toBe('boom');
  expect(raised).toEqual(['SIGTERM']);
  expect(await statusShort(b.root)).toEqual([]);
  expect(process.listenerCount('SIGTERM')).toBe(listeners);
});

test('without a signal nothing is raised', async () => {
  const raised: string[] = [];
  await executeWrite(ctx, CREATE, { raise: (s) => raised.push(s) });
  expect(raised).toEqual([]);
});

test('a journal left by a crash is rolled back by the next write', async () => {
  // Zustand wie nach einem SIGKILL zwischen Dateien und Commit.
  await writeFile(join(b.root, 'users/spw.md'), 'kaputt\n');
  await mkdir(join(b.root, 'projects'), { recursive: true });
  await writeFile(join(b.root, 'projects/web.md'), 'halb geschrieben\n');
  const journal = join(await stateDir(b.root), 'write.journal');
  await writeFile(journal, JSON.stringify({ head, paths: ['projects/web.md', 'users/spw.md'] }));

  const r = await executeWrite(ctx, CREATE);
  expect(await statusShort(b.root)).toEqual([]);
  expect(await git(['show', 'HEAD:users/spw.md'], { cwd: b.root })).toMatchObject({
    stdout: await readFile(join(b.root, 'users/spw.md'), 'utf8'),
  });
  expect(r.commit).toBe(await revParse(b.root, 'HEAD'));
  expect(await revParse(b.root, 'HEAD~1')).toBe(head);
  expect(await readdir(await stateDir(b.root))).not.toContain('write.journal');
});

test('a comment op sees the comments on disk', async () => {
  const id = await createdId();
  const added = await executeWrite(ctx, { kind: 'op', op: { op: 'comment.add', id, body: 'x' } });
  const { file } = added.recorded[0] as Extract<Operation, { op: 'comment.add' }>;
  const r = await executeWrite(ctx, {
    kind: 'op',
    op: { op: 'comment.delete', id, file: file as string },
  });
  expect(r.paths).toEqual([`${commentsDir(id)}/${file}`]);
  expect(await statusShort(b.root)).toEqual([]);
});

test('an unreadable journal stops the write before anything is written', async () => {
  await mkdir(join(await stateDir(b.root), 'write.journal'));
  await expect(executeWrite(ctx, CREATE)).rejects.toMatchObject({ code: 'EISDIR' });
  expect(await revParse(b.root, 'HEAD')).toBe(head);
  expect(await statusShort(b.root)).toEqual([]);
});

test('a journal is not recovered while an operation runs', async () => {
  await writeFile(join(b.root, 'users/spw.md'), 'kaputt\n');
  const journal = join(await stateDir(b.root), 'write.journal');
  await writeFile(journal, JSON.stringify({ head, paths: ['users/spw.md'] }));
  await mkdir(join(b.root, '.git', 'rebase-merge'));
  const err = await catchErrAsync(() => executeWrite(ctx, CREATE));
  expect(err.code).toBe('conflict');
  expect(err.message).toBe(`Unterbrochener Write in ${b.root} kann nicht zurückgesetzt werden`);
  expect(err.hint).toBe(`git -C ${b.root} status prüfen, dann ${journal} löschen`);
  expect(await readFile(join(b.root, 'users/spw.md'), 'utf8')).toBe('kaputt\n');
  expect(await readdir(await stateDir(b.root))).toContain('write.journal');
  expect(await revParse(b.root, 'HEAD')).toBe(head);
});

test('a journal whose commit already landed is recovered', async () => {
  const id = await createdId();
  const file = issueFile(id);
  // Absturz nach dem Commit, bevor der Index für die Pfade angeglichen wurde.
  await git(['rm', '-q', '--cached', '--', file], { cwd: b.root });
  const journal = join(await stateDir(b.root), 'write.journal');
  await writeFile(journal, JSON.stringify({ head, paths: [file] }));
  await executeWrite(ctx, CREATE_B);
  expect(await statusShort(b.root)).toEqual([]);
  expect(await logTrailers(b.root)).toHaveLength(3);
  expect(await readdir(await stateDir(b.root))).not.toContain('write.journal');
});

test('a journal from an unrelated head is a conflict and stays', async () => {
  const journal = join(await stateDir(b.root), 'write.journal');
  await writeFile(journal, JSON.stringify({ head: 'a'.repeat(40), paths: ['users/spw.md'] }));
  const err = await catchErrAsync(() => executeWrite(ctx, CREATE));
  expect(err.code).toBe('conflict');
  expect(await readdir(await stateDir(b.root))).toContain('write.journal');
  expect(await revParse(b.root, 'HEAD')).toBe(head);
});

test('a manual write by a handle that is no user is refused', async () => {
  const bob = await testKey('bob');
  await writeLocalState(b.root, 'identity', 'bob');
  const asBob: ResolvedContext = {
    ...ctx,
    backlog: { ...ctx.backlog, boundTo: 'bob' },
    user: { ...ctx.user, value: 'bob', key: bob.priv },
  };
  const err = await catchErrAsync(() =>
    executeWrite(asBob, {
      kind: 'manual',
      subject: 'fremd',
      changes: [{ path: 'notes.md', content: 'x\n' }],
    }),
  );
  expect(err.code).toBe('validation');
  expect(err.message).toBe('Akteur "bob" ist kein User dieses Backlogs');
  expect(await statusShort(b.root)).toEqual([]);
  expect(await revParse(b.root, 'HEAD')).toBe(head);
});

test('a hand edit on an affected path is a conflict and stays untouched', async () => {
  const id = await createdId();
  const before = await revParse(b.root, 'HEAD');
  const file = issueFile(id);
  await appendFile(join(b.root, file), 'von Hand\n');
  const edited = await readFile(join(b.root, file), 'utf8');
  const err = await catchErrAsync(() =>
    executeWrite(ctx, {
      kind: 'op',
      op: { op: 'issue.edit', id, set: { title: { from: 'A', to: 'B' } } },
    }),
  );
  expect(err.code).toBe('conflict');
  expect(err.message).toBe(`Ungesicherte Änderungen an ${file}`);
  expect(err.hint).toBe(`backe commit, oder git -C ${b.root} restore -- ${file}`);
  expect(await readFile(join(b.root, file), 'utf8')).toBe(edited);
  expect(await revParse(b.root, 'HEAD')).toBe(before);
});

test('a hand edit elsewhere stays uncommitted', async () => {
  const original = await readFile(join(b.root, 'users/spw.md'), 'utf8');
  await appendFile(join(b.root, 'users/spw.md'), '\nNotiz\n');
  await executeWrite(ctx, CREATE);
  expect(await statusShort(b.root)).toEqual([' M users/spw.md']);
  expect((await git(['show', 'HEAD:users/spw.md'], { cwd: b.root })).stdout).toBe(original);
});

test('concurrent writes are serialized', async () => {
  await Promise.all([executeWrite(ctx, CREATE_A), executeWrite(ctx, CREATE_B)]);
  expect((await logTrailers(b.root)).length).toBe(3); // Anker + zwei, linear
  const parents = await git(['log', '--format=%P'], { cwd: b.root });
  expect(parents.stdout.split('\n').every((line) => !line.includes(' '))).toBe(true);
  expect(await statusShort(b.root)).toEqual([]);
});

test('a working copy of another identity is refused with the own path', async () => {
  await writeLocalState(b.root, 'identity', 'bob');
  const err = await catchErrAsync(() => executeWrite(ctx, CREATE));
  const own = workingCopyPath(ctx.userConfig, ctx.homes, 'acme', 'spw');
  expect(err.code).toBe('usage');
  expect(err.message).toBe(
    `Die Arbeitskopie ${b.root} gehört "bob"; die Arbeitskopie von "spw" ist ${own}`,
  );
  expect(await revParse(b.root, 'HEAD')).toBe(head);
});

test('a missing identity file is set by the first write', async () => {
  await rm(join(await stateDir(b.root), 'identity'));
  await executeWrite(ctx, CREATE);
  expect(await readLocalState(b.root, 'identity')).toBe('spw');
});

test('a detached HEAD is a conflict', async () => {
  await git(['checkout', '-q', '--detach'], { cwd: b.root });
  const err = await catchErrAsync(() => executeWrite(ctx, CREATE));
  expect(err.code).toBe('conflict');
  expect(await revParse(b.root, 'HEAD')).toBe(head);
  expect(await statusShort(b.root)).toEqual([]);
});

test('a newer backlog format refuses writes', async () => {
  const config = await readFile(join(b.root, '.backe/backlog.jsonc'), 'utf8');
  await rawCommit(b.root, {
    files: { '.backe/backlog.jsonc': config.replace('"version": 1', '"version": 2') },
  });
  const before = await revParse(b.root, 'HEAD');
  const err = await catchErrAsync(() => executeWrite(ctx, CREATE));
  expect(err.code).toBe('validation');
  expect(err.message).toBe('Backlog-Format 2 ist neuer als dieses backe (1)');
  expect(err.hint).toBe('backe aktualisieren; lesen geht weiter.');
  expect(await revParse(b.root, 'HEAD')).toBe(before);
});

test('a writer without key or working copy fails before the lock', async () => {
  const lock = join(await stateDir(b.root), 'write.lock');
  const missing = join(await tempDir(), 'gone');
  const errs = await withFileLock(lock, async () => [
    await catchErrAsync(() =>
      executeWrite({ ...ctx, user: { ...ctx.user, key: undefined } }, CREATE, {
        lock: { timeoutMs: 0 },
      }),
    ),
    await catchErrAsync(async () =>
      executeWrite(await b.context({ as: 'bob' }), CREATE, { lock: { timeoutMs: 0 } }),
    ),
    await catchErrAsync(() =>
      executeWrite(
        {
          ...ctx,
          userConfig: { ...ctx.userConfig, backlogs: { acme: { paths: { spw: missing } } } },
          backlog: { ...ctx.backlog, workingCopy: missing },
        },
        CREATE,
        { lock: { timeoutMs: 0 } },
      ),
    ),
  ]);
  expect(errs.map((e) => e.code)).toEqual(['usage', 'usage', 'not_found']);
  expect(errs[2]?.message).toBe(`Arbeitskopie ${missing} fehlt`);
});

test('a symlinked issues directory is refused and nothing is committed', async () => {
  const outside = await tempDir();
  await symlink(outside, join(b.root, 'issues'));
  const err = await catchErrAsync(() => executeWrite(ctx, CREATE));
  expect(err.code).toBe('validation');
  expect(await revParse(b.root, 'HEAD')).toBe(head);
  expect(await readdir(outside)).toEqual([]);

  await rm(join(b.root, 'issues'));
  await executeWrite(ctx, CREATE);
  expect(await statusShort(b.root)).toEqual([]);
});

test('re-adding a removed user takes the history into account', async () => {
  const bob = await testKey('bob');
  const bot = await testKey('bot');
  const addBot: Operation = {
    op: 'user.add',
    handle: 'bot',
    name: 'Bot',
    kind: 'agent',
    operator: 'bob',
    keys: [bot.line],
  };
  await executeWrite(ctx, {
    kind: 'batch',
    ops: [{ op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [bob.line] }, addBot],
  });
  await executeWrite(ctx, { kind: 'op', op: { op: 'user.rm', handle: 'bot' } });

  await writeLocalState(b.root, 'identity', 'bob');
  const asBob: ResolvedContext = {
    ...ctx,
    backlog: { ...ctx.backlog, boundTo: 'bob' },
    user: { ...ctx.user, value: 'bob', key: bob.priv },
  };
  const err = await catchErrAsync(() => executeWrite(asBob, { kind: 'op', op: addBot }));
  expect(err.code).toBe('validation');
  expect(err.message).toBe('bob darf den User bot nicht neu anlegen');
});

describe('another identity', () => {
  let claude: TestKey;

  /** spw legt den Agent claude-1 an; ohne Remote bleibt der Stand lokal. */
  async function addClaude(backlog: TestBacklog): Promise<ResolvedContext> {
    claude = await testKey('claude-1');
    await executeWrite(await backlog.context(), {
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
    if (backlog.remote !== undefined) {
      await git(['push', '-q', 'origin', 'main'], { cwd: backlog.root });
    }
    await setIdentity(backlog.homes, 'acme', 'claude-1', claude.priv);
    return backlog.context({ as: 'claude-1', backlog: 'acme' });
  }

  test('the first write of another identity clones its own working copy with --reference', async () => {
    const remote = await testBacklog({ remote: true });
    const asClaude = await addClaude(remote);
    const before = await revParse(remote.root, 'HEAD');
    const r = await executeWrite(asClaude, CREATE);
    const wc = managedClonePath(remote.homes, 'acme', 'claude-1');
    expect(await readFile(join(wc, '.git/objects/info/alternates'), 'utf8')).toContain(
      join(remote.root, '.git/objects'),
    );
    expect(await readLocalState(wc, 'identity')).toBe('claude-1');
    expect(await readLocalState(wc, 'anchor')).toBe(await readLocalState(remote.root, 'anchor'));
    expect(await revParse(wc, 'HEAD')).toBe(r.commit);
    expect(await sigOf(wc, r.commit as string, { spw: remote.key, 'claude-1': claude })).toEqual([
      'G',
      'claude-1',
    ]);
    expect(await revParse(remote.root, 'HEAD')).toBe(before); // fremde Arbeitskopie unberührt
    expect(r.verifyNotices).toEqual([]);
  });

  test('an automatic clone in warn mode reports the reasons in the write result', async () => {
    const remote = await testBacklog({ remote: true });
    const config = await readFile(join(remote.root, '.backe/backlog.jsonc'), 'utf8');
    await executeWrite(await remote.context(), {
      kind: 'manual',
      subject: 'verify: warn',
      changes: [
        {
          path: '.backe/backlog.jsonc',
          content: config.replace(/\n}\n$/, ',\n  "verify": "warn"\n}\n'),
        },
      ],
    });
    const asClaude = await addClaude(remote);
    const bad = await rawCommit(remote.root, {
      files: { 'notes.md': 'x\n' },
      actor: 'spw',
      op: 'manual',
    });
    await git(['push', '-q', 'origin', 'main'], { cwd: remote.root });
    const r = await executeWrite(asClaude, CREATE);
    expect(r.verifyNotices).toEqual([`${bad.slice(0, 7)}: unsigniert`]);
    expect(r.commit).toBe(
      await revParse(managedClonePath(remote.homes, 'acme', 'claude-1'), 'HEAD'),
    );
  });

  test('a backlog without remote clones the new identity from the existing working copy', async () => {
    const asClaude = await addClaude(b);
    const before = await revParse(b.root, 'HEAD');
    const r = await executeWrite(asClaude, CREATE);
    const wc = managedClonePath(b.homes, 'acme', 'claude-1');
    expect(await readLocalState(wc, 'identity')).toBe('claude-1');
    expect(await readLocalState(wc, 'verified')).toBe(before);
    expect((await git(['rev-parse', 'HEAD~1'], { cwd: wc })).stdout.trim()).toBe(before);
    expect(r.commit).toBe(await revParse(wc, 'HEAD'));
    expect(await revParse(b.root, 'HEAD')).toBe(before);
  });
});

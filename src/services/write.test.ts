import { constants } from 'node:fs';
import {
  access,
  appendFile,
  mkdir,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
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
import { userConfigPath } from '../context/user-config.ts';
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
import { attachmentsDir, commentsDir, issueFile, LFS_RULE, QUARANTINE } from '../store/layout.ts';
import { verifyRange } from './verify.ts';
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
  const commit = await revParse(b.root, 'HEAD');
  expect(r).toEqual({
    commit,
    recorded: [],
    refs: {},
    notices: [],
    paths: ['notes.md'],
    verifyNotices: [],
    chain: [{ commit, kind: 'manual', recorded: [], paths: ['notes.md'] }],
    warnings: [],
    rewritten: [],
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
    chain: [],
    warnings: [],
    rewritten: [],
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

test('a failure after the commit landed reports the write as done', async () => {
  const r = await executeWrite(ctx, CREATE, {
    hooks: {
      afterCommit: async () => {
        throw new BackeError('unexpected', 'boom');
      },
    },
  });
  expect(r.commit).toBe(await revParse(b.root, 'HEAD'));
  expect(await revParse(b.root, 'HEAD^')).toBe(head);
  expect(r.recorded).toHaveLength(1);
  expect(await readdir(await stateDir(b.root))).not.toContain('write.journal');
  expect(await statusShort(b.root)).toEqual([]);
});

test('a foreign commit on the same base is no landed write', async () => {
  const err = await catchErrAsync(() =>
    executeWrite(ctx, CREATE, {
      hooks: {
        afterFiles: async () => {
          const tree = (await git(['rev-parse', `${head}^{tree}`], { cwd: b.root })).stdout.trim();
          const foreign = await git(['commit-tree', tree, '-p', head, '-m', 'fremd'], {
            cwd: b.root,
            env: {
              GIT_AUTHOR_NAME: 'x',
              GIT_AUTHOR_EMAIL: 'x@x.invalid',
              GIT_COMMITTER_NAME: 'x',
              GIT_COMMITTER_EMAIL: 'x@x.invalid',
            },
          });
          await git(['update-ref', 'HEAD', foreign.stdout.trim()], { cwd: b.root });
        },
      },
    }),
  );
  expect(err.code).toBe('conflict');
  expect(await statusShort(b.root)).toEqual([]);
});

test('a foreign commit with the same tree but another actor or subject is not taken as landed', async () => {
  for (const foreign of [
    { actor: 'bob', subject: 'Issue A angelegt' },
    { actor: 'spw', subject: 'fremd' },
  ]) {
    const base = await revParse(b.root, 'HEAD');
    const err = await catchErrAsync(() =>
      executeWrite(ctx, CREATE, {
        now: () => NOW,
        randomBytes: seqBytes(),
        hooks: {
          afterCommit: async () => {
            await git(['reset', '--soft', base], { cwd: b.root });
            const tree = (await git(['write-tree'], { cwd: b.root })).stdout.trim();
            const msg = `${foreign.subject}\n\nBacke-Actor: ${foreign.actor}\n`;
            const c = await git(['commit-tree', tree, '-p', base, '-m', msg], {
              cwd: b.root,
              env: {
                GIT_AUTHOR_NAME: 'x',
                GIT_AUTHOR_EMAIL: 'x@x.invalid',
                GIT_COMMITTER_NAME: 'x',
                GIT_COMMITTER_EMAIL: 'x@x.invalid',
              },
            });
            await git(['update-ref', 'HEAD', c.stdout.trim()], { cwd: b.root });
            throw new BackeError('unexpected', 'boom');
          },
        },
      }),
    );
    expect(err.message).toBe('boom');
    await git(['reset', '--hard', base], { cwd: b.root });
  }
});

test('derive builds the operation against the locked snapshot', async () => {
  const r = await executeWrite(ctx, {
    kind: 'derive',
    derive: (s, actor) => ({ op: 'issue.create', title: `von ${actor} bei ${s.issues.size}` }),
  });
  expect(r.recorded[0]).toMatchObject({ op: 'issue.create', title: 'von spw bei 0' });
  expect(await logTrailers(b.root)).toHaveLength(2);
  expect((await git(['log', '-1', '--format=%s'], { cwd: b.root })).stdout.trim()).toBe(
    summarizeOp(r.recorded[0] as Operation),
  );
});

test('a throwing derive writes nothing', async () => {
  const err = await catchErrAsync(() =>
    executeWrite(ctx, {
      kind: 'derive',
      derive: () => {
        throw new BackeError('validation', 'nein');
      },
    }),
  );
  expect(err.message).toBe('nein');
  expect(await revParse(b.root, 'HEAD')).toBe(head);
  expect(await statusShort(b.root)).toEqual([]);
  expect(await readdir(await stateDir(b.root))).not.toContain('write.journal');
});

test('a committed .gitignore does not keep a write from committing its file', async () => {
  await rawCommit(b.root, { files: { '.gitignore': '*.md\n' }, key: b.key, actor: 'spw' });
  const r = await executeWrite(ctx, CREATE);
  const [path] = r.paths;
  expect(
    (await git(['ls-tree', '--name-only', 'HEAD', '--', path as string], { cwd: b.root })).stdout,
  ).toBe(`${path}\n`);
});

describe('the signing key', () => {
  test('a revoked key of the writer is a usage error and writes nothing', async () => {
    const bob = await testKey('bob');
    const spare = await testKey('bob-spare');
    await executeWrite(ctx, {
      kind: 'op',
      op: {
        op: 'user.add',
        handle: 'bob',
        name: 'Bob',
        kind: 'human',
        keys: [bob.line, spare.line],
      },
    });
    await executeWrite(ctx, {
      kind: 'op',
      op: { op: 'user.revoke_key', handle: 'bob', key: bob.line },
    });
    await writeLocalState(b.root, 'identity', 'bob');
    const before = await revParse(b.root, 'HEAD');
    const asBob: ResolvedContext = {
      ...ctx,
      backlog: { ...ctx.backlog, boundTo: 'bob' },
      user: { ...ctx.user, value: 'bob', key: bob.priv },
    };
    const err = await catchErrAsync(() => executeWrite(asBob, CREATE));
    expect(err).toMatchObject({
      code: 'usage',
      message: `Der Key ${bob.priv} ist kein aktiver Key von bob`,
      hint: `identities.acme.bob.key in ${userConfigPath(b.homes.backeHome)} prüfen`,
    });
    expect(await revParse(b.root, 'HEAD')).toBe(before);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('a writer whose only key was revoked is a usage error', async () => {
    const bob = await testKey('bob-solo');
    await executeWrite(ctx, {
      kind: 'op',
      op: { op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [bob.line] },
    });
    await executeWrite(ctx, {
      kind: 'op',
      op: { op: 'user.revoke_key', handle: 'bob', key: bob.line },
    });
    await writeLocalState(b.root, 'identity', 'bob');
    const before = await revParse(b.root, 'HEAD');
    const asBob: ResolvedContext = {
      ...ctx,
      backlog: { ...ctx.backlog, boundTo: 'bob' },
      user: { ...ctx.user, value: 'bob', key: bob.priv },
    };
    const err = await catchErrAsync(() => executeWrite(asBob, CREATE));
    expect(err).toMatchObject({
      code: 'usage',
      message: `Der Key ${bob.priv} ist kein aktiver Key von bob`,
    });
    expect(await revParse(b.root, 'HEAD')).toBe(before);
  });

  test('a write with an open invalid commit refuses a key that verify would refuse', async () => {
    const fresh = await testKey('spw-fresh');
    const file = await readFile(join(b.root, 'users/spw.md'), 'utf8');
    // Unsigniert und damit ungültig: Für verify gilt der neue Key nicht.
    const widened = file.replace(b.key.line, `${b.key.line}, ${fresh.line}`);
    expect(widened).not.toBe(file);
    await rawCommit(b.root, { files: { 'users/spw.md': widened }, actor: 'spw', op: 'manual' });
    const before = await revParse(b.root, 'HEAD');
    const err = await catchErrAsync(() =>
      executeWrite({ ...ctx, user: { ...ctx.user, key: fresh.priv } }, CREATE),
    );
    expect(err).toMatchObject({
      code: 'usage',
      message: `Der Key ${fresh.priv} ist kein aktiver Key von spw`,
    });
    expect(await revParse(b.root, 'HEAD')).toBe(before);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('a key of another user is a usage error', async () => {
    const bob = await testKey('bob');
    await executeWrite(ctx, {
      kind: 'op',
      op: { op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [bob.line] },
    });
    const err = await catchErrAsync(() =>
      executeWrite({ ...ctx, user: { ...ctx.user, key: bob.priv } }, CREATE),
    );
    expect(err).toMatchObject({
      code: 'usage',
      message: `Der Key ${bob.priv} ist kein aktiver Key von spw`,
    });
  });
});

test('a write on a path changed by an open invalid commit is refused', async () => {
  const id = await createdId();
  const file = issueFile(id);
  const content = await readFile(join(b.root, file), 'utf8');
  const bad = await rawCommit(b.root, {
    files: { [file]: content.replace('title: A', 'title: X') },
    actor: 'spw',
    op: 'manual',
  });
  const before = await revParse(b.root, 'HEAD');
  const reason = `baut auf ungültigem Commit ${bad.slice(0, 7)} auf`;
  const err = await catchErrAsync(() =>
    executeWrite(ctx, {
      kind: 'op',
      op: { op: 'issue.edit', id, set: { title: { from: 'X', to: 'Y' } } },
    }),
  );
  expect(err).toMatchObject({
    code: 'validation',
    message: `verify würde den Commit ablehnen: ${reason}`,
    details: { reasons: [reason] },
  });
  expect(await revParse(b.root, 'HEAD')).toBe(before);
  expect(await statusShort(b.root)).toEqual([]);
  // Pfade, die der ungültige Commit nicht berührt hat, bleiben schreibbar.
  await executeWrite(ctx, CREATE_B);
  expect(await revParse(b.root, 'HEAD^')).toBe(before);
});

test('an op while frozen is checked against the frozen state', async () => {
  const bob = await testKey('bob-op');
  await executeWrite(ctx, {
    kind: 'op',
    op: { op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [bob.line] },
  });
  // bob macht sich selbst zum Admin; der Commit ist ungültig, der Stand davor eingefroren.
  const config = await readFile(join(b.root, '.backe/backlog.jsonc'), 'utf8');
  const widened = config.replace(
    '"admins": [\n    "spw"\n  ]',
    '"admins": [\n    "spw",\n    "bob"\n  ]',
  );
  expect(widened).not.toBe(config);
  await rawCommit(b.root, {
    files: { '.backe/backlog.jsonc': widened },
    key: bob,
    actor: 'bob',
    op: 'manual',
  });
  await writeLocalState(b.root, 'identity', 'bob');
  const asBob: ResolvedContext = {
    ...ctx,
    backlog: { ...ctx.backlog, boundTo: 'bob' },
    user: { ...ctx.user, value: 'bob', key: bob.priv },
  };
  const xena = await testKey('xena');
  const before = await revParse(b.root, 'HEAD');

  const err = await catchErrAsync(() =>
    executeWrite(asBob, {
      kind: 'op',
      op: { op: 'user.add', handle: 'xena', name: 'Xena', kind: 'human', keys: [xena.line] },
    }),
  );
  expect(err).toMatchObject({
    code: 'validation',
    message: 'verify würde den Commit ablehnen: bob darf den User xena nicht anlegen',
  });
  expect(await revParse(b.root, 'HEAD')).toBe(before);
  expect(await statusShort(b.root)).toEqual([]);
});

test('a write below the last verified state still succeeds', async () => {
  await executeWrite(ctx, CREATE);
  await verifyRange(b.root, { record: true });
  await git(['reset', '-q', '--hard', 'HEAD~1'], { cwd: b.root });
  const r = await executeWrite(ctx, CREATE_B);
  expect(r.commit).toBe(await revParse(b.root, 'HEAD'));
  expect(await revParse(b.root, 'HEAD^')).toBe(head);
});

test('SIGINT is deferred until the write finished', async () => {
  const raised: string[] = [];
  const listeners = process.listenerCount('SIGINT');
  await executeWrite(ctx, CREATE, {
    hooks: {
      afterFiles: async () => {
        // Fremde Listener sind abgehängt; nur der eigene merkt sich das Signal.
        expect(process.listenerCount('SIGINT')).toBe(1);
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
  expect(err.message).toBe('Akteur »bob« ist kein User dieses Backlogs');
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
  expect(err.hint).toBe(
    `git -C ${b.root} stash, oder git -C ${b.root} restore --staged --worktree -- ${file}`,
  );
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
    `Die Arbeitskopie ${b.root} gehört »bob«; die Arbeitskopie von »spw« ist ${own}`,
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

  test('a clone in warn mode that inherits a frozen base still refuses tainted paths', async () => {
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
    const asClaude = await addClaude(b);
    const id = await createdId();
    const content = await readFile(join(b.root, issueFile(id)), 'utf8');
    const bad = await rawCommit(b.root, {
      files: { [issueFile(id)]: content.replace('title: A', 'title: X') },
      actor: 'spw',
      op: 'manual',
    });
    // Die vertraute Arbeitskopie kennt einen Remote-Stand nach dem ungültigen Commit; der Clone
    // übernimmt ihn als `verified`, obwohl der Stand dort eingefroren ist.
    await writeLocalState(b.root, 'upstream', bad);
    const first = await executeWrite(asClaude, CREATE_B);
    // Ohne Remote klont der Agent über den lokalen Hub; der ist ein Hinweis, keine Warnung.
    expect(first.verifyNotices).toEqual([`${bad.slice(0, 7)}: unsigniert`]);
    expect(first.notices).toEqual([
      {
        code: 'hub_created',
        message: expect.stringMatching(/^Lokaler Hub .* angelegt; /),
        ids: [],
      },
    ]);
    const wc = managedClonePath(b.homes, 'acme', 'claude-1');
    expect(await readLocalState(wc, 'verified')).toBe(bad);
    const before = await revParse(wc, 'HEAD');

    const err = await catchErrAsync(() =>
      executeWrite(asClaude, {
        kind: 'op',
        op: { op: 'issue.edit', id, set: { title: { from: 'X', to: 'Y' } } },
      }),
    );
    expect(err).toMatchObject({
      code: 'validation',
      message: `verify würde den Commit ablehnen: baut auf ungültigem Commit ${bad.slice(0, 7)} auf`,
    });
    expect(await revParse(wc, 'HEAD')).toBe(before);
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

describe('derive with several operations', () => {
  test('derive with two operations writes one batch commit', async () => {
    const r = await executeWrite(
      ctx,
      {
        kind: 'derive',
        derive: () => [
          { op: 'issue.create', title: 'A' },
          { op: 'issue.create', title: 'B' },
        ],
      },
      { now: () => NOW, randomBytes: seqBytes() },
    );
    expect(r.recorded).toHaveLength(2);
    const [last] = await logTrailers(b.root);
    expect(last).toEqual({ subject: summarizeBatch(r.recorded), actor: 'spw', op: 'batch' });
    expect(r.chain).toEqual([
      { commit: r.commit, kind: 'batch', recorded: r.recorded, paths: r.paths },
    ]);
    expect(await logTrailers(b.root)).toHaveLength(2);
  });

  test('derive with one operation in an array writes an op commit', async () => {
    const r = await executeWrite(ctx, {
      kind: 'derive',
      derive: () => [{ op: 'issue.create', title: 'A' }],
    });
    expect((await logTrailers(b.root))[0]?.op).toBe(encodeOp(r.recorded[0] as Operation));
    expect(r.chain.map((c) => c.kind)).toEqual(['op']);
  });

  test('derive with no operation writes nothing', async () => {
    const r = await executeWrite(ctx, { kind: 'derive', derive: () => [] });
    expect(r.commit).toBeUndefined();
    expect(r.chain).toEqual([]);
    expect(await revParse(b.root, 'HEAD')).toBe(head);
  });
});

describe('expectHead', () => {
  test('a manual write with a stale expectHead is a conflict', async () => {
    await executeWrite(ctx, CREATE);
    const err = await catchErrAsync(() =>
      executeWrite(ctx, {
        kind: 'manual',
        subject: 'spät',
        changes: [{ path: 'notes.md', content: 'x\n' }],
        expectHead: head,
      }),
    );
    expect(err.code).toBe('conflict');
    expect(err.message).toBe('Stand hat sich seit der Prüfung geändert');
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('a manual write with the current expectHead commits', async () => {
    const r = await executeWrite(ctx, {
      kind: 'manual',
      subject: 'pünktlich',
      changes: [{ path: 'notes.md', content: 'x\n' }],
      expectHead: head,
    });
    expect(await revParse(b.root, 'HEAD^')).toBe(head);
    expect(r.chain).toEqual([
      { commit: r.commit, kind: 'manual', recorded: [], paths: ['notes.md'] },
    ]);
  });
});

describe('edits', () => {
  const read = (path: string) => readFile(join(b.root, path), 'utf8');
  const write = async (path: string, content: string) => {
    await mkdir(join(b.root, path, '..'), { recursive: true });
    await writeFile(join(b.root, path), content);
  };
  const edit = async (path: string, fn: (s: string) => string) => {
    const before = await read(path);
    const after = fn(before);
    expect(after).not.toBe(before);
    await write(path, after);
  };
  const show = async (spec: string) => (await git(['show', spec], { cwd: b.root })).stdout;
  const EDITS: WriteInput = { kind: 'edits' };

  async function issues(...titles: string[]): Promise<string[]> {
    const r = await executeWrite(ctx, {
      kind: 'batch',
      ops: titles.map((title) => ({ op: 'issue.create', title }) as Operation),
    });
    return r.recorded.map((op) => (op as { id: string }).id);
  }

  test('edits: field changes become operations, unknown keys become manual first', async () => {
    const [a, bb] = (await issues('A', 'B')) as [string, string];
    const base = await revParse(b.root, 'HEAD');
    await edit(issueFile(a), (s) => s.replace('title: A', 'title: A2\nassignee: xena'));
    await edit(issueFile(bb), (s) => s.replace('title: B', 'title: B\nfoo: bar'));
    await write('users/xena.md', '---\nname: Xena\nkind: human\n---\n');

    const r = await executeWrite(ctx, EDITS, { now: () => NOW });
    expect(r.chain).toMatchObject([
      { kind: 'manual', recorded: [], paths: [issueFile(bb), 'users/xena.md'].sort() },
      {
        kind: 'op',
        recorded: [
          {
            op: 'issue.edit',
            id: a,
            set: { title: { from: 'A', to: 'A2' }, assignee: { to: 'xena' } },
          },
        ],
        paths: [issueFile(a)],
      },
    ]);
    const [manual, op] = r.chain as [(typeof r.chain)[0], (typeof r.chain)[0]];
    expect(r.commit).toBe(op.commit);
    expect(await revParse(b.root, 'HEAD')).toBe(op.commit);
    expect(await revParse(b.root, 'HEAD^')).toBe(manual.commit);
    expect(await revParse(b.root, 'HEAD^^')).toBe(base);
    expect(r.recorded).toEqual(op.recorded);
    expect(r.paths).toEqual([issueFile(a), issueFile(bb), 'users/xena.md'].sort());
    expect(r.warnings).toEqual([{ path: issueFile(bb), unknownKeys: ['foo'] }]);
    expect(r.rewritten).toEqual([]);
    expect((await logTrailers(b.root)).slice(0, 2)).toEqual([
      {
        subject: summarizeOp(op.recorded[0] as Operation),
        actor: 'spw',
        op: encodeOp(op.recorded[0] as Operation),
      },
      { subject: 'manual: 2 Dateien', actor: 'spw', op: 'manual' },
    ]);
    expect(await sigOf(b.root, 'HEAD', { spw: b.key })).toEqual(['G', 'spw']);
    expect(await sigOf(b.root, 'HEAD^', { spw: b.key })).toEqual(['G', 'spw']);
    expect(await show(`HEAD^:${issueFile(a)}`)).toBe(await show(`${base}:${issueFile(a)}`));
    expect(await show(`HEAD:${issueFile(bb)}`)).toContain('foo: bar');
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('edits: a subject names the manual commit', async () => {
    await write('notes.md', 'Notiz\n');
    const r = await executeWrite(ctx, { kind: 'edits', subject: 'Notizen' });
    expect((await logTrailers(b.root))[0]).toEqual({
      subject: 'Notizen',
      actor: 'spw',
      op: 'manual',
    });
    expect(r.chain.map((c) => c.kind)).toEqual(['manual']);
  });

  test('edits: several operations become one batch commit', async () => {
    const [a, bb] = (await issues('A', 'B')) as [string, string];
    await edit(issueFile(a), (s) => s.replace('title: A', 'title: A2'));
    await edit(issueFile(bb), (s) => s.replace('title: B', 'title: B2'));
    const r = await executeWrite(ctx, EDITS);
    expect(r.chain.map((c) => c.kind)).toEqual(['batch']);
    expect((await logTrailers(b.root))[0]).toEqual({
      subject: summarizeBatch(r.recorded),
      actor: 'spw',
      op: 'batch',
    });
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('edits: an invalid operation lands neither commit', async () => {
    const [a, bb] = (await issues('A', 'B')) as [string, string];
    const before = await revParse(b.root, 'HEAD');
    await edit(issueFile(a), (s) => s.replace('title: A', `title: A\ndepends_on: [${bb}]`));
    await edit(issueFile(bb), (s) => s.replace('title: B', `title: B\ndepends_on: [${a}]`));
    await write('notes.md', 'Notiz\n');
    const edited = await Promise.all([issueFile(a), issueFile(bb), 'notes.md'].map(read));

    const err = await catchErrAsync(() => executeWrite(ctx, EDITS));
    expect(err.code).toBe('validation');
    expect(err.message).toMatch(/^Zyklus in depends_on: /);
    expect(err.details).toEqual({ reason: 'cycle', ids: expect.any(Array) });
    expect(err.hint).toBe('Änderung auf zwei backe commit aufteilen');
    expect(await revParse(b.root, 'HEAD')).toBe(before);
    expect(await Promise.all([issueFile(a), issueFile(bb), 'notes.md'].map(read))).toEqual(edited);
    expect(await readdir(await stateDir(b.root))).not.toContain('write.journal');
  });

  test('edits: a violation with its own hint keeps that hint', async () => {
    await executeWrite(ctx, {
      kind: 'batch',
      ops: [
        { op: 'project.create', path: 'web', title: 'Web' },
        { op: 'project.create', path: 'web/sub', title: 'Sub' },
      ],
    });
    const before = await revParse(b.root, 'HEAD');
    await rm(join(b.root, 'projects/web.md'));
    const err = await catchErrAsync(() => executeWrite(ctx, EDITS));
    expect(err.code).toBe('conflict');
    expect(err.message).toBe('web hat Unterprojekte: web/sub');
    expect(err.details).toEqual({ reason: 'has_subprojects', ids: ['web/sub'] });
    expect(err.hint).toBe('Erst die Unterprojekte entfernen oder verschieben.');
    expect(await revParse(b.root, 'HEAD')).toBe(before);
    expect(await statusShort(b.root)).toEqual([' D projects/web.md']);
  });

  test('edits: a failure after writing restores the hand edits, not HEAD', async () => {
    const [a] = (await issues('A')) as [string];
    const before = await revParse(b.root, 'HEAD');
    await edit(issueFile(a), (s) => s.replace('title: A', 'title:   A2'));
    await write('notes.md', 'Notiz\n');
    const edited = await Promise.all([issueFile(a), 'notes.md'].map(read));
    const err = await catchErrAsync(() =>
      executeWrite(ctx, EDITS, {
        hooks: {
          afterFiles: async () => {
            // Die Dateien tragen schon den kanonischen Inhalt.
            expect(await read(issueFile(a))).toContain('title: A2\n');
            throw new BackeError('unexpected', 'boom');
          },
        },
      }),
    );
    expect(err.message).toBe('boom');
    expect(await revParse(b.root, 'HEAD')).toBe(before);
    expect(await Promise.all([issueFile(a), 'notes.md'].map(read))).toEqual(edited);
    expect(await readdir(await stateDir(b.root))).not.toContain('write.journal');
    expect(await statusShort(b.root)).toEqual([` M ${issueFile(a)}`, '?? notes.md']);
  });

  test('edits: a deleted issue directory is restored after a failure', async () => {
    const [a] = (await issues('A')) as [string];
    await executeWrite(ctx, { kind: 'op', op: { op: 'comment.add', id: a, body: 'bleibt' } });
    await rm(join(b.root, issueFile(a)));
    const err = await catchErrAsync(() =>
      executeWrite(ctx, EDITS, {
        hooks: {
          afterFiles: async () => {
            throw new BackeError('unexpected', 'boom');
          },
        },
      }),
    );
    expect(err.message).toBe('boom');
    expect(await statusShort(b.root)).toEqual([` D ${issueFile(a)}`]);
    expect(await readdir(join(b.root, commentsDir(a)))).toHaveLength(1);
  });

  test('edits: a failure after the chain landed reports the write as done', async () => {
    const [a] = (await issues('A')) as [string];
    const before = await revParse(b.root, 'HEAD');
    await edit(issueFile(a), (s) => s.replace('title: A', 'title: A2'));
    await write('notes.md', 'Notiz\n');
    const r = await executeWrite(ctx, EDITS, {
      hooks: {
        afterCommit: async () => {
          throw new BackeError('unexpected', 'boom');
        },
      },
    });
    expect(r.chain).toHaveLength(2);
    expect(r.commit).toBe(await revParse(b.root, 'HEAD'));
    expect(await revParse(b.root, 'HEAD~2')).toBe(before);
    expect(await statusShort(b.root)).toEqual([]);
    expect(await readdir(await stateDir(b.root))).not.toContain('write.journal');
  });

  test('edits: a journal of an interrupted chain brings the hand edits back', async () => {
    const [a] = (await issues('A')) as [string];
    await edit(issueFile(a), (s) => s.replace('title: A', 'title: A2'));
    const edited = await read(issueFile(a));
    const current = await revParse(b.root, 'HEAD');
    // Zustand wie nach einem SIGKILL zwischen Dateien und Commit.
    await write(issueFile(a), 'halb geschrieben\n');
    await write('notes.md', 'halb\n');
    await writeFile(
      join(await stateDir(b.root), 'write.journal'),
      JSON.stringify({
        head: current,
        paths: [issueFile(a), 'notes.md'],
        commits: 2,
        saved: [
          { path: issueFile(a), content: Buffer.from(edited).toString('base64') },
          { path: 'notes.md', content: null },
        ],
      }),
    );
    await executeWrite(ctx, CREATE_B);
    expect(await read(issueFile(a))).toBe(edited);
    expect(await statusShort(b.root)).toEqual([` M ${issueFile(a)}`]);
  });

  test('edits: a journal of a landed chain is recovered', async () => {
    const [a] = (await issues('A')) as [string];
    const before = await revParse(b.root, 'HEAD');
    await edit(issueFile(a), (s) => s.replace('title: A', 'title: A2'));
    await write('notes.md', 'Notiz\n');
    await executeWrite(ctx, EDITS);
    // Absturz nach dem Ref-Update, bevor der Index angeglichen wurde.
    await git(['rm', '-q', '--cached', '--', 'notes.md'], { cwd: b.root });
    await writeFile(
      join(await stateDir(b.root), 'write.journal'),
      JSON.stringify({
        head: before,
        paths: [issueFile(a), 'notes.md'],
        commits: 2,
        saved: [{ path: 'notes.md', content: null }],
      }),
    );
    await executeWrite(ctx, CREATE_B);
    expect(await statusShort(b.root)).toEqual([]);
    expect(await read('notes.md')).toBe('Notiz\n');
  });

  test('edits: a list reordered by hand is reset with a notice', async () => {
    const [x, y] = (await issues('X', 'Y')) as [string, string];
    const z = await createdId({
      kind: 'op',
      op: { op: 'issue.create', title: 'Z', depends_on: [x, y] },
    });
    const before = await revParse(b.root, 'HEAD');
    const committed = await read(issueFile(z));
    await edit(issueFile(z), (s) => s.replace(`[${x}, ${y}]`, `[${y}, ${x}]`));
    const r = await executeWrite(ctx, EDITS);
    expect(r.commit).toBeUndefined();
    expect(r.chain).toEqual([]);
    expect(r.rewritten).toEqual([{ path: issueFile(z), reason: 'no_effect' }]);
    expect(await read(issueFile(z))).toBe(committed);
    expect(await revParse(b.root, 'HEAD')).toBe(before);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('edits: a set operation rewrites list order canonically with a notice', async () => {
    const [x, y] = (await issues('X', 'Y')) as [string, string];
    const z = await createdId({
      kind: 'op',
      op: { op: 'issue.create', title: 'Z', depends_on: [x] },
    });
    await edit(issueFile(z), (s) => s.replace(`[${x}]`, `[${y}, ${x}]`));
    const r = await executeWrite(ctx, EDITS);
    expect(r.rewritten).toEqual([{ path: issueFile(z), reason: 'canonical' }]);
    expect(await read(issueFile(z))).toContain(`depends_on: [${x}, ${y}]`);
    expect(await show(`HEAD:${issueFile(z)}`)).toBe(await read(issueFile(z)));
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('edits: a broken file names file and line', async () => {
    const [a] = (await issues('A')) as [string];
    const before = await revParse(b.root, 'HEAD');
    await edit(issueFile(a), (s) => s.replace('title: A', 'title: [A'));
    const edited = await read(issueFile(a));
    const err = await catchErrAsync(() => executeWrite(ctx, EDITS));
    expect(err.code).toBe('validation');
    expect(err.message).toMatch(new RegExp(`^${issueFile(a)}:\\d+: `));
    expect(await revParse(b.root, 'HEAD')).toBe(before);
    expect(await read(issueFile(a))).toBe(edited);
  });

  test('edits: a hand-deleted parent project still sees its subprojects', async () => {
    await executeWrite(ctx, {
      kind: 'batch',
      ops: [
        { op: 'project.create', path: 'web', title: 'Web' },
        { op: 'project.create', path: 'web/sub', title: 'Sub' },
      ],
    });
    const before = await revParse(b.root, 'HEAD');
    await rm(join(b.root, 'projects/web.md'));
    const err = await catchErrAsync(() => executeWrite(ctx, EDITS));
    expect(err.details).toMatchObject({ reason: 'has_subprojects' });
    expect(await revParse(b.root, 'HEAD')).toBe(before);
  });

  test('edits: staged-only changes are committed and the index matches HEAD afterwards', async () => {
    const [a] = (await issues('A')) as [string];
    await edit(issueFile(a), (s) => s.replace('title: A', 'title: A2'));
    await git(['add', '--', issueFile(a)], { cwd: b.root });
    await executeWrite(ctx, EDITS);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('edits: a hand-edited config is a manual commit checked against the HEAD config', async () => {
    const config = await read('.backe/backlog.jsonc');
    await write(
      '.backe/backlog.jsonc',
      config.replace(/\n}\n$/, ',\n  "workflow": { "strict": true }\n}\n'),
    );
    const r = await executeWrite(ctx, EDITS);
    expect(r.chain).toMatchObject([{ kind: 'manual', paths: ['.backe/backlog.jsonc'] }]);
    expect(await show('HEAD:.backe/backlog.jsonc')).toContain('"strict": true');
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('edits: a comment edit sees the comments as they stand after the manual part', async () => {
    const [a] = (await issues('A')) as [string];
    const first = await executeWrite(ctx, {
      kind: 'op',
      op: { op: 'comment.add', id: a, body: 'eins' },
    });
    const second = await executeWrite(ctx, {
      kind: 'op',
      op: { op: 'comment.add', id: a, body: 'zwei' },
    });
    const file = (r: typeof first) =>
      `${commentsDir(a)}/${(r.recorded[0] as { file: string }).file}`;
    await edit(file(first), (s) => s.replace('eins', 'eins, korrigiert'));
    await edit(file(second), (s) => s.replace('---\n', '---\nfoo: bar\n'));
    const r = await executeWrite(ctx, EDITS);
    expect(r.chain).toMatchObject([
      { kind: 'manual', paths: [file(second)] },
      { kind: 'op', recorded: [{ op: 'comment.edit', id: a, body: 'eins, korrigiert\n' }] },
    ]);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('edits: a change only in the index is reset without a notice', async () => {
    const [a] = (await issues('A')) as [string];
    const committed = await read(issueFile(a));
    await edit(issueFile(a), (s) => s.replace('title: A', 'title: A2'));
    await git(['add', '--', issueFile(a)], { cwd: b.root });
    await write(issueFile(a), committed);
    const r = await executeWrite(ctx, EDITS);
    expect(r).toMatchObject({ commit: undefined, rewritten: [] });
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('edits: a file deleted by hand is a manual deletion', async () => {
    await executeWrite(ctx, {
      kind: 'manual',
      subject: 'Notiz',
      changes: [{ path: 'notes.md', content: 'x\n' }],
    });
    await rm(join(b.root, 'notes.md'));
    const r = await executeWrite(ctx, EDITS);
    expect(r.chain).toMatchObject([{ kind: 'manual', paths: ['notes.md'] }]);
    expect(
      (await git(['ls-tree', '--name-only', 'HEAD', '--', 'notes.md'], { cwd: b.root })).stdout,
    ).toBe('');
  });

  test('edits: a hand-edited sync.branch is checked against the branch from HEAD', async () => {
    const config = await read('.backe/backlog.jsonc');
    await write(
      '.backe/backlog.jsonc',
      config.replace(/\n}\n$/, ',\n  "sync": { "branch": "trunk" }\n}\n'),
    );
    const r = await executeWrite(ctx, EDITS);
    expect(r.chain).toMatchObject([{ kind: 'manual', paths: ['.backe/backlog.jsonc'] }]);
    expect(await show('HEAD:.backe/backlog.jsonc')).toContain('"branch": "trunk"');
  });

  test('edits: a failing reset after the commits is reported, not hidden', async () => {
    const [x, y, a] = (await issues('X', 'Y', 'A')) as [string, string, string];
    const z = await createdId({
      kind: 'op',
      op: { op: 'issue.create', title: 'Z', depends_on: [x, y] },
    });
    await edit(issueFile(z), (s) => s.replace(`[${x}, ${y}]`, `[${y}, ${x}]`));
    await edit(issueFile(a), (s) => s.replace('title: A', 'title: A2'));
    const lock = join(b.root, '.git', 'index.lock');
    try {
      const r = await executeWrite(ctx, EDITS, {
        hooks: { afterCommit: () => writeFile(lock, '') },
      });
      expect(r.commit).toBe(await revParse(b.root, 'HEAD'));
      expect(r.rewritten).toEqual([{ path: issueFile(z), reason: 'no_effect' }]);
      expect(r.unsettled).toEqual({
        paths: [issueFile(a), issueFile(z)].sort(),
        reason: expect.stringContaining('index.lock'),
      });
    } finally {
      await rm(lock, { force: true });
    }
    // Der Hand-Edit ohne Wirkung liegt noch da; verloren ist nichts.
    expect(await read(issueFile(z))).toContain(`[${y}, ${x}]`);
  });

  test('edits: a hand edit that verify would reject is refused and stays', async () => {
    const bob = await testKey('bob-edits');
    await executeWrite(ctx, {
      kind: 'op',
      op: { op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [bob.line] },
    });
    await writeLocalState(b.root, 'identity', 'bob');
    const asBob: ResolvedContext = {
      ...ctx,
      backlog: { ...ctx.backlog, boundTo: 'bob' },
      user: { ...ctx.user, value: 'bob', key: bob.priv },
    };
    const before = await revParse(b.root, 'HEAD');
    const config = await read('.backe/backlog.jsonc');
    const changed = config.replace(
      '"admins": [\n    "spw"\n  ]',
      '"admins": [\n    "spw",\n    "bob"\n  ]',
    );
    expect(changed).not.toBe(config);
    await write('.backe/backlog.jsonc', changed);
    await write('users/xena.md', '---\nname: Xena\nkind: human\n---\n');

    const err = await catchErrAsync(() => executeWrite(asBob, EDITS));
    expect(err.code).toBe('validation');
    expect(err.message).toBe(
      'verify würde den Commit ablehnen: nur Admins ändern .backe/backlog.jsonc; bob darf den User xena nicht anlegen',
    );
    expect(err.details).toEqual({
      reasons: ['nur Admins ändern .backe/backlog.jsonc', 'bob darf den User xena nicht anlegen'],
    });
    expect(await revParse(b.root, 'HEAD')).toBe(before);
    expect(await read('.backe/backlog.jsonc')).toBe(changed);
    expect(await statusShort(b.root)).toEqual([' M .backe/backlog.jsonc', '?? users/xena.md']);
  });

  test('hand edits are checked against the frozen state', async () => {
    const bob = await testKey('bob-frozen');
    await executeWrite(ctx, {
      kind: 'op',
      op: { op: 'user.add', handle: 'bob', name: 'Bob', kind: 'human', keys: [bob.line] },
    });
    // bob macht sich selbst zum Admin; der Commit ist ungültig, der Stand davor eingefroren.
    const config = await read('.backe/backlog.jsonc');
    const widened = config.replace(
      '"admins": [\n    "spw"\n  ]',
      '"admins": [\n    "spw",\n    "bob"\n  ]',
    );
    expect(widened).not.toBe(config);
    await rawCommit(b.root, {
      files: { '.backe/backlog.jsonc': widened },
      key: bob,
      actor: 'bob',
      op: 'manual',
    });
    await writeLocalState(b.root, 'identity', 'bob');
    const asBob: ResolvedContext = {
      ...ctx,
      backlog: { ...ctx.backlog, boundTo: 'bob' },
      user: { ...ctx.user, value: 'bob', key: bob.priv },
    };
    const before = await revParse(b.root, 'HEAD');
    await write('users/xena.md', '---\nname: Xena\nkind: human\n---\n');

    const err = await catchErrAsync(() => executeWrite(asBob, EDITS));
    expect(err.code).toBe('validation');
    expect(err.details).toEqual({ reasons: ['bob darf den User xena nicht anlegen'] });
    expect(await revParse(b.root, 'HEAD')).toBe(before);
    expect(await statusShort(b.root)).toEqual(['?? users/xena.md']);
  });

  test('edits: a quarantine reverted by hand while frozen lands and verifies', async () => {
    const [a] = (await issues('A')) as [string];
    const original = await read(issueFile(a));
    const bad = await rawCommit(b.root, {
      files: { [issueFile(a)]: original.replace('title: A', 'title: X') },
      actor: 'spw',
    });
    await write(issueFile(a), original);
    const entries = [{ sha: bad, decision: 'reverted', reason: 'von Hand' }];
    await write(QUARANTINE, `${JSON.stringify({ entries }, null, 2)}\n`);

    const r = await executeWrite(ctx, EDITS);
    expect(r.chain.map((c) => c.kind)).toEqual(['manual', 'op']);
    const report = await verifyRange(b.root);
    expect(report.invalid).toEqual([]);
    expect(report.quarantined.map((f) => f.sha)).toEqual([bad]);
  });

  test('edits: a quarantine that does not thaw leaves later steps bound by tainted paths', async () => {
    const [a] = (await issues('A')) as [string];
    const original = await read(issueFile(a));
    const first = await rawCommit(b.root, { files: { 'notes.md': 'x\n' }, actor: 'spw' });
    await rawCommit(b.root, {
      files: { [issueFile(a)]: original.replace('title: A', 'title: X') },
      actor: 'spw',
    });
    const before = await revParse(b.root, 'HEAD');
    // Deckt nur den ersten offenen Commit: Der Stand bleibt eingefroren, der Titel ist verseucht.
    const entries = [{ sha: first, decision: 'accepted', reason: 'harmlos' }];
    await write(QUARANTINE, `${JSON.stringify({ entries }, null, 2)}\n`);
    await edit(issueFile(a), (s) => s.replace('title: X', 'title: Y'));

    const err = await catchErrAsync(() => executeWrite(ctx, EDITS));
    expect(err).toMatchObject({
      code: 'validation',
      message: `verify würde den Commit ablehnen: baut auf ungültigem Commit ${first.slice(0, 7)} auf`,
    });
    expect(await revParse(b.root, 'HEAD')).toBe(before);
  });

  test('edits read the format version from HEAD', async () => {
    await edit('.backe/backlog.jsonc', (s) => s.replace('"version": 1', '"version": 99'));
    const r = await executeWrite(ctx, EDITS);
    expect(r.chain).toMatchObject([{ kind: 'manual', paths: ['.backe/backlog.jsonc'] }]);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('edits: a hand-edited config that does not parse never lands', async () => {
    const config = await read('.backe/backlog.jsonc');
    await write('.backe/backlog.jsonc', config.replace(/\n}\n$/, ',\n  "attachments": 5\n}\n'));
    const err = await catchErrAsync(() => executeWrite(ctx, EDITS));
    expect(err.code).toBe('validation');
    expect(err.message).toMatch(/^\.backe\/backlog\.jsonc: attachments: /);
    expect(await revParse(b.root, 'HEAD')).toBe(head);
  });

  test('edits: new editor and system junk files are refused, even without .gitignore', async () => {
    const [a] = (await issues('A')) as [string];
    await rawCommit(b.root, { files: { '.gitignore': null }, key: b.key, actor: 'spw' });
    const base = await revParse(b.root, 'HEAD');
    await edit(issueFile(a), (s) => s.replace('title: A', 'title: A2'));
    const dir = issueFile(a).replace(/\/issue\.md$/, '');
    const junk = [`${dir}/.issue.md.swp`, `${dir}/issue.md~`, `${dir}/#issue.md#`, '.DS_Store'];
    for (const path of junk) await write(path, 'x');
    await write('notes.swp', 'kein Junk: der Name beginnt nicht mit einem Punkt');

    const err = await catchErrAsync(() => executeWrite(ctx, EDITS));
    expect(err.code).toBe('validation');
    expect(err.message).toBe(`Editor- oder Systemdateien: ${[...junk].sort().join(', ')}`);
    expect(err.hint).toBe('löschen oder in .gitignore aufnehmen');
    expect(await revParse(b.root, 'HEAD')).toBe(base);
    expect(await read(issueFile(a))).toContain('title: A2');

    for (const path of junk) await rm(join(b.root, path));
    const r = await executeWrite(ctx, EDITS);
    expect(r.chain).toMatchObject([
      { kind: 'manual', paths: ['notes.swp'] },
      { kind: 'op', recorded: [{ op: 'issue.edit', id: a }] },
    ]);
  });

  test('edits: a symlink among the changed paths is refused before writing', async () => {
    const outside = join(await tempDir(), 'geheim.txt');
    await writeFile(outside, 'außerhalb\n');
    await symlink(outside, join(b.root, 'notes.md'));
    const err = await catchErrAsync(() => executeWrite(ctx, EDITS));
    expect(err.code).toBe('validation');
    expect(err.message).toBe('notes.md ist keine reguläre Datei');
    expect(await revParse(b.root, 'HEAD')).toBe(head);
    expect(await statusShort(b.root)).toEqual(['?? notes.md']);
  });

  test('edits: nothing changed writes nothing', async () => {
    const r = await executeWrite(ctx, EDITS);
    expect(r).toMatchObject({ commit: undefined, chain: [], rewritten: [], warnings: [] });
    expect(await revParse(b.root, 'HEAD')).toBe(head);
  });
});

const hasLfs = await git(['lfs', 'version'], { cwd: process.cwd() }).then(
  () => true,
  () => false,
);
if (!hasLfs) console.warn('git-lfs fehlt: LFS-Tests übersprungen');

describe('lfs', () => {
  async function enableLfs(): Promise<void> {
    const config = await readFile(join(b.root, '.backe/backlog.jsonc'), 'utf8');
    await executeWrite(ctx, {
      kind: 'manual',
      subject: 'lfs an',
      changes: [
        {
          path: '.backe/backlog.jsonc',
          content: config.replace(/\n}\n$/, ',\n  "attachments": { "lfs": true }\n}\n'),
        },
      ],
    });
  }

  test.runIf(hasLfs)('lfs: attachments are stored as lfs pointers', async () => {
    await enableLfs();
    const id = await createdId();
    const bytes = 'viele Bytes\n';
    const path = `${attachmentsDir(id)}/log.txt`;
    const add: WriteInput = {
      kind: 'op',
      op: { op: 'attach.add', id, name: 'log', file: 'log.txt', content: Buffer.from(bytes) },
    };
    const rm: WriteInput = { kind: 'op', op: { op: 'attach.rm', id, name: 'log' } };
    await executeWrite(ctx, add);
    const pointer = await git(['cat-file', '-p', `HEAD:${path}`], { cwd: b.root });
    expect(pointer.stdout).toMatch(/^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/);
    expect((await git(['show', 'HEAD:.gitattributes'], { cwd: b.root })).stdout).toContain(
      'filter=lfs',
    );
    // Der Filter steht in der Arbeitskopie selbst; der Arbeitsbaum trägt die echten Bytes.
    const filter = await git(['config', '--local', '--get', 'filter.lfs.process'], { cwd: b.root });
    expect(filter.stdout.trim()).toBe('git-lfs filter-process');
    expect(await readFile(join(b.root, path), 'utf8')).toBe(bytes);
    expect(await statusShort(b.root)).toEqual([]);

    // Ohne Hand-Edit ist der Anhang keiner.
    expect(await executeWrite(ctx, { kind: 'edits' })).toMatchObject({
      commit: undefined,
      chain: [],
    });

    // Ein Rollback bringt die Bytes zurück, nicht den Pointer.
    const err = await catchErrAsync(() =>
      executeWrite(ctx, rm, {
        hooks: {
          afterFiles: async () => {
            throw new BackeError('unexpected', 'boom');
          },
        },
      }),
    );
    expect(err.message).toBe('boom');
    expect(await readFile(join(b.root, path), 'utf8')).toBe(bytes);
    expect(await statusShort(b.root)).toEqual([]);

    await executeWrite(ctx, rm);
    await expect(readFile(join(b.root, path))).rejects.toThrow();
    expect(await statusShort(b.root)).toEqual([]);
  });

  test.runIf(hasLfs)('lfs: switching lfs on later renormalizes earlier attachments', async () => {
    const id = await createdId();
    const attach = (file: string): WriteInput => ({
      kind: 'op',
      op: { op: 'attach.add', id, name: file, file, content: Buffer.from(`${file}\n`) },
    });
    const old = `${attachmentsDir(id)}/old.txt`;
    await executeWrite(ctx, attach('old.txt'));
    await enableLfs();
    const r = await executeWrite(ctx, attach('new.txt'));
    expect(r.paths).toContain(old);
    expect(await statusShort(b.root)).toEqual([]);
    const pointer = await git(['cat-file', '-p', `HEAD:${old}`], { cwd: b.root });
    expect(pointer.stdout).toMatch(/^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/);
    expect(await readFile(join(b.root, old), 'utf8')).toBe('old.txt\n');

    await executeWrite(ctx, { kind: 'op', op: { op: 'attach.rm', id, name: 'old.txt' } });
    expect(await statusShort(b.root)).toEqual([]);
    expect((await git(['ls-tree', '--name-only', 'HEAD', '--', old], { cwd: b.root })).stdout).toBe(
      '',
    );
  });

  test.runIf(hasLfs)(
    'lfs: a hand-added lfs rule renormalizes attachments in its commit',
    async () => {
      const id = await createdId();
      const old = `${attachmentsDir(id)}/old.txt`;
      await executeWrite(ctx, {
        kind: 'op',
        op: { op: 'attach.add', id, name: 'old', file: 'old.txt', content: Buffer.from('alt\n') },
      });
      await enableLfs();
      await writeFile(join(b.root, '.gitattributes'), `${LFS_RULE}\n`);
      const r = await executeWrite(ctx, { kind: 'edits' });
      expect(r.chain).toMatchObject([{ kind: 'manual', paths: ['.gitattributes', old] }]);
      expect(await statusShort(b.root)).toEqual([]);
      const pointer = await git(['cat-file', '-p', `HEAD:${old}`], { cwd: b.root });
      expect(pointer.stdout).toMatch(/^version https:\/\/git-lfs\.github\.com\/spec\/v1\n/);
    },
  );

  test.runIf(hasLfs)(
    'a crash after update-ref with renormalized attachments leaves them unstaged',
    async () => {
      const id = await createdId();
      const attach = (file: string): WriteInput => ({
        kind: 'op',
        op: { op: 'attach.add', id, name: file, file, content: Buffer.from(`${file}\n`) },
      });
      const old = `${attachmentsDir(id)}/old.txt`;
      await executeWrite(ctx, attach('old.txt'));
      await enableLfs();
      const start = await revParse(b.root, 'HEAD');
      const journal = join(await stateDir(b.root), 'write.journal');
      let left = '';
      await executeWrite(ctx, attach('new.txt'), {
        hooks: {
          afterCommit: async () => {
            left = await readFile(journal, 'utf8');
          },
        },
      });
      expect(JSON.parse(left).paths).toContain(old);
      // Zustand wie nach einem SIGKILL nach dem Ref-Update, bevor der Index nachgezogen war.
      const raw = await revParse(b.root, `${start}:${old}`);
      await git(['update-index', '--cacheinfo', `100644,${raw},${old}`], { cwd: b.root });
      await writeFile(journal, left);
      expect(await statusShort(b.root)).not.toEqual([]);

      await executeWrite(ctx, CREATE_B);
      expect(await statusShort(b.root)).toEqual([]);
      expect(await readdir(await stateDir(b.root))).not.toContain('write.journal');
    },
  );

  test.runIf(hasLfs)('landedChain recognizes a landed commit with an lfs attachment', async () => {
    await enableLfs();
    const id = await createdId();
    const before = await revParse(b.root, 'HEAD');
    const path = `${attachmentsDir(id)}/log.txt`;
    const r = await executeWrite(
      ctx,
      {
        kind: 'op',
        op: { op: 'attach.add', id, name: 'log', file: 'log.txt', content: Buffer.from('Bytes\n') },
      },
      {
        hooks: {
          afterCommit: async () => {
            throw new BackeError('unexpected', 'boom');
          },
        },
      },
    );
    expect(r.commit).toBe(await revParse(b.root, 'HEAD'));
    expect(await revParse(b.root, 'HEAD^')).toBe(before);
    expect(await readFile(join(b.root, path), 'utf8')).toBe('Bytes\n');
    expect(await statusShort(b.root)).toEqual([]);
    expect(await readdir(await stateDir(b.root))).not.toContain('write.journal');
  });

  test.runIf(hasLfs)(
    'lfs: a chain touching a renormalized attachment again while frozen is refused',
    async () => {
      const id = await createdId();
      await executeWrite(ctx, {
        kind: 'op',
        op: { op: 'attach.add', id, name: 'old', file: 'old.txt', content: Buffer.from('alt\n') },
      });
      await enableLfs();
      const bad = await rawCommit(b.root, { files: { 'notes.md': 'x\n' }, actor: 'spw' });
      const before = await revParse(b.root, 'HEAD');
      // Die neue Regel legt den Anhang im manual-Commit neu ab; `issue.delete` danach ändert ihn
      // ein zweites Mal — sein Parent trägt dann nicht mehr den Blob des eingefrorenen Stands.
      await writeFile(join(b.root, '.gitattributes'), `${LFS_RULE}\n`);
      await rm(join(b.root, issueFile(id)));

      const err = await catchErrAsync(() => executeWrite(ctx, { kind: 'edits' }));
      expect(err.details).toEqual({
        reasons: [`baut auf ungültigem Commit ${bad.slice(0, 7)} auf`],
      });
      expect(await revParse(b.root, 'HEAD')).toBe(before);
    },
  );

  test.runIf(hasLfs)(
    'lfs: an edits chain with renormalized attachments restores them on failure and in recovery',
    async () => {
      const id = await createdId();
      await executeWrite(ctx, {
        kind: 'op',
        op: { op: 'attach.add', id, name: 'old', file: 'old.txt', content: Buffer.from('alt\n') },
      });
      const old = `${attachmentsDir(id)}/old.txt`;
      await enableLfs();
      await writeFile(join(b.root, '.gitattributes'), `${LFS_RULE}\n`);
      const start = await revParse(b.root, 'HEAD');
      const staged = async () =>
        (await git(['ls-files', '-s', '--', old, '.gitattributes'], { cwd: b.root })).stdout;
      const index = await staged();

      // Scheitern vor dem Ref-Update: Hand-Edits, Arbeitsbaum und Index wie vorher.
      const err = await catchErrAsync(() =>
        executeWrite(
          ctx,
          { kind: 'edits' },
          {
            hooks: {
              afterFiles: async () => {
                throw new BackeError('unexpected', 'boom');
              },
            },
          },
        ),
      );
      expect(err.message).toBe('boom');
      expect(await revParse(b.root, 'HEAD')).toBe(start);
      expect(await staged()).toBe(index);
      expect(await readFile(join(b.root, '.gitattributes'), 'utf8')).toBe(`${LFS_RULE}\n`);
      expect(await readFile(join(b.root, old), 'utf8')).toBe('alt\n');

      // Absturz nach dem Ref-Update: Die Recovery gleicht auch den Index des Anhangs an.
      const journal = join(await stateDir(b.root), 'write.journal');
      let left = '';
      const r = await executeWrite(
        ctx,
        { kind: 'edits' },
        {
          hooks: {
            afterCommit: async () => {
              left = await readFile(journal, 'utf8');
            },
          },
        },
      );
      expect(r.chain).toMatchObject([{ kind: 'manual', paths: ['.gitattributes', old] }]);
      expect(JSON.parse(left).paths).toContain(old);
      const raw = await revParse(b.root, `${start}:${old}`);
      await git(['update-index', '--cacheinfo', `100644,${raw},${old}`], { cwd: b.root });
      await writeFile(journal, left);
      expect(await statusShort(b.root)).not.toEqual([]);

      await executeWrite(ctx, CREATE_B);
      expect(await statusShort(b.root)).toEqual([]);
    },
  );

  test.runIf(hasLfs)('lfs: a foreign hook stays and the filter is set up anyway', async () => {
    const hook = join(b.root, '.git/hooks/pre-push');
    await writeFile(hook, '#!/bin/sh\necho eigener Hook\n', { mode: 0o755 });
    await enableLfs();
    await executeWrite(ctx, CREATE);
    expect(await readFile(hook, 'utf8')).toBe('#!/bin/sh\necho eigener Hook\n');
    const filter = await git(['config', '--local', '--get', 'filter.lfs.clean'], { cwd: b.root });
    expect(filter.stdout.trim()).toBe('git-lfs clean -- %f');
  });

  test('lfs without git-lfs on PATH is a validation error', async () => {
    await enableLfs();
    const before = await revParse(b.root, 'HEAD');
    const bin = await tempDir();
    for (const tool of ['git', 'ssh-keygen', 'sh']) {
      await symlink(await which(tool), join(bin, tool));
    }
    vi.stubEnv('PATH', bin);
    try {
      const err = await catchErrAsync(() => executeWrite(ctx, CREATE));
      expect(err.code).toBe('validation');
      expect(err.message).toBe('attachments.lfs verlangt git-lfs');
      expect(err.hint).toBe('backe doctor');
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await revParse(b.root, 'HEAD')).toBe(before);
    expect(await statusShort(b.root)).toEqual([]);
  });
});

/** Absoluter Pfad eines Programms aus dem PATH des Testprozesses. */
async function which(tool: string): Promise<string> {
  for (const dir of (process.env.PATH ?? '').split(':')) {
    const candidate = join(dir, tool);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  throw new Error(`${tool} nicht im PATH`);
}

import { readdir } from 'node:fs/promises';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { revParse, sigOf, statusShort, testBacklog } from '../../test/helpers/git.ts';
import { commitChanges } from './commit-changes.ts';
import { git, gitBytes } from './exec.ts';
import { stateDir } from './local-state.ts';

const AUTHOR = { name: 'Alice Author', email: 'alice@example.test' };
const MESSAGE = 'm\n\nBacke-Actor: spw\nBacke-Op: manual\n';

async function setup() {
  const tb = await testBacklog();
  const head = await revParse(tb.root, 'HEAD');
  const base = { parent: head, message: MESSAGE, key: tb.key.priv, author: AUTHOR, env: tb.env };
  return { ...tb, head, base };
}

async function lsTree(wc: string, rev: string): Promise<string[]> {
  const { stdout } = await git(['ls-tree', '-r', '--name-only', rev], { cwd: wc });
  return stdout.split('\n').filter((l) => l !== '');
}

test('commitChanges builds a signed commit without touching HEAD, index or files', async () => {
  const { root: wc, head, base, key } = await setup();
  const before = { head, status: await statusShort(wc) };
  const sha = await commitChanges(wc, {
    ...base,
    changes: [{ path: 'notes/a.md', content: 'x\n' }],
  });
  expect(await revParse(wc, 'HEAD')).toBe(before.head);
  expect(await statusShort(wc)).toEqual(before.status);
  expect(await sigOf(wc, sha, { spw: key })).toEqual(['G', 'spw']);
  expect(await git(['show', `${sha}:notes/a.md`], { cwd: wc })).toMatchObject({ stdout: 'x\n' });
  expect(await revParse(wc, `${sha}^`)).toBe(head);
  expect(await git(['log', '-1', '--format=%an <%ae>|%cn', sha], { cwd: wc })).toMatchObject({
    stdout: 'Alice Author <alice@example.test>|Alice Author\n',
  });
  expect(await readdir(await stateDir(wc))).not.toContainEqual(expect.stringMatching(/^index-/));
});

test('commitChanges applies deletions and writes in order', async () => {
  const { root: wc, base } = await setup();
  const first = await commitChanges(wc, {
    ...base,
    changes: [
      { path: 'n/a.md', content: '1' },
      { path: 'n/b.md', content: '2' },
    ],
  });
  const sha = await commitChanges(wc, {
    ...base,
    parent: first,
    changes: [
      { path: 'n/a.md', content: null },
      { path: 'n/b.md', content: null },
      { path: 'n/b.md', content: '3' },
      { path: 'n/never.md', content: null },
    ],
  });
  expect(await lsTree(wc, sha)).toContain('n/b.md');
  expect(await lsTree(wc, sha)).not.toContain('n/a.md');
  expect((await git(['show', `${sha}:n/b.md`], { cwd: wc })).stdout).toBe('3');
});

test('commitChanges removes an issue directory recursively', async () => {
  const { root: wc, base } = await setup();
  const first = await commitChanges(wc, {
    ...base,
    changes: [
      { path: 'issues/aa/bk-aa001/issue.md', content: 'i' },
      { path: 'issues/aa/bk-aa001/comments/c.md', content: 'c' },
      { path: 'issues/aa/bk-aa002/issue.md', content: 'j' },
    ],
  });
  const sha = await commitChanges(wc, {
    ...base,
    parent: first,
    changes: [{ path: 'issues/aa/bk-aa001', content: null, recursive: true }],
  });
  const files = await lsTree(wc, sha);
  expect(files.filter((f) => f.startsWith('issues/'))).toEqual(['issues/aa/bk-aa002/issue.md']);
});

test('commitChanges stores bytes verbatim, also lfs pointers', async () => {
  const { root: wc, base } = await setup();
  const pointer = 'version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 3\n';
  const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x0d, 0x0a, 0x80]);
  const sha = await commitChanges(wc, {
    ...base,
    changes: [
      { path: 'issues/aa/bk-aa001/attachments/p.bin', content: pointer },
      { path: 'issues/aa/bk-aa001/attachments/raw.bin', content: bytes },
    ],
  });
  const raw = await gitBytes(
    ['cat-file', 'blob', `${sha}:issues/aa/bk-aa001/attachments/raw.bin`],
    {
      cwd: wc,
    },
  );
  expect([...raw.stdout]).toEqual([...bytes]);
  expect(
    (await git(['cat-file', 'blob', `${sha}:issues/aa/bk-aa001/attachments/p.bin`], { cwd: wc }))
      .stdout,
  ).toBe(pointer);
});

test('commitChanges without a parent starts from the empty tree', async () => {
  const { root: wc, base } = await setup();
  const sha = await commitChanges(wc, {
    ...base,
    parent: undefined,
    changes: [{ path: 'only.md', content: 'o' }],
  });
  expect(await lsTree(wc, sha)).toEqual(['only.md']);
  expect((await git(['rev-list', '--parents', '-1', sha], { cwd: wc })).stdout.trim()).toBe(sha);
});

test('commitChanges without effect is unexpected', async () => {
  const { root: wc, base } = await setup();
  const err = await catchErrAsync(() =>
    commitChanges(wc, { ...base, changes: [{ path: 'nothing.md', content: null }] }),
  );
  expect(err).toMatchObject({ code: 'unexpected', message: 'Write ohne Änderung am Baum' });
  expect(await readdir(await stateDir(wc))).not.toContainEqual(expect.stringMatching(/^index-/));
});

test('commitChanges refuses unsafe paths', async () => {
  const { root: wc, base } = await setup();
  const err = await catchErrAsync(() =>
    commitChanges(wc, { ...base, changes: [{ path: '../x', content: 'x' }] }),
  );
  expect(err.code).toBe('validation');
});

test('commitChanges reports a failing signature as usage', async () => {
  const { root: wc, base } = await setup();
  const err = await catchErrAsync(() =>
    commitChanges(wc, {
      ...base,
      key: '/nonexistent/key',
      changes: [{ path: 'a.md', content: 'a' }],
    }),
  );
  expect(err.code).toBe('usage');
  expect(err.message).toContain('Signieren mit /nonexistent/key fehlgeschlagen');
});

test('an executable change is committed with mode 100755, others with 100644', async () => {
  const { root: wc, base } = await setup();
  const sha = await commitChanges(wc, {
    ...base,
    changes: [
      { path: 'notes/run.sh', content: 'echo\n', executable: true },
      { path: 'notes/plain.txt', content: 'x\n', executable: false },
    ],
  });
  const { stdout } = await git(['ls-tree', '-r', '--format=%(objectmode) %(path)', sha, 'notes/'], {
    cwd: wc,
  });
  expect(stdout).toBe('100644 notes/plain.txt\n100755 notes/run.sh\n');
});

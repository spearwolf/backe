import { catchErr } from '../../test/helpers/catch.ts';
import { I, seqBytes, snap } from '../../test/helpers/snapshot.ts';
import type { Comment, Issue } from '../core/schemas.ts';
import { serializeEntityFile } from '../store/frontmatter.ts';
import { attachmentsDir, commentFileName, commentsDir, issueFile } from '../store/layout.ts';
import type { StoredEntity } from '../store/snapshot.ts';
import { type ApplyContext, applyOperation } from './apply.ts';
import { bodyHash, type Operation } from './operation.ts';

const FILE = commentFileName('2026-11-18T10:04:00Z', 'spw', 'q8x');
const OTHER = commentFileName('2026-11-18T10:05:00Z', 'alice', 'abc');

function stored(file: string, author: string, body: string): StoredEntity<Comment> {
  return {
    data: { author, created: '2026-11-18T10:04:00Z' },
    extra: [['x_note', 'keep']],
    body,
    path: `${commentsDir(I(1))}/${file}`,
  };
}

const ctx = (actor = 'spw', withComments = true): ApplyContext => ({
  actor,
  now: '2026-11-19T08:00:00Z',
  randomBytes: seqBytes(),
  ...(withComments
    ? {
        comments: new Map([
          [I(1), [stored(FILE, 'spw', 'alt\n'), stored(OTHER, 'alice', 'fremd\n')]],
        ]),
      }
    : {}),
});

const base = (issue: Partial<Issue> = {}) => snap({ issues: [{ id: I(1), ...issue }] });
const run = (op: Operation, actor = 'spw', s = base()) => applyOperation(s, op, ctx(actor));
const fail = (op: Operation, actor = 'spw', c = ctx(actor)) =>
  catchErr(() => applyOperation(base(), op, c));
const reasonOf = (err: { details?: unknown }) => (err.details as { reason: string }).reason;

describe('comment.add', () => {
  test('writes a plain comment by the actor', () => {
    const r = run({ op: 'comment.add', id: I(1), body: 'Hallo' });
    expect(r.changes).toHaveLength(1);
    const [c] = r.changes;
    expect(c?.path).toMatch(
      new RegExp(`^${commentsDir(I(1))}/20261119T080000Z-spw-[0-9a-z]{3}\\.md$`),
    );
    expect(c?.content).toBe(
      serializeEntityFile('comment', { author: 'spw', created: '2026-11-19T08:00:00Z' }, 'Hallo'),
    );
    expect(c?.content).not.toContain('kind:');
    expect(r.recorded).toMatchObject({ op: 'comment.add', file: c?.path.split('/').pop() });
  });

  test('uses the given file name', () => {
    const file = commentFileName('2026-11-18T09:00:00Z', 'spw', 'abc');
    const r = run({ op: 'comment.add', id: I(1), body: 'x', file });
    expect(r.changes[0]?.path).toBe(`${commentsDir(I(1))}/${file}`);
    expect(r.changes[0]?.content).toContain('created: 2026-11-18T09:00:00Z');
    expect(r.recorded).toMatchObject({ file });
  });

  test.each(['', '  \n\t'])('rejects the blank body %j as schema violation', (body) => {
    const err = fail({ op: 'comment.add', id: I(1), body });
    expect([err.exitCode, reasonOf(err)]).toEqual([2, 'schema']);
  });

  test('a missing issue is not found', () => {
    const err = catchErr(() =>
      applyOperation(snap(), { op: 'comment.add', id: I(1), body: 'x' }, ctx()),
    );
    expect(err.exitCode).toBe(3);
  });
});

describe('comment.edit', () => {
  const edit = (extra: Record<string, unknown> = {}): Operation =>
    ({
      op: 'comment.edit',
      id: I(1),
      file: FILE,
      from_hash: bodyHash('alt\n'),
      body: 'neu',
      ...extra,
    }) as Operation;

  test('rewrites body and keeps frontmatter and extra', () => {
    const r = run(edit());
    expect(r.changes).toEqual([
      {
        path: `${commentsDir(I(1))}/${FILE}`,
        content: serializeEntityFile(
          'comment',
          { author: 'spw', created: '2026-11-18T10:04:00Z' },
          'neu',
          [['x_note', 'keep']],
        ),
      },
    ]);
  });

  test('a body that is already there is a no-op', () => {
    const r = run(edit({ body: 'alt', from_hash: '0'.repeat(64) }));
    expect([r.noop, r.changes]).toEqual([true, []]);
  });

  test('a stale from_hash is a precondition conflict', () => {
    const err = fail(edit({ from_hash: '0'.repeat(64) }));
    expect([err.exitCode, reasonOf(err)]).toEqual([4, 'precondition']);
  });

  test('only the author may edit', () => {
    const err = fail(edit({ file: OTHER, from_hash: bodyHash('fremd\n') }));
    expect([err.exitCode, reasonOf(err)]).toEqual([2, 'policy']);
  });

  test('a missing comment is not found', () => {
    const err = fail(edit({ file: commentFileName('2026-01-01T00:00:00Z', 'spw', 'zzz') }));
    expect([err.exitCode, reasonOf(err)]).toEqual([3, 'missing_ref']);
  });

  test('without loaded comments for the issue it is unexpected', () => {
    const err = fail(edit(), 'spw', ctx('spw', false));
    expect(err.exitCode).toBe(1);
  });
});

describe('comment.delete', () => {
  const del = (file = FILE): Operation => ({ op: 'comment.delete', id: I(1), file });

  test('removes the comment file', () => {
    expect(run(del()).changes).toEqual([{ path: `${commentsDir(I(1))}/${FILE}`, content: null }]);
  });

  test('only the author may delete', () => {
    const err = fail(del(OTHER));
    expect([err.exitCode, reasonOf(err)]).toEqual([2, 'policy']);
  });

  test('a missing comment is not found', () => {
    const err = fail(del(commentFileName('2026-01-01T00:00:00Z', 'spw', 'zzz')));
    expect(err.exitCode).toBe(3);
  });

  test('without loaded comments for the issue it is unexpected', () => {
    expect(fail(del(), 'spw', ctx('spw', false)).exitCode).toBe(1);
  });
});

describe('attach.add', () => {
  const bytes = Uint8Array.from([1, 2, 3]);

  test('stores the file and the frontmatter entry', () => {
    const r = run({ op: 'attach.add', id: I(1), name: 'log', file: 'a.txt', content: bytes });
    expect(r.changes.map((c) => c.path)).toEqual([
      `${attachmentsDir(I(1))}/a.txt`,
      issueFile(I(1)),
    ]);
    expect(r.changes[0]?.content).toEqual(bytes);
    expect(r.snapshot.issues.get(I(1))?.data.attachments).toEqual([{ name: 'log', file: 'a.txt' }]);
  });

  test('appends a url entry without writing a file', () => {
    const s = base({ attachments: [{ name: 'a', url: 'https://x.test/a' }] });
    const r = run({ op: 'attach.add', id: I(1), name: 'b', url: 'https://x.test/b' }, 'spw', s);
    expect(r.changes.map((c) => c.path)).toEqual([issueFile(I(1))]);
    expect(r.snapshot.issues.get(I(1))?.data.attachments).toEqual([
      { name: 'a', url: 'https://x.test/a' },
      { name: 'b', url: 'https://x.test/b' },
    ]);
  });

  test('a duplicate name exists', () => {
    const s = base({ attachments: [{ name: 'log', url: 'https://x.test/a' }] });
    const err = catchErr(() =>
      applyOperation(
        s,
        { op: 'attach.add', id: I(1), name: 'log', url: 'https://x.test/b' },
        ctx(),
      ),
    );
    expect([err.exitCode, reasonOf(err)]).toEqual([4, 'exists']);
  });

  test('a second attachment with another name but the same file exists and writes nothing', () => {
    const s = base({ attachments: [{ name: 'log', file: 'a.txt' }] });
    const err = catchErr(() =>
      applyOperation(
        s,
        { op: 'attach.add', id: I(1), name: 'other', file: 'a.txt', content: bytes },
        ctx(),
      ),
    );
    expect([err.exitCode, reasonOf(err)]).toEqual([4, 'exists']);
  });

  test('attachments with different names and files coexist', () => {
    const s = base({ attachments: [{ name: 'log', file: 'a.txt' }] });
    const r = applyOperation(
      s,
      { op: 'attach.add', id: I(1), name: 'other', file: 'b.txt', content: bytes },
      ctx(),
    );
    expect(r.snapshot.issues.get(I(1))?.data.attachments).toEqual([
      { name: 'log', file: 'a.txt' },
      { name: 'other', file: 'b.txt' },
    ]);
    expect(r.changes.map((c) => c.path)).toEqual([
      `${attachmentsDir(I(1))}/b.txt`,
      issueFile(I(1)),
    ]);
  });

  test('attachment over max_bytes is too large and points at lfs', () => {
    const s = snap({
      config: { attachments: { max_bytes: 2, lfs: false } },
      issues: [{ id: I(1) }],
    });
    const err = catchErr(() =>
      applyOperation(
        s,
        { op: 'attach.add', id: I(1), name: 'log', file: 'a.txt', content: bytes },
        ctx(),
      ),
    );
    expect([err.exitCode, reasonOf(err)]).toEqual([2, 'too_large']);
    expect(err.hint).toContain('attachments.lfs');
  });

  test('a null max_bytes allows any size', () => {
    const s = snap({
      config: { attachments: { max_bytes: null, lfs: false } },
      issues: [{ id: I(1) }],
    });
    const r = applyOperation(
      s,
      { op: 'attach.add', id: I(1), name: 'log', file: 'a.txt', content: bytes },
      ctx(),
    );
    expect(r.noop).toBe(false);
  });

  test('attach.add without content is unexpected', () => {
    const err = fail({ op: 'attach.add', id: I(1), name: 'log', file: 'a.txt' });
    expect(err.exitCode).toBe(1);
  });

  test('a missing issue is not found', () => {
    const err = catchErr(() =>
      applyOperation(
        snap(),
        { op: 'attach.add', id: I(1), name: 'l', url: 'https://x.test' },
        ctx(),
      ),
    );
    expect(err.exitCode).toBe(3);
  });
});

describe('attach.rm', () => {
  const s = base({
    attachments: [
      { name: 'log', file: 'a.txt' },
      { name: 'web', url: 'https://x.test/w' },
    ],
  });

  test('removes entry and file', () => {
    const r = run({ op: 'attach.rm', id: I(1), name: 'log' }, 'spw', s);
    expect(r.changes).toEqual([
      { path: `${attachmentsDir(I(1))}/a.txt`, content: null },
      expect.objectContaining({ path: issueFile(I(1)) }),
    ]);
    expect(r.snapshot.issues.get(I(1))?.data.attachments).toEqual([
      { name: 'web', url: 'https://x.test/w' },
    ]);
  });

  test('removing the last url entry touches no file and drops the list', () => {
    const only = base({ attachments: [{ name: 'web', url: 'https://x.test/w' }] });
    const r = run({ op: 'attach.rm', id: I(1), name: 'web' }, 'spw', only);
    expect(r.changes.map((c) => c.path)).toEqual([issueFile(I(1))]);
    expect(r.snapshot.issues.get(I(1))?.data.attachments).toBeUndefined();
  });

  test('a missing entry is missing_ref', () => {
    const err = catchErr(() =>
      applyOperation(s, { op: 'attach.rm', id: I(1), name: 'nope' }, ctx()),
    );
    expect([err.exitCode, reasonOf(err)]).toEqual([3, 'missing_ref']);
  });
});

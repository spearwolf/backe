import { readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import type { BackeError } from '../core/errors.ts';
import { listComments } from '../store/snapshot.ts';
import {
  addComment,
  deleteComment,
  editComment,
  listIssueComments,
  resolveCommentRef,
} from './comments.ts';
import { createIssue } from './issues.ts';
import { executeWrite } from './write.ts';

let b: TestBacklog;
let ctx: ResolvedContext;
let id: string;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
  id = (await createIssue(ctx, { title: 'Kommentiert' })).id as string;
});

describe('comments', () => {
  test('comments are listed chronologically and addressed by index or file', async () => {
    // Feste Dateinamen: innerhalb einer Sekunde ordnet sonst nur der Zufallsanteil.
    await executeWrite(ctx, {
      kind: 'batch',
      ops: ['eins', 'zwei', 'drei'].map((body, n) => ({
        op: 'comment.add' as const,
        id,
        body,
        file: `20261118T10000${n}Z-spw-aaa.md`,
      })),
    });
    const all = await listIssueComments(ctx, id);
    expect(all.map((c) => c.body.trim())).toEqual(['eins', 'zwei', 'drei']);
    expect((await listIssueComments(ctx, id, { limit: 2 })).map((c) => c.body.trim())).toEqual([
      'zwei',
      'drei',
    ]);
    expect(resolveCommentRef(all, '2')).toBe(all[1]?.file);
    expect(resolveCommentRef(all, all[2]?.file as string)).toBe(all[2]?.file);
    const err = await catchErrAsync(async () => resolveCommentRef(all, '9'));
    expect(err).toMatchObject({ code: 'not_found' });
    expect((err as Error).message).toContain('»9«');
    expect(() => resolveCommentRef(all, '0')).toThrow(/nicht gefunden/);
  });

  test('an empty comment is rejected and a bad limit too', async () => {
    expect(await catchErrAsync(() => addComment(ctx, id, '  '))).toMatchObject({
      code: 'validation',
      message: 'Kommentar ist leer',
    });
    expect(await catchErrAsync(() => editComment(ctx, id, '1', ' '))).toMatchObject({
      code: 'validation',
    });
    expect(await catchErrAsync(() => listIssueComments(ctx, id, { limit: 0 }))).toMatchObject({
      code: 'validation',
    });
  });

  test('editing and deleting an own comment works', async () => {
    await addComment(ctx, id, 'alt');
    await editComment(ctx, id, '1', 'neu');
    expect((await listIssueComments(ctx, id))[0]?.body.trim()).toBe('neu');
    await deleteComment(ctx, id, '1');
    expect(await listIssueComments(ctx, id)).toEqual([]);
  });

  test('editing a foreign comment is refused by the operation', async () => {
    await addComment(ctx, id, 'von spw');
    const [stored] = await listComments(b.root, id);
    const path = join(b.root, (stored as { path: string }).path);
    const text = await readFile(path, 'utf8');
    await writeFile(path, text.replace('author: spw', 'author: bob'));
    const err = await catchErrAsync(() => editComment(ctx, id, '1', 'fremd'));
    expect(err).toBeDefined();
    expect((err as Error).message).toContain('bob');
    const del = await catchErrAsync(() => deleteComment(ctx, id, '1'));
    expect(del).toMatchObject({ code: expect.any(String) });
    expect((del as Error).message).toContain('bob');
    expect((del as BackeError).code).toBe((err as BackeError).code);
  });

  test('a comment changed between read and write yields a conflict and keeps the other content', async () => {
    await addComment(ctx, id, 'alt');
    const [stored] = await listComments(b.root, id);
    const path = join(b.root, (stored as { path: string }).path);
    let changed = false;
    // `now` läuft im Write nach dem Vorab-Lesen, aber vor dem Laden der Kommentare unter dem Lock.
    const now = () => {
      if (!changed) {
        changed = true;
        writeFileSync(path, readFileSync(path, 'utf8').replace('alt', 'zwischendurch'));
      }
      return new Date();
    };
    const err = await catchErrAsync(() => editComment(ctx, id, '1', 'meins', { now }));
    expect(err).toMatchObject({ code: 'conflict' });
    expect((err as Error).message).toContain('inzwischen geändert');
    expect(readFileSync(path, 'utf8')).toContain('zwischendurch');
    expect(readFileSync(path, 'utf8')).not.toContain('meins');
  });
});

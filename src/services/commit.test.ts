import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logTrailers, statusShort, type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import type { Operation } from '../ops/operation.ts';
import { commentsDir, issueFile } from '../store/layout.ts';
import { commitEdits } from './commit.ts';
import { executeWrite } from './write.ts';

let b: TestBacklog;
let ctx: ResolvedContext;

beforeEach(async () => {
  b = await testBacklog();
  ctx = await b.context();
});

async function issues(...titles: string[]): Promise<string[]> {
  const r = await executeWrite(ctx, {
    kind: 'batch',
    ops: titles.map((title) => ({ op: 'issue.create', title }) as Operation),
  });
  return r.recorded.map((op) => (op as { id: string }).id);
}

const read = (path: string) => readFile(join(b.root, path), 'utf8');
const write = async (path: string, content: string) => {
  await mkdir(join(b.root, path, '..'), { recursive: true });
  await writeFile(join(b.root, path), content);
};

describe('commitEdits', () => {
  test('hand edits with crlf, bom, reorder and whitespace leave a clean working copy', async () => {
    const [a, bb] = (await issues('A', 'B')) as [string, string];
    const c = (
      await executeWrite(ctx, {
        kind: 'op',
        op: { op: 'issue.create', title: 'C', depends_on: [a, bb] },
      })
    ).recorded[0] as { id: string };
    const d = (
      await executeWrite(ctx, {
        kind: 'op',
        op: { op: 'issue.create', title: 'D', body: 'Text\n' },
      })
    ).recorded[0] as { id: string };
    // A: Titel geändert, mit BOM und CRLF gespeichert
    const textA = (await read(issueFile(a))).replace('title: A', 'title: A2');
    await write(issueFile(a), `﻿${textA.replaceAll('\n', '\r\n')}`);
    // C: nur depends_on umsortiert; D: nur der Schluss-Newline des Bodys fehlt (CRLF-Editoren)
    await write(
      issueFile(c.id),
      (await read(issueFile(c.id))).replace(`[${a}, ${bb}]`, `[${bb}, ${a}]`),
    );
    await write(issueFile(d.id), (await read(issueFile(d.id))).replace(/\n$/, ''));

    const out = await commitEdits(ctx, {});
    expect(out.commits).toHaveLength(1);
    expect(out.commits[0]).toMatchObject({
      kind: 'op',
      summary: `issue edit ${a}`,
      paths: [issueFile(a)],
    });
    expect(out.commits[0]?.recorded).toHaveLength(1);
    expect(out.notices.sort()).toEqual(
      [
        `${issueFile(c.id)}: keine wirksame Änderung`,
        `${issueFile(d.id)}: keine wirksame Änderung`,
      ].sort(),
    );
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('a deleted issue file becomes issue.delete', async () => {
    const [a] = (await issues('A')) as [string];
    await rm(join(b.root, issueFile(a)));
    const out = await commitEdits(ctx, {});
    expect(out.commits.map((c) => c.recorded.map((o) => o.op))).toEqual([['issue.delete']]);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('a new comment file becomes comment.add', async () => {
    const [a] = (await issues('A')) as [string];
    await write(
      `${commentsDir(a)}/20260101T000000Z-spw-abc.md`,
      '---\nauthor: spw\ncreated: 2026-01-01T00:00:00Z\n---\nHallo\n',
    );
    const out = await commitEdits(ctx, {});
    expect(out.commits.flatMap((c) => c.recorded.map((o) => o.op))).toEqual(['comment.add']);
  });

  test('unknown keys warn and go to the manual commit', async () => {
    const [a] = (await issues('A')) as [string];
    await write(issueFile(a), (await read(issueFile(a))).replace('title: A', 'title: A\nfoo: bar'));
    const out = await commitEdits(ctx, {});
    expect(out.warnings).toEqual([{ path: issueFile(a), unknownKeys: ['foo'] }]);
    expect(out.commits).toMatchObject([
      { kind: 'manual', summary: 'manual: 1 Dateien', recorded: [] },
    ]);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('nothing to commit', async () => {
    expect((await commitEdits(ctx, {})).commits).toEqual([]);
    expect((await commitEdits(ctx, { message: 'x' })).notices).toEqual([]);
  });

  test('-m names the manual commit and is noted when unused', async () => {
    const [a, bb] = (await issues('A', 'B')) as [string, string];
    await write(issueFile(a), (await read(issueFile(a))).replace('title: A', 'title: A\nfoo: bar'));
    const named = await commitEdits(ctx, { message: 'Notizen' });
    expect(named.commits[0]).toMatchObject({ kind: 'manual', summary: 'Notizen' });
    expect(named.notices).toEqual([]);
    expect((await logTrailers(b.root))[0]?.subject).toBe('Notizen');

    await write(issueFile(bb), (await read(issueFile(bb))).replace('title: B', 'title: B2'));
    const unused = await commitEdits(ctx, { message: 'Egal' });
    expect(unused.commits).toHaveLength(1);
    expect(unused.notices).toEqual(['-m gilt nur für manuelle Änderungen']);
  });

  test('a canonical rewrite is noted', async () => {
    const [x, y] = (await issues('X', 'Y')) as [string, string];
    const z = (
      await executeWrite(ctx, {
        kind: 'op',
        op: { op: 'issue.create', title: 'Z', depends_on: [x] },
      })
    ).recorded[0] as { id: string };
    await write(issueFile(z.id), (await read(issueFile(z.id))).replace(`[${x}]`, `[${y}, ${x}]`));
    const out = await commitEdits(ctx, {});
    expect(out.notices).toEqual([`${issueFile(z.id)}: kanonisch umgeschrieben`]);
  });
});

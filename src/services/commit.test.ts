import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  logTrailers,
  statusShort,
  type TestBacklog,
  testBacklog,
  warnModeAgent,
} from '../../test/helpers/git.ts';
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
    expect(out.rewritten).toEqual(
      [
        { path: issueFile(c.id), reason: 'no_effect' },
        { path: issueFile(d.id), reason: 'no_effect' },
      ].sort((x, y) => (x.path < y.path ? -1 : 1)),
    );
    expect(out.notices).toEqual([]);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('a deleted issue file becomes issue.delete', async () => {
    const [a] = (await issues('A')) as [string];
    await rm(join(b.root, issueFile(a)));
    const out = await commitEdits(ctx, {});
    expect(out.commits.map((c) => c.recorded.map((o) => o.op))).toEqual([['issue.delete']]);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('notices of the operations stay objects with code and ids', async () => {
    const [p] = (await issues('P')) as [string];
    const child = (
      await executeWrite(ctx, { kind: 'op', op: { op: 'issue.create', title: 'C', parent: p } })
    ).recorded[0] as { id: string };
    const text = await read(issueFile(p));
    await write(issueFile(p), text.replace(/^state: .*$/m, 'state: cancelled'));
    const out = await commitEdits(ctx, {});
    expect(out.commits.flatMap((c) => c.recorded.map((o) => o.op))).toEqual(['issue.move']);
    expect(out.notices).toMatchObject([{ code: 'open_children', ids: [child.id] }]);
    expect(out.warnings).toEqual([]);
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
    expect(out.unknownKeys).toEqual([{ path: issueFile(a), keys: ['foo'] }]);
    expect(out.commits).toMatchObject([
      { kind: 'manual', summary: 'manual: 1 Dateien', recorded: [] },
    ]);
    expect(await statusShort(b.root)).toEqual([]);
  });

  test('nothing to commit', async () => {
    expect((await commitEdits(ctx, {})).commits).toEqual([]);
    expect((await commitEdits(ctx, { message: 'x' })).warnings).toEqual([]);
  });

  test('a fresh clone in warn mode passes the verify reasons on as warnings', async () => {
    const { ctx: asClaude, notice } = await warnModeAgent();
    const out = await commitEdits(asClaude, {});
    expect(out.commits).toEqual([]);
    expect(out.warnings).toEqual([notice]);
  });

  test('-m names the manual commit and is noted when unused', async () => {
    const [a, bb] = (await issues('A', 'B')) as [string, string];
    await write(issueFile(a), (await read(issueFile(a))).replace('title: A', 'title: A\nfoo: bar'));
    const named = await commitEdits(ctx, { message: 'Notizen' });
    expect(named.commits[0]).toMatchObject({ kind: 'manual', summary: 'Notizen' });
    expect(named.warnings).toEqual([]);
    expect((await logTrailers(b.root))[0]?.subject).toBe('Notizen');

    await write(issueFile(bb), (await read(issueFile(bb))).replace('title: B', 'title: B2'));
    const unused = await commitEdits(ctx, { message: 'Egal' });
    expect(unused.commits).toHaveLength(1);
    expect(unused.warnings).toEqual(['-m gilt nur für manuelle Änderungen']);
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
    expect(out.rewritten).toEqual([{ path: issueFile(z.id), reason: 'canonical' }]);
  });

  test('a working copy that could not be aligned is noted', async () => {
    const [x, y, a] = (await issues('X', 'Y', 'A')) as [string, string, string];
    const z = (
      await executeWrite(ctx, {
        kind: 'op',
        op: { op: 'issue.create', title: 'Z', depends_on: [x, y] },
      })
    ).recorded[0] as { id: string };
    await write(
      issueFile(z.id),
      (await read(issueFile(z.id))).replace(`[${x}, ${y}]`, `[${y}, ${x}]`),
    );
    await write(issueFile(a), (await read(issueFile(a))).replace('title: A', 'title: A2'));
    const lock = join(b.root, '.git', 'index.lock');
    try {
      const out = await commitEdits(ctx, {}, { hooks: { afterCommit: () => writeFile(lock, '') } });
      expect(out.commits).toHaveLength(1);
      const unsettled = out.warnings.find((n) => n.startsWith('Arbeitskopie nicht angeglichen'));
      expect(unsettled).toContain(issueFile(a));
      expect(unsettled).toContain(issueFile(z.id));
      expect(unsettled).toContain('index.lock');
    } finally {
      await rm(lock, { force: true });
    }
  });
});

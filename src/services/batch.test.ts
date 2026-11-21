import { catchErrAsync } from '../../test/helpers/catch.ts';
import { revParse, type TestBacklog, testBacklog, warnModeAgent } from '../../test/helpers/git.ts';
import { git } from '../git/exec.ts';
import { parseCommitMessage } from '../git/message.ts';
import { encodeBatchBody, summarizeBatch } from '../ops/operation.ts';
import { runBatch } from './batch.ts';

let b: TestBacklog;

beforeEach(async () => {
  b = await testBacklog();
});

describe('runBatch', () => {
  test('a fresh clone in warn mode passes the verify reasons on as warnings', async () => {
    const { ctx: asClaude, notice } = await warnModeAgent();
    const out = await runBatch(asClaude, '{"op":"issue.create","title":"X"}\n');
    expect(out.commit).toBeDefined();
    expect(out.warnings).toEqual([notice]);
  });

  test('batch input from agents', async () => {
    const ctx = await b.context();
    const lines = [
      '{"op":"issue.create","title":"Erstes","ref":"$f1"}',
      '{"op":"issue.edit","id":"$f1","set":{"title":{"from":"Erstes","to":"Zweites"}}}',
    ];
    const out = await runBatch(ctx, `﻿${lines.join('\r\n')}\r\n\r\n`);
    expect(out.commit).toBeDefined();
    expect(Object.keys(out.refs)).toEqual(['$f1']);
    expect(out.ops).toHaveLength(2);

    const head = await revParse(b.root, 'HEAD');
    const before = head;
    const err = (text: string) => catchErrAsync(() => runBatch(ctx, text));

    const placeholder = await err(
      '{"op":"issue.edit","id":"$f9","set":{"title":{"from":"a","to":"b"}}}\n',
    );
    expect(placeholder.code).toBe('validation');
    expect(placeholder.message).toMatch(/^Zeile 1: /);

    const short = await err(
      `{"op":"issue.create","title":"X"}\n{"op":"issue.delete","id":"7f3"}\n`,
    );
    expect(short.code).toBe('validation');
    expect(short.details).toMatchObject({ line: 2 });

    const many = await err(`${'{"op":"issue.create","title":"X"}\n'.repeat(1001)}`);
    expect(many.code).toBe('validation');
    expect(many.message).toContain('höchstens 1000');

    const id = Object.values(out.refs)[0] as string;
    const attach = await err(`{"op":"attach.add","id":"${id}","name":"a","file":"a.txt"}\n`);
    expect(attach).toMatchObject({ code: 'validation' });
    expect(attach.message).toBe('Zeile 1: Datei-Anhänge gehen nicht per Batch');

    const claim = await err(`{"op":"issue.claim","id":"${id}"}\n`);
    expect(claim.code).toBe('validation');
    expect(claim.message).toBe('Zeile 1: issue.claim gibt es nicht im Batch');

    expect(await revParse(b.root, 'HEAD')).toBe(before);
  });

  test('errors come in line order: a forbidden op on line 2 before a schema error on line 5', async () => {
    const ctx = await b.context();
    const lines = [
      '{"op":"issue.create","title":"A","ref":"$a"}',
      '{"op":"issue.claim","id":"$a"}',
      '{"op":"issue.create","title":"B"}',
      '{"op":"issue.create","title":"C"}',
      '{"op":"issue.create"}',
    ];
    const err = await catchErrAsync(() => runBatch(ctx, `${lines.join('\n')}\n`));
    expect(err).toMatchObject({
      code: 'validation',
      message: 'Zeile 2: issue.claim gibt es nicht im Batch',
      details: { line: 2 },
    });
  });

  test('batch commit carries the operations as body', async () => {
    const ctx = await b.context();
    const out = await runBatch(
      ctx,
      '{"op":"issue.create","title":"A"}\n{"op":"issue.create","title":"B"}\n',
    );
    const raw = (await git(['log', '-1', '--format=%B'], { cwd: b.root })).stdout;
    const msg = parseCommitMessage(raw);
    expect(msg.subject).toBe(summarizeBatch(out.ops));
    expect(msg.trailers.get('Backe-Op')).toEqual(['batch']);
    expect(msg.body?.trim()).toBe(encodeBatchBody(out.ops).trim());
  });
});

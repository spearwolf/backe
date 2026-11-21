import { catchErr, reasonOf } from '../../test/helpers/catch.ts';
import { I, seqBytes, snap } from '../../test/helpers/snapshot.ts';
import type { BackeError } from '../core/errors.ts';
import type { ApplyContext } from './apply.ts';
import { applyBatch, MAX_BATCH, parseBatchInput } from './batch.ts';
import type { Operation } from './operation.ts';

const ctx = (extra: Partial<ApplyContext> = {}): ApplyContext => ({
  actor: 'spw',
  now: '2026-11-19T08:00:00Z',
  randomBytes: seqBytes(),
  ...extra,
});

const create = (title: string): Operation => ({ op: 'issue.create', title });
const lineOf = (err: BackeError) => (err.details as { line?: number }).line;

describe('applyBatch', () => {
  test('placeholders resolve in later lines and map to ids', () => {
    const r = applyBatch(
      snap({}),
      [
        { op: 'issue.create', ref: '$p1', title: 'Paket' },
        { op: 'issue.create', ref: '$f1', title: 'Finding', parent: '$p1' },
        { op: 'issue.create', title: 'Folge', depends_on: ['$f1'] },
      ],
      ctx(),
    );
    expect(Object.keys(r.refs)).toEqual(['$p1', '$f1']);
    expect(r.snapshot.issues.get(r.refs.$f1 as string)?.data.parent).toBe(r.refs.$p1);
    expect(r.recorded.map((o) => (o as { ref?: string }).ref)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(r.recorded[1]).toMatchObject({ id: r.refs.$f1, parent: r.refs.$p1 });
    expect(r.recorded[2]).toMatchObject({ depends_on: [r.refs.$f1] });
    expect(r.changes).toHaveLength(3);
  });

  test('one bad line writes nothing and names the line', () => {
    const err = catchErr(() =>
      applyBatch(
        snap({}),
        [create('a'), { op: 'issue.create', title: 'b', parent: '$nope' }],
        ctx(),
      ),
    );
    expect([err.message.startsWith('Zeile 2: '), lineOf(err), err.code]).toEqual([
      true,
      2,
      'validation',
    ]);
    expect(reasonOf(err)).toBe('schema');
  });

  test('an error keeps its code and reason and gains the line', () => {
    const s = snap({ issues: [{ id: I(1), title: 'A' }] });
    const err = catchErr(() =>
      applyBatch(
        s,
        [
          { op: 'issue.edit', id: I(1), set: { title: { from: 'A', to: 'B' } } },
          { op: 'issue.edit', id: I(1), set: { title: { from: 'A', to: 'C' } } },
        ],
        ctx(),
      ),
    );
    expect([err.code, reasonOf(err), lineOf(err)]).toEqual(['conflict', 'precondition', 2]);
    expect(err.message).toMatch(/^Zeile 2: /);
  });

  test('a line sees the state its predecessors left', () => {
    const r = applyBatch(
      snap({ issues: [{ id: I(1), title: 'A' }] }),
      [
        { op: 'issue.edit', id: I(1), set: { title: { from: 'A', to: 'B' } } },
        { op: 'issue.edit', id: I(1), set: { title: { from: 'B', to: 'C' } } },
      ],
      ctx(),
    );
    expect(r.snapshot.issues.get(I(1))?.data.title).toBe('C');
    expect(r.changes).toHaveLength(1);
  });

  test('create then delete in one batch leaves no changes for it', () => {
    const r = applyBatch(
      snap({}),
      [
        { op: 'issue.create', ref: '$a', title: 'x' },
        { op: 'issue.delete', id: '$a' },
      ],
      ctx(),
    );
    expect(r.changes).toEqual([]);
    expect(r.snapshot.issues.size).toBe(0);
    expect(r.recorded).toHaveLength(2);
  });

  test('a no-op line is not recorded', () => {
    const r = applyBatch(
      snap({ issues: [{ id: I(1), title: 'A' }] }),
      [{ op: 'issue.edit', id: I(1), set: { title: { from: 'A', to: 'A' } } }, create('neu')],
      ctx(),
    );
    expect(r.recorded.map((o) => o.op)).toEqual(['issue.create']);
    expect(r.changes).toHaveLength(1);
  });

  test('a batch of only no-ops changes and records nothing', () => {
    const r = applyBatch(
      snap({ issues: [{ id: I(1), title: 'A' }] }),
      [{ op: 'issue.edit', id: I(1), set: { title: { from: 'A', to: 'A' } } }],
      ctx(),
    );
    expect([r.recorded, r.changes, r.refs]).toEqual([[], [], {}]);
  });

  test('a duplicate ref is a schema error naming the line', () => {
    const err = catchErr(() =>
      applyBatch(
        snap({}),
        [
          { op: 'issue.create', ref: '$a', title: 'x' },
          { op: 'issue.create', ref: '$a', title: 'y' },
        ],
        ctx(),
      ),
    );
    expect([reasonOf(err), lineOf(err)]).toEqual(['schema', 2]);
  });

  test('notices of all lines are collected', () => {
    const s = snap({
      issues: [
        { id: I(1), state: 'review' },
        { id: I(2), state: 'review', parent: I(1) },
      ],
    });
    const r = applyBatch(
      s,
      [{ op: 'issue.move', id: I(1), from: 'review', to: 'done', force: true }],
      ctx(),
    );
    expect(r.notices.map((n) => n.code)).toContain('forced_done');
  });

  test('an empty batch is a validation error', () => {
    expect(catchErr(() => applyBatch(snap({}), [], ctx())).code).toBe('validation');
  });

  test('batch over 1000 ops is refused with a hint to split', () => {
    const ops = Array.from({ length: MAX_BATCH + 1 }, (_, i) => create(`t${i}`));
    const err = catchErr(() => applyBatch(snap({}), ops, ctx()));
    expect([err.code, err.hint]).toEqual(['validation', expect.stringMatching(/mehrere Batches/)]);
  });

  test('a large batch yields the same result as before', async () => {
    // Bestand: ein Binärbaum aus 200 Issues; 50 Creates hängen per Platzhalter aneinander.
    const issues = Array.from({ length: 200 }, (_, i) => ({
      id: I(i + 1),
      state: (['backlog', 'todo', 'in_progress'] as const)[i % 3],
      ...(i > 0 ? { parent: I(Math.floor((i + 1) / 2)) } : {}),
    }));
    const ops: Operation[] = Array.from({ length: 50 }, (_, i) => ({
      op: 'issue.create',
      ref: `$c${i}`,
      title: `Neu ${i}`,
      ...(i % 5 === 0 ? { parent: I(10 + i) } : i > 0 ? { parent: `$c${Math.floor(i / 2)}` } : {}),
      ...(i % 3 === 0 && i > 0 ? { depends_on: [`$c${i - 1}`, I(100 + i)] } : {}),
    }));
    // Jeder Aufruf liefert die Ziffern eines Zählers zur Basis 32: 50 verschiedene IDs.
    let calls = 0;
    const randomBytes = (n: number) => {
      const k = calls++;
      return Uint8Array.from({ length: n }, (_, i) => Math.floor(k / 32 ** (n - 1 - i)) % 32);
    };
    const r = applyBatch(snap({ issues }), ops, ctx({ randomBytes }));
    const result = {
      recorded: r.recorded,
      refs: r.refs,
      changes: r.changes,
      order: [...r.snapshot.issues.keys()],
    };
    await expect(`${JSON.stringify(result, null, 2)}\n`).toMatchFileSnapshot(
      '../../test/fixtures/batch-golden.json',
    );
  });

  test('errors that are not BackeErrors propagate unchanged', () => {
    const boom = new Error('boom');
    const randomBytes = () => {
      throw boom;
    };
    expect(() => applyBatch(snap({}), [create('a')], ctx({ randomBytes }))).toThrow(boom);
  });
});

describe('parseBatchInput', () => {
  const line = (title: string) => JSON.stringify({ op: 'issue.create', title });

  test('one operation per line, trailing newline and empty tail allowed', () => {
    expect(parseBatchInput(`${line('a')}\n${line('b')}\n\n\n`)).toEqual([
      { op: 'issue.create', title: 'a' },
      { op: 'issue.create', title: 'b' },
    ]);
  });

  test('CRLF line ends are accepted', () => {
    expect(parseBatchInput(`${line('a')}\r\n${line('b')}\r\n`)).toHaveLength(2);
  });

  test('parseBatchInput rejects an empty line in the middle', () => {
    const err = catchErr(() => parseBatchInput(`${line('a')}\n\n${line('b')}\n`));
    expect([reasonOf(err), lineOf(err), err.message.startsWith('Zeile 2: ')]).toEqual([
      'schema',
      2,
      true,
    ]);
  });

  test('a broken line names its physical line', () => {
    const err = catchErr(() => parseBatchInput(`${line('a')}\n${line('b')}\n{kaputt\n`));
    expect([lineOf(err), err.message.startsWith('Zeile 3: ')]).toEqual([3, true]);
  });

  test('input without any operation parses to an empty list', () => {
    expect(parseBatchInput('\n\n')).toEqual([]);
  });
});

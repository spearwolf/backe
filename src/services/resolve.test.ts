/**
 * `sync resolve` (backe.md §2.16.4): ein abgelegter Konflikt wird verworfen oder mit neu gesetzten
 * Vorbedingungen als ein Batch-Write angewendet. Die Einträge entstehen echt, durch eine
 * Sync-Runde des Agents gegen einen Remote-Stand, den `spw` vorher verändert hat.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { logTrailers, revParse, twoClones } from '../../test/helpers/git.ts';
import { seqBytes } from '../../test/helpers/snapshot.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import { stateDir } from '../git/local-state.ts';
import { bodyHash, type Operation } from '../ops/operation.ts';
import { attachmentsDir } from '../store/layout.ts';
import { listComments, loadSnapshot } from '../store/snapshot.ts';
import { resolveConflict } from './resolve.ts';
import { type SyncDeps, syncNow } from './sync.ts';
import { type ConflictEntry, listConflicts, writeConflicts } from './sync-state.ts';
import { executeWrite } from './write.ts';

let t: Awaited<ReturnType<typeof twoClones>>;

beforeEach(async () => {
  t = await twoClones();
});

const noSleep: SyncDeps = { sleep: async () => {} };
const spw = () => t.spw.ctx;
const agent = () => t.agent.ctx;
const wc = () => t.agent.wc;

async function write(ctx: ResolvedContext, op: Operation): Promise<string> {
  const r = await executeWrite(ctx, { kind: 'op', op });
  return (r.recorded[0] as { id: string }).id;
}

const setTitle = (id: string, from: string, to: string): Operation => ({
  op: 'issue.edit',
  id,
  set: { title: { from, to } },
});

async function shared(...titles: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const title of titles) ids.push(await write(spw(), { op: 'issue.create', title }));
  await syncNow(spw(), noSleep);
  await syncNow(agent(), noSleep);
  return ids;
}

/** `spw` ändert den Titel von `x` und pusht; der Agent ändert ihn lokal anders. */
async function titleConflict(x: string, ...followers: Operation[]): Promise<ConflictEntry> {
  await write(spw(), setTitle(x, 'X', 'Remote'));
  await syncNow(spw(), noSleep);
  await write(agent(), setTitle(x, 'X', 'Lokal'));
  for (const op of followers) await executeWrite(agent(), { kind: 'op', op });
  const r = await syncNow(agent(), noSleep);
  expect(r.conflicts).toHaveLength(1);
  return (await listConflicts(wc()))[0] as ConflictEntry;
}

const titleOf = async (id: string) => (await loadSnapshot(wc())).issues.get(id)?.data.title;

test('drop removes the entry', async () => {
  const [x] = (await shared('X')) as [string];
  const entry = await titleConflict(x);
  const head = await revParse(wc(), 'HEAD');

  const r = await resolveConflict(agent(), entry.id, 'drop');

  expect(r).toEqual({ commit: undefined, ops: [setTitle(x, 'X', 'Lokal')] });
  expect(await listConflicts(wc())).toEqual([]);
  expect(await revParse(wc(), 'HEAD')).toBe(head);
  expect(await titleOf(x)).toBe('Remote');
});

test('apply rebases preconditions and writes one batch', async () => {
  const [x] = (await shared('X')) as [string];
  const entry = await titleConflict(x, { op: 'comment.add', id: x, body: 'Dazu' });
  expect(entry.units).toHaveLength(2);

  const r = await resolveConflict(agent(), entry.id, 'apply');

  expect(r.commit).toBe(await revParse(wc(), 'HEAD'));
  expect(r.ops.map((op) => op.op)).toEqual(['issue.edit', 'comment.add']);
  expect(r.ops[0]).toEqual(setTitle(x, 'Remote', 'Lokal'));
  expect((await logTrailers(wc()))[0]).toMatchObject({ actor: 'claude-1', op: 'batch' });
  expect(await titleOf(x)).toBe('Lokal');
  expect((await listComments(wc(), x)).map((c) => c.body.trim())).toEqual(['Dazu']);
  expect(await listConflicts(wc())).toEqual([]);
});

test('apply of a single operation writes it as an op commit', async () => {
  const [x] = (await shared('X')) as [string];
  const entry = await titleConflict(x);

  const r = await resolveConflict(agent(), entry.id, 'apply');

  expect(r.ops).toEqual([setTitle(x, 'Remote', 'Lokal')]);
  expect((await logTrailers(wc()))[0]?.op).toContain('"op":"issue.edit"');
  expect(await titleOf(x)).toBe('Lokal');
});

test('apply restores attachment content from the original commit', async () => {
  const [x] = (await shared('X')) as [string];
  const bytes = Buffer.from([0, 1, 2, 255, 10]);
  const entry = await titleConflict(x, {
    op: 'attach.add',
    id: x,
    name: 'log',
    file: 'log.bin',
    content: bytes,
  });
  expect(entry.units[1]?.sources).toBeDefined();

  await resolveConflict(agent(), entry.id, 'apply');

  const blob = await readFile(join(wc(), attachmentsDir(x), 'log.bin'));
  expect(blob.equals(bytes)).toBe(true);
  expect(await listConflicts(wc())).toEqual([]);
});

test('apply with a lost attachment source is validation and keeps the entry', async () => {
  const [x] = (await shared('X')) as [string];
  const entry = await titleConflict(x, {
    op: 'attach.add',
    id: x,
    name: 'log',
    file: 'log.bin',
    content: Buffer.from('x\n'),
  });
  const file = join(await stateDir(wc()), 'conflicts', `${entry.id}.json`);
  const text = await readFile(file, 'utf8');
  const sha = entry.units[1]?.sha as string;
  await writeFile(file, text.replaceAll(`"${sha}:`, `"${'0'.repeat(40)}:`));
  const head = await revParse(wc(), 'HEAD');

  const err = await catchErrAsync(() => resolveConflict(agent(), entry.id, 'apply'));

  expect(err.code).toBe('validation');
  expect(err.message).toContain('log.bin');
  expect(await revParse(wc(), 'HEAD')).toBe(head);
  expect((await listConflicts(wc())).map((e) => e.id)).toEqual([entry.id]);
});

test('apply that still violates an invariant keeps the entry', async () => {
  const [x, y] = (await shared('X', 'Y')) as [string, string];
  await write(spw(), { op: 'issue.delete', id: y });
  await syncNow(spw(), noSleep);
  await write(agent(), { op: 'issue.edit', id: x, add: { depends_on: [y] } });
  const r = await syncNow(agent(), noSleep);
  expect(r.conflicts).toHaveLength(1);
  const [entry] = (await listConflicts(wc())) as [ConflictEntry];
  const head = await revParse(wc(), 'HEAD');

  const err = await catchErrAsync(() => resolveConflict(agent(), entry.id, 'apply'));

  expect(err.code).toBe('not_found');
  expect(await revParse(wc(), 'HEAD')).toBe(head);
  expect((await listConflicts(wc())).map((e) => e.id)).toEqual([entry.id]);
});

test('unknown conflict id is not_found', async () => {
  for (const action of ['drop', 'apply'] as const) {
    const err = await catchErrAsync(() =>
      resolveConflict(agent(), '20261120T080000Z-abcdef', action),
    );
    expect(err).toMatchObject({
      code: 'not_found',
      message: 'Konflikt 20261120T080000Z-abcdef nicht gefunden',
    });
  }
  expect((await catchErrAsync(() => resolveConflict(agent(), '../x', 'drop'))).code).toBe(
    'not_found',
  );
});

test('apply gives a colliding created issue a fresh id', async () => {
  const [x] = (await shared('X')) as [string];
  const entry = await titleConflict(x);
  // Ein Eintrag, dessen issue.create eine inzwischen vergebene ID nennt.
  const file = join(await stateDir(wc()), 'conflicts', `${entry.id}.json`);
  const stored = JSON.parse(await readFile(file, 'utf8')) as {
    units: { ops: unknown[] }[];
  };
  (stored.units[0] as { ops: unknown[] }).ops.push({
    op: 'issue.create',
    id: x,
    title: 'Doppelt',
  });
  await writeFile(file, JSON.stringify(stored));

  const r = await resolveConflict(agent(), entry.id, 'apply');

  const created = r.ops.find((op) => op.op === 'issue.create') as { id: string };
  expect(created.id).not.toBe(x);
  expect(await titleOf(created.id)).toBe('Doppelt');
  expect(await titleOf(x)).toBe('Lokal');
});

test('apply without a recorded attachment source is validation', async () => {
  const [x] = (await shared('X')) as [string];
  const entry = await titleConflict(x, {
    op: 'attach.add',
    id: x,
    name: 'log',
    file: 'log.bin',
    content: Buffer.from('x\n'),
  });
  const file = join(await stateDir(wc()), 'conflicts', `${entry.id}.json`);
  const stored = JSON.parse(await readFile(file, 'utf8')) as { units: { sources?: unknown }[] };
  delete (stored.units[1] as { sources?: unknown }).sources;
  await writeFile(file, JSON.stringify(stored));

  const err = await catchErrAsync(() => resolveConflict(agent(), entry.id, 'apply'));

  expect(err).toMatchObject({ code: 'validation', hint: `backe sync resolve ${entry.id} --drop` });
});

test('apply without effect writes nothing and removes the entry', async () => {
  const [x] = (await shared('X')) as [string];
  const entry = await titleConflict(x);
  await write(spw(), setTitle(x, 'Remote', 'Lokal'));
  await syncNow(spw(), noSleep);
  await syncNow(agent(), noSleep);
  const head = await revParse(wc(), 'HEAD');

  const r = await resolveConflict(agent(), entry.id, 'apply');

  expect(r).toEqual({ commit: undefined, ops: [setTitle(x, 'Lokal', 'Lokal')] });
  expect(await revParse(wc(), 'HEAD')).toBe(head);
  expect(await listConflicts(wc())).toEqual([]);
});

test('apply rebases the hash of a comment edit onto the current comment', async () => {
  const [x] = (await shared('X')) as [string];
  const added = await executeWrite(agent(), {
    kind: 'op',
    op: { op: 'comment.add', id: x, body: 'jetzt' },
  });
  const file = (added.recorded[0] as { file: string }).file;
  const entry: ConflictEntry = {
    version: 1,
    id: '20261120T080000Z-0a0b0c',
    created: '2026-11-20T08:00:00Z',
    onto: await revParse(wc(), 'HEAD'),
    reason: { code: 'conflict', message: 'Vorbedingung', reason: 'precondition' },
    units: [
      {
        sha: await revParse(wc(), 'HEAD'),
        subject: 'comment edit',
        kind: 'op',
        ops: [{ op: 'comment.edit', id: x, file, from_hash: bodyHash('früher'), body: 'neu' }],
      },
    ],
  };
  await writeConflicts(wc(), [entry]);

  const r = await resolveConflict(agent(), entry.id, 'apply', { randomBytes: seqBytes() });

  expect(r.ops).toMatchObject([{ op: 'comment.edit', file }]);
  expect((await listComments(wc(), x)).map((c) => c.body.trim())).toEqual(['neu']);
});

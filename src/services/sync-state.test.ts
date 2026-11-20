import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { type TestBacklog, testBacklog } from '../../test/helpers/git.ts';
import { I } from '../../test/helpers/snapshot.ts';
import { stateDir } from '../git/local-state.ts';
import {
  type ConflictEntry,
  listConflicts,
  readSyncState,
  removeConflict,
  writeConflicts,
  writeSyncState,
} from './sync-state.ts';

let b: TestBacklog;

beforeEach(async () => {
  b = await testBacklog();
});

const entry = (id: string, ops: ConflictEntry['units'][number]['ops']): ConflictEntry => ({
  version: 1,
  id,
  created: '2026-11-19T08:00:00Z',
  onto: 'a'.repeat(40),
  reason: { code: 'conflict', message: 'm', reason: 'precondition', ids: [I(1)] },
  units: [{ sha: 'b'.repeat(40), subject: 's', kind: 'op', ops }],
});

test('conflict entries round-trip and list sorted', async () => {
  const later = entry('20261119T080001Z-00ff00', [
    { op: 'issue.edit', id: I(1), set: { title: { from: 'A', to: 'C' } } },
  ]);
  const earlier = entry('20261119T080000Z-abcdef', [
    {
      op: 'attach.add',
      id: I(1),
      name: 'log',
      file: 'log.txt',
      content: Buffer.from('bytes'),
    },
  ]);
  await writeConflicts(b.root, [later, earlier]);
  const listed = await listConflicts(b.root);
  expect(listed.map((e) => e.id)).toEqual([earlier.id, later.id]);
  expect(listed[1]).toEqual(later);
  // Der Inhalt eines Anhangs steht nie in der Ablage; er kommt aus dem Ursprungs-Commit.
  expect(listed[0]?.units[0]?.ops).toEqual([
    { op: 'attach.add', id: I(1), name: 'log', file: 'log.txt' },
  ]);
  const dir = join(await stateDir(b.root), 'conflicts');
  expect((await readdir(dir)).sort()).toEqual([`${earlier.id}.json`, `${later.id}.json`]);

  await removeConflict(b.root, earlier.id);
  expect((await listConflicts(b.root)).map((e) => e.id)).toEqual([later.id]);
});

test('listing without a conflict store is empty and skips broken entries', async () => {
  expect(await listConflicts(b.root)).toEqual([]);
  await writeConflicts(b.root, [entry('20261119T080000Z-abcdef', [])]);
  const dir = join(await stateDir(b.root), 'conflicts');
  await writeFile(join(dir, '20261119T080002Z-000000.json'), '{kaputt');
  await writeFile(join(dir, 'notiz.txt'), 'x');
  // Eine Datei, deren Inhalt eine andere ID nennt, ist kein Eintrag.
  await writeFile(
    join(dir, '20261119T080003Z-000000.json'),
    JSON.stringify(entry('20261119T080004Z-000000', [])),
  );
  expect((await listConflicts(b.root)).map((e) => e.id)).toEqual(['20261119T080000Z-abcdef']);
});

test('a malformed conflict id is never written', async () => {
  const err = await catchErrAsync(() => writeConflicts(b.root, [entry('../x', [])]));
  expect([err.code, err.message]).toEqual(['unexpected', 'Ungültige Konflikt-ID »../x«']);
});

test('removing an unknown or malformed conflict id is not_found', async () => {
  for (const id of ['20261119T080000Z-abcdef', '../sync']) {
    const err = await catchErrAsync(() => removeConflict(b.root, id));
    expect([err.code, err.message]).toEqual(['not_found', `Konflikt ${id} nicht gefunden`]);
  }
});

test('sync state round-trips with version 1', async () => {
  expect(await readSyncState(b.root)).toEqual({});
  const s = {
    last_attempt: '2026-11-19T08:00:00Z',
    last_error: {
      code: 'sync',
      message: 'Push nach 5 Runden abgelehnt',
      at: '2026-11-19T08:00:00Z',
      paths: ['notes.md'],
      commit: 'c'.repeat(40),
    },
  };
  await writeSyncState(b.root, s);
  expect(await readSyncState(b.root)).toEqual(s);
  const raw = JSON.parse(await readFile(join(await stateDir(b.root), 'sync.json'), 'utf8'));
  expect(raw.version).toBe(1);

  await writeSyncState(b.root, { last_attempt: 'x', last_success: 'x' });
  expect(await readSyncState(b.root)).toEqual({ last_attempt: 'x', last_success: 'x' });
});

test('a broken sync.json reads as empty', async () => {
  const file = join(await stateDir(b.root), 'sync.json');
  for (const text of ['{kaputt', '[]', '{"version":2,"last_attempt":"x"}', '{"last_attempt":3}']) {
    await writeFile(file, text);
    expect(await readSyncState(b.root)).toEqual({});
  }
});

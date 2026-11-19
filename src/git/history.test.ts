import { realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { rawCommit, testKey } from '../../test/helpers/git.ts';
import { sshFingerprint } from '../core/ssh.ts';
import { git } from './exec.ts';
import {
  isAncestor,
  listCommits,
  listTree,
  objectInfo,
  readBlobs,
  removedHandles,
  resolveCommit,
  rootCommits,
  signatures,
  treeChanges,
} from './history.ts';

async function repo(): Promise<string> {
  const wc = await realpath(await tempDir());
  await git(['init', '-q', '-b', 'main'], { cwd: wc });
  return wc;
}

test('removedHandles lists handles whose user file was deleted before rev', async () => {
  const wc = await repo();
  await rawCommit(wc, {
    files: { 'users/ann.md': 'a\n', 'users/bob.md': 'b\n', 'projects/web.md': 'w\n' },
  });
  const beforeRemoval = await rawCommit(wc, {
    files: { 'users/ann.md': null, 'projects/web.md': null },
  });
  await rawCommit(wc, { files: { 'users/bob.md': null, 'users/ann.md': 'a\n' } });

  expect(await removedHandles(wc, 'HEAD')).toEqual(new Set(['ann', 'bob']));
  expect(await removedHandles(wc, beforeRemoval)).toEqual(new Set(['ann']));
  expect(await removedHandles(wc, `${beforeRemoval}~1`)).toEqual(new Set());
});

test('listCommits lists oldest first with parents and message, from exclusive', async () => {
  const wc = await repo();
  const a = await rawCommit(wc, { files: { x: '1' }, subject: 'eins' });
  const b = await rawCommit(wc, { files: { x: '2' }, subject: 'zwei', actor: 'spw' });
  // Ein Commit-Datum vor dem Parent ändert die Reihenfolge nicht.
  const c = await rawCommit(wc, {
    files: { x: '3' },
    subject: 'drei',
    date: '2001-01-01T00:00:00Z',
  });

  const all = await listCommits(wc, { from: undefined, to: 'HEAD' });
  expect(all.map((x) => x.sha)).toEqual([a, b, c]);
  expect(all[0]?.parents).toEqual([]);
  expect(all[1]).toEqual({ sha: b, parents: [a], message: 'zwei\n\nBacke-Actor: spw\n' });
  expect((await listCommits(wc, { from: a, to: c })).map((x) => x.sha)).toEqual([b, c]);
  expect(await listCommits(wc, { from: c, to: c })).toEqual([]);
});

test('signatures reports status, fingerprint and principal per commit', async () => {
  const wc = await repo();
  const spw = await testKey('spw');
  const mallory = await testKey('mallory');
  const good = await rawCommit(wc, { files: { x: '1' }, key: spw });
  const unknown = await rawCommit(wc, { files: { x: '2' }, key: mallory });
  const unsigned = await rawCommit(wc, { files: { x: '3' } });
  const signers = join(await realpath(await tempDir()), 'allowed_signers');
  await writeFile(signers, `spw namespaces="git" ${spw.line}\n`);

  const sigs = await signatures(wc, [unsigned, good, unknown], signers);
  expect(sigs).toEqual(
    new Map([
      [unsigned, { status: 'N', fingerprint: '', principal: '' }],
      [good, { status: 'G', fingerprint: sshFingerprint(spw.line), principal: 'spw' }],
      [unknown, { status: 'U', fingerprint: sshFingerprint(mallory.line), principal: '' }],
    ]),
  );
  expect(await signatures(wc, [], signers)).toEqual(new Map());
});

test('treeChanges lists raw changes with modes, without rename detection', async () => {
  const wc = await repo();
  const root = await rawCommit(wc, { files: { 'a.md': 'gleich\n', 'b.md': 'b\n' } });
  const next = await rawCommit(wc, {
    files: { 'a.md': null, 'c.md': 'gleich\n', 'b.md': { symlink: '/etc/passwd' } },
  });

  expect(await treeChanges(wc, undefined, root)).toEqual([
    { path: 'a.md', status: 'A', oldMode: '000000', newMode: '100644' },
    { path: 'b.md', status: 'A', oldMode: '000000', newMode: '100644' },
  ]);
  expect(await treeChanges(wc, root, next)).toEqual([
    { path: 'a.md', status: 'D', oldMode: '100644', newMode: '000000' },
    { path: 'b.md', status: 'T', oldMode: '100644', newMode: '120000' },
    { path: 'c.md', status: 'A', oldMode: '000000', newMode: '100644' },
  ]);
});

test('readBlobs returns raw bytes per spec and null for missing or non-blob objects', async () => {
  const wc = await repo();
  const bytes = Buffer.from([0, 255, 10, 0, 1]);
  await rawCommit(wc, { files: { 'dir/text.md': 'ä\n' } });
  await writeFile(join(wc, 'bin'), bytes);
  const blob = (await git(['hash-object', '-w', 'bin'], { cwd: wc })).stdout.trim();

  const blobs = await readBlobs(wc, ['HEAD:dir/text.md', 'HEAD:fehlt', 'HEAD:dir', blob]);
  expect(blobs.get('HEAD:dir/text.md')).toEqual(Buffer.from('ä\n'));
  expect(blobs.get('HEAD:fehlt')).toBeNull();
  expect(blobs.get('HEAD:dir')).toBeNull();
  expect(blobs.get(blob)).toEqual(bytes);
  expect(await readBlobs(wc, [])).toEqual(new Map());
});

test('objectInfo and listTree describe trees without reading blobs', async () => {
  const wc = await repo();
  await rawCommit(wc, { files: { 'users/a b.md': 'a\n', 'users/l': { symlink: 'x' } } });

  const info = await objectInfo(wc, ['HEAD:users', 'HEAD:users/a b.md', 'HEAD:fehlt']);
  expect(info.get('HEAD:users')).toMatchObject({ type: 'tree' });
  expect(info.get('HEAD:users/a b.md')).toMatchObject({ type: 'blob' });
  expect(info.get('HEAD:fehlt')).toBeUndefined();

  const tree = info.get('HEAD:users')?.oid as string;
  expect(await listTree(wc, tree)).toEqual([
    { mode: '100644', type: 'blob', oid: info.get('HEAD:users/a b.md')?.oid, name: 'a b.md' },
    { mode: '120000', type: 'blob', oid: expect.any(String), name: 'l' },
  ]);
});

test('isAncestor, rootCommits and resolveCommit answer about the history', async () => {
  const wc = await repo();
  const a = await rawCommit(wc, { files: { x: '1' } });
  const b = await rawCommit(wc, { files: { x: '2' } });
  const other = await rawCommit(wc, { files: { y: '1' }, parents: [] });
  const merged = await rawCommit(wc, { files: {}, parents: [b, other] });

  expect(await isAncestor(wc, a, b)).toBe(true);
  expect(await isAncestor(wc, a, a)).toBe(true);
  expect(await isAncestor(wc, b, a)).toBe(false);
  expect(await rootCommits(wc, b)).toEqual([a]);
  expect((await rootCommits(wc, merged)).sort()).toEqual([a, other].sort());
  expect(await resolveCommit(wc, 'HEAD^1')).toBe(b);
  const err = await catchErrAsync(() => resolveCommit(wc, 'gibtsnicht'));
  expect(err.code).toBe('not_found');
  expect(err.message).toBe('Revision gibtsnicht nicht gefunden');
  expect((await catchErrAsync(() => resolveCommit(wc, `${b}:x`))).code).toBe('not_found');
});

import { readdir } from 'node:fs/promises';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import { git } from './exec.ts';
import { stateDir } from './local-state.ts';
import { mergeText } from './merge-file.ts';

const labels: [string, string, string] = ['remote', 'basis', 'lokal'];
const b = (s: string) => Buffer.from(s);

test('non-overlapping edits merge cleanly', async () => {
  const { root } = await testBacklog();
  const r = await mergeText(root, {
    base: b('1\n2\n3\n4\n5\n6\n7\n'),
    ours: b('1\nX\n3\n4\n5\n6\n7\n'),
    theirs: b('1\n2\n3\n4\n5\nY\n7\n'),
    labels,
  });
  expect(r.clean).toBe(true);
  expect(r.content.toString()).toBe('1\nX\n3\n4\n5\nY\n7\n');
  expect(await readdir(await stateDir(root))).not.toContainEqual(expect.stringMatching(/^merge-/));
});

test('overlapping edits return markers with the labels', async () => {
  const { root } = await testBacklog();
  const r = await mergeText(root, { base: b('a\n'), ours: b('b\n'), theirs: b('c\n'), labels });
  expect(r.clean).toBe(false);
  const text = r.content.toString();
  expect(text).toContain('<<<<<<< remote');
  expect(text).toContain('>>>>>>> lokal');
});

test('a failing merge-file call is unexpected and leaves no temp files', async () => {
  const { root } = await testBacklog();
  // Ein NUL im Label lässt den Prozessstart scheitern, nachdem die Temp-Dateien angelegt sind.
  const err = await catchErrAsync(() =>
    mergeText(root, { base: b(''), ours: b(''), theirs: b(''), labels: ['a\0b', 'x', 'y'] }),
  );
  expect(err.code).toBe('unexpected');
  expect(await readdir(await stateDir(root))).not.toContainEqual(expect.stringMatching(/^merge-/));
});

test('markers do not depend on the user merge.conflictStyle', async () => {
  const { root } = await testBacklog();
  await git(['config', 'merge.conflictStyle', 'diff3'], { cwd: root });
  const r = await mergeText(root, { base: b('a\n'), ours: b('b\n'), theirs: b('c\n'), labels });
  expect(r.content.toString()).not.toContain('||||||| basis');
});

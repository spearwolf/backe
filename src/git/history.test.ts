import { realpath } from 'node:fs/promises';
import { tempDir } from '../../test/helpers/backlog.ts';
import { rawCommit } from '../../test/helpers/git.ts';
import { git } from './exec.ts';
import { removedHandles } from './history.ts';

test('removedHandles lists handles whose user file was deleted before rev', async () => {
  const wc = await realpath(await tempDir());
  await git(['init', '-q', '-b', 'main'], { cwd: wc });
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

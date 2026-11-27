import { rawCommit, testBacklog } from '../../test/helpers/git.ts';
import { git } from '../git/exec.ts';
import { issueFile } from '../store/layout.ts';
import { issueActors } from './actors.ts';

const head = async (wc: string) => (await git(['rev-parse', 'HEAD'], { cwd: wc })).stdout.trim();

test('actors come from the commits between two heads', async () => {
  const b = await testBacklog();
  const from = await head(b.root);
  await rawCommit(b.root, {
    files: { [issueFile('bk-aaaaa')]: 'a\n', [issueFile('bk-bbbbb')]: 'b\n' },
    actor: 'claude-1',
    op: 'issue.edit',
  });
  await rawCommit(b.root, {
    files: { [issueFile('bk-aaaaa')]: 'a2\n' },
    actor: 'spw',
    op: 'issue.edit',
  });
  const actors = await issueActors(b.root, from, await head(b.root));
  expect(actors).toEqual(
    new Map([
      ['bk-aaaaa', new Set(['claude-1', 'spw'])],
      ['bk-bbbbb', new Set(['claude-1'])],
    ]),
  );
});

test('the same head has no actors', async () => {
  const b = await testBacklog();
  const h = await head(b.root);
  expect(await issueActors(b.root, h, h)).toEqual(new Map());
});

test('a commit with several actor trailers names all of them', async () => {
  const b = await testBacklog();
  const from = await head(b.root);
  await rawCommit(b.root, {
    files: { [issueFile('bk-ddddd')]: 'd\n' },
    actor: ['claude-1', 'spw'],
    op: 'issue.edit',
  });
  expect(await issueActors(b.root, from, await head(b.root))).toEqual(
    new Map([['bk-ddddd', new Set(['claude-1', 'spw'])]]),
  );
});

test('commits outside issues/ are not looked at', async () => {
  const b = await testBacklog();
  const from = await head(b.root);
  await rawCommit(b.root, { files: { 'projects/x.md': 'p\n' }, actor: 'spw', op: 'manual' });
  expect(await issueActors(b.root, from, await head(b.root))).toEqual(new Map());
});

test('a commit without an actor trailer adds nothing', async () => {
  const b = await testBacklog();
  const from = await head(b.root);
  await rawCommit(b.root, { files: { [issueFile('bk-ccccc')]: 'c\n' }, op: 'manual' });
  expect(await issueActors(b.root, from, await head(b.root))).toEqual(new Map());
});

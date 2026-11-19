import { symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { contextTree } from '../../test/helpers/context.ts';
import { findProjectConfig } from './project-config.ts';

test('nearest level wins, no merge across levels', async () => {
  const { at } = await contextTree({
    '.backlog.jsonc': '{ "backlog": "outer", "sprint": "w1" }',
    'code/.backlog.jsonc': '{ "project": "web" }',
    'code/app/src/.keep': '',
  });
  const level = await findProjectConfig(at('code/app/src'));
  expect(level?.dir).toBe(at('code'));
  expect(level?.shared?.config).toEqual({ project: 'web' });
  expect(level?.shared?.file).toBe(at('code/.backlog.jsonc'));
});

test('local and shared of one level are both returned', async () => {
  const { at } = await contextTree({
    'p/.backlog.jsonc': '{ "project": "web" }',
    'p/.backlog.local.jsonc': '{ "user": "spw" }',
  });
  const level = await findProjectConfig(at('p'));
  expect([level?.shared?.config.project, level?.local?.config.user]).toEqual(['web', 'spw']);
  expect(level?.local?.file).toBe(at('p/.backlog.local.jsonc'));
});

test('a level with only the local file counts', async () => {
  const { at } = await contextTree({ 'p/.backlog.local.jsonc': '{ "sprint": "w2" }' });
  const level = await findProjectConfig(at('p'));
  expect(level?.local?.config.sprint).toBe('w2');
  expect(level?.shared).toBeUndefined();
});

test('nothing found up to the root', async () => {
  const { at } = await contextTree({ 'a/.keep': '' });
  expect(await findProjectConfig(at('a'))).toBeUndefined();
});

test('symlinked cwd finds the same config as the physical path', async () => {
  const { root, at } = await contextTree({
    'real/.backlog.jsonc': '{ "project": "web" }',
    'real/sub/.keep': '',
  });
  await symlink(at('real/sub'), join(root, 'link'));
  expect((await findProjectConfig(join(root, 'link')))?.dir).toBe(at('real'));
});

test('user in the shared file is rejected with a hint', async () => {
  const { at } = await contextTree({ 'p/.backlog.jsonc': '{ "user": "spw" }' });
  const err = await catchErrAsync(() => findProjectConfig(at('p')));
  expect([err.code, err.hint]).toEqual([
    'validation',
    expect.stringContaining('.backlog.local.jsonc'),
  ]);
  expect(err.message).toContain(at('p/.backlog.jsonc'));
});

test('syntax error names file and line', async () => {
  const { at } = await contextTree({ 'p/.backlog.jsonc': '{\n  "project": \n}' });
  expect((await catchErrAsync(() => findProjectConfig(at('p')))).message).toMatch(
    /\.backlog\.jsonc:3/,
  );
});

test('schema error names file and key path', async () => {
  const { at } = await contextTree({ 'p/.backlog.local.jsonc': '{ "sprint": 5 }' });
  const err = await catchErrAsync(() => findProjectConfig(at('p')));
  expect([err.code, err.message]).toEqual([
    'validation',
    expect.stringContaining(`${at('p/.backlog.local.jsonc')}: sprint:`),
  ]);
});

test('a directory named like the config file is not "no file"', async () => {
  const { at } = await contextTree({ 'p/.backlog.jsonc/x': '' });
  await expect(findProjectConfig(at('p'))).rejects.toMatchObject({ code: 'EISDIR' });
});

test('two broken project configs report .backlog.jsonc first', async () => {
  const { at } = await contextTree({
    'p/.backlog.jsonc': '{ "sprint": 5 }',
    'p/.backlog.local.jsonc': '{ "sprint": 6 }',
  });
  for (let i = 0; i < 20; i++) {
    const err = await catchErrAsync(() => findProjectConfig(at('p')));
    expect(err.message.startsWith(at('p/.backlog.jsonc'))).toBe(true);
  }
});

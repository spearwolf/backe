import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { readUserConfig, updateUserConfig, userConfigPath } from './user-config.ts';

const HAND = `{
  // mein Default
  "user": "spw",
  "backlogs": {
    "acme": { "remote": "git@github.com:acme/backlog.git", }, // trailing comma
  },
}
`;

test('missing config reads as empty', async () => {
  expect(await readUserConfig(await tempDir())).toEqual({});
});

test('update keeps comments and touches only the changed value', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), HAND);
  await updateUserConfig(home, () => [{ path: ['current'], value: 'acme' }]);
  const text = await readFile(userConfigPath(home), 'utf8');
  expect(text).toContain('// mein Default');
  expect(text).toContain('// trailing comma');
  expect((await readUserConfig(home)).current).toBe('acme');
});

test('undefined removes a key', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), HAND);
  await updateUserConfig(home, () => [{ path: ['user'], value: undefined }]);
  expect((await readUserConfig(home)).user).toBeUndefined();
});

test('an invalid result is rejected and nothing is written', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), HAND);
  const err = await catchErrAsync(() =>
    updateUserConfig(home, () => [{ path: ['user'], value: 'Bad Handle' }]),
  );
  expect(err.code).toBe('validation');
  expect(err.message).toContain('user');
  expect(await readFile(userConfigPath(home), 'utf8')).toBe(HAND);
});

test('a typo key names its path', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), '{ "backlogs": { "acme": { "remte": "x" } } }\n');
  expect((await catchErrAsync(() => readUserConfig(home))).message).toContain('backlogs.acme');
});

test('a syntax error names file and line', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), '{\n  "user": \n');
  const err = await catchErrAsync(() => readUserConfig(home));
  expect(err.code).toBe('validation');
  expect(err.message).toContain(`${userConfigPath(home)}:`);
});

test('concurrent updates keep both entries', async () => {
  const home = await tempDir();
  await Promise.all(
    ['a-1', 'a-2'].map((h) =>
      updateUserConfig(home, () => [
        { path: ['identities', 'acme', h], value: { key: `/k/${h}` } },
      ]),
    ),
  );
  expect(Object.keys((await readUserConfig(home)).identities?.acme ?? {}).sort()).toEqual([
    'a-1',
    'a-2',
  ]);
});

test('a fresh home is created private', async () => {
  const home = join(await tempDir(), 'b');
  await updateUserConfig(home, () => [{ path: ['user'], value: 'spw' }]);
  expect((await stat(home)).mode & 0o777).toBe(0o700);
});

test('no edits writes nothing', async () => {
  const home = await tempDir();
  expect(await updateUserConfig(home, () => [])).toEqual({});
  await expect(stat(userConfigPath(home))).rejects.toThrow();
});

test('edit sees the freshly read config', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), HAND);
  let seen: string | undefined;
  await updateUserConfig(home, (current) => {
    seen = current.user;
    return [];
  });
  expect(seen).toBe('spw');
});

test('a non-object config is rejected at the root', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), '[]\n');
  const err = await catchErrAsync(() => readUserConfig(home));
  expect(err.code).toBe('validation');
  expect(err.message).toContain('(Wurzel)');
});

test('an unreadable config file is not mistaken for a missing one', async () => {
  const home = await tempDir();
  await mkdir(userConfigPath(home));
  await expect(readUserConfig(home)).rejects.toThrow(/EISDIR/);
});

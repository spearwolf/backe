import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import {
  type ConfigEdit,
  readUserConfig,
  updateUserConfig,
  userConfigPath,
} from './user-config.ts';

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

/** Schreibt `before`, wendet die Edits an und liefert den Dateitext zurück. */
async function edited(before: string, edits: readonly ConfigEdit[]): Promise<string> {
  const home = await tempDir();
  await writeFile(userConfigPath(home), before);
  await updateUserConfig(home, () => edits);
  return readFile(userConfigPath(home), 'utf8');
}

const TABS =
  '{\n\t"user": "spw",\n\t"backlogs": {\n\t\t"acme": {"remote":"git@github.com:acme/a.git"},\n\t},\n}\n';
const CRLF = '{\r\n  "backlogs": {},\r\n  "user": "spw" // x\r\n}\r\n';

test('update keeps comments and touches only the changed value', async () => {
  expect(await edited(HAND, [{ path: ['current'], value: 'acme' }])).toBe(
    HAND.replace('  },\n}\n', '  },\n  "current": "acme",\n}\n'),
  );
});

test('a tab-indented file gets a tab-indented top-level key and no other byte changes', async () => {
  expect(await edited(TABS, [{ path: ['current'], value: 'acme' }])).toBe(
    '{\n\t"user": "spw",\n\t"backlogs": {\n\t\t"acme": {"remote":"git@github.com:acme/a.git"},\n\t},\n\t"current": "acme",\n}\n',
  );
});

test('a sibling inside a tab-indented object leaves the existing sibling untouched', async () => {
  expect(
    await edited(TABS, [
      { path: ['backlogs', 'other'], value: { remote: 'git@github.com:acme/b.git' } },
    ]),
  ).toBe(
    '{\n\t"user": "spw",\n\t"backlogs": {\n\t\t"acme": {"remote":"git@github.com:acme/a.git"},\n\t\t"other": {\n\t\t\t"remote": "git@github.com:acme/b.git"\n\t\t},\n\t},\n}\n',
  );
});

test('a CRLF file keeps its line ending and the trailing comment stays on its line', async () => {
  expect(await edited(CRLF, [{ path: ['current'], value: 'acme' }])).toBe(
    '{\r\n  "backlogs": {},\r\n  "user": "spw", // x\r\n  "current": "acme"\r\n}\r\n',
  );
});

test('several edits in one call all apply', async () => {
  expect(
    await edited(HAND, [
      { path: ['current'], value: 'acme' },
      { path: ['user'], value: undefined },
      { path: ['output', 'format'], value: 'json' },
    ]),
  ).toBe(`{
  // mein Default
  "backlogs": {
    "acme": { "remote": "git@github.com:acme/backlog.git", }, // trailing comma
  },
  "current": "acme",
  "output": {
    "format": "json"
  },
}
`);
});

test('a key is added to an empty object and to a single-line object', async () => {
  expect(await edited('{}\n', [{ path: ['user'], value: 'spw' }])).toBe('{\n  "user": "spw"\n}\n');
  expect(await edited('{ "user": "spw" }\n', [{ path: ['current'], value: 'a' }])).toBe(
    '{ "user": "spw", "current": "a" }\n',
  );
  expect(await edited('{ "user": "spw", }\n', [{ path: ['current'], value: 'a' }])).toBe(
    '{ "user": "spw", "current": "a", }\n',
  );
});

test('removing the last property drops the comma before it; absent keys are a no-op', async () => {
  const two = '{\n  "user": "spw",\n  "current": "acme"\n}\n';
  expect(await edited(two, [{ path: ['current'], value: undefined }])).toBe(
    '{\n  "user": "spw"\n}\n',
  );
  expect(await edited(two, [{ path: ['project'], value: undefined }])).toBe(two);
  expect(
    await edited('{ "user": "spw", "current": "a" }\n', [{ path: ['user'], value: undefined }]),
  ).toBe('{ "current": "a" }\n');
  expect(
    await edited('{\n  "user": "spw", // c\n  "current": "a"\n}\n', [
      { path: ['user'], value: undefined },
    ]),
  ).toBe('{\n  // c\n  "current": "a"\n}\n');
});

test('a duplicate key is edited at its last occurrence, which is the one the parser reads', async () => {
  const dup = '{ "current": "acme", "user": "spw", "current": "acme" }\n';
  expect(await edited(dup, [{ path: ['current'], value: 'beta' }])).toBe(
    '{ "current": "acme", "user": "spw", "current": "beta" }\n',
  );
  expect(
    await edited(
      '{ "backlogs": { "a": { "user": "xx" } }, "backlogs": { "a": { "user": "yy" } } }\n',
      [{ path: ['backlogs', 'a', 'user'], value: 'zz' }],
    ),
  ).toBe('{ "backlogs": { "a": { "user": "xx" } }, "backlogs": { "a": { "user": "zz" } } }\n');
  expect(
    await edited('{ "current": "beta", "user": "spw", "current": "acme" }\n', [
      { path: ['current'], value: undefined },
    ]),
  ).toBe('{ "current": "beta", "user": "spw" }\n');
});

test('a path through a non-object value is rejected by the schema, not written', async () => {
  const home = await tempDir();
  await writeFile(userConfigPath(home), HAND);
  const err = await catchErrAsync(() =>
    updateUserConfig(home, () => [{ path: ['user', 'x'], value: 1 }]),
  );
  expect(err.code).toBe('validation');
  expect(await readFile(userConfigPath(home), 'utf8')).toBe(HAND);
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

test('a ~name path names file and key path', async () => {
  const home = await tempDir();
  await writeFile(
    userConfigPath(home),
    '{ "backlogs": { "acme": { "paths": { "bob": "~bob/acme" } } } }',
  );
  const err = await catchErrAsync(() => readUserConfig(home));
  expect([err.code, err.message]).toEqual([
    'validation',
    expect.stringMatching(/config\.jsonc: backlogs\.acme\.paths\.bob: .*~name/),
  ]);
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

test('keys are inserted around comments and closing braces on the same line', async () => {
  expect(await edited('{ // c\n}\n', [{ path: ['user'], value: 'spw' }])).toBe(
    '{\n  "user": "spw" // c\n}\n',
  );
  expect(await edited('{\n  "user": "spw" }\n', [{ path: ['current'], value: 'a' }])).toBe(
    '{\n  "user": "spw",\n  "current": "a" }\n',
  );
});

test('a missing path with an array index is rejected by the schema', async () => {
  const err = await catchErrAsync(() => edited(HAND, [{ path: ['backlogs', 'zz', 0], value: 1 }]));
  expect(err.code).toBe('validation');
});

test('an edit that yields unparsable jsonc is unexpected and leaves the file', async () => {
  const home = await tempDir();
  const before = '{\n  "user": "spw"\n  , "current": "acme"\n}\n';
  await writeFile(userConfigPath(home), before);
  const err = await catchErrAsync(() =>
    updateUserConfig(home, () => [{ path: ['user'], value: undefined }]),
  );
  expect([err.code, err.message]).toEqual([
    'unexpected',
    `Edit an ${userConfigPath(home)} konnte nicht angewendet werden; Datei unverändert`,
  ]);
  expect(await readFile(userConfigPath(home), 'utf8')).toBe(before);
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'jsonc-parser';
import { catchErr, catchErrAsync } from '../../test/helpers/catch.ts';
import type { Homes } from '../context/paths.ts';
import { userConfigPath } from '../context/user-config.ts';
import { UserConfigSchema } from '../core/schemas.ts';
import { configKeyShape, editConfigText, getConfig, parseConfigKey, setConfig } from './config.ts';

let dir: string;
let homes: Homes;
let cfgPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'backe-config-'));
  homes = { home: join(dir, 'home'), backeHome: join(dir, 'backe') };
  await mkdir(homes.backeHome, { recursive: true });
  cfgPath = userConfigPath(homes.backeHome);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const parseText = (text: string) => parse(text) as Record<string, unknown>;

describe('setConfig', () => {
  test('config set keeps comments, canonicalizes repo keys and refuses invalid values', async () => {
    await writeFile(cfgPath, '{\n  // Standard\n  "user": "spw"\n}\n');
    await setConfig(homes, 'repos.https://github.com/Acme/WebApp.git', '~/code/webapp');
    const text = await readFile(cfgPath, 'utf8');
    expect(text).toContain('// Standard');
    expect(parseText(text).repos).toEqual({ 'github.com/acme/webapp': '~/code/webapp' });
    expect((await catchErrAsync(() => setConfig(homes, 'output.color', 'bunt'))).code).toBe(
      'validation',
    );
    expect(await readFile(cfgPath, 'utf8')).toBe(text);
  });

  test('set creates the file when missing and returns the config', async () => {
    const config = await setConfig(homes, 'output.format', 'json');
    expect(config.output).toEqual({ format: 'json' });
    expect(parseText(await readFile(cfgPath, 'utf8'))).toEqual({ output: { format: 'json' } });
  });

  test('unset removes a key; a missing key is a no-op and creates no file', async () => {
    await writeFile(cfgPath, '{\n  "user": "spw",\n  "sprint": "s1"\n}\n');
    const config = await setConfig(homes, 'sprint', undefined);
    expect(config).toEqual({ user: 'spw' });
    expect(parseText(await readFile(cfgPath, 'utf8'))).toEqual({ user: 'spw' });
    const before = await readFile(cfgPath, 'utf8');
    await setConfig(homes, 'backlogs.acme.user', undefined);
    expect(await readFile(cfgPath, 'utf8')).toBe(before);
    await rm(cfgPath);
    await setConfig(homes, 'user', undefined);
    await expect(readFile(cfgPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('set refuses an unknown key without touching the file', async () => {
    await writeFile(cfgPath, '{}\n');
    expect((await catchErrAsync(() => setConfig(homes, 'nope', 'x'))).code).toBe('validation');
    expect(await readFile(cfgPath, 'utf8')).toBe('{}\n');
  });
});

describe('parseConfigKey', () => {
  test.each([
    ['backlogs.acme.user', ['backlogs', 'acme', 'user']],
    ['identities.acme.claude-1.key', ['identities', 'acme', 'claude-1', 'key']],
    ['repos.gh:acme/api', ['repos', 'github.com/acme/api']],
    ['repos.github.com/acme/web.app', ['repos', 'github.com/acme/web.app']],
    ['backlogs.acme.paths.spw', ['backlogs', 'acme', 'paths', 'spw']],
    ['backlogs.acme.sync.mode', ['backlogs', 'acme', 'sync', 'mode']],
    ['$schema', ['$schema']],
  ])('parseConfigKey(%s)', (k, p) => expect(parseConfigKey(k)).toEqual(p));

  test.each([
    'backlogs',
    'output',
    'nope',
    'backlogs.acme.paths',
    'user.x',
    'backlogs..user',
    '',
    'repos',
  ])('parseConfigKey(%s) refuses', (k) =>
    expect(catchErr(() => parseConfigKey(k)).code).toBe('validation'),
  );

  test('messages name the value or the allowed keys', () => {
    expect(catchErr(() => parseConfigKey('backlogs')).message).toBe(
      '»backlogs« ist kein setzbarer Wert',
    );
    expect(catchErr(() => parseConfigKey('output.nope')).message).toBe(
      'Unbekannter Key »nope«; erlaubt: format, color',
    );
  });

  test('the key table matches UserConfigSchema', () => {
    expect(Object.keys(UserConfigSchema.shape)).toEqual(Object.keys(configKeyShape()));
  });
});

describe('getConfig', () => {
  test('get without key returns the file text, a missing file yields no text', async () => {
    expect(await getConfig(homes)).toEqual({ config: {} });
    const text = '{\n  // c\n  "user": "spw"\n}\n';
    await writeFile(cfgPath, text);
    expect(await getConfig(homes)).toEqual({ text, config: { user: 'spw' } });
  });

  test('get with key returns a string or an object; a missing key is not_found', async () => {
    await writeFile(cfgPath, '{"user":"spw","backlogs":{"acme":{"user":"xyz"}}}\n');
    expect((await getConfig(homes, 'user')).value).toBe('spw');
    expect((await getConfig(homes, 'backlogs.acme')).value).toEqual({ user: 'xyz' });
    expect((await getConfig(homes, 'backlogs')).value).toEqual({ acme: { user: 'xyz' } });
    expect((await catchErrAsync(() => getConfig(homes, 'sprint'))).code).toBe('not_found');
    expect((await catchErrAsync(() => getConfig(homes, 'backlogs.zzz.user'))).code).toBe(
      'not_found',
    );
    expect((await catchErrAsync(() => getConfig(homes, 'nope'))).code).toBe('validation');
  });
});

describe('editConfigText', () => {
  test('writes a valid result and keeps nothing else behind', async () => {
    await writeFile(cfgPath, '{\n  "user": "spw"\n}\n');
    await writeFile(`${cfgPath}.draft`, 'alt');
    const seen: string[] = [];
    const result = await editConfigText(homes, async (text) => {
      seen.push(text);
      return text.replace('spw', 'neu');
    });
    expect(result).toEqual({ changed: true });
    expect(seen).toEqual(['{\n  "user": "spw"\n}\n']);
    expect(await readFile(cfgPath, 'utf8')).toBe('{\n  "user": "neu"\n}\n');
    await expect(readFile(`${cfgPath}.draft`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('an unchanged text writes nothing, also for a missing file', async () => {
    expect(await editConfigText(homes, async (t) => t)).toEqual({ changed: false });
    await expect(readFile(cfgPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('a missing file is offered as an empty object and created on change', async () => {
    const result = await editConfigText(homes, async (t) => {
      expect(parseText(t)).toEqual({});
      return '{ "user": "spw" }\n';
    });
    expect(result).toEqual({ changed: true });
    expect(parseText(await readFile(cfgPath, 'utf8'))).toEqual({ user: 'spw' });
  });

  test('editConfigText writes a valid result and keeps a draft of an invalid one', async () => {
    const original = '{\n  "user": "spw"\n}\n';
    await writeFile(cfgPath, original);
    const syntax = await catchErrAsync(() => editConfigText(homes, async () => '{\n  "user": \n'));
    expect(syntax.code).toBe('validation');
    expect(syntax.message).toMatch(/config\.jsonc\.draft:\d+:/);
    expect(syntax.hint).toContain(`${cfgPath}.draft`);
    expect(await readFile(`${cfgPath}.draft`, 'utf8')).toBe('{\n  "user": \n');
    const schema = await catchErrAsync(() =>
      editConfigText(homes, async () => '{"output":{"color":"bunt"}}\n'),
    );
    expect(schema.code).toBe('validation');
    expect(schema.message.startsWith(`${cfgPath}.draft`)).toBe(true);
    expect(schema.hint).toContain('config.jsonc.draft');
    expect(await readFile(`${cfgPath}.draft`, 'utf8')).toBe('{"output":{"color":"bunt"}}\n');
    expect(await readFile(cfgPath, 'utf8')).toBe(original);
  });

  test('editConfigText refuses when the file changed meanwhile', async () => {
    await writeFile(cfgPath, '{\n  "user": "spw"\n}\n');
    const err = await catchErrAsync(() =>
      editConfigText(homes, async (text) => {
        await writeFile(cfgPath, '{\n  "user": "anderer"\n}\n');
        return text.replace('spw', 'neu');
      }),
    );
    expect(err.code).toBe('conflict');
    expect(await readFile(cfgPath, 'utf8')).toBe('{\n  "user": "anderer"\n}\n');
    expect(await readFile(`${cfgPath}.draft`, 'utf8')).toBe('{\n  "user": "neu"\n}\n');
  });

  test('a file created meanwhile conflicts with a missing original', async () => {
    const err = await catchErrAsync(() =>
      editConfigText(homes, async () => {
        await writeFile(cfgPath, '{"user":"xyz"}\n');
        return '{"user":"neu"}\n';
      }),
    );
    expect(err.code).toBe('conflict');
  });
});

import { chmod, symlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { catchErr } from '../../test/helpers/catch.ts';
import { contextTree } from '../../test/helpers/context.ts';
import { envValue, expandPath, physicalPath, resolveHomes, samePath } from './paths.ts';

const opts = { home: '/h', base: '/w' };

test.each([
  ['~', '/h'],
  ['~/x', '/h/x'],
  ['x/../y', '/w/y'],
  ['/a//b/', '/a/b'],
  ['./k', '/w/k'],
  ['/', '/'],
])('expandPath(%s) = %s', (p, out) => expect(expandPath(p, opts)).toBe(out));

test('~user is not supported', () =>
  expect(catchErr(() => expandPath('~bob/x', opts)).code).toBe('validation'));

test('envValue treats empty and missing as undefined', () => {
  expect(envValue({ A: 'x', B: '' }, 'A')).toBe('x');
  expect(envValue({ A: 'x', B: '' }, 'B')).toBeUndefined();
  expect(envValue({ A: 'x' }, 'C')).toBeUndefined();
});

test.each([
  [{ HOME: '/h' }, '/w', '/h/.backe'],
  [{ HOME: '/h', BACKE_HOME: '~/b' }, '/w', '/h/b'],
  [{ HOME: '/h', BACKE_HOME: 'rel' }, '/w', '/w/rel'],
  [{ HOME: '/h', BACKE_HOME: '' }, '/w', '/h/.backe'],
])('resolveHomes(%o)', (env, cwd, backeHome) =>
  expect(resolveHomes(env, cwd).backeHome).toBe(backeHome),
);

test('a ~name in BACKE_HOME names the variable', () => {
  const err = catchErr(() => resolveHomes({ HOME: '/h', BACKE_HOME: '~bob' }, '/w'));
  expect([err.code, err.message]).toEqual(['validation', expect.stringContaining('BACKE_HOME')]);
});

test('resolveHomes returns HOME from env and falls back to os.homedir()', () => {
  expect(resolveHomes({ HOME: '/h' }, '/w').home).toBe('/h');
  expect(resolveHomes({}, '/w').home).toBe(homedir());
});

test('physicalPath resolves symlinks, also below a missing tail', async () => {
  const { root, at } = await contextTree({ 'real/x': '' });
  await symlink(at('real'), at('link'));
  expect(await physicalPath(at('link/x'))).toBe(at('real/x'));
  expect(await physicalPath(at('link/missing/y'))).toBe(at('real/missing/y'));
  expect(await samePath(at('link'), join(root, 'real'))).toBe(true);
  expect(await samePath(at('link'), at('real/x'))).toBe(false);
});

test.skipIf(process.getuid?.() === 0)(
  'physicalPath rethrows errors other than a missing path',
  async () => {
    const { at } = await contextTree({ 'locked/sub/f': '' });
    await chmod(at('locked'), 0o000);
    try {
      await expect(physicalPath(at('locked/sub/f'))).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      await chmod(at('locked'), 0o700);
    }
  },
);

test('physicalPath treats ENOTDIR like a missing path', async () => {
  const { at } = await contextTree({ 'f.txt': 'x' });
  expect(await physicalPath(at('f.txt/x'))).toBe(join(await physicalPath(at('f.txt')), 'x'));
});

import { catchErr } from '../../test/helpers/catch.ts';
import {
  ATTACHMENT_NAME_RE,
  HANDLE_RE,
  isBacklogName,
  isGitArg,
  isHandle,
  isProjectPath,
  isRepoName,
  isSprintSlug,
  PROP_KEY_RE,
  parseRepoRef,
  projectAncestors,
  RESERVED_HANDLES,
} from './names.ts';

test('me is reserved', () => {
  expect(isHandle('me')).toBe(false);
  expect(RESERVED_HANDLES).toEqual(['me']);
});

test('handle rules', () => {
  expect(isHandle('ab')).toBe(true);
  expect(isHandle('a-b9')).toBe(true);
  expect(isHandle('a')).toBe(false);
  expect(isHandle('-ab')).toBe(false);
  expect(isHandle('Ab')).toBe(false);
  expect(isHandle('a'.repeat(32))).toBe(true);
  expect(isHandle('a'.repeat(33))).toBe(false);
  expect(HANDLE_RE.test('ab')).toBe(true);
});

test('project depth max 5', () => {
  expect(isProjectPath('a/b/c/d/e')).toBe(true);
  expect(isProjectPath('a/b/c/d/e/f')).toBe(false);
});

test.each(['', '/a', 'a/', 'a//b', 'A', '-a', 'a/-b', 'a b', 'a_b'])(
  'invalid project path %j',
  (s) => expect(isProjectPath(s)).toBe(false),
);
test.each(['a', 'web', 'web/auth-2', '0/1'])('valid project path %j', (s) =>
  expect(isProjectPath(s)).toBe(true),
);

test('projectAncestors lists proper ancestors root-first', () => {
  expect(projectAncestors('web/auth/sso')).toEqual(['web', 'web/auth']);
  expect(projectAncestors('web/auth')).toEqual(['web']);
  expect(projectAncestors('web')).toEqual([]);
});

test('sprint slug, repo name, attachment name, prop key', () => {
  expect(isSprintSlug('s-1')).toBe(true);
  expect(isSprintSlug('-s')).toBe(false);
  expect(isSprintSlug('a'.repeat(64))).toBe(true);
  expect(isSprintSlug('a'.repeat(65))).toBe(false);
  expect(isRepoName('web.app_x-1')).toBe(true);
  expect(isRepoName('.web')).toBe(false);
  expect(isRepoName('Web')).toBe(false);
  expect(ATTACHMENT_NAME_RE.test('shot.png')).toBe(true);
  expect(ATTACHMENT_NAME_RE.test('_x')).toBe(false);
  expect(PROP_KEY_RE.test('x.y_z-1')).toBe(true);
  expect(PROP_KEY_RE.test('1x')).toBe(false);
});

test('parseRepoRef keeps slashes in ref', () =>
  expect(parseRepoRef('webapp@feat/sso')).toEqual({ name: 'webapp', ref: 'feat/sso' }));

test('parseRepoRef without ref', () => expect(parseRepoRef('webapp')).toEqual({ name: 'webapp' }));

test('parseRepoRef splits at first @', () =>
  expect(parseRepoRef('webapp@a@b')).toEqual({ name: 'webapp', ref: 'a@b' }));

test.each([
  'webapp@',
  '@main',
  'Web@x',
  '',
  'a b@x',
  'webapp@--upload-pack=x',
  'webapp@-x',
  'webapp@a b',
  'webapp@a\nb',
  'webapp@\u0001',
])('parseRepoRef(%j) is validation error', (s) =>
  expect(catchErr(() => parseRepoRef(s)).code).toBe('validation'),
);

test.each(['main', 'feat/sso', '4e1f9c2', 'v1.2.3', 'a@b'])('parseRepoRef accepts ref %j', (ref) =>
  expect(parseRepoRef(`webapp@${ref}`)).toEqual({ name: 'webapp', ref }),
);

test('backlog names', () => {
  for (const s of ['acme', 'a', '0-x', 'a'.repeat(64)]) expect(isBacklogName(s)).toBe(true);
  for (const s of ['../../.ssh', 'a b', '\u0001', '', 'Acme', '-a', 'a_b', 'a'.repeat(65)])
    expect(isBacklogName(s)).toBe(false);
});

test('git arguments', () => {
  for (const s of ['origin', 'main', 'feat/sso', '4e1f9c2', 'a-b', 'x@y'])
    expect(isGitArg(s)).toBe(true);
  for (const s of [
    '--upload-pack=x',
    '-',
    'a b',
    ' a',
    'a\t',
    '\u0001',
    '\u007f',
    '\u0085',
    '\u00a0',
    '',
  ])
    expect(isGitArg(s)).toBe(false);
});

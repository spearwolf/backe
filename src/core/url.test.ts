import { catchErr } from '../../test/helpers/catch.ts';
import { isRepoName } from './names.ts';
import { deriveRepoName, normalizeRepoUrl } from './url.ts';

test.each([
  ['git@github.com:acme/webapp.git', 'github.com/acme/webapp'],
  ['https://github.com/acme/webapp', 'github.com/acme/webapp'],
  ['https://github.com/acme/webapp.git/', 'github.com/acme/webapp'],
  ['ssh://git@github.com/acme/webapp', 'github.com/acme/webapp'],
  ['ssh://git@GitHub.com:22/acme/webapp.git', 'github.com/acme/webapp'],
  ['gh:acme/webapp', 'github.com/acme/webapp'],
  ['/srv/git/backlog.git', 'file:/srv/git/backlog'],
  ['file:///srv/git/backlog.git', 'file:/srv/git/backlog'],
  ['http://Example.org:8080/a//b/C.git', 'example.org/a/b/C'],
  ['https://user@host.example/x/y', 'host.example/x/y'],
  ['host.example:x/y.git', 'host.example/x/y'],
  ['git@host.example:/x//y/', 'host.example/x/y'],
  ['/srv//git/backlog.git/', 'file:/srv/git/backlog'],
  ['gh:acme/webapp.git', 'github.com/acme/webapp'],
  ['https://github.com/acme/a.git.git', 'github.com/acme/a.git'],
])('normalizeRepoUrl(%s)', (input, want) => expect(normalizeRepoUrl(input)).toBe(want));

test.each([
  'not a url',
  '',
  ' https://github.com/a/b',
  'relative/path',
  'ftp://host/a/b',
  'https://',
  'https://host',
  'gh:',
  '/',
  'file://relative/x',
])('unparseable url %j is usage error with hint', (s) => {
  const err = catchErr(() => normalizeRepoUrl(s));
  expect(err.code).toBe('usage');
  expect(err.hint).toBeTruthy();
});

test('deriveRepoName falls back to owner prefix', () => {
  expect(deriveRepoName('github.com/acme/webapp', new Set())).toBe('webapp');
  expect(deriveRepoName('github.com/acme/webapp', new Set(['webapp']))).toBe('acme-webapp');
});

test('deriveRepoName counts up when owner-repo is taken too', () => {
  const taken = new Set(['webapp', 'acme-webapp']);
  expect(deriveRepoName('github.com/acme/webapp', taken)).toBe('acme-webapp-2');
  taken.add('acme-webapp-2');
  expect(deriveRepoName('github.com/acme/webapp', taken)).toBe('acme-webapp-3');
});

test('deriveRepoName lowercases and replaces odd characters', () => {
  expect(deriveRepoName('host/Acme/My App+x', new Set())).toBe('my-app-x');
  expect(deriveRepoName('host/Acme/Web', new Set(['web']))).toBe('acme-web');
  expect(deriveRepoName('file:/srv/git/backlog', new Set())).toBe('backlog');
});

test('deriveRepoName always yields a valid repo name', () => {
  for (const c of ['host/o/.hidden', 'host/o/---', 'host/x', `host/o/${'a'.repeat(100)}`]) {
    expect(isRepoName(deriveRepoName(c, new Set()))).toBe(true);
  }
  expect(isRepoName(deriveRepoName(`host/${'o'.repeat(70)}/r`, new Set(['r'])))).toBe(true);
  expect(isRepoName(deriveRepoName('host/x', new Set(['x'])))).toBe(true);
});

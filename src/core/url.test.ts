import fc from 'fast-check';
import { arbRawRepoUrl } from '../../test/helpers/arbitraries.ts';
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
  ['https://github.com/Acme/WebApp', 'github.com/acme/webapp'],
  ['git@gitlab.com:Group/Proj.git', 'gitlab.com/group/proj'],
  ['https://git.example.org/Team/Repo', 'git.example.org/Team/Repo'],
  ['github.com/acme/a.git', 'github.com/acme/a'],
  ['github.com/a/b.git', 'github.com/a/b'],
  ['git.example.org/Team/Repo.git/', 'git.example.org/Team/Repo'],
  ['https://localhost/a/b', 'localhost/a/b'],
  ['ssh://git@gitserver/repo.git', 'gitserver/repo'],
  ['FILE:/srv/Git/A', 'file:/srv/Git/A'],
  ['file:/srv/git/a.git', 'file:/srv/git/a.git'],
  ['https://user@host.example/x/y', 'host.example/x/y'],
  ['host.example:x/y.git', 'host.example/x/y'],
  ['git@host.example:/x//y/', 'host.example/x/y'],
  ['/srv//git/backlog.git/', 'file:/srv/git/backlog'],
  ['gh:acme/webapp.git', 'github.com/acme/webapp'],
  ['https://github.com/acme/a.git.git', 'github.com/acme/a'],
  ['github.com/acme/a.git.git', 'github.com/acme/a'],
])('normalizeRepoUrl(%s)', (input, want) => {
  expect(normalizeRepoUrl(input)).toBe(want);
  expect(normalizeRepoUrl(want)).toBe(want);
});

test.each([
  'not a url',
  '',
  ' https://github.com/a/b',
  'ftp://host/a/b',
  'https://',
  'https://host',
  'gh:',
  '/',
  'file://relative/x',
])('unparseable url %j is a validation error with hint', (s) => {
  const err = catchErr(() => normalizeRepoUrl(s));
  expect(err.code).toBe('validation');
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

test('query and fragment are refused', () => {
  for (const u of ['https://github.com/a/b?x=1', 'https://github.com/a/b#readme']) {
    expect(catchErr(() => normalizeRepoUrl(u)).code).toBe('validation');
  }
});

test('normalizeRepoUrl is idempotent', () =>
  fc.assert(
    fc.property(
      arbRawRepoUrl(),
      (u) => normalizeRepoUrl(normalizeRepoUrl(u)) === normalizeRepoUrl(u),
    ),
  ));

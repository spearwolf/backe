import { issueUrlTransform } from './url-transform.ts';

const withIssue = issueUrlTransform({
  backlog: 'acme',
  issue: {
    id: 'bk-7f3k2',
    attachments: [
      { name: 'my trace', file: 'my trace.png' },
      { name: 'l', url: 'https://x.test/l' },
    ],
  },
});
const noIssue = issueUrlTransform({ backlog: 'acme' });

test('keeps http, https, mailto and fragments', () => {
  for (const url of ['https://a.test/x', 'http://a.test', 'mailto:a@b.test', '#abschnitt']) {
    expect(withIssue(url, 'href')).toBe(url);
  }
});

test('drops dangerous schemes', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,x',
    'vbscript:x',
    ' JaVaScRiPt:alert(1)',
  ]) {
    expect(withIssue(url, 'href')).toBeFalsy();
  }
});

test('maps own attachment files, percent-decoded, to the api url', () => {
  expect(withIssue('attachments/my%20trace.png', 'src')).toBe(
    '/api/b/acme/issues/bk-7f3k2/attachments/my%20trace',
  );
  expect(withIssue('./attachments/my trace.png', 'src')).toBe(
    '/api/b/acme/issues/bk-7f3k2/attachments/my%20trace',
  );
});

test('drops every other relative path', () => {
  for (const url of [
    'attachments/other.png',
    'attachments/../issue.md',
    '../attachments/my trace.png',
    'attachments/%2e%2e/x',
    'attachments/a/b.png',
    'attachments\\my trace.png',
    '/etc/passwd',
    '//evil.test/x',
    'issue.md',
    'attachments/%zz',
  ]) {
    expect(withIssue(url, 'src')).toBeFalsy();
  }
  expect(noIssue('attachments/my trace.png', 'src')).toBeFalsy();
});

test('allows only internal issue routes of the same backlog', () => {
  expect(noIssue('/b/acme/issue/bk-7f3k2', 'href')).toBe('/b/acme/issue/bk-7f3k2');
  expect(noIssue('/b/other/issue/bk-7f3k2', 'href')).toBeFalsy();
  expect(noIssue('/b/acme/issue/../../x', 'href')).toBeFalsy();
  expect(noIssue('/b/acme/issue/%2e%2e', 'href')).toBeFalsy();
});

test('local previews resolve to blob urls', () => {
  const local = new Map([['shot.png', 'blob:x']]);
  const t = issueUrlTransform({
    backlog: 'acme',
    issue: { id: 'bk-7f3k2', attachments: [] },
    local,
  });
  expect(t('attachments/shot.png', 'src')).toBe('blob:x');
  expect(t('attachments/other.png', 'src')).toBeFalsy();
});

test('local previews work without an issue context', () => {
  const t = issueUrlTransform({ backlog: 'acme', local: new Map([['shot.png', 'blob:x']]) });
  expect(t('attachments/shot.png', 'src')).toBe('blob:x');
});

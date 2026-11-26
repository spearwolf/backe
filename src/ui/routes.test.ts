import { readRoute } from './routes.ts';

const url = (path: string) => new URL(path, 'http://127.0.0.1');

test.each([
  ['/api/backlogs', { kind: 'backlogs' }],
  ['/api/b/acme/state', { kind: 'state', backlog: 'acme' }],
  ['/api/b/acme/issues/bk-12', { kind: 'issue', backlog: 'acme', id: 'bk-12' }],
  [
    '/api/b/acme/issues/bk-12/attachments/a%20b.png',
    { kind: 'attachment', backlog: 'acme', id: 'bk-12', name: 'a b.png' },
  ],
  ['/api/b/acme/search?q=x', { kind: 'search', backlog: 'acme', q: 'x' }],
  ['/api/b/acme/search', { kind: 'search', backlog: 'acme', q: undefined }],
])('maps GET %s', (path, expected) => {
  expect(readRoute('GET', url(path))).toEqual(expected);
  expect(readRoute('HEAD', url(path))).toEqual(expected);
});

test.each([
  ['POST', '/api/backlogs'],
  ['GET', '/api/b/ACME/state'],
  ['GET', '/api/b/acme/events'],
  ['GET', '/api/b/acme/issues/bk-1/attachments/%E0'],
  ['GET', '/api/b/acme/state/x'],
  ['GET', '/api/backlogs/'],
  ['GET', '/api/b/%E0/state'],
  ['GET', '/api/b//state'],
  ['GET', '/api/b/acme/issues/%E0'],
  ['GET', '/api/b/acme/issues/bk-1/comments/x'],
  ['GET', '/api/b/acme'],
  ['GET', '/other'],
])('rejects %s %s', (method, path) => {
  expect(readRoute(method, url(path))).toBeUndefined();
});

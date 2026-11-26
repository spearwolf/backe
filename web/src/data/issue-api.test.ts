import { attachmentUrl, fetchAttachments, fetchIssue } from './issue-api.ts';

const json = (body: unknown) => new Response(JSON.stringify(body));

test('fetchIssue and fetchAttachments request the issue endpoints', async () => {
  const paths: string[] = [];
  const fetchFn = async (path: string) => {
    paths.push(path);
    return json([]);
  };
  await fetchIssue('acme/x', 'bk-1', fetchFn);
  await fetchAttachments('acme/x', 'bk-1', fetchFn);
  expect(paths).toEqual(['/api/b/acme%2Fx/issues/bk-1', '/api/b/acme%2Fx/issues/bk-1/attachments']);
});

test('attachmentUrl encodes every segment', () => {
  expect(attachmentUrl('acme', 'bk-1', 'a b/ü.png')).toBe(
    '/api/b/acme/issues/bk-1/attachments/a%20b%2F%C3%BC.png',
  );
});

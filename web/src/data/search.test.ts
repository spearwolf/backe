import { searchIds } from './search.ts';

test('searchIds asks the search endpoint and returns the ids', async () => {
  const calls: string[] = [];
  const f = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ issues: [{ id: 'bk-1' }, { id: 'bk-2' }] }));
  };
  expect(await searchIds('my backlog', 'a&b', f)).toEqual(['bk-1', 'bk-2']);
  expect(calls).toEqual(['/api/b/my%20backlog/search?q=a%26b']);
});

test('searchIds passes api errors on', async () => {
  const f = async () =>
    new Response(JSON.stringify({ error: { code: 'usage', message: 'x' } }), { status: 400 });
  await expect(searchIds('acme', 'x', f)).rejects.toMatchObject({ status: 400, code: 'usage' });
});

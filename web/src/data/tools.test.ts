import { expect, it } from 'vitest';
import { callTool, uploadAttachment } from './tools.ts';

const record = () => {
  const calls: [string, RequestInit | undefined][] = [];
  const f = async (input: string, init?: RequestInit) => {
    calls.push([input, init]);
    return new Response(JSON.stringify({ commit: 'c', id: 'bk-1' }), { status: 200 });
  };
  return { calls, f };
};

it('callTool posts to the tool endpoint', async () => {
  const { calls, f } = record();
  const res = await callTool('a b', 'issue_move', { id: 'bk-1', to: 'done' }, f);
  expect(res).toEqual({ commit: 'c', id: 'bk-1' });
  expect(calls[0]?.[0]).toBe('/api/b/a%20b/tools/issue_move');
  expect(calls[0]?.[1]).toMatchObject({
    method: 'POST',
    body: JSON.stringify({ id: 'bk-1', to: 'done' }),
  });
});

it('uploadAttachment puts to the attachment endpoint', async () => {
  const { calls, f } = record();
  const blob = new Blob(['x']);
  await uploadAttachment('acme', 'bk-7f3k2', 'shot.png', blob, f);
  expect(calls[0]?.[0]).toBe('/api/b/acme/issues/bk-7f3k2/attachments/shot.png');
  expect(calls[0]?.[1]).toMatchObject({ method: 'PUT' });
  expect(calls[0]?.[1]?.body).toBe(blob);
});

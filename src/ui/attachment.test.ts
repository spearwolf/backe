import { attachmentDelivery, contentDisposition } from './attachment.ts';

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

test.each([
  ['shot.PNG', undefined, 'image/png', 'inline'],
  ['logo.svg', utf8('<svg/>'), 'image/svg+xml', 'inline'],
  ['notes.md', utf8('# x'), 'text/plain; charset=utf-8', 'inline'],
  ['data.json', utf8('{}'), 'text/plain; charset=utf-8', 'inline'],
  ['big.log', undefined, 'application/octet-stream', 'attachment'],
  ['blob.bin', new Uint8Array([0xff, 0xfe]), 'application/octet-stream', 'attachment'],
] as const)('attachmentDelivery(%s)', (name, bytes, type, disposition) => {
  expect(attachmentDelivery(name, bytes)).toEqual({ type, disposition });
});

test('html attachments are never inline', () => {
  for (const name of ['page.html', 'PAGE.HTM', 'a.xhtml', 'b.xht']) {
    expect(attachmentDelivery(name, utf8('<p>x</p>'))).toEqual({
      type: 'application/octet-stream',
      disposition: 'attachment',
    });
  }
});

test('contentDisposition encodes the name', () => {
  expect(contentDisposition('inline', 'a b ä.png')).toBe(
    "inline; filename*=UTF-8''a%20b%20%C3%A4.png",
  );
});

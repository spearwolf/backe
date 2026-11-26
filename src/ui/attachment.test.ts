import { truncateSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { rawRequest } from '../../test/helpers/ui.ts';
import { attachmentDelivery, contentDisposition, sendAttachment } from './attachment.ts';

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

test('contentDisposition encodes quotes, parentheses and asterisks', () => {
  expect(contentDisposition('attachment', "it's (1)*.txt")).toBe(
    "attachment; filename*=UTF-8''it%27s%20%281%29%2A.txt",
  );
});

test('contentDisposition replaces a lone surrogate instead of throwing', () => {
  expect(contentDisposition('attachment', 'a\uD800b.txt')).toBe(
    "attachment; filename*=UTF-8''a%EF%BF%BDb.txt",
  );
});

test('a vanished attachment file is not_found and sends nothing', async () => {
  const dir = await tempDir();
  const path = join(dir, 'gone.txt');
  // Ohne Datei öffnet `sendFile` nichts und fasst die Antwort nicht an.
  const err = await catchErrAsync(() =>
    sendAttachment({} as ServerResponse, { name: 'gone.txt', path }, false),
  );
  expect([err.code, err.exitCode]).toEqual(['not_found', 3]);
  expect(err.message).toContain(path);
});

test('sendAttachment takes length and bytes from the opened file', async () => {
  const dir = await tempDir();
  const path = join(dir, 'a.txt');
  await writeFile(path, 'hello');
  const server = createServer((_req, res) => {
    sendAttachment(res, { name: 'a.txt', path }, false).catch(() => res.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address() as { port: number };
    const r = await rawRequest(port, { path: '/' });
    expect(r.headers['content-length']).toBe('5');
    expect(r.text()).toBe('hello');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('a streamed file that is larger than the limit keeps its fstat length', async () => {
  const dir = await tempDir();
  const path = join(dir, 'big.log');
  await writeFile(path, Buffer.alloc(300_000, 0x61));
  const server = createServer((_req, res) => {
    sendAttachment(res, { name: 'big.log', path }, false).catch(() => res.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address() as { port: number };
    const r = await rawRequest(port, { path: '/' });
    expect(r.headers['content-length']).toBe('300000');
    expect(r.body.length).toBe(300_000);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('a file that shrinks after the fstat aborts the response instead of hanging', async () => {
  const dir = await tempDir();
  const path = join(dir, 'big.log');
  await writeFile(path, Buffer.alloc(300_000, 0x61));
  const server = createServer((_req, res) => {
    // Deterministisch: die Datei schrumpft genau zwischen fstat und Stream.
    const writeHead = res.writeHead.bind(res) as (...a: unknown[]) => typeof res;
    res.writeHead = ((...a: unknown[]) => {
      truncateSync(path, 1000);
      return writeHead(...a);
    }) as typeof res.writeHead;
    sendAttachment(res, { name: 'big.log', path }, false).catch(() => res.destroy());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const { port } = server.address() as { port: number };
    await expect(
      rawRequest(port, { path: '/', headers: { connection: 'keep-alive' } }),
    ).rejects.toThrow();
  } finally {
    await new Promise((r) => server.close(r));
  }
}, 3000);

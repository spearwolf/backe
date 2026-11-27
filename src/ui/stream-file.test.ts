import { appendFileSync, truncateSync } from 'node:fs';
import { chmod, mkdir, readdir, readlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tempDir } from '../../test/helpers/backlog.ts';
import { rawRequest } from '../../test/helpers/ui.ts';
import { type FileBody, type SendFileOptions, sendFile } from './stream-file.ts';

type Outcome = { sent: boolean; headersSent: boolean } | { error: unknown };

/**
 * Server, der jede Anfrage mit `sendFile(path, opts(req))` beantwortet. `outcome` ist das Ergebnis
 * des letzten Aufrufs; antwortet `sendFile` nicht, schickt der Server 204. `settled` erfüllt sich,
 * sobald der letzte Aufruf ganz fertig ist, samt dem Schließen seines Handles.
 */
async function serve(
  path: string,
  opts: (req: IncomingMessage) => SendFileOptions,
): Promise<{
  port: number;
  outcome(): Outcome | undefined;
  settled(): Promise<void>;
  close(): Promise<void>;
}> {
  let last: Outcome | undefined;
  let running: Promise<void> = Promise.resolve();
  const server = createServer((req, res: ServerResponse) => {
    running = sendFile(res, path, opts(req)).then(
      (sent) => {
        last = { sent, headersSent: res.headersSent };
        if (!sent) res.writeHead(204).end();
      },
      (error: unknown) => {
        last = { error };
        res.destroy();
      },
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    outcome: () => last,
    settled: () => running,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const plain = (req: IncomingMessage): SendFileOptions => ({
  head: req.method === 'HEAD',
  headers: () => ({ 'Content-Type': 'application/octet-stream' }),
});

/** Deskriptoren dieses Prozesses, die auf `target` zeigen (nur Linux). */
async function fdsOn(target: string): Promise<number> {
  const links = await Promise.all(
    (await readdir('/proc/self/fd')).map((fd) => readlink(`/proc/self/fd/${fd}`).catch(() => '')),
  );
  return links.filter((link) => link === target).length;
}

let dir: string;
beforeEach(async () => {
  dir = await tempDir();
});

test('a small file within the read limit is read whole and handed to headers', async () => {
  const path = join(dir, 'a.txt');
  await writeFile(path, 'hello');
  const seen: FileBody[] = [];
  const s = await serve(path, () => ({
    head: false,
    readLimit: 10,
    headers: (body) => {
      seen.push(body);
      return { 'Content-Type': 'text/plain' };
    },
  }));
  try {
    const r = await rawRequest(s.port, { path: '/' });
    expect([r.status, r.headers['content-length'], r.text()]).toEqual([200, '5', 'hello']);
    expect(seen.map((b) => [b.size, Buffer.from(b.bytes ?? []).toString()])).toEqual([
      [5, 'hello'],
    ]);
  } finally {
    await s.close();
  }
});

test('a file above the read limit streams with its fstat length', async () => {
  const path = join(dir, 'big.bin');
  await writeFile(path, Buffer.alloc(200_000, 0x62));
  const seen: FileBody[] = [];
  const s = await serve(path, () => ({
    head: false,
    headers: (body) => {
      seen.push(body);
      return {};
    },
  }));
  try {
    const r = await rawRequest(s.port, { path: '/' });
    expect([r.status, r.headers['content-length'], r.body.length]).toEqual([
      200,
      '200000',
      200_000,
    ]);
    expect(seen).toEqual([{ size: 200_000, bytes: undefined }]);
  } finally {
    await s.close();
  }
});

test('an empty file is an empty 200', async () => {
  const path = join(dir, 'empty');
  await writeFile(path, '');
  const s = await serve(path, plain);
  try {
    const r = await rawRequest(s.port, { path: '/' });
    expect([r.status, r.headers['content-length'], r.body.length]).toEqual([200, '0', 0]);
  } finally {
    await s.close();
  }
});

test('head sends the headers only', async () => {
  const path = join(dir, 'big.bin');
  await writeFile(path, Buffer.alloc(200_000, 0x62));
  const s = await serve(path, plain);
  try {
    const r = await rawRequest(s.port, { method: 'HEAD', path: '/' });
    expect([r.status, r.headers['content-length'], r.body.length]).toEqual([200, '200000', 0]);
  } finally {
    await s.close();
  }
});

test('a missing path or a directory sends nothing', async () => {
  await mkdir(join(dir, 'sub'));
  await writeFile(join(dir, 'file'), 'x');
  for (const path of [join(dir, 'nope'), join(dir, 'sub'), join(dir, 'file', 'below')]) {
    const s = await serve(path, plain);
    try {
      expect((await rawRequest(s.port, { path: '/' })).status, path).toBe(204);
      expect(s.outcome(), path).toEqual({ sent: false, headersSent: false });
    } finally {
      await s.close();
    }
  }
});

test.skipIf(process.getuid?.() === 0)('other open errors are thrown', async () => {
  const path = join(dir, 'locked');
  await writeFile(path, 'x');
  await chmod(path, 0o000);
  const s = await serve(path, plain);
  try {
    await expect(rawRequest(s.port, { path: '/' })).rejects.toThrow();
    expect(s.outcome()).toEqual({ error: expect.objectContaining({ code: 'EACCES' }) });
  } finally {
    await s.close();
  }
});

test('a file that grows after the fstat sends only the promised bytes', async () => {
  const path = join(dir, 'grow.bin');
  await writeFile(path, Buffer.alloc(100_000, 0x61));
  const s = await serve(path, () => ({
    head: false,
    // Deterministisch: Die Datei wächst genau zwischen fstat und Stream.
    headers: () => {
      appendFileSync(path, Buffer.alloc(50_000, 0x7a));
      return {};
    },
  }));
  try {
    const r = await rawRequest(s.port, { path: '/' });
    expect([r.headers['content-length'], r.body.length]).toEqual(['100000', 100_000]);
    expect(r.body.includes(0x7a)).toBe(false);
  } finally {
    await s.close();
  }
});

test('a file that shrinks after the fstat aborts the response instead of hanging', async () => {
  const path = join(dir, 'shrink.bin');
  await writeFile(path, Buffer.alloc(300_000, 0x61));
  const s = await serve(path, () => ({
    head: false,
    headers: () => {
      truncateSync(path, 1000);
      return {};
    },
  }));
  try {
    await expect(
      rawRequest(s.port, { path: '/', headers: { connection: 'keep-alive' } }),
    ).rejects.toThrow();
  } finally {
    await s.close();
  }
});

test.runIf(process.platform === 'linux')('the handle is closed on every path', async () => {
  const path = join(dir, 'a.bin');
  await writeFile(path, Buffer.alloc(100_000, 0x61));
  await mkdir(join(dir, 'sub'));
  const cases: [string, string, (req: IncomingMessage) => SendFileOptions][] = [
    ['head', path, plain],
    ['read whole', path, () => ({ head: false, readLimit: 200_000, headers: () => ({}) })],
    ['stream', path, plain],
    [
      'stream to a client already gone',
      path,
      (req) => {
        req.socket.destroy();
        return plain(req);
      },
    ],
    ['directory', join(dir, 'sub'), plain],
    [
      'throwing headers',
      path,
      () => ({
        head: false,
        headers: () => {
          throw new Error('boom');
        },
      }),
    ],
  ];
  for (const [name, target, opts] of cases) {
    const s = await serve(target, opts);
    await rawRequest(s.port, { path: '/', method: name === 'head' ? 'HEAD' : 'GET' }).catch(
      () => undefined,
    );
    // `sendFile` schließt das Handle im `finally` (der Stream läuft mit `autoClose: false`);
    // `rawRequest` löst schon bei `res.end` auf, bevor `fh.close()` fertig ist.
    await s.settled();
    expect(await fdsOn(target), name).toBe(0);
    await s.close();
  }
});

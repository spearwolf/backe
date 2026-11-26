import { mkdir, readFile, stat } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { receiveUpload, uploadDir } from './upload.ts';

/** Ein Request-Stream, wie `receiveUpload` ihn sieht. */
const request = (stream: PassThrough) => stream as unknown as IncomingMessage;

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

test('receive writes all bytes', async () => {
  const path = join(await tempDir(), 'upload');
  const body = new PassThrough();
  const received = receiveUpload(request(body), path, 8);
  body.write(Buffer.from([0, 1, 2]));
  body.write(Buffer.from([3, 4, 5, 6, 7]));
  body.end();
  expect(await received).toEqual({ size: 8 });
  expect([...(await readFile(path))]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});

test('receive without a limit takes any size', async () => {
  const path = join(await tempDir(), 'upload');
  const body = new PassThrough();
  const received = receiveUpload(request(body), path, null);
  body.end(Buffer.alloc(100_000, 7));
  expect(await received).toEqual({ size: 100_000 });
  expect((await stat(path)).size).toBe(100_000);
});

test('receive stops at the first byte over max', async () => {
  const path = join(await tempDir(), 'upload');
  const body = new PassThrough();
  const received = receiveUpload(request(body), path, 4);
  body.write(Buffer.from([1, 2, 3]));
  body.write(Buffer.from([4, 5]));
  expect(await received).toEqual({ tooLarge: 5 });
  // Nichts über der Grenze landet in der Datei, und der Stream wird nicht weiter gelesen.
  expect([...(await readFile(path))]).toEqual([1, 2, 3]);
  expect(body.listenerCount('data')).toBe(0);
  expect(body.isPaused()).toBe(true);
});

/** Startet `receiveUpload` und wartet, bis es am Stream hört (nach dem Öffnen der Datei). */
async function listening(max: number | null = null) {
  const path = join(await tempDir(), 'upload');
  const body = new PassThrough();
  const received = receiveUpload(request(body), path, max);
  received.catch(() => {});
  await vi.waitFor(() => expect(body.listenerCount('data')).toBe(1));
  return { body, received };
}

test('receive fails when the client goes away', async () => {
  const { body, received } = await listening();
  body.write(Buffer.from([1]));
  body.destroy();
  expect((await catchErrAsync(() => received)).code).toBe('usage');
  expect(body.listenerCount('close')).toBe(0);
});

test('receive fails when the client went away while the file was opened', async () => {
  const path = join(await tempDir(), 'upload');
  const body = new PassThrough();
  const received = receiveUpload(request(body), path, null);
  body.destroy();
  expect((await catchErrAsync(() => received)).code).toBe('usage');
});

test('receive fails on a stream error', async () => {
  const { body, received } = await listening();
  body.destroy(new Error('kaputt'));
  await expect(received).rejects.toThrow('kaputt');
  const path = join(await tempDir(), 'upload');
  const early = new PassThrough();
  const before = receiveUpload(request(early), path, null);
  early.destroy(new Error('früh'));
  await expect(before).rejects.toThrow('früh');
});

test('receive refuses a stream that is already consumed', async () => {
  const dir = await tempDir();
  const ended = new PassThrough();
  ended.resume();
  ended.end();
  await new Promise((resolve) => ended.once('end', resolve));
  const err = await catchErrAsync(() => receiveUpload(request(ended), join(dir, 'a'), null));
  expect(err.code).toBe('usage');
  const destroyed = new PassThrough();
  destroyed.destroy();
  const gone = await catchErrAsync(() => receiveUpload(request(destroyed), join(dir, 'b'), null));
  expect(gone.code).toBe('usage');
  // Kein Body, keine Datei.
  expect(await exists(join(dir, 'a'))).toBe(false);
});

test('receive never writes through an existing path', async () => {
  const dir = await tempDir();
  const path = join(dir, 'upload');
  await mkdir(path);
  const body = new PassThrough();
  await expect(receiveUpload(request(body), path, null)).rejects.toMatchObject({ code: 'EEXIST' });
});

test('receive fails when the file cannot be created', async () => {
  const path = join(await tempDir(), 'missing', 'upload');
  const body = new PassThrough();
  await expect(receiveUpload(request(body), path, null)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('the dir is created once and removed', async () => {
  const uploads = uploadDir();
  // Ohne Upload gibt es nichts zu entfernen.
  await uploads.remove();
  const [a, b] = await Promise.all([uploads.file(), uploads.file()]);
  const dir = dirname(a);
  expect(dirname(b)).toBe(dir);
  expect(dirname(dir)).toBe(tmpdir());
  expect(basename(dir)).toMatch(/^backe-ui-/);
  expect(basename(a)).toMatch(/^upload-[0-9a-f-]{36}$/);
  expect(a).not.toBe(b);
  expect((await stat(dir)).mode & 0o777).toBe(0o700);
  // `file()` legt nur das Verzeichnis an, nie die Datei.
  expect(await exists(a)).toBe(false);
  await uploads.remove();
  expect(await exists(dir)).toBe(false);
  await uploads.remove();
});

test('a failed mkdtemp is tried again on the next upload', async () => {
  const base = await tempDir();
  vi.stubEnv('TMPDIR', join(base, 'missing'));
  const uploads = uploadDir();
  try {
    await expect(uploads.file()).rejects.toMatchObject({ code: 'ENOENT' });
    vi.stubEnv('TMPDIR', base);
    expect(dirname(dirname(await uploads.file()))).toBe(base);
  } finally {
    vi.unstubAllEnvs();
    await uploads.remove();
  }
});

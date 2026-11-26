import type { IncomingMessage } from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { mediaType, readJsonBody, TOOL_BODY_LIMIT } from './body.ts';

/** Ein Request-Stream mit Headern, wie `readJsonBody` ihn sieht. */
function request(stream: Readable, headers: Record<string, string> = {}): IncomingMessage {
  return Object.assign(stream, { headers }) as unknown as IncomingMessage;
}

const bodyOf = (text: string, headers?: Record<string, string>) =>
  request(Readable.from([Buffer.from(text)]), headers);

test('the limit is 16 MiB', () => {
  expect(TOOL_BODY_LIMIT).toBe(16 * 1024 * 1024);
});

test('mediaType ignores parameters and case', () => {
  expect(mediaType('application/json')).toBe('application/json');
  expect(mediaType('Application/JSON; charset=utf-8')).toBe('application/json');
  expect(mediaType(' text/plain ;charset=x')).toBe('text/plain');
  expect(mediaType('')).toBeUndefined();
  expect(mediaType(undefined)).toBeUndefined();
});

test('an empty body is an empty object', async () => {
  expect(await readJsonBody(request(Readable.from([])), 100)).toEqual({});
});

test('a json object comes back parsed', async () => {
  expect(await readJsonBody(bodyOf('{"title":"ä"}'), 100)).toEqual({ title: 'ä' });
});

test('a body over the limit is cut off', async () => {
  let pulled = 0;
  const endless = new Readable({
    read() {
      pulled += 1;
      this.push(Buffer.alloc(4, 0x20));
    },
  });
  const err = await catchErrAsync(() => readJsonBody(request(endless), 10));
  expect(err.code).toBe('validation');
  const seen = pulled;
  // Nach dem Abbruch liest niemand weiter: Der Stream steht still und zieht nichts mehr nach.
  await new Promise((resolve) => setImmediate(resolve));
  expect(endless.isPaused()).toBe(true);
  expect(endless.listenerCount('data')).toBe(0);
  expect(pulled).toBeLessThanOrEqual(seen + 1);
});

test('a declared length over the limit fails before reading', async () => {
  const stream = new PassThrough();
  const err = await catchErrAsync(() =>
    readJsonBody(request(stream, { 'content-length': '11' }), 10),
  );
  expect(err.code).toBe('validation');
  expect(stream.listenerCount('data')).toBe(0);
});

test('no json is a usage error', async () => {
  expect((await catchErrAsync(() => readJsonBody(bodyOf('{x'), 100))).code).toBe('usage');
});

test('an array is a usage error', async () => {
  expect((await catchErrAsync(() => readJsonBody(bodyOf('[1]'), 100))).code).toBe('usage');
  expect((await catchErrAsync(() => readJsonBody(bodyOf('null'), 100))).code).toBe('usage');
  expect((await catchErrAsync(() => readJsonBody(bodyOf('"x"'), 100))).code).toBe('usage');
});

test('a stream error rejects', async () => {
  const stream = new PassThrough();
  const read = readJsonBody(request(stream), 100);
  stream.destroy(new Error('reset'));
  await expect(read).rejects.toThrow('reset');
});

test('a stream that closes before its end rejects', async () => {
  const stream = new PassThrough({ emitClose: true });
  const read = readJsonBody(request(stream), 100);
  stream.write('{"a"');
  stream.destroy();
  expect((await catchErrAsync(() => read)).code).toBe('usage');
});

test('a stream already read or destroyed rejects instead of waiting', async () => {
  const used = bodyOf('{}');
  expect(await readJsonBody(used, 100)).toEqual({});
  expect((await catchErrAsync(() => readJsonBody(used, 100))).code).toBe('usage');
  const gone = new PassThrough();
  gone.destroy();
  expect((await catchErrAsync(() => readJsonBody(request(gone), 100))).code).toBe('usage');
});

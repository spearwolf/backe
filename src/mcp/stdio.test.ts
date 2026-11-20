/**
 * `runStdio` in-process über `PassThrough`-Streams: eine Anfrage hinein, eine JSON-RPC-Zeile
 * heraus, Ende mit stdin. Der echte Prozess samt beider Protokoll-Generationen steht in
 * `test/e2e/mcp.test.ts`.
 */
import { PassThrough } from 'node:stream';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import { runStdio } from './stdio.ts';

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'backe-test', version: '0.0.0' },
  },
};

/** Die nächste vollständige Zeile auf `stream`. */
function nextLine(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      stream.off('data', onData);
      resolve(buffer.slice(0, end));
    };
    stream.on('data', onData);
  });
}

async function setup() {
  const b = await testBacklog();
  const opts = { cwd: b.root, env: b.env, flags: { as: b.handle }, allowDelete: false };
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr: string[] = [];
  const io = { stdin, stdout, stderr: (s: string) => stderr.push(s) };
  return { b, opts, stdin, stdout, stderr, io };
}

test('runStdio answers on stdout and ends with stdin', async () => {
  const t = await setup();
  const running = runStdio(t.opts, t.io);
  const reply = nextLine(t.stdout);
  t.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
  expect(JSON.parse(await reply)).toMatchObject({
    jsonrpc: '2.0',
    id: 1,
    result: { serverInfo: { name: 'backe' } },
  });
  t.stdin.end();
  await running;
  expect(t.stderr).toEqual([]);
});

test('runStdio reports out-of-band errors on stderr and keeps serving', async () => {
  const t = await setup();
  const running = runStdio(t.opts, t.io);
  const reply = nextLine(t.stdout);
  // Eine Antwort, bevor die Generation feststeht, verwirft das SDK und meldet sie über `onerror`.
  t.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 99, result: {} })}\n`);
  t.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
  expect(JSON.parse(await reply)).toHaveProperty('id', 1);
  t.stdin.end();
  await running;
  expect(t.stderr).toHaveLength(1);
  expect(t.stderr[0]).toMatch(/^backe mcp: Discarded a JSON-RPC response .*\n$/);
});

test('runStdio ends at once when stdin is already gone', async () => {
  const t = await setup();
  t.stdin.destroy();
  await runStdio(t.opts, t.io);
  expect(t.stdout.read()).toBeNull();
});

test('runStdio refuses to start before writing a byte', async () => {
  const t = await setup();
  const err = await catchErrAsync(() => runStdio({ ...t.opts, flags: {} }, t.io));
  expect(err.code).toBe('usage');
  expect(err.message).toContain('Kein User aufgelöst');
  expect(t.stdout.read()).toBeNull();
});

/**
 * `runStdio` in-process über `PassThrough`-Streams: eine Anfrage hinein, eine JSON-RPC-Zeile
 * heraus, Ende mit stdin. Der echte Prozess samt beider Protokoll-Generationen steht in
 * `test/e2e/mcp.test.ts`.
 */
import { PassThrough } from 'node:stream';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { setLocale } from '../../src/i18n/locale.ts';
import { createBackeMcp } from '../../src/mcp/server.ts';
import { runStdio } from '../../src/mcp/stdio.ts';
import { catchErrAsync } from '../helpers/catch.ts';
import { testBacklog } from '../helpers/git.ts';

// Der MCP-Modus spricht immer Englisch (backe.md §2.18); `backe mcp` setzt die Locale beim Start.
beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

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

/** Löst nach einer Runde der Event-Loop auf: Was bis dahin nur über Promises läuft, ist durch. */
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('runStdio reports out-of-band errors on stderr and keeps serving', async () => {
  const t = await setup();
  const running = runStdio(t.opts, t.io);
  let reply = nextLine(t.stdout);
  // Eine Antwort, bevor die Generation feststeht, verwirft das SDK und meldet sie über `onerror`.
  t.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 99, result: {} })}\n`);
  t.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
  expect(JSON.parse(await reply)).toHaveProperty('id', 1);
  // Ein Lesefehler auf stdin schließt den Transport nicht; er geht ebenso auf stderr.
  t.stdin.emit('error', new Error('stdin wackelt'));
  reply = nextLine(t.stdout);
  t.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n`);
  expect(JSON.parse(await reply)).toMatchObject({ id: 2, result: {} });
  t.stdin.end();
  await running;
  expect(t.stderr).toHaveLength(2);
  // Den Wortlaut der SDK-Meldung legt das SDK fest; geprüft wird nur die Form.
  expect(t.stderr[0]).toMatch(/^backe mcp: \S[^\n]*\n$/);
  expect(t.stderr[1]).toBe('backe mcp: stdin wackelt\n');
});

test('runStdio ends when the transport closes itself after a stdout error', async () => {
  const t = await setup();
  let ended = false;
  const running = runStdio(t.opts, t.io).then(() => {
    ended = true;
  });
  const reply = nextLine(t.stdout);
  t.stdin.write(`${JSON.stringify(INITIALIZE)}\n`);
  await reply;
  try {
    // stdin bleibt offen; der Transport schließt sich selbst und pausiert stdin. Danach laufen nur
    // noch Promises, kein I/O: Eine Runde der Event-Loop genügt, sonst hinge runStdio an stdin.
    t.stdout.emit('error', new Error('Broken pipe'));
    await nextTurn();
    expect(ended).toBe(true);
    expect(t.stdin.readableEnded).toBe(false);
    expect(t.stderr).toEqual(['backe mcp: Broken pipe\n']);
  } finally {
    // Ein pausiertes stdin meldet `end` nie; `close` erreicht runStdio auch dann.
    t.stdin.destroy();
    await running;
  }
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
  expect(err.message).toContain('No user resolved');
  expect(t.stdout.read()).toBeNull();
});

test('errors from closing after stdin ended go to stderr, and runStdio still returns', async () => {
  const t = await setup();
  const running = runStdio(t.opts, t.io, {
    serve: (factory, options) => {
      const handle = serveStdio(factory, options);
      return {
        ...handle,
        close: async () => {
          await handle.close();
          throw new Error('Verbindung klemmt');
        },
      };
    },
    create: async (opts, start) => {
      const mcp = await createBackeMcp(opts, start);
      return {
        ...mcp,
        close: async () => {
          await mcp.close();
          throw new Error('Timer klemmt');
        },
      };
    },
  });
  t.stdin.end();
  await running;
  expect(t.stderr).toEqual(['backe mcp: Verbindung klemmt\n', 'backe mcp: Timer klemmt\n']);
});

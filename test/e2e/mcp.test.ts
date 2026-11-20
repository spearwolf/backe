/**
 * `backe mcp` als echter Prozess über stdio (backe.md §2.19): stdout trägt nur JSON-RPC, beide
 * Protokoll-Generationen werden bedient, ohne Identität samt Key startet der Server nicht. Der
 * Prozess endet von selbst, sobald der Client stdin schließt.
 */
import type { ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { Env } from '../../src/context/paths.ts';
import { tempDir } from '../helpers/backlog.ts';
import { type TestBacklog, testBacklog } from '../helpers/git.ts';
import { SPEC_TOOLS } from '../helpers/mcp.ts';
import { CLI, childEnv, cli } from './cli.ts';

type Session = {
  client: Client;
  /** Ruft ein Tool; ein Fehler-Ergebnis wirft mit seinem Text. */
  // biome-ignore lint/suspicious/noExplicitAny: Tests greifen ohne Narrowing in das Ergebnis.
  call(name: string, args?: object): Promise<any>;
  /** Schließt den Client und liefert den Exit-Code des Servers (bzw. das Signal). */
  close(): Promise<number | string | null>;
  /** Fehler, die der Client-Transport gemeldet hat (etwa nicht parsbare Zeilen auf stdout). */
  errors: Error[];
  stderr(): string;
};

/** `backe mcp` als `spw` im Backlog `b`, mit Default-Handshake oder fest auf `pin`. */
async function serve(b: TestBacklog, opts: { pin?: string } = {}): Promise<Session> {
  const env: Env = { ...b.env, BACKE_USER: 'spw', NO_COLOR: '1' };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI, 'mcp'],
    cwd: b.root,
    env: childEnv(env),
    stderr: 'pipe',
  });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  const client = new Client(
    { name: 'backe-e2e', version: '0.0.0' },
    opts.pin === undefined ? {} : { versionNegotiation: { mode: { pin: opts.pin } } },
  );
  const errors: Error[] = [];
  client.onerror = (error) => {
    errors.push(error);
  };
  await client.connect(transport);
  // Der Transport gibt den Exit-Code nicht heraus; der Kindprozess der Sitzung (beim Aushandeln
  // nach der Probe auf dem Geschwisterprozess gestartet) steht in seinem privaten Feld.
  const child = (transport as unknown as { _process: ChildProcess })._process;
  const exited = new Promise<number | string | null>((resolve) => {
    child.once('exit', (code, signal) => resolve(code ?? signal));
  });
  return {
    client,
    errors,
    stderr: () => stderr,
    async call(name, args = {}) {
      const r = await client.callTool({ name, arguments: args as Record<string, unknown> });
      const text = (r.content as { type: string; text?: string }[])[0]?.text ?? '';
      if (r.isError === true) throw new Error(`${name}: ${text}`);
      return JSON.parse(text);
    },
    async close() {
      await client.close();
      return exited;
    },
  };
}

test('stdout carries only JSON-RPC over a full flow', async () => {
  const b = await testBacklog();
  const s = await serve(b);
  const { id } = await s.call('issue_create', { title: 'Login reparieren' });
  const list = await s.call('issue_list');
  expect(JSON.stringify(list)).toContain(id);
  expect(await s.call('comment_add', { id, body: 'Ursache gefunden' })).toHaveProperty('id', id);
  expect(s.client.getProtocolEra()).toBe('legacy');
  const code = await s.close();
  expect({ code, errors: s.errors, stderr: s.stderr() }).toEqual({
    code: 0,
    errors: [],
    stderr: '',
  });
});

test('serves protocol revision 2026-07-28', async () => {
  const b = await testBacklog();
  const s = await serve(b, { pin: '2026-07-28' });
  expect(s.client.getProtocolEra()).toBe('modern');
  const { tools } = await s.client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual([...SPEC_TOOLS].sort());
  expect(await s.call('context_get')).toHaveProperty('user.value', 'spw');
  const code = await s.close();
  expect({ code, errors: s.errors, stderr: s.stderr() }).toEqual({
    code: 0,
    errors: [],
    stderr: '',
  });
});

test('mcp refuses to start without an identity', async () => {
  const b = await testBacklog();
  const r = await cli(['mcp'], { env: { ...b.env, NO_COLOR: '1' }, cwd: b.root });
  expect({ code: r.code, stdout: r.stdout }).toEqual({ code: 2, stdout: '' });
  expect(r.stderr).toMatch(/^Fehler: Kein User aufgelöst/);
});

test('mcp refuses an identity without key', async () => {
  const b = await testBacklog();
  // Aus einem fremden Verzeichnis: `b.root` ist die Arbeitskopie von spw und würde vorher als
  // fremde Arbeitskopie abgelehnt. `-B` vor, `--as` nach `mcp` — beide Stellen kommen an.
  const r = await cli(['-B', 'acme', 'mcp', '--as', 'claude-1'], {
    env: { ...b.env, NO_COLOR: '1' },
    cwd: await tempDir(),
  });
  expect({ code: r.code, stdout: r.stdout }).toEqual({ code: 2, stdout: '' });
  expect(r.stderr).toMatch(/^Fehler: Für »claude-1« ist kein Signing-Key eingetragen\n/);
  expect(r.stderr).toContain('\nHinweis: identities.acme.claude-1 ');
});

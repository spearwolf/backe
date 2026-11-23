/**
 * `backe mcp` als echter Prozess über stdio (backe.md §2.19): stdout trägt nur JSON-RPC, beide
 * Protokoll-Generationen werden bedient, ohne Identität samt Key startet der Server nicht. Der
 * Prozess endet von selbst, sobald der Client stdin schließt.
 */
import type { ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import type { Env } from '../../src/context/paths.ts';
import { managedClonePath, setIdentity } from '../../src/context/registry.ts';
import { readSyncState, syncFile } from '../../src/services/sync-state.ts';
import { executeWrite } from '../../src/services/write.ts';
import { exists } from '../../src/store/files.ts';
import { tempDir } from '../helpers/backlog.ts';
import { type TestBacklog, testBacklog, testKey } from '../helpers/git.ts';
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

/**
 * Der Kindprozess des Transports. Der Transport gibt den Exit-Code nicht heraus; der Kindprozess der
 * Sitzung (beim Aushandeln nach der Probe auf dem Geschwisterprozess gestartet) steht in seinem
 * privaten Feld `_process`. Fehlt es nach einem SDK-Update, scheitert der Test hier mit Grund.
 */
function childOf(transport: StdioClientTransport): ChildProcess {
  const raw: object = transport;
  const child = '_process' in raw ? raw._process : undefined;
  if (child === undefined || child === null || typeof (child as ChildProcess).once !== 'function') {
    throw new Error('StdioClientTransport hat kein Feld _process mehr; den Exit-Code anders holen');
  }
  return child as ChildProcess;
}

/**
 * `backe mcp` im Backlog `b`, mit Default-Handshake oder fest auf `pin`; ohne `as` als `spw` in
 * dessen Arbeitskopie, mit `as` aus einem fremden Verzeichnis mit `-B acme`.
 */
async function serve(b: TestBacklog, opts: { pin?: string; as?: string } = {}): Promise<Session> {
  const env: Env = { ...b.env, BACKE_USER: opts.as ?? 'spw', NO_COLOR: '1' };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: opts.as === undefined ? [CLI, 'mcp'] : [CLI, '-B', 'acme', 'mcp'],
    cwd: opts.as === undefined ? b.root : await tempDir(),
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
  const child = childOf(transport);
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

test('stdout carries only JSON-RPC when a write clones through the hub and starts a sync', async () => {
  // Ohne Remote: Der erste Write des Agents legt den lokalen Hub an, klont seine Arbeitskopie
  // daraus (git als Kindprozess) und startet danach den Hintergrund-Sync (ein eigener Prozess).
  const b = await testBacklog();
  const key = await testKey('claude-1');
  await executeWrite(await b.context(), {
    kind: 'op',
    op: {
      op: 'user.add',
      handle: 'claude-1',
      name: 'Claude',
      kind: 'agent',
      operator: 'spw',
      keys: [key.line],
    },
  });
  await setIdentity(b.homes, 'acme', 'claude-1', key.priv);
  const s = await serve(b, { as: 'claude-1' });
  const created = await s.call('issue_create', { title: 'Vom Agent' });
  expect(created.notices).toEqual([expect.objectContaining({ code: 'hub_created' })]);
  // Genau ein Hintergrund-Sync: Der zweite Write soll keinen weiteren Prozess starten, der nach
  // dem Ende des Tests noch in die Arbeitskopie schreibt (das Aufräumen scheitert sonst an
  // ENOTEMPTY). Der Server liest die User-Config bei jedem Aufruf neu.
  const manual = await cli(['config', 'set', 'backlogs.acme.sync.mode', 'manual'], {
    env: { ...b.env, BACKE_USER: 'claude-1', NO_COLOR: '1' },
    cwd: b.root,
  });
  expect({ code: manual.code, stderr: manual.stderr }).toEqual({ code: 0, stderr: '' });
  expect(await s.call('comment_add', { id: created.id, body: 'zweiter Write' })).toHaveProperty(
    'id',
    created.id,
  );
  const code = await s.close();
  expect({ code, errors: s.errors, stderr: s.stderr() }).toEqual({
    code: 0,
    errors: [],
    stderr: '',
  });
  // Der Hintergrund-Sync lief als eigener Prozess, hat seine Runde abgeschlossen und `sync.lock`
  // freigegeben; danach legt er in der Arbeitskopie nichts mehr an.
  const wc = managedClonePath(b.homes, 'acme', 'claude-1');
  const lock = await syncFile(wc, 'sync.lock');
  await vi.waitFor(
    async () => {
      expect((await readSyncState(wc)).last_success).toBeDefined();
      expect(await exists(lock)).toBe(false);
    },
    { timeout: 20_000 },
  );
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

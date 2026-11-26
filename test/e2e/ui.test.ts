/**
 * `backe ui` als echter Prozess (ui.md §2.1): Startzeile, Signale, Exit-Codes, --open, Parität der
 * API mit dem CLI und der Tools mit MCP.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { Env } from '../../src/context/paths.ts';
import { cookieName } from '../../src/ui/security.ts';
import { tempDir } from '../helpers/backlog.ts';
import { writeOp } from '../helpers/context.ts';
import { revParse, testBacklog } from '../helpers/git.ts';
import { connectMcp } from '../helpers/mcp.ts';
import { rawRequest } from '../helpers/ui.ts';
import { CLI, childEnv, cli } from './cli.ts';

const START = /^backe ui: http:\/\/127\.0\.0\.1:(\d+)\/\?token=([0-9a-f]{64})$/;

type Ui = {
  line: string;
  port: number;
  token: string;
  stdout(): string;
  stderr(): string;
  stop(signal: NodeJS.Signals): Promise<number | null>;
  /** Tauscht das Token und gibt den Cookie-Header zurück. */
  cookie(): Promise<string>;
};

const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill('SIGKILL');
});

async function spawnUi(args: string[], opts: { env: Env; cwd: string }): Promise<Ui> {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: opts.cwd,
    env: childEnv(opts.env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(child);
  let stdout = '';
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (c: string) => {
    stderr += c;
  });
  const exit = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
  const line = await new Promise<string>((resolve, reject) => {
    const early = (code: number | null) => {
      reject(new Error(`exited with ${code} before start line: ${stderr}`));
    };
    child.once('close', early);
    child.stdout.setEncoding('utf8').on('data', (c: string) => {
      stdout += c;
      const nl = stdout.indexOf('\n');
      if (nl >= 0) {
        child.off('close', early);
        resolve(stdout.slice(0, nl));
      }
    });
  });
  const [, portText, token] = START.exec(line) ?? [];
  if (portText === undefined || token === undefined) {
    throw new Error(`start line does not match ${START}: ${line}`);
  }
  const port = Number(portText);
  return {
    line,
    port,
    token,
    stdout: () => stdout,
    stderr: () => stderr,
    stop: (signal) => {
      child.kill(signal);
      return exit;
    },
    cookie: async () => {
      const res = await rawRequest(port, { path: `/?token=${token}` });
      expect(res.status).toBe(303);
      const setCookie = res.headers['set-cookie']?.[0] ?? '';
      expect(setCookie.startsWith(`${cookieName(port)}=`)).toBe(true);
      return setCookie.split(';')[0] ?? '';
    },
  };
}

function env(b: { env: Env }, extra: Env = {}): Env {
  return { ...b.env, BACKE_USER: 'spw', NO_COLOR: '1', ...extra };
}

async function busyPort(): Promise<{ port: number; close(): Promise<void> }> {
  const srv = createServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const port = (srv.address() as { port: number }).port;
  return { port, close: () => new Promise((resolve) => srv.close(() => resolve())) };
}

test('prints exactly one start line and serves the api', async () => {
  const b = await testBacklog();
  const ui = await spawnUi(['ui', '--port', '0'], { env: env(b), cwd: b.root });
  expect(ui.line).toMatch(START);
  const cookie = await ui.cookie();
  const api = await rawRequest(ui.port, { path: '/api/backlogs', headers: { cookie } });
  expect(api.status).toBe(200);
  expect(api.text()).toContain('acme');
  const page = await rawRequest(ui.port, { path: '/', headers: { cookie } });
  expect(page.status).toBe(200);
  expect(String(page.headers['content-type'])).toContain('text/html');
  expect(await ui.stop('SIGTERM')).toBe(0);
  expect(ui.stdout()).toBe(`${ui.line}\n`);
});

test('-p is the short form of --port', async () => {
  const b = await testBacklog();
  const ui = await spawnUi(['ui', '-p', '0'], { env: env(b), cwd: b.root });
  expect(ui.line).toMatch(START);
  expect(ui.port).toBeGreaterThan(0);
  expect(await ui.stop('SIGTERM')).toBe(0);
});

test('SIGINT ends with exit code 0', async () => {
  const b = await testBacklog();
  const ui = await spawnUi(['ui', '--port', '0'], { env: env(b), cwd: b.root });
  expect(await ui.stop('SIGINT')).toBe(0);
});

test('-B works before and after the command', async () => {
  const b = await testBacklog();
  const elsewhere = await tempDir();
  for (const args of [
    ['-B', 'acme', 'ui', '--port', '0'],
    ['ui', '--port', '0', '-B', 'acme'],
  ]) {
    const ui = await spawnUi(args, { env: env(b), cwd: elsewhere });
    expect(ui.line).toMatch(START);
    expect(await ui.stop('SIGTERM')).toBe(0);
  }
});

test('a busy port exits with 6', async () => {
  const b = await testBacklog();
  const busy = await busyPort();
  try {
    const r = await cli(['ui', '--port', String(busy.port)], { env: env(b), cwd: b.root });
    expect(r.code).toBe(6);
    expect(r.stderr).toContain(`Port ${busy.port}`);
    expect(r.stderr).toContain('backe ui --port <n>');
  } finally {
    await busy.close();
  }
});

test('the console speaks the server language', async () => {
  const b = await testBacklog();
  const busy = await busyPort();
  try {
    const r = await cli(['ui', '--port', String(busy.port)], {
      env: env(b, { BACKE_LANG: 'de' }),
      cwd: b.root,
    });
    expect(r.code).toBe(6);
    expect(r.stderr).toContain(`Port ${busy.port} ist belegt`);
  } finally {
    await busy.close();
  }
});

test('without a registered backlog the start fails like the cli', async () => {
  const b = await testBacklog();
  const empty = await tempDir();
  const r = await cli(['ui', '--port', '0'], {
    env: { ...b.env, BACKE_HOME: join(empty, 'backe'), NO_COLOR: '1' },
    cwd: empty,
  });
  expect(r.code).toBe(2);
});

test('an invalid port is a validation error', async () => {
  const b = await testBacklog();
  for (const port of ['70000', 'abc', '-1', '8.5']) {
    const r = await cli(['ui', '--port', port], { env: env(b), cwd: b.root });
    expect([port, r.code]).toEqual([port, 2]);
    expect(r.stderr).toContain('backe ui --port <n>');
  }
});

async function fakeOpener(script: string): Promise<{ env: Env; out: string }> {
  const dir = await tempDir();
  const out = join(dir, 'opened.txt');
  const bin = join(dir, 'xdg-open');
  await writeFile(bin, `#!/bin/sh\n${script}\n`);
  await chmod(bin, 0o755);
  return { env: { PATH: `${dir}:${process.env.PATH}`, OUT: out }, out };
}

test.runIf(process.platform === 'linux')('--open hands the url to xdg-open', async () => {
  const b = await testBacklog();
  const fake = await fakeOpener('printf \'%s\' "$1" > "$OUT"');
  const ui = await spawnUi(['ui', '--port', '0', '--open'], {
    env: env(b, fake.env),
    cwd: b.root,
  });
  await vi.waitFor(async () => {
    expect(await readFile(fake.out, 'utf8')).toBe(ui.line.slice('backe ui: '.length));
  });
  expect(await ui.stop('SIGTERM')).toBe(0);
});

test.runIf(process.platform === 'linux')('a failing browser start is only a hint', async () => {
  const b = await testBacklog();
  const fake = await fakeOpener('exit 3');
  const ui = await spawnUi(['ui', '--port', '0', '--open'], {
    env: env(b, fake.env),
    cwd: b.root,
  });
  await vi.waitFor(() => expect(ui.stderr()).toContain('xdg-open'));
  const cookie = await ui.cookie();
  expect((await rawRequest(ui.port, { path: '/api/backlogs', headers: { cookie } })).status).toBe(
    200,
  );
  expect(await ui.stop('SIGTERM')).toBe(0);
});

test('api json equals the cli json', async () => {
  const b = await testBacklog();
  const ctx = await b.context();
  const id = await writeOp(ctx, {
    op: 'issue.create',
    title: 'Erstes',
    state: 'todo',
    body: 'Der Body\n',
  });
  await writeOp(ctx, { op: 'comment.add', id, body: 'Ein Kommentar\n' });
  await writeOp(ctx, {
    op: 'issue.create',
    title: 'Zweites',
    state: 'todo',
    body: 'enthält Zimtschnecke\n',
  });
  const e = env(b);
  const ui = await spawnUi(['ui', '--port', '0'], { env: e, cwd: b.root });
  const cookie = await ui.cookie();
  const short = id.slice(id.indexOf('-') + 1);
  const detail = await rawRequest(ui.port, {
    path: `/api/b/acme/issues/${short}`,
    headers: { cookie },
  });
  const shown = await cli(['issue', 'show', id, '--comments', 'all', '--json'], {
    env: e,
    cwd: b.root,
  });
  expect(detail.json()).toEqual(JSON.parse(shown.stdout));
  const search = await rawRequest(ui.port, {
    path: '/api/b/acme/search?q=Zimtschnecke',
    headers: { cookie },
  });
  const listed = await cli(['issue', 'list', '-q', 'Zimtschnecke', '--state', 'all', '--json'], {
    env: e,
    cwd: b.root,
  });
  expect(search.json()).toEqual(JSON.parse(listed.stdout));
  expect(await ui.stop('SIGTERM')).toBe(0);
});

/**
 * Ohne `commit`, mit vereinheitlichten Issue-IDs, Zeitstempeln und Kommentar-Dateinamen: Die beiden
 * Seiten schreiben nicht zwingend in derselben Sekunde.
 */
function normalized(value: unknown, ids: readonly string[]): unknown {
  let text = JSON.stringify(value);
  for (const [i, id] of ids.entries()) text = text.replaceAll(id, `<id${i}>`);
  text = text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/g, '<zeit>');
  text = text.replace(/\d{8}T\d{6}Z-([a-z]+)-[a-z0-9]+\.md/g, '<zeit>-$1-<x>.md');
  const { commit: _commit, ...rest } = JSON.parse(text) as Record<string, unknown>;
  return rest;
}

const BK_ID = expect.stringMatching(/^bk-/);

test('tool json equals the mcp json', async () => {
  // Zwei gleich aufgebaute Backlogs: auf dem einen schreibt `backe ui`, auf dem anderen MCP.
  const viaUi = await testBacklog();
  const viaMcp = await testBacklog();
  const ui = await spawnUi(['ui', '--port', '0'], { env: env(viaUi), cwd: viaUi.root });
  const mcp = await connectMcp(viaMcp);
  try {
    const cookie = await ui.cookie();
    const origin = `http://127.0.0.1:${ui.port}`;
    // biome-ignore lint/suspicious/noExplicitAny: Tests greifen ohne Narrowing in das Ergebnis.
    const both = async (tool: string, args: (side: 'ui' | 'mcp') => object): Promise<any[]> => {
      const http = await rawRequest(ui.port, {
        method: 'POST',
        path: `/api/b/acme/tools/${tool}`,
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify(args('ui')),
      });
      expect([tool, http.status, http.status === 200 ? '' : http.text()]).toEqual([tool, 200, '']);
      const called = await mcp.call(tool, args('mcp'));
      if (!('ok' in called)) throw new Error(JSON.stringify(called));
      return [http.json(), called.ok];
    };
    const ids = { ui: [] as string[], mcp: [] as string[] };
    const same = (pair: unknown[]) => {
      expect(normalized(pair[0], ids.ui)).toEqual(normalized(pair[1], ids.mcp));
    };

    const created = await both('issue_create', () => ({ title: 'Erstes', body: 'Der Body\n' }));
    ids.ui.push(created[0].id);
    ids.mcp.push(created[1].id);
    same(created);
    const first = (side: 'ui' | 'mcp') => ids[side][0];
    same(await both('issue_move', (side) => ({ id: first(side), to: 'in_progress' })));
    same(await both('comment_add', (side) => ({ id: first(side), body: 'Ein Kommentar' })));
    const batch = await both('batch', (side) => ({
      ops: [
        { op: 'issue.create', ref: '$a', title: 'Zweites', parent: first(side) },
        { op: 'comment.add', id: '$a', body: 'Im Batch' },
        { op: 'issue.move', id: first(side), from: 'in_progress', to: 'review' },
      ],
    }));
    ids.ui.push(batch[0].refs.$a);
    ids.mcp.push(batch[1].refs.$a);
    same(batch);
    for (const side of [ids.ui, ids.mcp]) expect(side).toEqual([BK_ID, BK_ID]);

    // SIGTERM direkt nach einem Write: Der Prozess endet mit 0, der Commit des Writes steht.
    const commit = batch[0].commit as string;
    expect(commit).toMatch(/^[0-9a-f]{40}$/);
    expect(await ui.stop('SIGTERM')).toBe(0);
    expect(await revParse(viaUi.root, 'HEAD')).toBe(commit);
  } finally {
    await mcp.close();
  }
});

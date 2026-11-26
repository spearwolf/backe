import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { testBacklog } from '../../test/helpers/git.ts';
import { connectServer } from '../../test/helpers/mcp.ts';
import { BackeError } from '../core/errors.ts';
import { setLocale } from '../i18n/locale.ts';
import { scheduleSync } from '../services/background.ts';
import type { SyncDeps } from '../services/sync.ts';
import { tool } from '../tools/define.ts';
import { pendingStarts, runTool, type ToolEnv, writeQueue } from '../tools/run.ts';
import { registerTool, toolError, toolResult } from './tool.ts';

// Der MCP-Modus spricht immer Englisch (backe.md §2.18); `backe mcp` setzt die Locale beim Start.
beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

vi.mock('../services/background.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/background.ts')>()),
  scheduleSync: vi.fn(async () => false),
}));

const schedule = vi.mocked(scheduleSync);
const SYNC: SyncDeps = { now: () => new Date('2026-11-20T00:00:00Z') };

beforeEach(() => {
  schedule.mockClear();
});

/** Frisches `McpServer` mit eigener `ToolEnv` über einem Test-Backlog, per Client verbunden. */
async function harness(define: (server: McpServer, env: ToolEnv) => void) {
  const b = await testBacklog();
  const env: ToolEnv = {
    context: () => b.context(),
    cwd: b.root,
    allowDelete: false,
    deps: { sync: SYNC },
    queue: writeQueue(),
    pending: pendingStarts(),
  };
  const server = new McpServer({ name: 'test', version: '0' });
  define(server, env);
  return connectServer(server);
}

const EMPTY = z.object({});

test('an unexpected error becomes an error result without a stack', async () => {
  const m = await harness((server, env) => {
    registerTool(
      server,
      env,
      tool({
        name: 'boom',
        description: 'wirft',
        input: EMPTY,
        kind: 'read',
        surfaces: ['mcp'],
        run: () => {
          throw new Error('boom');
        },
      }),
    );
    registerTool(
      server,
      env,
      tool({
        name: 'fine',
        description: 'gelingt',
        input: EMPTY,
        kind: 'read',
        surfaces: ['mcp'],
        run: () => Promise.resolve({ fine: true }),
      }),
    );
  });
  try {
    const raw = await m.client.callTool({ name: 'boom', arguments: {} });
    expect(raw.isError).toBe(true);
    const text = (raw.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).not.toContain('stack');
    expect(text).not.toContain('tool.test.ts');
    expect(JSON.parse(text)).toEqual({
      error: { code: 'unexpected', message: 'Unexpected error: boom' },
    });
    expect(await m.call('fine')).toEqual({ ok: { fine: true } });
  } finally {
    await m.close();
  }
});

test('a BackeError keeps code, message and hint', async () => {
  const m = await harness((server, env) => {
    registerTool(
      server,
      env,
      tool({
        name: 'refuse',
        description: 'lehnt ab',
        input: EMPTY,
        kind: 'write',
        surfaces: ['mcp'],
        run: () =>
          Promise.reject(new BackeError('usage', 'Nein »x«', { hint: 'backe issue move --force' })),
      }),
    );
  });
  try {
    expect(await m.call('refuse')).toEqual({
      error: { code: 'usage', message: 'Nein »x«', hint: 'backe issue move --force' },
    });
    expect(schedule).not.toHaveBeenCalled();
  } finally {
    await m.close();
  }
});

test('a read tool schedules a read sync before it runs and gets parsed arguments', async () => {
  const order: string[] = [];
  schedule.mockImplementation(async (_ctx, reason) => {
    order.push(`sync:${reason}`);
    return false;
  });
  const m = await harness((server, env) => {
    registerTool(
      server,
      env,
      tool({
        name: 'echo',
        description: 'echo',
        input: z.object({ word: z.string() }),
        kind: 'read',
        surfaces: ['mcp'],
        run: async (ctx, args) => {
          order.push('run');
          return { word: args.word, user: ctx.user.value };
        },
      }),
    );
  });
  try {
    expect(await m.call('echo', { word: 'hallo' })).toEqual({ ok: { word: 'hallo', user: 'spw' } });
    expect(order).toEqual(['sync:read', 'run']);
    expect(schedule.mock.calls[0]?.[2]).toBe(SYNC);
  } finally {
    await m.close();
    schedule.mockImplementation(async () => false);
  }
});

test('a check on the arguments runs before the read sync; a failing one schedules nothing', async () => {
  const order: string[] = [];
  schedule.mockImplementation(async (_ctx, reason) => {
    order.push(`sync:${reason}`);
    return false;
  });
  const m = await harness((server, env) => {
    registerTool(
      server,
      env,
      tool({
        name: 'checked',
        description: 'checked',
        input: z.object({ ok: z.boolean() }),
        kind: 'read',
        check: (a) => {
          order.push('check');
          if (!a.ok) throw new BackeError('usage', 'nicht ok');
        },
        surfaces: ['mcp'],
        run: async () => {
          order.push('run');
          return {};
        },
      }),
    );
  });
  try {
    expect(await m.call('checked', { ok: false })).toEqual({
      error: { code: 'usage', message: 'nicht ok' },
    });
    expect(order).toEqual(['check']);
    await m.call('checked', { ok: true });
    expect(order).toEqual(['check', 'check', 'sync:read', 'run']);
  } finally {
    await m.close();
    schedule.mockImplementation(async () => false);
  }
});

test('runTool plans the read sync like a registered tool', async () => {
  const b = await testBacklog();
  const env: ToolEnv = {
    context: () => b.context(),
    cwd: b.root,
    allowDelete: false,
    deps: { sync: SYNC },
    queue: writeQueue(),
    pending: pendingStarts(),
  };
  const ctx = await b.context();
  expect(await runTool(env, 'read', ctx, async () => 'gelesen')).toBe('gelesen');
  expect(schedule).toHaveBeenCalledWith(ctx, 'read', SYNC);
});

test('a write tool schedules a write sync only after a commit', async () => {
  const m = await harness((server, env) => {
    registerTool(
      server,
      env,
      tool({
        name: 'write',
        description: 'schreibt',
        input: z.object({ commit: z.string().nullable() }),
        kind: 'write',
        surfaces: ['mcp'],
        run: async (_ctx, args) => ({ commit: args.commit }),
      }),
    );
  });
  try {
    expect(await m.call('write', { commit: null })).toEqual({ ok: { commit: null } });
    expect(schedule).not.toHaveBeenCalled();
    expect(await m.call('write', { commit: 'abc1234' })).toEqual({ ok: { commit: 'abc1234' } });
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0]?.[1]).toBe('write');
    expect(schedule.mock.calls[0]?.[2]).toBe(SYNC);
  } finally {
    await m.close();
  }
});

test('a sync tool answers while a write waits in the queue', async () => {
  const log: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let enqueued = 0;
  const m = await harness((server, env) => {
    const queue = env.queue;
    const counting: ToolEnv = {
      ...env,
      queue: {
        run: (fn) => {
          enqueued += 1;
          // Ein zweiter Job käme nie an die Reihe, solange der erste wartet: dann freigeben,
          // damit der Test an der Reihenfolge scheitert statt zu hängen.
          if (enqueued > 1) release();
          return queue.run(fn);
        },
      },
    };
    registerTool(
      server,
      counting,
      tool({
        name: 'w',
        description: 'w',
        input: EMPTY,
        kind: 'write',
        surfaces: ['mcp'],
        run: async () => {
          log.push('w+');
          await gate;
          log.push('w-');
          return { commit: 'abc1234' };
        },
      }),
    );
    registerTool(
      server,
      counting,
      tool({
        name: 's',
        description: 's',
        input: EMPTY,
        kind: 'sync',
        surfaces: ['mcp'],
        run: async () => {
          log.push('s');
          release();
          return { commit: 'def5678' };
        },
      }),
    );
  });
  try {
    const write = m.call('w');
    const sync = m.call('s');
    expect(await sync).toEqual({ ok: { commit: 'def5678' } });
    expect(await write).toEqual({ ok: { commit: 'abc1234' } });
    // Der Write war noch nicht fertig, als das Sync-Tool lief; wann er anfing, ist offen.
    expect(log.filter((e) => e !== 'w+')).toEqual(['s', 'w-']);
    expect(enqueued).toBe(1);
    // Nachlauf nur für den Write, nicht für das Sync-Tool.
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0]?.[1]).toBe('write');
  } finally {
    await m.close();
  }
});

test('the kind may depend on the arguments', async () => {
  let enqueued = 0;
  const m = await harness((server, env) => {
    const queue = env.queue;
    const counting: ToolEnv = {
      ...env,
      queue: {
        run: (fn) => {
          enqueued += 1;
          return queue.run(fn);
        },
      },
    };
    registerTool(
      server,
      counting,
      tool({
        name: 'k',
        description: 'k',
        input: z.object({ write: z.boolean() }),
        kind: (a) => (a.write ? 'write' : 'sync'),
        surfaces: ['mcp'],
        run: () => Promise.resolve({ commit: null }),
      }),
    );
  });
  try {
    await m.call('k', { write: false });
    expect(enqueued).toBe(0);
    await m.call('k', { write: true });
    expect(enqueued).toBe(1);
  } finally {
    await m.close();
  }
});

test('a context that fails to resolve becomes an error result', async () => {
  const b = await testBacklog();
  const env: ToolEnv = {
    context: () => Promise.reject(new BackeError('not_found', 'Backlog »x« nicht gefunden')),
    cwd: b.root,
    allowDelete: false,
    queue: writeQueue(),
    pending: pendingStarts(),
  };
  const server = new McpServer({ name: 'test', version: '0' });
  registerTool(
    server,
    env,
    tool({
      name: 'any',
      description: 'x',
      input: EMPTY,
      kind: 'read',
      surfaces: ['mcp'],
      run: () => Promise.resolve({}),
    }),
  );
  const m = await connectServer(server);
  try {
    expect(await m.call('any')).toEqual({
      error: { code: 'not_found', message: 'Backlog »x« nicht gefunden' },
    });
  } finally {
    await m.close();
  }
});

test('toolResult and toolError carry compact JSON', () => {
  expect(toolResult({ a: 1, b: undefined })).toEqual({
    content: [{ type: 'text', text: '{"a":1}' }],
  });
  // `JSON.stringify(undefined)` ist kein String; der Block trägt dann `null` wie JSON.
  expect(toolResult(undefined)).toEqual({ content: [{ type: 'text', text: 'null' }] });
  expect(toolError(new BackeError('conflict', 'besetzt'))).toEqual({
    content: [{ type: 'text', text: '{"error":{"code":"conflict","message":"besetzt"}}' }],
    isError: true,
  });
});

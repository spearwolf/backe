import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { testBacklog } from '../../test/helpers/git.ts';
import { connectServer } from '../../test/helpers/mcp.ts';
import { BackeError } from '../core/errors.ts';
import { scheduleSync } from '../services/background.ts';
import type { SyncDeps } from '../services/sync.ts';
import {
  defineTool,
  pendingStarts,
  type ToolEnv,
  toolError,
  toolResult,
  writeQueue,
} from './tool.ts';

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
  const opts = {
    cwd: b.root,
    env: b.env,
    flags: { as: b.handle },
    allowDelete: false,
    deps: { sync: SYNC },
  };
  const env: ToolEnv = {
    context: () => b.context(),
    opts,
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
    defineTool(server, env, 'boom', { description: 'wirft', input: EMPTY, kind: 'read' }, () => {
      throw new Error('boom');
    });
    defineTool(server, env, 'fine', { description: 'gelingt', input: EMPTY, kind: 'read' }, () =>
      Promise.resolve({ fine: true }),
    );
  });
  try {
    const raw = await m.client.callTool({ name: 'boom', arguments: {} });
    expect(raw.isError).toBe(true);
    const text = (raw.content as { type: string; text: string }[])[0]?.text ?? '';
    expect(text).not.toContain('stack');
    expect(text).not.toContain('tool.test.ts');
    expect(JSON.parse(text)).toEqual({
      error: { code: 'unexpected', message: 'Unerwarteter Fehler: boom' },
    });
    expect(await m.call('fine')).toEqual({ ok: { fine: true } });
  } finally {
    await m.close();
  }
});

test('a BackeError keeps code, message and hint', async () => {
  const m = await harness((server, env) => {
    defineTool(
      server,
      env,
      'refuse',
      { description: 'lehnt ab', input: EMPTY, kind: 'write' },
      () =>
        Promise.reject(new BackeError('usage', 'Nein »x«', { hint: 'backe issue move --force' })),
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
    defineTool(
      server,
      env,
      'echo',
      { description: 'echo', input: z.object({ word: z.string() }), kind: 'read' },
      async (ctx, args) => {
        order.push('run');
        return { word: args.word, user: ctx.user.value };
      },
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

test('a write tool schedules a write sync only after a commit', async () => {
  const m = await harness((server, env) => {
    defineTool(
      server,
      env,
      'write',
      {
        description: 'schreibt',
        input: z.object({ commit: z.string().nullable() }),
        kind: 'write',
      },
      async (_ctx, args) => ({ commit: args.commit }),
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

test('a write tool runs through the queue, a sync tool beside it', async () => {
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
    defineTool(server, counting, 'w', { description: 'w', input: EMPTY, kind: 'write' }, () =>
      Promise.resolve({ commit: 'abc1234' }),
    );
    defineTool(server, counting, 's', { description: 's', input: EMPTY, kind: 'sync' }, () =>
      Promise.resolve({ commit: 'abc1234' }),
    );
  });
  try {
    await m.call('w');
    expect(enqueued).toBe(1);
    expect(await m.call('s')).toEqual({ ok: { commit: 'abc1234' } });
    expect(enqueued).toBe(1);
    expect(schedule).toHaveBeenCalledTimes(1);
  } finally {
    await m.close();
  }
});

test('a context that fails to resolve becomes an error result', async () => {
  const b = await testBacklog();
  const opts = { cwd: b.root, env: b.env, flags: { as: b.handle }, allowDelete: false };
  const env: ToolEnv = {
    context: () => Promise.reject(new BackeError('not_found', 'Backlog »x« nicht gefunden')),
    opts,
    queue: writeQueue(),
    pending: pendingStarts(),
  };
  const server = new McpServer({ name: 'test', version: '0' });
  defineTool(server, env, 'any', { description: 'x', input: EMPTY, kind: 'read' }, () =>
    Promise.resolve({}),
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

test('the write queue runs one job after the other', async () => {
  const q = writeQueue();
  const log: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a = q.run(async () => {
    log.push('a+');
    await gate;
    log.push('a-');
    return 'a';
  });
  const b = q.run(async () => {
    log.push('b');
    return 'b';
  });
  release();
  expect(await Promise.all([a, b])).toEqual(['a', 'b']);
  expect(log).toEqual(['a+', 'a-', 'b']);
});

test('a failed job does not stop the write queue', async () => {
  const q = writeQueue();
  const failed = q.run(() => Promise.reject(new Error('kaputt')));
  const next = q.run(() => Promise.resolve(2));
  await expect(failed).rejects.toThrow('kaputt');
  expect(await next).toBe(2);
});

test('toolResult and toolError carry compact JSON', () => {
  expect(toolResult({ a: 1, b: undefined })).toEqual({
    content: [{ type: 'text', text: '{"a":1}' }],
  });
  expect(toolError(new BackeError('conflict', 'besetzt'))).toEqual({
    content: [{ type: 'text', text: '{"error":{"code":"conflict","message":"besetzt"}}' }],
    isError: true,
  });
});

test('pending starts are settled, including one added while waiting', async () => {
  const p = pendingStarts();
  await p.settled();
  // Ein abgelehnter Start hält `settled` nicht auf und wird nicht zur unbehandelten Ablehnung.
  p.add(Promise.reject(new Error('abgelehnt')));
  const order: string[] = [];
  let finishFirst!: () => void;
  p.add(
    new Promise<void>((r) => {
      finishFirst = r;
    }).then(() => {
      order.push('first');
      p.add(Promise.reject(new Error('second')).catch(() => order.push('second')));
    }),
  );
  const settled = p.settled().then(() => order.push('settled'));
  finishFirst();
  await settled;
  expect(order).toEqual(['first', 'second', 'settled']);
});

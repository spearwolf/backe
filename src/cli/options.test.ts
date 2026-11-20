import { Command } from 'commander';
import { tempDir } from '../../test/helpers/backlog.ts';
import { catchErrAsync } from '../../test/helpers/catch.ts';
import { testBacklog } from '../../test/helpers/git.ts';
import type { Env } from '../context/paths.ts';
import type { ResolvedContext } from '../context/resolve.ts';
import type { CliIo } from './io.ts';
import {
  action,
  addGlobalOptions,
  type CommandEnv,
  GLOBAL_KEYS,
  type GlobalKey,
  globalKeysOf,
  globalOpts,
  type Runtime,
  stdinBody,
  subcommand,
  text,
} from './options.ts';
import { buildProgram } from './run.ts';

function fakeIo(env: Env, cwd: string, argv: string[] = []): CliIo {
  return {
    argv,
    env,
    cwd,
    stdout: () => {},
    stdoutBytes: () => {},
    stderr: () => {},
    readStdin: async () => '',
    isTTY: false,
    stdinIsTTY: false,
    runEditor: async () => 0,
    ask: async () => '',
  };
}

const runtime = (io: CliIo): Runtime => ({ io, stdin: { taken: false }, state: {} });

/**
 * Lange Namen der globalen Optionen, die `cmd` selbst trägt. Eine gleichnamige Option mit Wert
 * (`attach add --json <json|->`) ist eine eigene, nicht die globale Kurzform.
 */
function carried(cmd: Command): GlobalKey[] {
  const longs = new Set(
    cmd.options.filter((o) => o.long !== '--json' || o.isBoolean()).map((o) => o.long),
  );
  return GLOBAL_KEYS.filter((key) => longs.has(`--${key}`));
}

function walk(cmd: Command, visit: (c: Command) => void): void {
  visit(cmd);
  for (const sub of cmd.commands) walk(sub, visit);
}

test('every command level carries the global options it has not opted out of', () => {
  const program = buildProgram(runtime(fakeIo({}, '/')));
  const seen: string[] = [];
  walk(program, (cmd) => {
    seen.push(cmd.name());
    expect({ cmd: cmd.name(), keys: carried(cmd) }).toEqual({
      cmd: cmd.name(),
      keys: globalKeysOf(cmd),
    });
  });
  expect(seen).toEqual(expect.arrayContaining(['backe', 'context', 'backlog', 'list', 'verify']));
});

test('a command may opt out of a global flag and own the name', async () => {
  const program = addGlobalOptions(new Command('t').exitOverride().enablePositionalOptions());
  const own = subcommand(program, 'own', 'eigenes --json', { without: ['json'] }).option(
    '--json <json>',
    'eigener Wert',
  );
  expect(globalKeysOf(own)).toEqual(['backlog', 'as', 'format', 'fields']);
  let seen: unknown;
  own.action((opts: { json?: string }, cmd: Command) => {
    seen = { local: opts.json, global: globalOpts(cmd).json };
  });
  await program.parseAsync(['--json', 'own', '--json', '{"a":1}'], { from: 'user' });
  expect(seen).toEqual({ local: '{"a":1}', global: true });
});

test('context resolves once per flag set, not once per call', async () => {
  const b = await testBacklog();
  const io = fakeIo({ ...b.env, BACKE_USER: 'spw' }, await tempDir());
  const program = addGlobalOptions(new Command('t').exitOverride().enablePositionalOptions());
  const got: ResolvedContext[] = [];
  subcommand(program, 'x', 'Test').action(
    action(runtime(io), async (env: CommandEnv) => {
      got.push(await env.context({ project: 'web' }));
      got.push(await env.context({ project: 'api' }));
      got.push(await env.context({ project: 'web' }));
      got.push(await env.context());
    }),
  );
  await program.parseAsync(['x'], { from: 'user' });
  const [web, api, webAgain, plain] = got;
  expect(web?.project.value).toBe('web');
  expect(api?.project.value).toBe('api');
  expect(webAgain).toBe(web);
  expect(plain?.project.value).toBeUndefined();
});

test('stdin is handed out once per call', async () => {
  let reads = 0;
  const io = { ...fakeIo({}, '/'), readStdin: async () => `Eingabe ${++reads}` };
  const guard = { taken: false };
  expect(await text('wörtlich', io, guard)).toBe('wörtlich');
  expect(guard.taken).toBe(false);
  expect(await text('-', io, guard)).toBe('Eingabe 1');
  const err = await catchErrAsync(() => text('-', io, guard));
  expect([err.code, err.message]).toEqual(['usage', 'stdin ist schon vergeben']);
  expect(reads).toBe(1);
  // Ein wörtlicher Wert geht auch danach noch.
  expect(await text('x', io, guard)).toBe('x');
});

test('a body from stdin must not be empty', async () => {
  const io = (input: string) => ({ ...fakeIo({}, '/'), readStdin: async () => input });
  expect(await stdinBody(io('Text\n'), { taken: false }, "-d ''")).toBe('Text\n');
  for (const input of ['', ' \n\t\n']) {
    const err = await catchErrAsync(() => stdinBody(io(input), { taken: false }, "-d ''"));
    expect([err.code, err.message, err.hint]).toEqual([
      'validation',
      'Beschreibung ist leer',
      "Leeren mit -d ''",
    ]);
  }
});

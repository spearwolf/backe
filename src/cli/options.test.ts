import { Command } from 'commander';
import { tempDir } from '../../test/helpers/backlog.ts';
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
  subcommand,
} from './options.ts';
import { buildProgram } from './run.ts';

function fakeIo(env: Env, cwd: string, argv: string[] = []): CliIo {
  return {
    argv,
    env,
    cwd,
    stdout: () => {},
    stderr: () => {},
    readStdin: async () => '',
    isTTY: false,
  };
}

const runtime = (io: CliIo): Runtime => ({ io, stdin: { taken: false }, state: {} });

/** Lange Namen der globalen Optionen, die `cmd` selbst trägt. */
function carried(cmd: Command): GlobalKey[] {
  const longs = new Set(cmd.options.map((o) => o.long));
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

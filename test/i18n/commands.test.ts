import type { Command } from 'commander';
import type { CliIo } from '../../src/cli/io.ts';
import { buildProgram, run } from '../../src/cli/run.ts';
import type { Env } from '../../src/context/paths.ts';
import { setLocale } from '../../src/i18n/locale.ts';
import { tempDir } from '../helpers/backlog.ts';
import { testBacklog } from '../helpers/git.ts';

beforeAll(() => setLocale('en'));
afterAll(() => setLocale('de'));

type Out = { code: number; stdout: string; stderr: string };

function io(env: Env, cwd: string, argv: string[], out: { stdout: string; stderr: string }): CliIo {
  return {
    argv,
    env,
    cwd,
    stdout: (s) => {
      out.stdout += s;
    },
    stdoutBytes: () => {},
    stderr: (s) => {
      out.stderr += s;
    },
    readStdin: async () => '',
    isTTY: false,
    stdinIsTTY: false,
    runEditor: async () => 0,
    prompt: async () => '',
  };
}

async function setup(): Promise<(args: string[]) => Promise<Out>> {
  const b = await testBacklog();
  const cwd = await tempDir();
  const env: Env = { ...b.env, BACKE_USER: 'spw', NO_COLOR: '1', BACKE_LANG: 'en' };
  return async (args) => {
    const out = { stdout: '', stderr: '' };
    const code = await run(io(env, cwd, args, out));
    return { code, ...out };
  };
}

test('a usage error carries an English message and hint', async () => {
  const backe = await setup();
  const r = await backe(['attach', 'add', 'bk-1', '--name', 'x']);
  expect(r.code).not.toBe(0);
  expect(r.stderr).toBe(
    'Error: Specify exactly one source\nHint: <file>, --url <url> or --json <json|->\n',
  );
});

test('mutually exclusive flags are reported in English', async () => {
  const backe = await setup();
  const r = await backe(['issue', 'list', '--blocked', '--ready']);
  expect(r.stderr).toContain('Error: --blocked, --unblockable and --ready are mutually exclusive');
});

test('a truncated list ends with an English hint, the context shows English labels', async () => {
  const backe = await setup();
  expect((await backe(['config', 'set', 'backlogs.acme.sync.mode', 'manual'])).code).toBe(0);
  expect((await backe(['issue', 'create', '-t', 'First'])).code).toBe(0);
  expect((await backe(['issue', 'create', '-t', 'Second'])).code).toBe(0);
  const list = await backe(['issue', 'list', '--limit', '1']);
  expect(list.stderr).toBe('Hint: List truncated (--limit 1)\n');
  const ctx = await backe(['context']);
  expect(ctx.stdout).toMatch(/^write: {1,2}yes$/m);
});

test('hand edits report an English subject for nothing to commit', async () => {
  const backe = await setup();
  const r = await backe(['commit']);
  expect(r.stdout).toBe('Nothing to commit\n');
});

test('help shows English descriptions, placeholders and the editor note', async () => {
  const backe = await setup();
  const edit = await backe(['issue', 'edit', '--help']);
  expect(edit.stdout).toContain('Change fields of an issue or edit it in an editor');
  expect(edit.stdout).toContain('--title <title>');
  expect(edit.stdout).toContain('Without change flags, backe issue edit <id> opens the issue file');
  const batch = await backe(['batch', '--help']);
  expect(batch.stdout).toContain('backe batch [options] [source]');
  expect(batch.stdout).toContain("JSONL file ('-' reads stdin)");
});

/** Befehlsbaum als Text: Namen, Aliase, Argumente (mit Pflicht/variadisch) und Optionen (Flags, Attributname, Pflicht, Wertform). */
function shape(cmd: Command, depth = 0): string[] {
  const own = [
    `${'  '.repeat(depth)}${cmd.name()} [${cmd.aliases().join(',')}]`,
    ...cmd.registeredArguments.map(
      (a) => `${'  '.repeat(depth)}  arg ${a.required ? 'req' : 'opt'}${a.variadic ? '...' : ''}`,
    ),
    ...cmd.options.map(
      (o) =>
        `${'  '.repeat(depth)}  opt ${o.short ?? ''} ${o.long ?? ''} -> ${o.attributeName()}` +
        `${o.mandatory ? ' mandatory' : ''}${o.required ? ' value-required' : ''}` +
        `${o.optional ? ' value-optional' : ''}`,
    ),
  ];
  return [...own, ...cmd.commands.flatMap((c) => shape(c, depth + 1))];
}

test('command and option names are the same in English and German', async () => {
  const build = async (lang: 'en' | 'de') => {
    setLocale(lang);
    const out = { stdout: '', stderr: '' };
    const rt = {
      io: io({ BACKE_LANG: lang }, await tempDir(), [], out),
      stdin: { taken: false },
      state: {},
    };
    return shape(buildProgram(rt));
  };
  const en = await build('en');
  const de = await build('de');
  setLocale('en');
  expect(en).toEqual(de);
  expect(en.length).toBeGreaterThan(100);
});

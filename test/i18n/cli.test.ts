import type { CliIo } from '../../src/cli/io.ts';
import { checkNodeVersion } from '../../src/cli/node-version.ts';
import { issueDetailText } from '../../src/cli/render-issue.ts';
import { run } from '../../src/cli/run.ts';
import { setLocale } from '../../src/i18n/locale.ts';
import type { IssueDetail } from '../../src/services/issue-show.ts';

type Result = { code: number; stdout: string; stderr: string };

async function backe(...argv: string[]): Promise<Result> {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    argv,
    env: { NO_COLOR: '1', COLUMNS: '100' },
    cwd: '/',
    stdout: (s) => {
      stdout += s;
    },
    stdoutBytes: () => {},
    stderr: (s) => {
      stderr += s;
    },
    readStdin: async () => '',
    isTTY: false,
    stdinIsTTY: false,
    runEditor: async () => 0,
    prompt: async () => '',
  };
  const code = await run(io);
  return { code, stdout, stderr };
}

describe('CLI core in English', () => {
  beforeAll(() => setLocale('en'));
  afterAll(() => setLocale('de'));

  test('commander errors are translated, a suggestion included', async () => {
    const bogus = await backe('issue', 'list', '--bogus');
    expect(bogus.code).toBe(2);
    expect(bogus.stderr).toBe('Error: Unknown option --bogus\n');
    const near = await backe('ls', '--stat');
    expect(near.stderr).toBe('Error: Unknown option --stat (Did you mean --state?)\n');
    const command = await backe('isue');
    expect(command.stderr).toBe("Error: Unknown command 'isue' (Did you mean issue?)\n");
  });

  test('excess arguments and a missing option value are translated', async () => {
    const excess = await backe('issue', 'show', 'a', 'b');
    expect(excess.stderr).toBe("Error: Too many arguments for 'show': expected 1, got 2 (a, b)\n");
    const value = await backe('issue', 'list', '--state');
    expect(value.stderr).toBe("Error: Option '--state <state[,state]|all>' needs a value\n");
  });

  test('a missing argument names it and prints the help with English titles', async () => {
    const r = await backe('issue', 'show');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^Error: Missing argument 'id'\n\nUsage: backe issue show /);
    expect(r.stderr).toContain('Options:');
  });

  test('the root help carries the English description and quick start', async () => {
    const r = await backe('--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Git-based backlog for humans and agents');
    expect(r.stdout).toContain('Commands:');
    expect(r.stdout).toContain('Quick start:');
    expect(r.stdout).toContain('More: backe <command> --help');
  });

  test('an unknown output format is a validation error with a hint', async () => {
    const r = await backe('--format', 'xml', 'context');
    expect(r.stderr).toBe(
      "Error: Unknown output format 'xml' (source: --format)\nHint: text, json or md\n",
    );
  });

  test('the Node.js version check reports in English', () => {
    expect(checkNodeVersion('22.1.0')).toBe('backe needs Node.js ≥ 26 (found 22.1.0)');
  });
});

describe('CLI core in German', () => {
  test('commander errors and help section titles are German', async () => {
    const near = await backe('ls', '--stat');
    expect(near.stderr).toBe('Fehler: Unbekannte Option --stat (Meintest du --state?)\n');
    const help = await backe('issue', 'list', '--help');
    expect(help.stdout).toMatch(/^Aufruf: backe issue list /);
    expect(help.stdout).toContain('Optionen:');
    const root = await backe('--help');
    expect(root.stdout).toContain('Befehle:');
  });
});

describe('issue detail in English', () => {
  beforeAll(() => setLocale('en'));
  afterAll(() => setLocale('de'));

  test('a blocked, paused issue names its origin and its blockers', () => {
    const detail = {
      issue: {
        id: 'bk-aaaaa',
        title: 'Waiting',
        state: 'blocked',
        paused_from: 'todo',
        blocked_by: ['bk-bbbbb'],
      },
      body: '',
      parents: [],
      blockedBy: [{ id: 'bk-bbbbb', state: 'in_progress', title: 'Other' }],
      dependsOn: [],
      dependents: [],
      children: [],
      commentsCount: 0,
      comments: [],
    } as unknown as IssueDetail;
    expect(issueDetailText(detail, false)).toContain(
      'state       blocked (from todo), blocked by bk-bbbbb [in_progress]\n',
    );
  });
});

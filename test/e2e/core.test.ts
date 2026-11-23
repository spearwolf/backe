import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pkg from '../../package.json' with { type: 'json' };
import type { Env } from '../../src/context/paths.ts';
import { updateUserConfig } from '../../src/context/user-config.ts';
import { git } from '../../src/git/exec.ts';
import { executeWrite } from '../../src/services/write.ts';
import { listIssueIds } from '../../src/store/snapshot.ts';
import { tempDir } from '../helpers/backlog.ts';
import { rawCommit, revParse, type TestBacklog, testBacklog, testKey } from '../helpers/git.ts';
import { type CliResult, cli, normalize, transcript } from './cli.ts';

type Setup = { b: TestBacklog; env: Env; cwd: string; names: Record<string, string> };

/** Backlog `acme` im Temp-Home, aufgerufen als `spw` (über `BACKE_USER`) aus einem fremden Verzeichnis. */
async function setup(opts: { remote?: boolean } = {}): Promise<Setup> {
  const b = await testBacklog(opts);
  const cwd = await tempDir();
  const anchor = await revParse(b.root, 'HEAD');
  const names: Record<string, string> = {
    [b.root]: '<root>',
    [b.key.priv]: '<key>',
    [b.env.HOME as string]: '<home>',
    [b.env.BACKE_HOME as string]: '<backe>',
    [cwd]: '<cwd>',
    [anchor]: '<anchor>',
    [anchor.slice(0, 7)]: '<anchor7>',
  };
  if (b.remote !== undefined) names[b.remote] = '<remote>';
  const s = { b, env: { ...b.env, BACKE_USER: 'spw' }, cwd, names };
  // Kein Read und kein Write dieser Tests soll einen Hintergrund-Sync starten.
  const manual = await cli(['config', 'set', 'backlogs.acme.sync.mode', 'manual'], s);
  expect(manual.code).toBe(0);
  return s;
}

/** Leeres Home ohne Config und ohne Backlog. */
async function emptyHome(): Promise<{ env: Env; cwd: string }> {
  const cwd = await tempDir();
  return { env: { HOME: join(cwd, 'home'), BACKE_HOME: join(cwd, 'backe') }, cwd };
}

/** Mehrere Aufrufe als ein Golden-Text, je Aufruf mit Befehlszeile. */
async function session(s: Setup, calls: string[][]): Promise<string> {
  const parts: string[] = [];
  for (const args of calls) {
    const r = await cli(args, { env: s.env, cwd: s.cwd });
    const line = args.map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(' ');
    parts.push(`${normalize(`$ backe ${line}`, s.names)}\n${transcript(r, s.names)}`);
  }
  return parts.join('\n');
}

const noStack = (r: CliResult) => expect(r.stderr).not.toMatch(/^\s+at /m);

test('usage errors exit with 2', async () => {
  const { env, cwd } = await emptyHome();
  const opts = { env, cwd };
  const r = await cli(['--frobnicate'], opts);
  expect(r.code).toBe(2);
  expect(r.stdout).toBe('');
  expect(r.stderr).toMatch(/^Fehler: unknown option '--frobnicate'/);

  for (const args of [
    ['context', '--frobnicate'],
    ['backlog', 'use'],
    ['backlog', 'use', 'a', 'b'],
    ['frobnicate'],
    ['backlog'],
    [],
  ]) {
    const u = await cli(args, opts);
    expect({ args, code: u.code }).toEqual({ args, code: 2 });
    expect(u.stdout).toBe('');
    expect(u.stderr).toMatch(/^Fehler: /);
    noStack(u);
  }
  const group = await cli(['backlog'], opts);
  expect(group.stderr).toBe('Fehler: Unterbefehl fehlt\nHinweis: backe backlog --help\n');
});

test('errors in json mode', async () => {
  const { env, cwd } = await emptyHome();
  const noBacklog = { env, cwd };
  const r = await cli(['--json', 'context', '--props'], noBacklog);
  expect(r.code).toBe(2);
  expect(r.stdout).toBe('');
  expect(JSON.parse(r.stderr)).toEqual({
    error: {
      code: 'usage',
      message: expect.any(String),
      hint: expect.stringContaining('backe backlog use'),
    },
  });
  expect(r.stderr.endsWith('}\n')).toBe(true);
  expect(r.stderr.split('\n')).toHaveLength(2);

  // Auch commander-Fehler und Fehler vor dem Befehl kommen als ein JSON-Objekt.
  for (const [args, extra] of [
    [['--json', '--frobnicate'], {}],
    [['context', '--frobnicate', '--json'], {}],
    [['--format=json', 'backlog'], {}],
    [['context'], { BACKE_FORMAT: 'json' }],
  ] as const) {
    const e = await cli([...args], { env: { ...env, ...extra }, cwd });
    expect(e.code).toBe(2);
    expect(e.stdout).toBe('');
    expect(JSON.parse(e.stderr)).toMatchObject({ error: { code: 'usage' } });
  }
});

test('no backlog resolves to a usage error with hint', async () => {
  const { env, cwd } = await emptyHome();
  const r = await cli(['context'], { env, cwd });
  expect(r.code).toBe(2);
  expect(r.stdout).toBe('');
  expect(r.stderr).toMatch(/^Fehler: Kein Backlog angegeben\nHinweis: .*backe backlog use/);
  expect(r.stderr).toMatch(/backe backlog use/);
  noStack(r);
});

test('no color in pipes', async () => {
  const s = await setup({ remote: true });
  await updateUserConfig(s.b.homes.backeHome, () => [{ path: ['output', 'color'], value: 'auto' }]);
  for (const args of [['backlog', 'list'], ['context'], ['verify'], ['backlog', 'show']]) {
    const r = await cli(args, { env: s.env, cwd: s.cwd });
    expect({ args, code: r.code }).toEqual({ args, code: 0 });
    expect(r.stdout + r.stderr).not.toContain('\x1b');
  }
  // `always` erzwingt Farben auch ohne TTY, `NO_COLOR` schaltet nur `auto` ab.
  await updateUserConfig(s.b.homes.backeHome, () => [
    { path: ['output', 'color'], value: 'always' },
  ]);
  const forced = await cli(['backlog', 'list'], { env: { ...s.env, NO_COLOR: '1' }, cwd: s.cwd });
  expect(forced.stdout).toContain('\x1b[');
});

test('init and backlog add expand relative and ~ paths', async () => {
  const { env, cwd } = await emptyHome();
  const key = await testKey('spw');
  const as = { env: { ...env, BACKE_USER: 'spw' }, cwd };
  const rel = await cli(
    ['init', './acme', '--name', 'acme', '--prefix', 'bk', '--key', key.priv],
    as,
  );
  expect(rel).toEqual({ stdout: `${join(cwd, 'acme')}\n`, stderr: '', code: 0 });

  const home = await cli(
    ['init', '~/beta', '--name', 'beta', '--prefix', 'bt', '--key', key.priv],
    as,
  );
  expect(home).toEqual({ stdout: `${join(env.HOME as string, 'beta')}\n`, stderr: '', code: 0 });

  // Ein zweites Home bindet einen Clone von `acme` einmal über `~`, einmal relativ.
  const other = await tempDir();
  const otherEnv = { HOME: join(other, 'home'), BACKE_HOME: join(other, 'backe') };
  const copy = join(other, 'home', 'copy');
  await mkdir(join(other, 'home'), { recursive: true });
  await git(['clone', '-q', join(cwd, 'acme'), copy], { cwd: other });
  const opts = { env: otherEnv, cwd: join(other, 'home') };
  const viaHome = await cli(['backlog', 'add', 'acme', '~/copy', '--as', 'spw'], opts);
  expect(viaHome).toEqual({ stdout: `${copy}\n`, stderr: '', code: 0 });
  expect((await cli(['backlog', 'remove', 'acme'], opts)).code).toBe(0);
  const viaRel = await cli(['--as', 'spw', 'backlog', 'add', 'acme', './copy'], opts);
  expect(viaRel).toEqual({ stdout: `${copy}\n`, stderr: '', code: 0 });
});

test('init without handle or key is a usage error', async () => {
  const { env, cwd } = await emptyHome();
  const key = await testKey('spw');
  const noHandle = await cli(['init', '--name', 'acme', '--prefix', 'bk', '--key', key.priv], {
    env,
    cwd,
  });
  expect(noHandle.code).toBe(2);
  expect(noHandle.stderr).toMatch(/^Fehler: Kein Handle angegeben\nHinweis: --as <handle>/);

  const noKey = await cli(['init', '--name', 'acme', '--prefix', 'bk', '--as', 'spw'], {
    env,
    cwd,
  });
  expect(noKey.code).toBe(2);
  expect(noKey.stderr).toMatch(/^Fehler: Kein Signing-Key angegeben\nHinweis: --key <pfad>/);
});

test('context text and json', async () => {
  const s = await setup();
  const file = join(s.b.root, '.backe/backlog.jsonc');
  const config = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  config.props = {
    sev: { type: 'enum', values: ['high', 'mid', 'low'], ordered: true, description: 'Schwere' },
    area: { type: 'enum', values: ['api', 'ui'], description: 'Bereich' },
    estimate_h: { type: 'number', description: 'Schätzung in Stunden' },
  };
  await writeFile(file, JSON.stringify(config));

  await expect(
    await session(s, [
      ['context', '--props', '--project', 'web/auth'],
      ['context', '--as', 'bob'],
    ]),
  ).toMatchFileSnapshot('golden/context.txt');

  const after = await cli(['context', '--json'], { env: s.env, cwd: s.cwd });
  const before = await cli(['--json', 'context'], { env: s.env, cwd: s.cwd });
  expect(after).toEqual(before);
  expect(after.code).toBe(0);
  expect(after.stderr).toBe('');
  await expect(normalize(after.stdout, s.names)).toMatchFileSnapshot('golden/context.json');

  const env = await cli(['context'], { env: { ...s.env, BACKE_FORMAT: 'json' }, cwd: s.cwd });
  expect(env.stdout).toBe(after.stdout);
});

test('format and fields are checked per command', async () => {
  const s = await setup();
  const opts = { env: s.env, cwd: s.cwd };
  const cases: [string[], RegExp][] = [
    [['--format', 'xml', 'context'], /^Fehler: Unbekanntes Ausgabeformat »xml«/],
    [['--format', 'md', 'context'], /^Fehler: »backe context« kennt --format md nicht/],
    [['--fields', 'id', 'context'], /^Fehler: --fields geht nur mit --format json/],
  ];
  for (const [args, message] of cases) {
    const r = await cli(args, opts);
    expect({ args, code: r.code }).toEqual({ args, code: 2 });
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(message);
  }
  const fields = await cli(['--json', '--fields', 'id', 'context'], opts);
  expect(fields.code).toBe(2);
  expect(JSON.parse(fields.stderr)).toEqual({
    error: { code: 'usage', message: '»backe context« kennt --fields nicht' },
  });
  // Ein Default aus Env oder Config, den der Befehl nicht kann, fällt auf Text zurück.
  const md = await cli(['context'], { env: { ...s.env, BACKE_FORMAT: 'md' }, cwd: s.cwd });
  expect(md.code).toBe(0);
  expect(md.stdout).toMatch(/^backlog {2}/);
});

test('backlog list, use, show', async () => {
  const s = await setup({ remote: true });
  const key = s.b.key.priv;
  const beta = await cli(['init', '--name', 'beta', '--prefix', 'bt', '--key', key], {
    env: s.env,
    cwd: s.cwd,
  });
  expect(beta.code).toBe(0);
  s.names[join(s.b.env.BACKE_HOME as string, 'backlogs/beta/spw')] = '<beta>';
  const betaAnchor = await revParse(
    join(s.b.env.BACKE_HOME as string, 'backlogs/beta/spw'),
    'HEAD',
  );
  s.names[betaAnchor.slice(0, 7)] = '<beta-anchor7>';

  await expect(
    await session(s, [
      ['backlog', 'list'],
      ['backlog', 'use', 'beta'],
      ['backlog', 'list'],
      ['backlog', 'show', 'acme'],
      ['backlog', 'show'],
      ['backlog', 'use', 'nope'],
    ]),
  ).toMatchFileSnapshot('golden/backlog-list.txt');

  const json = await cli(['--json', 'backlog', 'list'], { env: s.env, cwd: s.cwd });
  await expect(normalize(json.stdout, s.names)).toMatchFileSnapshot('golden/backlog-list.json');
  const shown = await cli(['--json', 'backlog', 'show', 'acme'], { env: s.env, cwd: s.cwd });
  await expect(normalize(shown.stdout, s.names)).toMatchFileSnapshot('golden/backlog-show.json');

  // beta hat keine Remote: --purge allein löscht die einzige Kopie nicht.
  const refused = await cli(['backlog', 'remove', 'beta', '--purge'], { env: s.env, cwd: s.cwd });
  expect([refused.code, normalize(refused.stderr, s.names)]).toEqual([
    4,
    'Fehler: Der verwaltete Clone »<beta>« hat keine Remote\n' +
      'Hinweis: backe backlog remove beta --purge --force löscht trotzdem\n',
  ]);
  const loneForce = await cli(['backlog', 'remove', 'beta', '--force'], { env: s.env, cwd: s.cwd });
  expect([loneForce.code, loneForce.stderr]).toEqual([2, 'Fehler: --force gehört zu --purge\n']);
  const removed = await cli(['backlog', 'remove', 'beta', '--purge', '--force'], {
    env: s.env,
    cwd: s.cwd,
  });
  expect(normalize(removed.stdout, s.names)).toBe(
    'entfernt: beta\ngelöscht: <backe>/backlogs/beta\n',
  );
});

test('verify reports a clean history', async () => {
  const s = await setup();
  const ctx = await s.b.context();
  await executeWrite(ctx, {
    kind: 'op',
    op: { op: 'issue.create', title: 'A', props: { sev: 'kritisch' } },
  });
  const [id] = await listIssueIds(s.b.root);
  s.names[id as string] = '<A>';
  // Die Deklaration kommt erst nach dem Wert: `verify` meldet ihn als Hinweis, nicht als Fehler.
  const file = join(s.b.root, '.backe/backlog.jsonc');
  const config = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
  config.props = { sev: { type: 'integer', description: 'Schwere' } };
  await rawCommit(s.b.root, {
    files: { '.backe/backlog.jsonc': `${JSON.stringify(config, null, 2)}\n` },
    key: s.b.key,
    actor: 'spw',
    op: 'manual',
    subject: 'props deklarieren',
  });

  await expect(await session(s, [['verify'], ['verify', '--since', 'HEAD~1']])).toMatchFileSnapshot(
    'golden/verify.txt',
  );
  const json = await cli(['--json', 'verify'], { env: s.env, cwd: s.cwd });
  expect(json.code).toBe(0);
  expect(json.stderr).toBe('');
  expect(JSON.parse(json.stdout)).toMatchObject({
    checked: 3,
    invalid: [],
    prop_notices: [expect.stringMatching(/ sev: /)],
  });
  await expect(normalize(json.stdout, s.names)).toMatchFileSnapshot('golden/verify.json');
});

test('verify warns about unknown keys, text on stderr and JSON as unknown_keys', async () => {
  const s = await setup();
  const fixture = join(
    import.meta.dirname,
    '../fixtures/backlog-unknown-key/issues/7f/bk-7f3k2/issue.md',
  );
  await rawCommit(s.b.root, {
    files: { 'issues/7f/bk-7f3k2/issue.md': await readFile(fixture, 'utf8') },
    key: s.b.key,
    actor: 'spw',
    op: 'manual',
    subject: 'Altlast',
  });
  const text = await cli(['verify'], { env: s.env, cwd: s.cwd });
  expect(text.code).toBe(0);
  expect(text.stderr).toBe(
    'Warnung: issues/7f/bk-7f3k2/issue.md: unbekannte Keys legacy, 2 — eigene Daten gehören nach props\n',
  );
  const json = await cli(['--json', 'verify'], { env: s.env, cwd: s.cwd });
  expect(json.code).toBe(0);
  expect(json.stderr).toBe('');
  expect(JSON.parse(json.stdout).unknown_keys).toEqual([
    { path: 'issues/7f/bk-7f3k2/issue.md', keys: ['legacy', '2'] },
  ]);
});

test('verify fails with exit 5 until the commit is quarantined', async () => {
  const s = await setup();
  const bad = await rawCommit(s.b.root, {
    files: { 'x.txt': '1' },
    actor: 'spw',
    op: 'manual',
    subject: 'manipuliert',
  });
  s.names[bad] = '<bad>';
  s.names[bad.slice(0, 7)] = '<bad7>';
  await expect(
    await session(s, [
      ['verify'],
      ['verify', '--accept', bad, '--reason', 'bekannt und harmlos'],
      ['verify'],
    ]),
  ).toMatchFileSnapshot('golden/verify-invalid.txt');
  // Im JSON-Modus steht der Bericht mit snake_case-Keys in den Details des Fehlers.
  const unaccepted = await rawCommit(s.b.root, {
    files: { 'y.txt': '1' },
    actor: 'spw',
    op: 'manual',
  });
  s.names[unaccepted] = '<bad2>';
  const json = await cli(['--json', 'verify'], { env: s.env, cwd: s.cwd });
  expect([json.code, json.stdout]).toEqual([5, '']);
  await expect(normalize(json.stderr, s.names)).toMatchFileSnapshot('golden/verify-invalid.json');
});

test('verify --accept without reason is a usage error, with an empty reason a validation error', async () => {
  const s = await setup();
  const opts = { env: s.env, cwd: s.cwd };
  const head = await revParse(s.b.root, 'HEAD');
  const cases: [string[], string, RegExp][] = [
    [['verify', '--accept', head], 'usage', /^--accept braucht --reason/],
    [
      ['verify', '--accept', head, '--revert', head, '--reason', 'x'],
      'usage',
      /^--accept und --revert schließen sich aus/,
    ],
    [['verify', '--revert', head, '--reason', '  '], 'validation', /^Grund darf nicht leer sein$/],
  ];
  for (const [args, code, message] of cases) {
    const r = await cli(['--json', ...args], opts);
    expect({ args, exit: r.code }).toEqual({ args, exit: 2 });
    expect(r.stdout).toBe('');
    const { error } = JSON.parse(r.stderr) as { error: { code: string; message: string } };
    expect({ args, code: error.code }).toEqual({ args, code });
    expect(error.message).toMatch(message);
  }
  // Die Begründung darf von stdin kommen; leeres stdin ist ein angegebener, leerer Wert.
  const empty = await cli(['verify', '--accept', head, '--reason', '-'], { ...opts, input: '\n' });
  expect(empty).toEqual({
    stdout: '',
    stderr: 'Fehler: Grund darf nicht leer sein\n',
    code: 2,
  });
});

test('a reason that looks like a global option stays the reason', async () => {
  const s = await setup();
  const bad = await rawCommit(s.b.root, { files: { 'x.txt': '1' }, actor: 'spw', op: 'manual' });
  const opts = { env: s.env, cwd: s.cwd };
  const r = await cli(['verify', '--accept', bad, '--reason', '--json'], opts);
  expect(r).toEqual({ stdout: `${bad.slice(0, 7)} accepted: --json\n`, stderr: '', code: 0 });
  const after = await cli(['verify'], opts);
  expect(after.stdout).toContain(`${bad.slice(0, 7)} accepted: --json\n`);
  expect(after.code).toBe(0);
});

test('issue edit --help names the editor mode and its variables', async () => {
  const { env, cwd } = await emptyHome();
  const r = await cli(['issue', 'edit', '--help'], { env, cwd });
  expect(r.code).toBe(0);
  expect(r.stderr).toBe('');
  expect(r.stdout).toContain('im Editor');
  expect(r.stdout).toContain('BACKE_EDITOR, sonst VISUAL, dann EDITOR');
});

test('root help and help command end with the quickstart; subcommand help does not', async () => {
  const { env, cwd } = await emptyHome();
  for (const args of [['--help'], ['help']]) {
    const r = await cli(args, { env, cwd });
    expect({ args, code: r.code }).toEqual({ args, code: 0 });
    expect(r.stdout).toContain('Schnellstart:');
    const lines = r.stdout.trimEnd().split('\n');
    const block = lines.slice(lines.indexOf('Schnellstart:'));
    expect(block.filter((l) => l.length > 80)).toEqual([]);
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('Mehr: backe <befehl> --help');
  }
  for (const args of [
    ['issue', '--help'],
    ['issue', 'edit', '--help'],
    ['help', 'verify'],
  ]) {
    const r = await cli(args, { env, cwd });
    expect({ args, quickstart: r.stdout.includes('Schnellstart') }).toEqual({
      args,
      quickstart: false,
    });
  }
});

test('--help and --version exit 0', async () => {
  const { env, cwd } = await emptyHome();
  for (const args of [
    ['--help'],
    ['context', '--help'],
    ['backlog', '--help'],
    ['help', 'verify'],
  ]) {
    const r = await cli(args, { env, cwd });
    expect({ args, code: r.code }).toEqual({ args, code: 0 });
    expect(r.stdout).toMatch(/^Usage: backe/);
    expect(r.stderr).toBe('');
  }
  expect(await cli(['--version'], { env, cwd })).toEqual({
    stdout: `${pkg.version}\n`,
    stderr: '',
    code: 0,
  });
});

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Env } from '../../src/context/paths.ts';
import { sshFingerprint } from '../../src/core/fingerprint.ts';
import { executeWrite, type WriteDeps } from '../../src/services/write.ts';
import { tempDir } from '../helpers/backlog.ts';
import { type TestBacklog, testBacklog, testKey } from '../helpers/git.ts';
import { seqBytes } from '../helpers/snapshot.ts';
import { type CliResult, cli, normalize, transcript } from './cli.ts';

type Setup = { b: TestBacklog; env: Env; cwd: string; names: Record<string, string> };

const T0 = Date.UTC(2026, 10, 16, 9, 0, 0);

async function setup(): Promise<Setup> {
  const b = await testBacklog();
  const cwd = await tempDir();
  const names: Record<string, string> = {
    [b.root]: '<root>',
    [b.env.HOME as string]: '<home>',
    [b.env.BACKE_HOME as string]: '<backe>',
    [cwd]: '<cwd>',
  };
  const s = { b, env: { ...b.env, BACKE_USER: 'spw', NO_COLOR: '1' }, cwd, names };
  // Mit dem Hub eines Agents bekommt der Backlog ein Remote; kein Write soll dann einen
  // Hintergrund-Sync starten.
  const manual = await cli(['config', 'set', 'backlogs.acme.sync.mode', 'manual'], s);
  expect(manual.code).toBe(0);
  return s;
}

const run = (s: Setup, args: string[], extra: { env?: Env; input?: string } = {}) =>
  cli(args, {
    env: { ...s.env, ...extra.env },
    cwd: s.cwd,
    ...(extra.input === undefined ? {} : { input: extra.input }),
  });

/** Mehrere Aufrufe als ein Golden-Text, je Aufruf mit Befehlszeile. */
async function session(s: Setup, calls: string[][]): Promise<string> {
  const parts: string[] = [];
  for (const args of calls) {
    const r = await run(s, args);
    const line = args.map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(' ');
    parts.push(`${normalize(`$ backe ${line}`, s.names)}\n${transcript(r, s.names)}`);
  }
  return parts.join('\n');
}

const ok = (r: CliResult) => {
  expect({ stderr: r.stderr, code: r.code }).toEqual({ stderr: '', code: 0 });
  return r.stdout;
};

const errorOf = (r: CliResult) =>
  (JSON.parse(r.stderr) as { error: { code: string; message: string; details?: unknown } }).error;

/** Fehler im JSON-Modus: Exit-Code, Fehlercode, stdout leer. */
async function fails(s: Setup, args: string[], code: number, errorCode: string) {
  const r = await run(s, [...args, '--json']);
  expect({ args, code: r.code, stdout: r.stdout, error: errorOf(r).code }).toEqual({
    args,
    code,
    stdout: '',
    error: errorCode,
  });
  return errorOf(r);
}

test('project create und sprint create ohne -t nehmen Pfadsegment bzw. Slug als Titel', async () => {
  const s = await setup();
  ok(await run(s, ['project', 'create', 'web']));
  ok(await run(s, ['project', 'create', 'web/auth']));
  ok(await run(s, ['sprint', 'create', '2026-w48']));
  const projects = JSON.parse(ok(await run(s, ['project', 'list', '--json']))) as {
    path: string;
    title: string;
  }[];
  expect(projects.map((p) => [p.path, p.title])).toEqual([
    ['web', 'web'],
    ['web/auth', 'auth'],
  ]);
  const sprints = JSON.parse(ok(await run(s, ['sprint', 'list', '--json']))) as {
    slug: string;
    title: string;
  }[];
  expect(sprints.map((x) => [x.slug, x.title])).toEqual([['2026-w48', '2026-w48']]);
});

test('project create, list, show, mv, rm', async () => {
  const s = await setup();
  await writeFile(join(s.cwd, 'auth.md'), 'Login, SSO und Tokens.\n');
  expect(
    ok(await run(s, ['project', 'create', 'web', '-t', 'Web', '--lead', 'me', '-d', 'Alles Web.'])),
  ).toBe('project create web\n');
  expect(ok(await run(s, ['project', 'create', 'web/auth', '-t', 'Auth', '-F', 'auth.md']))).toBe(
    'project create web/auth\n',
  );
  ok(await run(s, ['project', 'create', 'api', '-t', 'API']));
  ok(await run(s, ['new', '-t', 'Login', '-p', 'web/auth']));
  ok(await run(s, ['new', '-t', 'Startseite', '-p', 'web', '--state', 'todo']));
  ok(await run(s, ['new', '-t', 'Altlast', '-p', 'web', '--state', 'done']));

  await expect(
    await session(s, [
      ['project', 'list'],
      ['project', 'list', '--json'],
    ]),
  ).toMatchFileSnapshot('golden/project-list.txt');
  await expect(
    await session(s, [
      ['project', 'show', 'web'],
      ['project', 'show', 'web', '--json'],
      ['project', 'show', 'api'],
    ]),
  ).toMatchFileSnapshot('golden/project-show.txt');

  // Ein leerer Body aus stdin ist `validation`, ein fehlendes Projekt `not_found`.
  const empty = await run(s, ['project', 'create', 'x', '-t', 'X', '-d', '-'], { input: '' });
  expect(empty).toMatchObject({ code: 2, stderr: expect.stringMatching(/^Fehler: Beschreibung/) });
  await fails(s, ['project', 'create', 'x', '-t', 'X', '-d', 'a', '-F', 'auth.md'], 2, 'usage');
  await fails(s, ['project', 'show', 'nope'], 3, 'not_found');

  // `mv` zieht Unterprojekte und Issues in einem Commit mit.
  expect(ok(await run(s, ['project', 'mv', 'web/auth', 'web/login']))).toBe(
    'project mv web/auth web/login\n',
  );
  const moved = JSON.parse(ok(await run(s, ['ls', '-p', 'web/login', '--exact', '--json']))) as {
    issues: { title: string; projects: string[] }[];
  };
  expect(moved.issues).toMatchObject([{ title: 'Login', projects: ['web/login'] }]);

  // `rm` nur ohne Referenzen; sonst `--reassign` oder `--detach`.
  expect((await fails(s, ['project', 'rm', 'web/login'], 4, 'conflict')).details).toMatchObject({
    reason: 'references',
  });
  await fails(s, ['project', 'rm', 'web', '--reassign', 'api', '--detach'], 2, 'usage');
  expect(ok(await run(s, ['project', 'rm', 'web/login', '--reassign', 'api']))).toBe(
    'project rm web/login\n',
  );
  expect(ok(await run(s, ['project', 'rm', 'web', '--detach']))).toBe('project rm web\n');
  const left = JSON.parse(ok(await run(s, ['project', 'list', '--json']))) as unknown[];
  expect(left).toEqual([{ path: 'api', title: 'API', open: 1 }]);
});

test('sprint create, list, show grouped, close --carry-over', async () => {
  const s = await setup();
  const ctx = await s.b.context();
  let tick = 0;
  const deps: WriteDeps = {
    now: () => new Date(T0 + 60_000 * tick++),
    randomBytes: seqBytes(0),
  };
  for (const args of [
    ['sprint', 'create', '2026-w47', '-t', 'KW 47', '--start', '2026-11-16', '--end', '2026-11-22'],
    ['sprint', 'create', '2026-w48', '-t', 'KW 48', '--start', '2026-11-23', '-d', 'Weiter.'],
    ['sprint', 'create', 'ideen', '-t', 'Ideen'],
    ['project', 'create', 'web', '-t', 'Web'],
  ]) {
    ok(await run(s, args));
  }
  await writeFile(join(s.cwd, 'ziel.md'), 'Login stabil bekommen.\n');
  expect(
    ok(
      await run(s, [
        'sprint',
        'create',
        'auth',
        '-t',
        'Auth',
        '--end',
        '2026-12-01',
        '-F',
        'ziel.md',
      ]),
    ),
  ).toBe('sprint create auth\n');

  const sprint = ['2026-w47'];
  const r = await executeWrite(
    ctx,
    {
      kind: 'batch',
      ops: [
        {
          op: 'issue.create',
          ref: '$A',
          title: 'Token-Refresh',
          state: 'todo',
          sprints: sprint,
          rank: 1000,
          assignee: 'spw',
        },
        {
          op: 'issue.create',
          ref: '$B',
          title: 'SSO-Abbruch',
          state: 'todo',
          sprints: sprint,
          rank: 500,
          depends_on: ['$A'],
          projects: ['web'],
        },
        {
          op: 'issue.create',
          ref: '$C',
          title: 'Login-Seite',
          state: 'in_progress',
          sprints: sprint,
          assignee: 'spw',
          projects: ['web'],
        },
        {
          op: 'issue.create',
          ref: '$D',
          title: 'Altes Login entfernt',
          state: 'done',
          sprints: sprint,
        },
        { op: 'issue.create', ref: '$E', title: 'Nicht im Sprint', state: 'todo' },
      ],
    },
    deps,
  );
  const ids = Object.values(r.refs);
  expect(ids).toHaveLength(5);

  await expect(
    await session(s, [
      ['sprint', 'show', '2026-w47'],
      ['sprint', 'show', '2026-w47', '--sort', 'created'],
      ['sprint', 'show', '2026-w47', '-p', 'web'],
      ['sprint', 'show', 'auth'],
    ]),
  ).toMatchFileSnapshot('golden/sprint-show.txt');
  const shown = await run(s, ['sprint', 'show', '2026-w47', '--json']);
  await expect(normalize(ok(shown), s.names)).toMatchFileSnapshot('golden/sprint-show.json');

  // Projekt aus dem Kontext: Kopfzeile wie bei `issue list`; `-A` verwirft sie.
  const scoped = ok(
    await run(s, ['sprint', 'show', '2026-w47'], { env: { BACKE_PROJECT: 'web' } }),
  );
  expect(scoped.split('\n')[1]).toBe('backlog=acme project=web');
  expect(scoped).not.toContain('Token-Refresh');
  const all = ok(
    await run(s, ['sprint', 'show', '2026-w47', '-A'], { env: { BACKE_PROJECT: 'web' } }),
  );
  expect(all).not.toContain('backlog=');
  expect(all).toContain('Token-Refresh');
  const scopedJson = JSON.parse(
    ok(await run(s, ['sprint', 'show', '2026-w47', '--json'], { env: { BACKE_PROJECT: 'web' } })),
  ) as Record<string, unknown>;
  expect(scopedJson.context).toEqual({ backlog: 'acme', project: 'web' });

  await fails(s, ['sprint', 'show', 'nope'], 3, 'not_found');
  await fails(s, ['sprint', 'show', '2026-w47', '--sort', 'title'], 2, 'validation');
  await fails(s, ['sprint', 'create', '2026-w47', '-t', 'doppelt'], 4, 'conflict');

  // Abschließen: offene Issues wandern zusätzlich in den Nachfolger.
  expect(ok(await run(s, ['sprint', 'close', '2026-w47', '--carry-over', '2026-w48']))).toBe(
    'sprint close 2026-w47\n',
  );
  await expect(
    await session(s, [
      ['sprint', 'list'],
      ['sprint', 'list', '--json'],
    ]),
  ).toMatchFileSnapshot('golden/sprint-list.txt');
  const carried = ok(await run(s, ['sprint', 'show', '2026-w48']));
  expect(carried).toContain('SSO-Abbruch');
  expect(carried).not.toContain('Altes Login entfernt');
});

test('repo add, list, rm', async () => {
  const s = await setup();
  expect(
    ok(
      await run(s, [
        'repo',
        'add',
        'https://example.com/acme/webapp.git',
        '--ref',
        'main',
        '-d',
        'Haupt-Webanwendung.',
      ]),
    ),
  ).toBe('repo add webapp\n');
  expect(
    ok(await run(s, ['repo', 'add', 'git@github.com:acme/api.git', '--name', 'backend'])),
  ).toBe('repo add backend\n');
  ok(await run(s, ['repo', 'add', 'gh:acme/docs', '-d', '-'], { input: 'Doku.\n' }));
  ok(await run(s, ['new', '-t', 'Login', '--repo', 'webapp@feat/sso']));
  ok(await run(s, ['new', '-t', 'Logout', '--repo', 'webapp']));

  await expect(
    await session(s, [
      ['repo', 'list'],
      ['repo', 'list', '--json'],
    ]),
  ).toMatchFileSnapshot('golden/repo-list.txt');

  // Gleiche kanonische URL ist ein Konflikt, ein referenziertes Repo bleibt.
  await fails(s, ['repo', 'add', 'https://github.com/acme/api'], 4, 'conflict');
  expect((await fails(s, ['repo', 'rm', 'webapp'], 4, 'conflict')).details).toMatchObject({
    reason: 'references',
  });
  await fails(s, ['repo', 'rm', 'nope'], 3, 'not_found');
  expect(ok(await run(s, ['repo', 'rm', 'backend']))).toBe('repo rm backend\n');
  const names = (
    JSON.parse(ok(await run(s, ['repo', 'list', '--json']))) as { name: string }[]
  ).map((r) => r.name);
  expect(names).toEqual(['docs', 'webapp']);
});

test('user add, list, show, revoke-key, rm', async () => {
  const s = await setup();
  const alice = await testKey('alice');
  const bot = await testKey('bot-2');
  const fp = (line: string) => sshFingerprint(line);
  s.names[fp(s.b.key.line)] = '<fp-spw>';
  s.names[fp(alice.line)] = '<fp-alice>';
  s.names[fp(bot.line)] = '<fp-bot-2>';

  expect(ok(await run(s, ['user', 'add', 'alice', '--key', alice.pub, '--name', 'Alice A.']))).toBe(
    'user add alice\n',
  );
  expect(ok(await run(s, ['user', 'add', 'bot-2', '--key', bot.pub, '--agent']))).toBe(
    'user add bot-2\n',
  );
  await fails(s, ['user', 'add', 'bot-3', '--key', bot.pub, '--operator', 'alice'], 2, 'usage');
  await fails(s, ['user', 'add', 'bot-3'], 2, 'usage');
  await fails(s, ['user', 'add', 'bot-3', '--key', 'fehlt.pub'], 3, 'not_found');

  await expect(
    await session(s, [
      ['user', 'list'],
      ['user', 'list', '--json'],
    ]),
  ).toMatchFileSnapshot('golden/user-list.txt');

  // Den einzigen Key widerrufen (Präfix mit `SHA256:`): alice bleibt ohne aktiven Key gültig.
  const prefix = fp(alice.line).slice(0, 'SHA256:'.length + 10);
  expect(ok(await run(s, ['user', 'revoke-key', 'alice', prefix]))).toBe('user revoke_key alice\n');
  await fails(s, ['user', 'revoke-key', 'alice', 'SHA256:abc'], 2, 'validation');
  await fails(s, ['user', 'revoke-key', 'alice', prefix], 3, 'not_found');

  await expect(
    await session(s, [
      ['user', 'show', 'me'],
      ['user', 'show', 'alice'],
      ['user', 'show', 'alice', '--json'],
      ['user', 'show', 'bot-2'],
    ]),
  ).toMatchFileSnapshot('golden/user-show.txt');

  await fails(s, ['user', 'show', 'nope'], 3, 'not_found');
  expect((await fails(s, ['user', 'rm', 'spw'], 4, 'conflict')).details).toMatchObject({
    reason: 'admin',
  });
  expect(ok(await run(s, ['user', 'rm', 'bot-2']))).toBe('user rm bot-2\n');
  const handles = (
    JSON.parse(ok(await run(s, ['user', 'list', '--json']))) as { handle: string }[]
  ).map((u) => u.handle);
  expect(handles).toEqual(['alice', 'spw']);
});

test('user create-agent prints the key path and the agent can write', async () => {
  const s = await setup();
  const created = await run(s, ['user', 'create-agent', 'bot-1', '--name', 'Bot Eins']);
  expect(normalize(ok(created), s.names)).toBe('<backe>/keys/acme/bot-1\n');

  // Der Agent schreibt mit eigenem Key in seine eigene Arbeitskopie (eine je Identität).
  const asBot = ['--as', 'bot-1'];
  // Ohne Remote legt der erste Clone des Agents den lokalen Hub an und sagt es; im Modus
  // `manual` nennt die Kopfzeile danach den ungepushten Commit.
  const first = await run(s, [...asBot, 'new', '-t', 'Vom Agent']);
  expect(first.code).toBe(0);
  expect(normalize(first.stderr, s.names)).toBe(
    [
      'Hinweis: Lokaler Hub <backe>/backlogs/acme/hub.git angelegt; <root> synct jetzt darüber',
      'Sync: 1 ungepusht',
      'Hinweis: backe sync status',
      '',
    ].join('\n'),
  );
  const id = first.stdout.trim();
  const issue = JSON.parse(ok(await run(s, [...asBot, 'show', id, '--json']))) as {
    creator: string;
  };
  expect(issue.creator).toBe('bot-1');
  expect((await run(s, [...asBot, 'verify'])).code).toBe(0);

  const listed = JSON.parse(ok(await run(s, ['user', 'list', '--json']))) as unknown[];
  expect(listed).toContainEqual({
    handle: 'bot-1',
    name: 'Bot Eins',
    kind: 'agent',
    operator: 'spw',
    admin: false,
  });

  const json = JSON.parse(ok(await run(s, ['user', 'create-agent', 'bot-9', '--json']))) as Record<
    string,
    unknown
  >;
  expect(Object.keys(json)).toEqual(['handle', 'key_path', 'commit']);
  expect(json.key_path).toBe(join(s.b.env.BACKE_HOME as string, 'keys', 'acme', 'bot-9'));
  expect(json.commit).toMatch(/^[0-9a-f]{40}$/);

  await fails(s, ['user', 'create-agent', 'bot-1'], 4, 'conflict');
  await fails(s, ['user', 'create-agent', '../x'], 2, 'validation');
});

test('aliases new, ls, show, mv match their long forms', async () => {
  const s = await setup();
  const short = ok(await run(s, ['new', '-t', 'Kurz'])).trim();
  const long = ok(await run(s, ['issue', 'create', '-t', 'Lang'])).trim();
  expect(short).toMatch(/^bk-[0-9a-z]{5}$/);
  expect(long).toMatch(/^bk-[0-9a-z]{5}$/);
  expect(ok(await run(s, ['ls']))).toBe(ok(await run(s, ['issue', 'list'])));
  expect(ok(await run(s, ['show', short, '--json']))).toBe(
    ok(await run(s, ['issue', 'show', short, '--json'])),
  );
  expect(ok(await run(s, ['mv', short, 'todo']))).toBe(`issue move ${short} todo\n`);
  expect(ok(await run(s, ['issue', 'move', long, 'todo']))).toBe(`issue move ${long} todo\n`);
  expect(ok(await run(s, ['mv', short, 'todo']))).toBe(`unverändert: issue move ${short} todo\n`);
});

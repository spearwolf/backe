import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Env } from '../../src/context/paths.ts';
import type { ResolvedContext } from '../../src/context/resolve.ts';
import { updateUserConfig } from '../../src/context/user-config.ts';
import { listIssueComments } from '../../src/services/comments.ts';
import { createProject } from '../../src/services/projects.ts';
import { addRepo } from '../../src/services/repos.ts';
import { createSprint } from '../../src/services/sprints.ts';
import { addUser } from '../../src/services/users.ts';
import { executeWrite, type WriteDeps } from '../../src/services/write.ts';
import { issueFile } from '../../src/store/layout.ts';
import { tempDir } from '../helpers/backlog.ts';
import { rawCommit, revParse, type TestBacklog, testBacklog, testKey } from '../helpers/git.ts';
import { seqBytes } from '../helpers/snapshot.ts';
import { type CliResult, cli, normalize, transcript } from './cli.ts';

type Key = 'E' | 'C1' | 'C2' | 'C3' | 'D' | 'B';

type Setup = {
  b: TestBacklog;
  ctx: ResolvedContext;
  env: Env;
  cwd: string;
  names: Record<string, string>;
  id: Record<Key, string>;
  deps: WriteDeps;
};

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
const ESC = '\x1b';

/**
 * Backlog `acme` mit Projekten `web`, `web/auth`, Sprint `2026-w47`, Repo `webapp` und einem
 * kleinen Baum: Paket E mit drei Sub-Issues (C1 läuft bei claude-1, C2 wartet auf C1, C3 erledigt),
 * dazu D (backlog) und B (blockiert von D). IDs und Zeiten sind deterministisch.
 */
async function setup(): Promise<Setup> {
  const b = await testBacklog();
  const cwd = await tempDir();
  const ctx = await b.context();
  let tick = 0;
  const deps: WriteDeps = {
    now: () => new Date(T0 + 60_000 * tick++),
    randomBytes: seqBytes(0),
  };
  await createProject(ctx, { path: 'web', title: 'Web' }, deps);
  await createProject(ctx, { path: 'web/auth', title: 'Auth' }, deps);
  await createSprint(ctx, { slug: '2026-w47', title: 'KW 47' }, deps);
  await addRepo(ctx, { url: 'https://example.com/acme/webapp.git', name: 'webapp' }, deps);
  const agentKey = await testKey('claude-1');
  await addUser(ctx, { handle: 'claude-1', keyFile: agentKey.pub, agent: true }, deps);
  const r = await executeWrite(
    ctx,
    {
      kind: 'batch',
      ops: [
        {
          op: 'issue.create',
          ref: '$E',
          title: 'Login überarbeiten',
          state: 'todo',
          projects: ['web/auth'],
          sprints: ['2026-w47'],
          repos: ['webapp'],
          rank: 1000,
          body: 'Sammelt die Login-Arbeiten.\n',
        },
        {
          op: 'issue.create',
          ref: '$C1',
          title: 'Token-Refresh reparieren',
          state: 'todo',
          parent: '$E',
          assignee: 'claude-1',
          rank: 1000,
        },
        {
          op: 'issue.create',
          ref: '$C2',
          title: 'SSO-Login bricht nach Token-Refresh ab',
          state: 'todo',
          parent: '$E',
          depends_on: ['$C1'],
          rank: 2000,
          props: { area: 'api', estimate_h: 3 },
        },
        {
          op: 'issue.create',
          ref: '$C3',
          title: 'Altes Login entfernen',
          state: 'done',
          parent: '$E',
          rank: 3000,
        },
        { op: 'issue.create', ref: '$D', title: 'Doku aktualisieren', projects: ['web'] },
        {
          op: 'issue.create',
          ref: '$B',
          title: 'Build hängt',
          state: 'blocked',
          paused_from: 'todo',
          blocked_by: ['$D'],
          assignee: 'spw',
          projects: ['web'],
        },
      ],
    },
    deps,
  );
  const ref = (k: Key) => r.refs[`$${k}`] as string;
  const id = {
    E: ref('E'),
    C1: ref('C1'),
    C2: ref('C2'),
    C3: ref('C3'),
    D: ref('D'),
    B: ref('B'),
  };
  await executeWrite(
    ctx,
    {
      kind: 'op',
      op: {
        op: 'issue.move',
        id: id.C1,
        from: 'todo',
        to: 'in_progress',
        reason: 'Fange mit dem Refresh an.\nDetails folgen.',
      },
    },
    deps,
  );
  await executeWrite(
    ctx,
    {
      kind: 'op',
      op: {
        op: 'comment.add',
        id: id.C1,
        body: 'Zwischenstand: Refresh-Token wird jetzt rotiert.\n\nNoch offen: Tests.\n',
      },
    },
    deps,
  );
  const names: Record<string, string> = {
    [b.root]: '<root>',
    [b.env.HOME as string]: '<home>',
    [b.env.BACKE_HOME as string]: '<backe>',
    [cwd]: '<cwd>',
  };
  return { b, ctx, env: { ...b.env, BACKE_USER: 'spw', NO_COLOR: '1' }, cwd, names, id, deps };
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

/** Platzhalter so lang wie eine echte ID, damit Spalten im Golden stimmen. */
const placeholder = (n: number) => `bk-NEW${String(n).padStart(2, '0')}`;

test('create, list, show in text and json', async () => {
  const s = await setup();
  const created = await run(s, [
    'new',
    '-t',
    'Neues Ticket',
    '-p',
    'web',
    '--state',
    'todo',
    '--prop',
    'sev=high',
    '-d',
    'Text mit **Markdown**.',
  ]);
  const newId = ok(created).trim();
  expect(newId).toMatch(/^bk-[0-9a-z]{5}$/);
  s.names[newId] = placeholder(1);

  await expect(
    await session(s, [
      ['ls'],
      ['issue', 'list', '--tree'],
      ['ls', '--state', 'all', '--sort', 'created'],
      ['ls', '-a', 'claude-1'],
      ['ls', '--state', 'done,blocked'],
      ['ls', '-p', 'web/auth', '--exact'],
      ['ls', '-q', 'login', '--limit', '1'],
      ['ls', '--ready'],
    ]),
  ).toMatchFileSnapshot('golden/issue-list.txt');

  // Ein Sub-Issue zweiter Ebene erbt Projekte, Sprints und Repos und zeigt den Pfad zur Wurzel.
  const grandchild = ok(await run(s, ['new', '-t', 'Enkel', '--parent', s.id.C2])).trim();
  s.names[grandchild] = placeholder(2);

  const json = await run(s, ['ls', '--json', '--tree']);
  await expect(normalize(ok(json), s.names)).toMatchFileSnapshot('golden/issue-list.json');

  await expect(
    await session(s, [
      ['show', s.id.C1, '--comments', 'all'],
      ['issue', 'show', s.id.E],
      ['show', s.id.B],
      ['show', s.id.C2, '--comments', '1'],
      ['show', newId],
      ['show', grandchild],
    ]),
  ).toMatchFileSnapshot('golden/issue-show.txt');

  const shown = await run(s, ['show', s.id.C1, '--json', '--comments', 'all']);
  await expect(normalize(ok(shown), s.names)).toMatchFileSnapshot('golden/issue-show.json');
  const parsed = JSON.parse(shown.stdout) as Record<string, unknown>;
  expect(parsed.dependents).toEqual([
    { id: s.id.C2, state: 'todo', title: 'SSO-Login bricht nach Token-Refresh ab' },
  ]);
  // Leere Listen fehlen.
  expect(parsed).not.toHaveProperty('children');
  expect(parsed).not.toHaveProperty('depends_on');
  expect((JSON.parse(ok(await run(s, ['show', newId, '--json']))) as { body: string }).body).toBe(
    'Text mit **Markdown**.\n',
  );
});

test('show --format md is the file plus comments', async () => {
  const s = await setup();
  const md = await run(s, ['show', s.id.C1, '--format', 'md', '--comments', 'all']);
  await expect(normalize(ok(md), s.names)).toMatchFileSnapshot('golden/issue-show.md');
  const plain = ok(await run(s, ['show', s.id.D, '--format', 'md']));
  expect(plain).toMatch(/^---\nid: /);
  expect(plain).not.toContain('<!-- comments/');

  // `--format md` kennt nur `issue show`.
  const list = await run(s, ['ls', '--format', 'md']);
  expect(list.code).toBe(2);
  expect(list.stderr).toMatch(/^Fehler: »backe ls« kennt --format md nicht/);
});

test('list header shows context filters, -A drops them', async () => {
  const s = await setup();
  const env = { BACKE_PROJECT: 'web' };
  const scoped = ok(await run(s, ['ls'], { env }));
  expect(scoped.split('\n')[0]).toBe('backlog=acme project=web');
  expect(scoped).toContain('Login überarbeiten');
  expect(scoped).toContain('Doku aktualisieren');

  const all = ok(await run(s, ['ls', '-A'], { env: { BACKE_SPRINT: '2026-w47', ...env } }));
  expect(all).not.toContain('backlog=');
  expect(all).toContain('Build hängt');

  // Ein explizites Flag filtert ohne Kopfzeile.
  const flag = ok(await run(s, ['ls', '-p', 'web/auth'], { env }));
  expect(flag).not.toContain('backlog=');
  expect(flag).not.toContain('Doku aktualisieren');

  const sprint = ok(await run(s, ['ls'], { env: { BACKE_SPRINT: '2026-w47', ...env } }));
  expect(sprint.split('\n')[0]).toBe('backlog=acme project=web sprint=2026-w47');

  const json = JSON.parse(ok(await run(s, ['ls', '--json'], { env }))) as Record<string, unknown>;
  expect(json.context).toEqual({ backlog: 'acme', project: 'web' });
  const plain = JSON.parse(ok(await run(s, ['ls', '--json']))) as Record<string, unknown>;
  expect(plain).not.toHaveProperty('context');

  // `--limit` kürzt; Text meldet das als Hinweis, JSON als Feld.
  const cut = await run(s, ['ls', '--limit', '2']);
  expect(cut.stdout.split('\n').filter((l) => l !== '')).toHaveLength(2);
  expect(cut.stderr).toBe('Hinweis: Liste gekürzt (--limit 2)\n');
  const cutJson = JSON.parse(ok(await run(s, ['ls', '--limit', '2', '--json'])));
  expect(cutJson).toMatchObject({ truncated: true });

  // Kaputte Issue-Dateien: Warnung auf stderr, im JSON als `problems`.
  const broken = join(s.b.root, issueFile('bk-zzzz9'));
  await mkdir(dirname(broken), { recursive: true });
  await writeFile(broken, '---\ntitle: [kaputt\n---\n');
  const warned = await run(s, ['ls']);
  expect(warned.code).toBe(0);
  expect(warned.stderr).toMatch(/^Warnung: issues\/zz\/bk-zzzz9\/issue\.md: /);
  const problems = await run(s, ['ls', '--json']);
  expect(problems.stderr).toBe('');
  expect(JSON.parse(problems.stdout)).toMatchObject({
    problems: [{ path: 'issues/zz/bk-zzzz9/issue.md' }],
  });
});

test('states are colored only with color on, columns stay aligned', async () => {
  const s = await setup();
  const plain = ok(await run(s, ['ls'], { env: { NO_COLOR: undefined } }));
  expect(plain).not.toContain('\x1b');
  await updateUserConfig(s.b.homes.backeHome, () => [
    { path: ['output', 'color'], value: 'always' },
  ]);
  const colored = ok(await run(s, ['ls']));
  expect(colored).toContain(`${s.id.C1}  \x1b[36min_progress\x1b[0m  claude-1  `);
  expect(colored).toContain(`${s.id.B}  \x1b[31mblocked\x1b[0m      spw       `);
  expect(colored.replace(new RegExp(`${ESC}\\[\\d+m`, 'g'), '')).toBe(plain);
});

test('--fields reduces json and is refused with text', async () => {
  const s = await setup();
  const list = JSON.parse(ok(await run(s, ['ls', '--json', '--fields', 'id,state']))) as {
    issues: Record<string, unknown>[];
  };
  for (const issue of list.issues) expect(Object.keys(issue)).toEqual(['id', 'state']);

  expect(ok(await run(s, ['show', s.id.D, '--json', '--fields', 'title,state']))).toBe(
    `${JSON.stringify({ title: 'Doku aktualisieren', state: 'backlog' })}\n`,
  );
  const next = JSON.parse(ok(await run(s, ['next', '--json', '--fields', 'id']))) as {
    issue: Record<string, unknown>;
    resumed: boolean;
  };
  expect(Object.keys(next.issue)).toEqual(['id']);
  expect(next.resumed).toBe(false);

  const text = await run(s, ['show', s.id.D, '--fields', 'id']);
  expect(text).toEqual({
    stdout: '',
    stderr: 'Fehler: --fields geht nur mit --format json\n',
    code: 2,
  });
  const unknown = await run(s, ['ls', '--json', '--fields', 'id,nope']);
  expect(unknown.code).toBe(2);
  expect(unknown.stdout).toBe('');
  expect(errorOf(unknown)).toMatchObject({
    code: 'usage',
    message: 'Unbekannte Felder für --fields: »nope«',
  });
  const writes = await run(s, ['mv', s.id.D, 'todo', '--json', '--fields', 'id']);
  expect(writes.code).toBe(2);
  expect(errorOf(writes).message).toBe('»backe mv« kennt --fields nicht');
});

test('titles that look like options or YAML survive', async () => {
  const s = await setup();
  for (const title of ['-x', 'key: value', '# kein Heading', '[a, b]']) {
    const r = await run(s, ['new', `--title=${title}`]);
    expect({ title, code: r.code, stderr: r.stderr }).toEqual({ title, code: 0, stderr: '' });
    expect((await run(s, ['show', r.stdout.trim(), '--json', '--fields', 'title'])).stdout).toBe(
      `${JSON.stringify({ title })}\n`,
    );
  }
  // Auch als getrennter Wert: `-t --json` bleibt ein Titel.
  const r = await run(s, ['new', '-t', '--json']);
  expect(r.code).toBe(0);
  expect(ok(await run(s, ['show', r.stdout.trim(), '--json', '--fields', 'title']))).toBe(
    `${JSON.stringify({ title: '--json' })}\n`,
  );
});

test('stdin is read once', async () => {
  const s = await setup();
  const r = await run(s, ['new', '-t', 'x', '-d', '-', '--prop', 'a=b'], {
    input: 'Zeile 1\nZeile 2\n',
  });
  expect(r.code).toBe(0);
  const shown = JSON.parse(ok(await run(s, ['show', r.stdout.trim(), '--json']))) as {
    body: string;
    props: unknown;
  };
  expect(shown.body).toBe('Zeile 1\nZeile 2\n');
  expect(shown.props).toEqual({ a: 'b' });

  const empty = await run(s, ['mv', s.id.D, 'todo', '--reason', '-'], { input: '' });
  expect(empty).toEqual({ stdout: '', stderr: 'Fehler: Begründung ist leer\n', code: 2 });
  const emptyJson = await run(s, ['mv', s.id.D, 'todo', '--reason', '-', '--json'], {
    input: '\n',
  });
  expect(errorOf(emptyJson)).toEqual({ code: 'validation', message: 'Begründung ist leer' });

  const file = join(s.cwd, 'body.md');
  await writeFile(file, 'aus Datei\n');
  const both = await run(s, ['new', '-t', 'x', '-d', '-', '-F', 'body.md'], { input: 'y' });
  expect(both.code).toBe(2);
  expect(both.stderr).toMatch(/^Fehler: -d und -F schließen sich aus/);
  const fromFile = ok(await run(s, ['new', '-t', 'x', '-F', 'body.md']));
  expect(
    (JSON.parse(ok(await run(s, ['show', fromFile.trim(), '--json']))) as { body: string }).body,
  ).toBe('aus Datei\n');

  // Nur Texte (Body, Begründung, Kommentar) lesen stdin; ein Titel »-« bleibt ein Titel.
  const edit = await run(s, ['issue', 'edit', s.id.D, '--body-file', '-', '--title', '-'], {
    input: 'neu\n',
  });
  expect(edit.code).toBe(0);
  const edited = JSON.parse(ok(await run(s, ['show', s.id.D, '--json']))) as {
    title: string;
    body: string;
  };
  expect(edited).toMatchObject({ title: '-', body: 'neu\n' });
  const emptyComment = await run(s, ['comment', 'add', s.id.D, '-m', '-'], { input: '' });
  expect(emptyComment).toEqual({ stdout: '', stderr: 'Fehler: Kommentar ist leer\n', code: 2 });
});

test('move, resume, reopen with reasons; no-op prints unverändert', async () => {
  const s = await setup();
  const { D, C1 } = s.id;
  const reasonFile = join(s.cwd, 'reason.md');
  await writeFile(reasonFile, 'Warten auf Freigabe\n');

  expect(ok(await run(s, ['mv', D, 'todo', '--reason', 'Jetzt dran']))).toBe(
    `issue move ${D} todo\n`,
  );
  expect(ok(await run(s, ['issue', 'move', D, 'todo']))).toBe(
    `unverändert: issue move ${D} todo\n`,
  );
  expect(ok(await run(s, ['mv', D, 'on-hold', '--reason-file', 'reason.md']))).toBe(
    `issue move ${D} on_hold\n`,
  );
  expect(ok(await run(s, ['issue', 'resume', D, '--reason', 'Freigabe da']))).toBe(
    `issue resume ${D}\n`,
  );
  expect(ok(await run(s, ['mv', D, 'blocked', '--blocked-by', C1]))).toBe(
    `issue move ${D} blocked\n`,
  );
  const shown = ok(await run(s, ['show', D]));
  expect(shown).toContain(`state       blocked (aus todo), blockiert von ${C1} [in_progress]\n`);

  expect(ok(await run(s, ['issue', 'resume', D]))).toBe(`issue resume ${D}\n`);
  expect(ok(await run(s, ['mv', D, 'cancelled', '--reason', '-'], { input: 'Doppelt\n' }))).toBe(
    `issue move ${D} cancelled\n`,
  );
  // Nach backlog führte bisher kein Übergang; so ist die Begründung eindeutig die letzte.
  const reopened = await run(s, [
    'issue',
    'reopen',
    D,
    '--to',
    'backlog',
    '--reason',
    'Doch nötig',
  ]);
  expect(ok(reopened)).toBe(`issue reopen ${D} backlog\n`);
  const detail = ok(await run(s, ['show', D, '--comments', 'all']));
  expect(detail).toContain('reason      Doch nötig — spw, ');
  expect(detail).toMatch(/--- \S+ \(spw, \S+, cancelled → backlog\)\nDoch nötig\n/);

  const json = JSON.parse(ok(await run(s, ['mv', D, 'in-progress', '--json']))) as {
    commit: string;
    op: { op: string; to: string };
    id: string;
  };
  expect(json).toMatchObject({ op: { op: 'issue.move', to: 'in_progress' }, id: D });
  expect(json.commit).toMatch(/^[0-9a-f]{40}$/);
  const same = JSON.parse(ok(await run(s, ['mv', D, 'in-progress', '--json'])));
  expect(same).toMatchObject({ commit: null, op: { op: 'issue.move' } });

  for (const args of [
    ['mv', D, 'review', '--reason', 'x', '--reason-file', 'reason.md'],
    ['issue', 'resume', D, '--reason', 'x', '--reason-file', 'reason.md'],
  ]) {
    const r = await run(s, args);
    expect({ args, code: r.code }).toEqual({ args, code: 2 });
    expect(r.stderr).toBe('Fehler: --reason und --reason-file schließen sich aus\n');
  }
  const bad = await run(s, ['mv', D, 'fertig', '--json']);
  expect(bad.code).toBe(2);
  expect(errorOf(bad)).toMatchObject({
    code: 'validation',
    message: 'Unbekannter State: »fertig«',
  });

  // Hinweise einer Operation: Text nach stderr, JSON nur im Objekt.
  const cancel = await run(s, ['mv', s.id.E, 'cancelled', '--reason', 'Verworfen']);
  expect(cancel.code).toBe(0);
  expect(cancel.stdout).toBe(`issue move ${s.id.E} cancelled\n`);
  expect(cancel.stderr).toMatch(/^Hinweis: /);
});

test('rank, link, unlink, assign, delete', async () => {
  const s = await setup();
  const { D, E, B, C1 } = s.id;
  expect(ok(await run(s, ['issue', 'rank', D, '--top']))).toBe(`issue rank ${D} --top\n`);
  expect(ok(await run(s, ['issue', 'rank', D, '--after', C1]))).toBe(
    `issue rank ${D} --after ${C1}\n`,
  );
  expect(ok(await run(s, ['issue', 'rank', D, '500']))).toBe(`issue rank ${D} 500\n`);
  expect(ok(await run(s, ['issue', 'rank', D, '--bottom']))).toBe(`issue rank ${D} --bottom\n`);
  for (const args of [
    ['issue', 'rank', D],
    ['issue', 'rank', D, '--top', '--bottom'],
    ['issue', 'rank', D, '5', '--before', E],
  ]) {
    const r = await run(s, args);
    expect({ args, code: r.code }).toEqual({ args, code: 2 });
    expect(r.stderr).toMatch(/^Fehler: Genau eine Position angeben\nHinweis: --top, --bottom/);
  }
  const notInt = await run(s, ['issue', 'rank', D, '1.5', '--json']);
  expect(errorOf(notInt)).toMatchObject({ code: 'validation', message: 'Ungültiger Rang: »1.5«' });

  expect(ok(await run(s, ['issue', 'link', D, 'webapp@main']))).toBe(`issue link ${D}\n`);
  expect(ok(await run(s, ['issue', 'link', D, 'https://example.com/x/y.git@v1']))).toBe(
    `issue link ${D}\n`,
  );
  const linked = JSON.parse(ok(await run(s, ['show', D, '--json']))) as { repos: string[] };
  expect(linked.repos).toContain('webapp@main');
  expect(ok(await run(s, ['issue', 'unlink', D, 'webapp']))).toBe(`issue unlink ${D}\n`);

  expect(ok(await run(s, ['issue', 'assign', D, 'me']))).toBe(`issue edit ${D}\n`);
  expect(ok(await run(s, ['show', D]))).toContain('assignee    spw\n');
  expect(ok(await run(s, ['issue', 'assign', D, 'none']))).toBe(`issue edit ${D}\n`);
  expect(ok(await run(s, ['show', D]))).not.toContain('assignee');

  // D steht in `blocked_by` von B: ohne --force ein Konflikt.
  const refd = await run(s, ['issue', 'delete', D]);
  expect(refd.code).toBe(4);
  expect(await run(s, ['issue', 'delete', D, '--force'])).toEqual({
    stdout: `issue delete ${D}\n`,
    stderr: `Hinweis: ${D}: letzter Blocker gelöscht, auf on_hold gesetzt: ${B}\n`,
    code: 0,
  });
  expect((await run(s, ['show', D])).code).toBe(3);
  expect(ok(await run(s, ['show', B]))).toContain(
    `state       on_hold (aus todo)\nreason      Blocker ${D} gelöscht — spw, `,
  );

  const both = await run(s, ['issue', 'delete', E, '--orphan', '--recursive']);
  expect(both).toEqual({
    stdout: '',
    stderr: 'Fehler: --orphan und --recursive schließen sich aus\n',
    code: 2,
  });
  expect((await run(s, ['issue', 'delete', E])).code).toBe(4);
  expect(ok(await run(s, ['issue', 'delete', E, '--recursive']))).toBe(`issue delete ${E}\n`);
  expect((await run(s, ['show', C1])).code).toBe(3);
});

test('edit changes fields and needs at least one flag', async () => {
  const s = await setup();
  const { D, C2, E } = s.id;
  const none = await run(s, ['issue', 'edit', D]);
  expect(none).toEqual({ stdout: '', stderr: 'Fehler: Nichts zu ändern\n', code: 2 });

  expect(
    ok(
      await run(s, [
        'issue',
        'edit',
        D,
        '--title',
        'Doku neu',
        '--add-project',
        'web/auth',
        '--rm-project',
        'web',
        '--add-sprint',
        '2026-w47',
        '--add-dep',
        C2,
        '--parent',
        E,
        '--prop',
        'sev=low',
      ]),
    ),
  ).toBe(`issue edit ${D}\n`);
  const after = JSON.parse(ok(await run(s, ['show', D, '--json']))) as Record<string, unknown>;
  expect(after).toMatchObject({
    title: 'Doku neu',
    projects: ['web/auth'],
    sprints: ['2026-w47'],
    parent: E,
    props: { sev: 'low' },
    depends_on: [{ id: C2, state: 'todo', title: 'SSO-Login bricht nach Token-Refresh ab' }],
  });
  expect(
    ok(
      await run(s, [
        'issue',
        'edit',
        D,
        '--no-parent',
        '--rm-dep',
        C2,
        '--rm-sprint',
        '2026-w47',
        '--unset-prop',
        'sev',
      ]),
    ),
  ).toBe(`issue edit ${D}\n`);
  const reset = JSON.parse(ok(await run(s, ['show', D, '--json']))) as Record<string, unknown>;
  expect(reset).not.toHaveProperty('parent');
  expect(reset).not.toHaveProperty('props');
  expect(reset).not.toHaveProperty('depends_on');

  // --parent und --no-parent widersprechen sich, in jeder Reihenfolge.
  for (const args of [
    ['issue', 'edit', D, '--parent', E, '--no-parent'],
    ['issue', 'edit', D, '--no-parent', '--parent', E],
  ]) {
    expect(await run(s, args)).toEqual({
      stdout: '',
      stderr: 'Fehler: --parent und --no-parent schließen sich aus\n',
      code: 2,
    });
  }
});

test('an empty stdin body is refused, an empty file or -d "" clears it', async () => {
  const s = await setup();
  const { E } = s.id;
  const head = await revParse(s.b.root, 'HEAD');
  for (const [args, hint] of [
    [['new', '-t', 'x', '-d', '-'], "-d ''"],
    [['issue', 'edit', E, '--body-file', '-'], '--body-file <leere datei>'],
  ] as const) {
    for (const input of ['', ' \n\n']) {
      expect(await run(s, [...args], { input })).toEqual({
        stdout: '',
        stderr: `Fehler: Beschreibung ist leer\nHinweis: Leeren mit ${hint}\n`,
        code: 2,
      });
    }
  }
  const json = await run(s, ['issue', 'edit', E, '--body-file', '-', '--json'], { input: '' });
  expect(errorOf(json)).toMatchObject({ code: 'validation', message: 'Beschreibung ist leer' });
  // Nichts committet, der Body steht noch.
  expect(await revParse(s.b.root, 'HEAD')).toBe(head);
  expect((JSON.parse(ok(await run(s, ['show', E, '--json']))) as { body?: string }).body).toBe(
    'Sammelt die Login-Arbeiten.\n',
  );

  // Der ausdrückliche Weg zum Leeren: eine leere Datei oder -d ''.
  await writeFile(join(s.cwd, 'leer.md'), '');
  expect(ok(await run(s, ['issue', 'edit', E, '--body-file', 'leer.md']))).toBe(
    `issue edit ${E}\n`,
  );
  expect(JSON.parse(ok(await run(s, ['show', E, '--json'])))).not.toHaveProperty('body');
  const blank = ok(await run(s, ['new', '-t', 'ohne Text', '-d', ''])).trim();
  expect(JSON.parse(ok(await run(s, ['show', blank, '--json'])))).not.toHaveProperty('body');
});

test('list filters and create defaults from the context', async () => {
  const s = await setup();
  const { E, C1, C2, C3, D, B } = s.id;
  const ids = async (args: string[], env: Env = {}) =>
    (
      JSON.parse(ok(await run(s, [...args, '--json', '--fields', 'id'], { env }))) as {
        issues: { id: string }[];
      }
    ).issues.map((i) => i.id);

  expect(await ids(['ls', '-a', 'none'])).toEqual([E, C2, D]);
  expect(await ids(['ls', '--blocked'])).toEqual([B]);
  expect(await ids(['ls', '--parent', E, '--state', 'all'])).toEqual([C1, C2, C3]);
  expect(await ids(['ls', '--top-level'])).toEqual([E, D, B]);
  expect(await ids(['ls', '--prop', 'area=api'])).toEqual([C2]);
  expect(await ids(['ls', '--has-prop', 'estimate_h'])).toEqual([C2]);
  expect(await ids(['ls', '--creator', 'me', '-p', 'web', '--exact'])).toEqual([D, B]);
  expect(await ids(['ls', '--creator', 'claude-1'])).toEqual([]);
  expect(await ids(['ls', '-s', '2026-w47'])).toEqual([E, C1, C2]);
  expect(await ids(['ls', '--repo', 'webapp', '--state', 'done'])).toEqual([C3]);

  // Ohne --parent belegt der Kontext Projekt und Sprint vor; ein Flag gewinnt.
  const env = { BACKE_PROJECT: 'web/auth', BACKE_SPRINT: '2026-w47' };
  const fromContext = ok(await run(s, ['new', '-t', 'Aus dem Kontext'], { env })).trim();
  expect(JSON.parse(ok(await run(s, ['show', fromContext, '--json'])))).toMatchObject({
    projects: ['web/auth'],
    sprints: ['2026-w47'],
  });
  const flagged = ok(await run(s, ['new', '-t', 'Mit Flag', '-p', 'web'], { env })).trim();
  expect(JSON.parse(ok(await run(s, ['show', flagged, '--json'])))).toMatchObject({
    projects: ['web'],
    sprints: ['2026-w47'],
  });
  expect(await ids(['ls'], env)).toContain(fromContext);
});

test('ambiguous short id lists candidates with exit 2', async () => {
  const s = await setup();
  const ids = ['7f3k2', '7f3k9'].map((rand) => rand.split('').map((c) => CROCKFORD.indexOf(c)));
  let call = 0;
  await executeWrite(
    s.ctx,
    {
      kind: 'batch',
      ops: [
        { op: 'issue.create', title: 'Erster' },
        { op: 'issue.create', title: 'Zweiter' },
      ],
    },
    { randomBytes: () => Uint8Array.from(ids[call++] as number[]) },
  );
  const r = await run(s, ['show', '7f3']);
  expect(r).toEqual({
    stdout: '',
    stderr: 'Fehler: ID-Kurzform »7f3« ist mehrdeutig: bk-7f3k2, bk-7f3k9\n',
    code: 2,
  });
  const json = await run(s, ['show', '7f3', '--json']);
  expect(errorOf(json)).toEqual({
    code: 'ambiguous',
    message: 'ID-Kurzform »7f3« ist mehrdeutig: bk-7f3k2, bk-7f3k9',
    details: { candidates: ['bk-7f3k2', 'bk-7f3k9'] },
  });
  // Großschreibung egal, Präfix erlaubt.
  expect(ok(await run(s, ['show', '7F3K2', '--json', '--fields', 'id']))).toBe(
    '{"id":"bk-7f3k2"}\n',
  );
  expect(ok(await run(s, ['show', 'bk-7f3k9', '--json', '--fields', 'title']))).toBe(
    '{"title":"Zweiter"}\n',
  );
});

test('next picks, resumes and explains an empty result with exit 3', async () => {
  const s = await setup();
  // Bereit sind nur D (backlog) und nichts in web/auth: C2 wartet auf C1, E hat offene Kinder.
  const picked = ok(await run(s, ['next']));
  expect(picked).toBe(`${s.id.D}  backlog      -  Doku aktualisieren\n`);

  const resumed = ok(await run(s, ['next', '--as', 'claude-1']));
  expect(resumed).toBe(
    `${s.id.C1}  in_progress  claude-1  Token-Refresh reparieren  (läuft schon)\n`,
  );

  const empty = await run(s, ['next', '-p', 'web/auth']);
  expect(empty.code).toBe(3);
  expect(empty.stdout).toBe('');
  expect(empty.stderr).toMatch(/^Fehler: Nichts /);
  const emptyJson = await run(s, ['next', '-p', 'web/auth', '--json']);
  expect(emptyJson.code).toBe(3);
  expect(errorOf(emptyJson)).toMatchObject({ code: 'not_found', details: { reason: 'waiting' } });

  const scoped = ok(await run(s, ['next'], { env: { BACKE_PROJECT: 'web' } }));
  expect(scoped).toBe(`backlog=acme project=web\n${s.id.D}  backlog      -  Doku aktualisieren\n`);
  const scopedJson = JSON.parse(
    ok(await run(s, ['next', '--json'], { env: { BACKE_PROJECT: 'web' } })),
  );
  expect(scopedJson).toMatchObject({
    context: { backlog: 'acme', project: 'web' },
    issue: { id: s.id.D },
    resumed: false,
  });
  const all = ok(await run(s, ['next', '-A'], { env: { BACKE_PROJECT: 'web/auth' } }));
  expect(all).toBe(`${s.id.D}  backlog      -  Doku aktualisieren\n`);

  const top = ok(await run(s, ['next', '--level', 'top', '-p', 'web/auth', '--as', 'ana']));
  expect(top).toBe(`${s.id.E}  todo         -  Login überarbeiten\n`);
  const badLevel = await run(s, ['next', '--level', 'mid']);
  expect(badLevel.code).toBe(2);
  expect(badLevel.stderr).toBe('Fehler: Ungültige Ebene: »mid«\nHinweis: leaf oder top\n');
  // Ein Claim gehört nicht zu diesem Befehl.
  expect((await run(s, ['next', '--claim'])).code).toBe(2);
  expect((await run(s, ['issue', 'claim', s.id.D])).code).toBe(2);

  // Ein fortgesetztes Issue kann offene Abhängigkeiten haben; die Zeile markiert sie.
  expect(ok(await run(s, ['issue', 'edit', s.id.C1, '--add-dep', s.id.D]))).toBe(
    `issue edit ${s.id.C1}\n`,
  );
  expect(ok(await run(s, ['next', '--as', 'claude-1']))).toBe(
    `${s.id.C1}  in_progress  claude-1  ⧗ Token-Refresh reparieren  (läuft schon)\n`,
  );
  const marked = JSON.parse(ok(await run(s, ['next', '--as', 'claude-1', '--json']))) as {
    issue: Record<string, unknown>;
  };
  expect(marked.issue).toMatchObject({ id: s.id.C1, open_deps: true });
  expect(JSON.parse(ok(await run(s, ['next', '--json', '--fields', 'id,open_deps'])))).toEqual({
    issue: { id: s.id.D },
    resumed: false,
  });
});

test('text output shows control characters from the data instead of passing them through', async () => {
  const s = await setup();
  const title = `Rot ${ESC}[31mgefärbt${ESC}[0m`;
  const osc = `Link ${ESC}]8;;https://evil.example${ESC}\\klick${ESC}]8;;${ESC}\\ und Glocke \x07\n`;
  const id = ok(await run(s, ['new', '-t', title, '-d', `Body ${ESC}[2J\n`])).trim();
  expect(ok(await run(s, ['comment', 'add', id, '-m', osc]))).toBe(`comment add ${id}\n`);

  for (const args of [
    ['ls', '--state', 'all'],
    ['show', id, '--comments', 'all'],
    ['comment', 'list', id],
    ['issue', 'edit', id, '--title', `${title}!`],
  ]) {
    const out = ok(await run(s, args));
    expect({ args, esc: out.includes(ESC), bell: out.includes('\x07') }).toEqual({
      args,
      esc: false,
      bell: false,
    });
  }
  const shown = ok(await run(s, ['show', id, '--comments', 'all']));
  expect(shown).toContain(`${id}  Rot ␛[31mgefärbt␛[0m!`);
  expect(shown).toContain('Body ␛[2J');
  expect(shown).toContain('Link ␛]8;;https://evil.example␛\\klick␛]8;;␛\\ und Glocke \\u{07}');

  // JSON und --format md geben die Daten unverändert weiter.
  const json = JSON.parse(ok(await run(s, ['show', id, '--json', '--comments', 'all']))) as {
    title: string;
    comments: { body: string }[];
  };
  expect([json.title, json.comments[0]?.body]).toEqual([`${title}!`, osc]);
  // Die Markdown-Ausgabe ist die Datei wie auf der Platte: Der Kommentar-Body steht dort roh.
  expect(ok(await run(s, ['show', id, '--format', 'md', '--comments', 'all']))).toContain(osc);
});

test('show lists a dependency whose issue is gone as missing', async () => {
  const s = await setup();
  await rawCommit(s.b.root, { files: { [issueFile(s.id.C1)]: null }, key: s.b.key, actor: 'spw' });
  const text = ok(await run(s, ['show', s.id.C2]));
  expect(text).toMatch(new RegExp(`^depends_on  ${s.id.C1} \\[fehlt\\]$`, 'm'));
  const json = JSON.parse(ok(await run(s, ['show', s.id.C2, '--json']))) as Record<string, unknown>;
  expect(json.depends_on).toEqual([{ id: s.id.C1, missing: true }]);
});

test('comment add, list, edit, delete', async () => {
  const s = await setup();
  const { C2, D } = s.id;
  const file = join(s.cwd, 'comment.md');
  await writeFile(file, 'Aus der Datei.\nZweite Zeile.\n');
  // Über die CLI an D: -m, -F und stdin.
  expect(ok(await run(s, ['comment', 'add', D, '-m', 'Erster Kommentar']))).toBe(
    `comment add ${D}\n`,
  );
  expect(ok(await run(s, ['comment', 'add', D, '-F', 'comment.md']))).toBe(`comment add ${D}\n`);
  expect(ok(await run(s, ['comment', 'add', D, '-m', '-'], { input: 'Von stdin\n' }))).toBe(
    `comment add ${D}\n`,
  );
  const added = await listIssueComments(s.ctx, D);
  expect(added.map((c) => c.body).sort()).toEqual([
    'Aus der Datei.\nZweite Zeile.\n',
    'Erster Kommentar\n',
    'Von stdin\n',
  ]);

  // Für den Golden mit festen Zeiten an C2: Kommentare derselben Sekunde ordnet erst ihr
  // Zufallssuffix, das wäre kein stabiler Vertrag.
  for (const body of ['Erster Kommentar\n', 'Aus der Datei.\nZweite Zeile.\n', 'Von stdin\n']) {
    await executeWrite(s.ctx, { kind: 'op', op: { op: 'comment.add', id: C2, body } }, s.deps);
  }
  const stored = await listIssueComments(s.ctx, C2);

  await expect(
    await session(s, [
      ['comment', 'list', C2],
      ['comment', 'edit', C2, '1', '-m', 'Erster Kommentar, korrigiert'],
      ['comment', 'delete', C2, stored[1]?.file as string],
      ['comment', 'list', C2],
      ['comment', 'list', C2, '--limit', '1'],
      ['comment', 'list', s.id.C1],
      ['comment', 'delete', C2, '9'],
    ]),
  ).toMatchFileSnapshot('golden/comment-list.txt');

  const json = JSON.parse(ok(await run(s, ['comment', 'list', C2, '--json']))) as {
    n: number;
    file: string;
    author: string;
    body: string;
  }[];
  expect(json.map((c) => [c.n, c.author, c.body])).toEqual([
    [1, 'spw', 'Erster Kommentar, korrigiert\n'],
    [2, 'spw', 'Von stdin\n'],
  ]);
  // Die Nummer zählt auch nach --limit in der ganzen Liste, wie in der Text-Ausgabe.
  const last = JSON.parse(ok(await run(s, ['comment', 'list', C2, '--json', '--limit', '1'])));
  expect(last).toMatchObject([{ n: 2, body: 'Von stdin\n' }]);

  for (const [args, message] of [
    [['comment', 'add', C2], /^Fehler: -m oder -F angeben/],
    [
      ['comment', 'add', C2, '-m', 'x', '-F', 'comment.md'],
      /^Fehler: -m und -F schließen sich aus/,
    ],
    [['comment', 'edit', C2, '1'], /^Fehler: -m oder -F angeben/],
    [['comment', 'add', C2, '-m', ' '], /^Fehler: Kommentar ist leer/],
  ] as const) {
    const r = await run(s, [...args]);
    expect({ args, code: r.code }).toEqual({ args, code: 2 });
    expect(r.stderr).toMatch(message);
  }
});

test('a handle without key reads but cannot write', async () => {
  const s = await setup();
  const read = await run(s, ['ls', '--as', 'bob']);
  expect(read.code).toBe(0);
  expect(read.stdout).toContain('Login überarbeiten');
  const write = await run(s, ['--as', 'bob', 'new', '-t', 'x']);
  expect(write.code).toBe(2);
  expect(write.stdout).toBe('');
  expect(write.stderr).toMatch(/kein Signing-Key/);
});

test('exit codes: not found 3, precondition 4', async () => {
  const s = await setup();
  const missing = await run(s, ['show', 'bk-zzzzz']);
  expect(missing).toEqual({
    stdout: '',
    stderr: 'Fehler: Issue »bk-zzzzz« nicht gefunden\n',
    code: 3,
  });
  expect((await run(s, ['comment', 'edit', s.id.C1, '7', '-m', 'x'])).code).toBe(3);
  expect((await run(s, ['new', '-t', 'x', '-F', 'fehlt.md'])).code).toBe(3);

  // E hat offene Sub-Issues: done ist ein Konflikt.
  const open = await run(s, ['mv', s.id.E, 'done', '--json']);
  expect(open.code).toBe(4);
  expect(errorOf(open)).toMatchObject({ code: 'conflict', details: { reason: 'open_children' } });
  // Ein offenes Kind unter einem erledigten Parent ebenso.
  await run(s, ['mv', s.id.C1, 'done']);
  await run(s, ['mv', s.id.C2, 'cancelled']);
  expect(ok(await run(s, ['mv', s.id.E, 'done']))).toBe(`issue move ${s.id.E} done\n`);
  // Hinweise beim Lesen: Text nach stderr, JSON nur im Objekt.
  const follower = ok(await run(s, ['new', '-t', 'Folgt auf C2', '--dep', s.id.C2])).trim();
  const shown = await run(s, ['show', follower]);
  expect(shown.code).toBe(0);
  expect(shown.stdout).toContain(`depends_on  ${s.id.C2} [cancelled]\n`);
  expect(shown.stderr).toMatch(new RegExp(`^Hinweis: .*${s.id.C2}`));
  const shownJson = await run(s, ['show', follower, '--json']);
  expect(shownJson.stderr).toBe('');
  expect(JSON.parse(shownJson.stdout)).toMatchObject({
    notices: [{ code: 'settled_dependency', ids: [s.id.C2] }],
  });

  const settled = await run(s, ['new', '-t', 'Nachzügler', '--parent', s.id.E]);
  expect(settled.code).toBe(4);
  expect(settled.stderr).toMatch(/^Fehler: .*\nHinweis: backe issue reopen /);
});

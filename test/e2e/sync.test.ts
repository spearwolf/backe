/**
 * Sync über die CLI (backe.md §2.16): `backe sync`, `sync status`, `sync resolve`, `issue claim`,
 * `next --claim`, `commit --resign`, Frische beim Lesen und die Kopfzeile auf stderr. Remotes sind
 * bare Repos im Temp-Verzeichnis; der zweite Client ist der Agent `bot-1` mit eigener Arbeitskopie.
 * Alle Setups stehen auf `sync.mode manual`, damit kein Write einen Hintergrund-Prozess startet;
 * nur die Claims laufen kurz in `auto` — ein Claim startet selbst keinen.
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { Env } from '../../src/context/paths.ts';
import { managedClonePath } from '../../src/context/registry.ts';
import { git } from '../../src/git/exec.ts';
import { issueFile } from '../../src/store/layout.ts';
import { tempDir } from '../helpers/backlog.ts';
import { rawCommit, revParse, type TestBacklog, testBacklog } from '../helpers/git.ts';
import { type CliResult, cli, normalize, transcript } from './cli.ts';

type Setup = { b: TestBacklog; env: Env; cwd: string; names: Record<string, string> };

const run = (s: Setup, args: string[]) => cli(args, { env: s.env, cwd: s.cwd });
const bot = (args: string[]) => ['--as', 'bot-1', ...args];

/** Erfolg ohne jede Ausgabe auf stderr; liefert stdout. */
const ok = (r: CliResult): string => {
  expect({ stderr: r.stderr, code: r.code }).toEqual({ stderr: '', code: 0 });
  return r.stdout;
};

/** Erfolg; stderr darf die Kopfzeile tragen. */
const done = (r: CliResult): string => {
  expect({ code: r.code, stderr: r.stderr }).toMatchObject({ code: 0 });
  return r.stdout;
};

const CONFLICT_ID = /\d{8}T\d{6}Z-[0-9a-f]{6}/g;

const norm = (s: Setup, text: string) =>
  normalize(text, s.names).replace(CONFLICT_ID, '<konflikt>');

/**
 * Backlog `acme` mit bare Remote, aufgerufen als `spw` aus einem fremden Verzeichnis, Modus
 * `manual`. Mit `agent` dazu `bot-1` mit gepushtem User und eigener Arbeitskopie.
 */
async function setup(opts: { remote?: boolean; agent?: boolean } = {}): Promise<Setup> {
  const b = await testBacklog({ remote: opts.remote ?? true });
  const cwd = await tempDir();
  const names: Record<string, string> = {
    [b.root]: '<root>',
    [b.env.HOME as string]: '<home>',
    [b.env.BACKE_HOME as string]: '<backe>',
    [cwd]: '<cwd>',
  };
  if (b.remote !== undefined) names[b.remote] = '<remote>';
  const s = { b, env: { ...b.env, BACKE_USER: 'spw', NO_COLOR: '1' }, cwd, names };
  ok(await run(s, ['config', 'set', 'backlogs.acme.sync.mode', 'manual']));
  if (opts.agent === true) {
    done(await run(s, ['user', 'create-agent', 'bot-1']));
    ok(await run(s, ['sync']));
    ok(await run(s, bot(['sync'])));
  }
  return s;
}

const setMode = async (s: Setup, mode: 'auto' | 'manual') =>
  ok(await run(s, ['config', 'set', 'backlogs.acme.sync.mode', mode]));

/** Legt als `spw` ein Issue an und gibt ihm einen Platzhalter. */
async function create(s: Setup, title: string, label: string, as: string[] = []): Promise<string> {
  const id = done(await run(s, [...as, 'new', '-t', title])).trim();
  s.names[id] = label;
  return id;
}

/** Der Kurz-SHA von HEAD in `wc` als Platzhalter `label`. */
async function nameHead(s: Setup, wc: string, label: string): Promise<string> {
  const head = await revParse(wc, 'HEAD');
  s.names[head.slice(0, 7)] = label;
  return head;
}

const botCopy = (s: Setup) => managedClonePath(s.b.homes, 'acme', 'bot-1');

/** Mehrere Aufrufe als ein Golden-Text, je Aufruf mit Befehlszeile. */
async function session(s: Setup, calls: (string[] | (() => Promise<void>))[]): Promise<string> {
  const parts: string[] = [];
  for (const call of calls) {
    if (typeof call === 'function') {
      await call();
      continue;
    }
    const r = await run(s, call);
    const line = call.map((a) => (/\s/.test(a) ? `'${a}'` : a)).join(' ');
    // Kurz-SHAs aus dieser Ausgabe benennen, bevor normalisiert wird.
    await nameHead(s, s.b.root, '<spw-head7>');
    if (await exists(botCopy(s))) await nameHead(s, botCopy(s), '<bot-head7>');
    parts.push(norm(s, `$ backe ${line}\n${transcript(r, {})}`));
  }
  return parts.join('\n');
}

async function exists(dir: string): Promise<boolean> {
  try {
    await readFile(join(dir, '.backe/backlog.jsonc'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Ein Konflikt in der Ablage von `bot-1`: `spw` benennt das Issue um und pusht, `bot-1` benennt es
 * auf dem alten Stand anders um und synct. Liefert die Konflikt-ID.
 */
async function shelve(s: Setup, id: string, n: number): Promise<string> {
  done(await run(s, ['issue', 'edit', id, '--title', `Spw ${n}`]));
  ok(await run(s, ['sync']));
  done(await run(s, bot(['issue', 'edit', id, '--title', `Bot ${n}`])));
  const out = done(await run(s, bot(['sync'])));
  const conflict = out.match(CONFLICT_ID)?.[0];
  expect(conflict).toBeDefined();
  return conflict as string;
}

const remoteHead = async (s: Setup) =>
  (await git(['rev-parse', 'main'], { cwd: s.b.remote as string })).stdout.trim();

test('sync pushes and a second clone sees the issue', async () => {
  const s = await setup({ agent: true });
  await create(s, 'Erstes', '<erstes>');

  await expect(
    await session(s, [['sync'], bot(['sync']), bot(['ls']), ['sync']]),
  ).toMatchFileSnapshot('golden/sync.txt');
  expect(await remoteHead(s)).toBe(await revParse(s.b.root, 'HEAD'));

  await create(s, 'Zweites', '<zweites>');
  const pushed = await run(s, ['sync', '--json']);
  const fetched = await run(s, bot(['sync', '--json']));
  await expect(norm(s, ok(pushed) + ok(fetched))).toMatchFileSnapshot('golden/sync.json');
  expect(JSON.parse(pushed.stdout)).toMatchObject({ pushed: await revParse(s.b.root, 'HEAD') });
  expect(JSON.parse(fetched.stdout)).toMatchObject({ fetched: 1, pushed: null });
});

test('sync status shows unpushed, last sync and conflicts', async () => {
  const s = await setup({ agent: true });
  const id = await create(s, 'Geteilt', '<id>');
  ok(await run(s, ['sync']));
  ok(await run(s, bot(['sync'])));
  done(await run(s, ['issue', 'edit', id, '--title', 'Spw 1']));
  ok(await run(s, ['sync']));
  // Der Bot benennt auf dem alten Stand um und legt dazu ein Issue an: Die Umbenennung geht in die
  // Konfliktablage, das neue Issue wird neu signiert und gepusht.
  done(await run(s, bot(['issue', 'edit', id, '--title', 'Bot 1'])));
  await create(s, 'Lokal', '<lokal>', ['--as', 'bot-1']);

  await expect(
    await session(s, [
      bot(['sync']),
      async () => {
        await create(s, 'Später', '<später>', ['--as', 'bot-1']);
      },
      bot(['sync', 'status']),
    ]),
  ).toMatchFileSnapshot('golden/sync-status.txt');
  const status = await run(s, bot(['sync', 'status', '--json']));
  await expect(norm(s, ok(status))).toMatchFileSnapshot('golden/sync-status.json');
  expect(JSON.parse(status.stdout)).toMatchObject({ mode: 'manual', unpushed: 1, running: false });

  // Die Kopfzeile nach einem anderen Befehl nennt Ungepushtes und Konflikte.
  const listed = await run(s, bot(['ls']));
  expect(listed.code).toBe(0);
  expect(listed.stderr).toBe('Sync: 1 ungepusht · 1 Konflikt\nHinweis: backe sync status\n');
});

test('a shelved conflict is listed, applied and dropped via sync resolve', async () => {
  const s = await setup({ agent: true });
  const id = await create(s, 'Geteilt', '<id>');
  ok(await run(s, ['sync']));
  ok(await run(s, bot(['sync'])));

  const first = await shelve(s, id, 1);
  const listed = done(await run(s, bot(['sync', 'resolve'])));
  expect(norm(s, listed)).toMatch(/^<konflikt> {2}\S.* {2}\S.*\n$/);
  expect(listed).toContain(first);

  const usage = await run(s, bot(['sync', 'resolve', first]));
  expect(usage.code).toBe(2);
  expect(usage.stderr).toMatch(/^Fehler: Genau eins von --drop und --apply angeben/);
  expect((await run(s, bot(['sync', 'resolve', first, '--drop', '--apply']))).code).toBe(2);
  expect((await run(s, bot(['sync', 'resolve', '20260101T000000Z-abcdef', '--drop']))).code).toBe(
    3,
  );

  const applied = await run(s, bot(['sync', 'resolve', first, '--apply', '--json']));
  const out = JSON.parse(done(applied)) as { id: string; commit: string; ops: unknown[] };
  expect(out).toMatchObject({ id: first, action: 'apply' });
  expect(out.commit).toMatch(/^[0-9a-f]{40}$/);
  const shown = JSON.parse(done(await run(s, bot(['show', id, '--json'])))) as { title: string };
  expect(shown.title).toBe('Bot 1');

  // Der Bot pusht seine Auflösung; der nächste Konflikt entsteht auf dem neuen Stand.
  ok(await run(s, bot(['sync'])));
  ok(await run(s, ['sync']));
  const second = await shelve(s, id, 2);
  expect(done(await run(s, bot(['sync', 'resolve', second, '--drop'])))).toBe(
    `verworfen: ${second}\n`,
  );
  const status = JSON.parse(ok(await run(s, bot(['sync', 'status', '--json'])))) as {
    conflicts: unknown[];
  };
  expect(status.conflicts).toEqual([]);
});

test('issue claim pushes; a second claim from another clone exits 4', async () => {
  const s = await setup({ agent: true });
  const id = await create(s, 'Claimbar', '<id>');
  ok(await run(s, ['sync']));
  ok(await run(s, bot(['sync'])));

  await setMode(s, 'auto');
  expect(ok(await run(s, ['issue', 'claim', id]))).toBe(`issue claim ${id}\n`);
  expect(await remoteHead(s)).toBe(await revParse(s.b.root, 'HEAD'));
  const lost = await run(s, bot(['issue', 'claim', id, '--json']));
  expect(lost.code).toBe(4);
  expect(JSON.parse(lost.stderr)).toMatchObject({ error: { code: 'conflict' } });
  await setMode(s, 'manual');

  // In `manual` bleibt der Claim lokal und sagt es.
  const other = await create(s, 'Nur lokal', '<other>');
  const local = await run(s, ['issue', 'claim', other]);
  expect(local.code).toBe(0);
  expect(local.stdout).toBe(`issue claim ${other}\n`);
  expect(local.stderr).toContain('Hinweis: Claim nur lokal: sync.mode manual\n');
  expect(await remoteHead(s)).not.toBe(await revParse(s.b.root, 'HEAD'));
});

test('next --claim claims and prints the issue', async () => {
  const s = await setup();
  const id = await create(s, 'Als Nächstes', '<id>');
  ok(await run(s, ['sync']));

  await setMode(s, 'auto');
  const claimed = JSON.parse(ok(await run(s, ['next', '--claim', '--json']))) as {
    issue: { id: string; state: string; assignee: string };
    commit: string;
    attempts: string[];
  };
  expect(claimed.issue).toMatchObject({ id, state: 'in_progress', assignee: 'spw' });
  expect(claimed.attempts).toEqual([id]);
  expect(claimed.commit).toBe(await revParse(s.b.root, 'HEAD'));
  expect(await remoteHead(s)).toBe(claimed.commit);

  // Schon in Arbeit: `next` setzt fort, der Claim ist unverändert.
  const again = ok(await run(s, ['next', '--claim']));
  expect(again).toContain(id);
  expect(again).toContain('(läuft schon)');
  await setMode(s, 'manual');
});

test('a read with --sync pulls before listing', async () => {
  const s = await setup({ agent: true });
  await create(s, 'Frisch', '<frisch>');
  ok(await run(s, ['sync']));

  expect(ok(await run(s, bot(['ls'])))).not.toContain('Frisch');
  expect(ok(await run(s, bot(['ls', '--sync'])))).toContain('Frisch');
});

test('a failed sync shows the status line on stderr in text mode only', async () => {
  const s = await setup();
  await create(s, 'Wartet', '<id>');
  await rm(s.b.remote as string, { recursive: true, force: true });

  const failed = await run(s, ['sync']);
  expect(failed.code).toBe(6);
  expect(failed.stderr).toMatch(/^Fehler: Fetch von origin fehlgeschlagen: /);

  const listed = await run(s, ['ls']);
  expect(listed.code).toBe(0);
  expect(listed.stderr).toMatch(
    /^Sync: 1 ungepusht · letzter Sync fehlgeschlagen: Fetch von origin fehlgeschlagen: .*\nHinweis: backe sync status\n$/,
  );
  expect(ok(await run(s, ['ls', '--json']))).toContain('Wartet');

  const status = done(await run(s, ['sync', 'status']));
  expect(status).toMatch(/^fehler {2}Fetch von origin fehlgeschlagen: /m);
});

test('sync --background runs a round and exits 0', async () => {
  const s = await setup();
  await create(s, 'Im Hintergrund', '<id>');
  expect(await run(s, ['sync', '--background'])).toEqual({ stdout: '', stderr: '', code: 0 });
  expect(await remoteHead(s)).toBe(await revParse(s.b.root, 'HEAD'));

  // Auch ein scheiternder Hintergrund-Sync endet still mit 0; der Fehler steht im Zustand.
  await rm(s.b.remote as string, { recursive: true, force: true });
  await create(s, 'Ohne Remote', '<other>');
  expect(await run(s, ['sync', '--background'])).toEqual({ stdout: '', stderr: '', code: 0 });
  const status = JSON.parse(ok(await run(s, ['sync', 'status', '--json']))) as {
    last_error?: { code: string };
  };
  expect(status.last_error).toMatchObject({ code: 'sync' });
});

test('commit --resign signs a bare git commit', async () => {
  const s = await setup();
  const id = await create(s, 'Roh', '<id>');
  ok(await run(s, ['sync']));
  const file = issueFile(id);
  const content = await readFile(join(s.b.root, file), 'utf8');
  await rawCommit(s.b.root, { files: { [file]: content.replace('title: Roh', 'title: Neu') } });

  const refused = await run(s, ['sync']);
  expect(refused.code).toBe(5);
  expect(refused.stderr).toMatch(
    /^Fehler: Lokaler Commit [0-9a-f]{7} ist nicht von backe signiert/,
  );
  expect(refused.stderr).toContain('Hinweis: backe commit --resign');

  expect(done(await run(s, ['commit', '--resign']))).toBe(`issue edit ${id}\n`);
  // Bis zur nächsten gelungenen Runde nennt die Kopfzeile den verweigerten Sync.
  expect(done(await run(s, ['commit', '--resign']))).toBe('Nichts neu zu signieren\n');
  expect(JSON.parse(ok(await run(s, ['commit', '--resign', '--json'])))).toEqual({
    commits: [],
    rewritten: 0,
  });
  ok(await run(s, ['sync']));
  expect(await remoteHead(s)).toBe(await revParse(s.b.root, 'HEAD'));
  expect(ok(await run(s, ['ls']))).toContain('Neu');
});

test('sync without remote prints kein Remote', async () => {
  const s = await setup({ remote: false });
  expect(ok(await run(s, ['sync']))).toBe('kein Remote\n');
  expect(JSON.parse(ok(await run(s, ['sync', '--json'])))).toEqual({
    fetched: 0,
    replayed: 0,
    conflicts: [],
    pushed: null,
    rounds: 0,
    skipped: 'no_remote',
  });
  expect(ok(await run(s, ['sync', 'status']))).toBe(
    'remote  kein Remote\nmodus  manual\nungepusht  0\nletzter Sync  nie\n',
  );
  const interactive = await run(s, ['sync', '--interactive']);
  expect(interactive.code).toBe(2);
  expect(interactive.stderr).toMatch(/^Fehler: --interactive braucht ein Terminal/);
});

test('next --claim --sync is a usage error, the claim syncs by itself', async () => {
  const s = await setup();
  const r = await run(s, ['next', '--claim', '--sync']);
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/^Fehler: --sync passt nicht zu --claim/);
});

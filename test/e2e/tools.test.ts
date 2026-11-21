import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { git } from '../../src/git/exec.ts';
import { tempDir } from '../helpers/backlog.ts';
import { transcript } from './cli.ts';
import { errorOf, norm, ok, run, setupTools, type Tools } from './tools.ts';

const IDENT = ['-c', 'user.name=t', '-c', 'user.email=t@example.org', '-c', 'commit.gpgsign=false'];

/** Bare-Repo mit Branch main und Tag v1 samt einem Arbeits-Klon, dessen origin es ist. */
async function remoteWithClone(t: Tools): Promise<{ bare: string; clone: string; dir: string }> {
  const dir = await tempDir();
  const bare = join(dir, 'webapp.git');
  const clone = join(dir, 'src', 'webapp');
  await mkdir(join(dir, 'src'));
  await git(['init', '--bare', '-q', '-b', 'main', bare], { cwd: dir });
  await git(['init', '-q', '-b', 'main', clone], { cwd: dir });
  await git([...IDENT, 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: clone });
  await git(['tag', 'v1'], { cwd: clone });
  await git(['remote', 'add', 'origin', bare], { cwd: clone });
  await git(['push', '-q', 'origin', 'main', 'v1'], { cwd: clone });
  t.names[bare] = '<bare>';
  t.names[clone] = '<clone>';
  t.names[dir] = '<remote-dir>';
  return { bare, clone, dir };
}

const session = async (t: Tools, calls: string[][]): Promise<string> => {
  let out = '';
  for (const args of calls)
    out += `$ ${norm(t, `backe ${args.join(' ')}`)}\n${transcript(await run(t, args), t.names)}\n`;
  return out;
};

test('repo check local and remote against a bare repo', async () => {
  const t = await setupTools();
  const { bare } = await remoteWithClone(t);
  ok(await run(t, ['repo', 'add', bare, '--name', 'webapp', '--ref', 'main']));
  ok(await run(t, ['new', '-t', 'Tag', '--repo', 'webapp@v1']));
  const local = await run(t, ['repo', 'check']);
  expect(local.code).toBe(0);

  const remote = await run(t, ['repo', 'check', '--remote']);
  expect(remote.code).toBe(0);
  expect(remote.stdout).toContain('webapp  ok');
  // Zweiter Lauf: aus dem Cache.
  const cached = await run(t, ['repo', 'check', 'webapp', '--remote']);
  expect(cached.stdout).toContain('(Cache vom ');
  const fresh = await run(t, ['repo', 'check', 'webapp', '--remote', '--fresh']);
  expect(fresh.stdout).not.toContain('Cache vom');

  // Fehlender Ref → validation, der Bericht steht trotzdem auf stdout.
  ok(await run(t, ['new', '-t', 'Fehlt', '--repo', 'webapp@feat/fehlt']));
  const text = await run(t, ['repo', 'check', '--remote', '--fresh']);
  expect(text.code).toBe(2);
  expect(text.stdout).toContain('fehler');
  await expect(
    await session(t, [
      ['repo', 'check', '--remote', '--fresh'],
      ['repo', 'check', 'webapp', '--remote', '--json'],
    ]),
  ).toMatchFileSnapshot('golden/repo-check.txt');
  const asJson = await run(t, ['repo', 'check', 'webapp', '--remote', '--json']);
  expect(asJson.code).toBe(2);
  await expect(norm(t, asJson.stdout)).toMatchFileSnapshot('golden/repo-check.json');
});

test('repo check on an unreachable repo exits 6', async () => {
  const t = await setupTools();
  const gone = join(await tempDir(), 'missing', 'gone.git');
  ok(await run(t, ['repo', 'add', gone, '--name', 'gone']));
  const r = await run(t, ['repo', 'check', '--remote']);
  expect(r.code).toBe(6);
  expect(r.stdout).toContain('gone  fehler');
  expect(r.stderr).toMatch(/^Fehler: repo check: 1 Fehler/);
  // Ohne --remote ist dasselbe Repo lokal in Ordnung.
  expect((await run(t, ['repo', 'check'])).code).toBe(0);
});

test('repo where prints the path; without path exits 3 with hint', async () => {
  const t = await setupTools();
  const { bare, clone } = await remoteWithClone(t);
  ok(await run(t, ['repo', 'add', bare, '--name', 'webapp']));
  const none = await run(t, ['repo', 'where', 'webapp', '--json']);
  expect(none.code).toBe(3);
  expect(errorOf(none).hint).toContain('backe repo scan');
  expect(errorOf(none).message).toBe('Kein lokaler Pfad für »webapp«');
  ok(await run(t, ['config', 'set', `repos.${bare}`, clone]));
  expect(norm(t, ok(await run(t, ['repo', 'where', 'webapp'])))).toBe('<clone>\n');
  const asJson = JSON.parse(ok(await run(t, ['repo', 'where', 'webapp', '--json']))) as Record<
    string,
    string
  >;
  expect(asJson).toMatchObject({ name: 'webapp', path: clone });
  expect((await run(t, ['repo', 'where', 'nope'])).code).toBe(3);
});

test('repo scan registers a clone and repo where finds it', async () => {
  const t = await setupTools();
  const { bare, clone, dir } = await remoteWithClone(t);
  ok(await run(t, ['repo', 'add', bare, '--name', 'webapp']));
  const src = join(dir, 'src');
  t.names[src] = '<src>';
  await expect(
    await session(t, [
      ['repo', 'scan', src, '--dry-run'],
      ['repo', 'where', 'webapp'],
      ['repo', 'scan', src],
      ['repo', 'where', 'webapp'],
      ['repo', 'scan', src],
      ['repo', 'scan', src, '--json'],
    ]),
  ).toMatchFileSnapshot('golden/repo-scan.txt');
  expect((await run(t, ['repo', 'scan', join(dir, 'nope')])).code).toBe(3);
  expect(norm(t, ok(await run(t, ['repo', 'where', 'webapp'])))).toBe(`${'<clone>'}\n`);
  expect(clone).toContain('webapp');
});

const doctorLines = (t: Tools, text: string): string =>
  norm(t, text)
    // Version und Vorhandensein dieser Programme hängen vom Rechner ab.
    .replace(
      /^(ok|warn|fail) {2}(node|git|ssh-keygen|git-lfs|gh) {2}.*$/gm,
      '<status>  $2  <detail>',
    );

test('doctor reports and exits 0 on a healthy setup', async () => {
  const t = await setupTools();
  const r = await run(t, ['doctor']);
  expect(r.code).toBe(0);
  expect(r.stderr).toBe('');
  const out = `$ backe doctor\n[exit ${r.code}]\n[stdout]\n${doctorLines(t, r.stdout)}`;
  await expect(out).toMatchFileSnapshot('golden/doctor.txt');
});

test('doctor --json lists checks', async () => {
  const t = await setupTools();
  const r = await run(t, ['doctor', '--json']);
  expect(r.code).toBe(0);
  const parsed = JSON.parse(r.stdout) as { checks: { id: string; status: string }[] };
  expect(parsed.checks.map((c) => c.id)).toEqual(
    expect.arrayContaining(['node', 'git', 'user-config', 'backlog', 'identity']),
  );
  expect(parsed.checks.find((c) => c.id === 'backlog')?.status).toBe('ok');
  expect(r.stdout.trimEnd().split('\n')).toHaveLength(1);
  // Ohne auflösbaren Backlog läuft doctor trotzdem und warnt.
  const none = await run(t, ['doctor', '--json'], {
    env: { BACKE_BACKLOG: join(t.cwd, 'nirgends') },
  });
  const checks = (JSON.parse(none.stdout) as { checks: { id: string; status: string }[] }).checks;
  expect(checks.find((c) => c.id === 'backlog')?.status).toBe('warn');
});

test('doctor exits 2 after the report when a check fails', async () => {
  const t = await setupTools();
  await writeFile(join(t.env.BACKE_HOME as string, 'config.jsonc'), '{ kaputt');
  const r = await run(t, ['doctor']);
  expect(r.code).toBe(2);
  expect(r.stdout).toContain('fail  user-config');
  expect(r.stderr).toContain('doctor: 1 Prüfung(en) fehlgeschlagen');
  // Jeder Hint steht direkt unter seiner Zeile.
  const out = `$ backe doctor\n[exit ${r.code}]\n[stdout]\n${doctorLines(t, r.stdout)}[stderr]\n${norm(t, r.stderr)}`;
  await expect(out).toMatchFileSnapshot('golden/doctor-fail.txt');
});

test('config set, get and unset', async () => {
  const t = await setupTools();
  const file = join(t.env.BACKE_HOME as string, 'config.jsonc');
  await writeFile(file, '// meine Config\n{\n  "user": "spw"\n}\n');
  expect(ok(await run(t, ['config', 'set', 'output.color', 'never']))).toBe('');
  expect(ok(await run(t, ['config', 'set', 'repos.github.com/Acme/WebApp', '~/code/webapp']))).toBe(
    '',
  );
  await expect(
    await session(t, [
      ['config', 'get'],
      ['config', 'get', '--json'],
      ['config', 'get', 'output.color'],
      ['config', 'get', 'repos'],
      ['config', 'get', 'repos.github.com/acme/webapp'],
      ['config', 'get', 'nope'],
      ['config', 'set', 'output.color', 'bunt'],
      ['config', 'set', '--unset', 'output.color'],
      ['config', 'get', 'output.color'],
    ]),
  ).toMatchFileSnapshot('golden/config-get.txt');
  expect(await readFile(file, 'utf8')).toContain('// meine Config');
});

test('config edit with an invalid result keeps the original', async () => {
  const t = await setupTools();
  const file = join(t.env.BACKE_HOME as string, 'config.jsonc');
  await writeFile(file, '{\n  "user": "spw"\n}\n');
  const editor = join(await tempDir(), 'kaputt.sh');
  await writeFile(editor, '#!/bin/sh\nprintf "{ kaputt" > "$1"\n');
  const r = await run(t, ['config', 'edit', '--json'], { env: { BACKE_EDITOR: `sh ${editor}` } });
  expect(r.code).toBe(2);
  const e = errorOf(r);
  expect(e.code).toBe('validation');
  expect(e.message).toMatch(/^<?[^ ]*config\.jsonc\.draft:1/);
  expect(e.hint).toContain('config.jsonc.draft');
  expect(await readFile(file, 'utf8')).toBe('{\n  "user": "spw"\n}\n');
  expect(await readFile(`${file}.draft`, 'utf8')).toBe('{ kaputt');

  // Der nächste Edit startet mit dem Entwurf; unverändert zurückgegeben scheitert er wieder.
  const dir = await tempDir();
  const peek = join(dir, 'peek.sh');
  await writeFile(peek, `#!/bin/sh\ncp "$1" ${join(dir, 'seen')}\n`);
  const again = await run(t, ['config', 'edit', '--json'], { env: { BACKE_EDITOR: `sh ${peek}` } });
  expect(again.code).toBe(2);
  expect(await readFile(join(dir, 'seen'), 'utf8')).toBe('{ kaputt');
  expect(await readFile(`${file}.draft`, 'utf8')).toBe('{ kaputt');

  // Gültiges Ergebnis wird übernommen und erledigt den Entwurf, unverändert meldet es.
  const good = join(dir, 'gut.sh');
  await writeFile(good, `#!/bin/sh\nprintf '{\\n  "user": "anna"\\n}\\n' > "$1"\n`);
  expect(ok(await run(t, ['config', 'edit'], { env: { BACKE_EDITOR: `sh ${good}` } }))).toBe('');
  expect(await readFile(file, 'utf8')).toBe('{\n  "user": "anna"\n}\n');
  await expect(readFile(`${file}.draft`, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  expect(ok(await run(t, ['config', 'edit'], { env: { BACKE_EDITOR: 'true' } }))).toBe(
    'unverändert\n',
  );
  const none = await run(t, ['config', 'edit', '--json']);
  expect(none.code).toBe(2);
  expect(errorOf(none)).toEqual({
    code: 'usage',
    message: 'Kein Editor verfügbar',
    hint: 'BACKE_EDITOR setzen',
  });
});

test('config edit repairs an invalid config', async () => {
  const t = await setupTools();
  const file = join(t.env.BACKE_HOME as string, 'config.jsonc');
  const valid = await readFile(file, 'utf8');
  await writeFile(file, '{ kaputt');
  const broken = await run(t, ['config', 'get']);
  expect(broken.code).toBe(2);
  expect(broken.stderr).toContain('config.jsonc:1');

  // Der Editor schreibt eine gültige Config; config edit startet trotz kaputter Datei.
  const template = join(await tempDir(), 'valid.jsonc');
  await writeFile(template, valid);
  const repair = join(await tempDir(), 'repair.sh');
  await writeFile(repair, `#!/bin/sh\ncat ${template} > "$1"\n`);
  expect(ok(await run(t, ['config', 'edit'], { env: { BACKE_EDITOR: `sh ${repair}` } }))).toBe('');
  expect(await readFile(file, 'utf8')).toBe(valid);
  expect(ok(await run(t, ['config', 'get']))).toBe(valid);
});

test('config set with a value and --unset is a usage error', async () => {
  const t = await setupTools();
  const r = await run(t, ['config', 'set', '--unset', 'output.color', 'never', '--json']);
  expect(r.code).toBe(2);
  expect(errorOf(r).code).toBe('usage');
  const missing = await run(t, ['config', 'set', 'output.color', '--json']);
  expect(errorOf(missing).code).toBe('usage');
});

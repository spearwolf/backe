import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { errorOf, norm, ok, run, runBytes, setupTools } from './tools.ts';

test('attach add from file, json and url; list; rm', async () => {
  const t = await setupTools();
  await writeFile(join(t.cwd, 'Bericht Final.PDF'), 'pdf-bytes');
  const added = await run(t, ['attach', 'add', t.id, '--name', 'bericht', 'Bericht Final.PDF']);
  expect(norm(t, ok(added))).toBe('attach add <id>\n');
  ok(await run(t, ['attach', 'add', t.id, '--name', 'trace', '--json', '{"b":1,"a":[1,2]}']));
  ok(await run(t, ['attach', 'add', t.id, '--name', 'spec', '--url', 'https://example.com/spec']));

  const list = ok(await run(t, ['attach', 'list', t.id]));
  await expect(norm(t, list)).toMatchFileSnapshot('golden/attach-list.txt');
  const listJson = ok(await run(t, ['attach', 'list', t.id, '--json']));
  await expect(norm(t, listJson)).toMatchFileSnapshot('golden/attach-list.json');
  const stored = await readFile(
    join(t.b.root, 'issues', t.id.slice(3, 5), t.id, 'attachments', 'trace.json'),
    'utf8',
  );
  expect(stored).toBe('{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}\n');

  const removed = await run(t, ['attach', 'rm', t.id, 'trace']);
  expect(norm(t, ok(removed))).toBe('attach rm <id>\n');
  expect(ok(await run(t, ['attach', 'list', t.id]))).not.toContain('trace');
});

test('attach get returns binary content unchanged', async () => {
  const t = await setupTools();
  const bytes = randomBytes(4096);
  await writeFile(join(t.cwd, 'bin.dat'), bytes);
  ok(await run(t, ['attach', 'add', t.id, '--name', 'blob', 'bin.dat']));
  const r = await runBytes(t, ['attach', 'get', t.id, 'blob']);
  expect(r.code).toBe(0);
  expect(r.stderr).toBe('');
  expect(r.stdout.equals(bytes)).toBe(true);
  ok(await run(t, ['attach', 'add', t.id, '--name', 'spec', '--url', 'https://example.com/spec']));
  expect(ok(await run(t, ['attach', 'get', t.id, 'spec']))).toBe('https://example.com/spec\n');
  const info = JSON.parse(ok(await run(t, ['attach', 'get', t.id, 'blob', '--json']))) as Record<
    string,
    unknown
  >;
  expect(info).toMatchObject({ name: 'blob', file: 'blob.dat', size: 4096 });
  expect(info.path).toBe(
    join(t.b.root, 'issues', t.id.slice(3, 5), t.id, 'attachments', 'blob.dat'),
  );
});

test('attach get -o writes the file and prints the path', async () => {
  const t = await setupTools();
  const bytes = randomBytes(300);
  await writeFile(join(t.cwd, 'bin.dat'), bytes);
  ok(await run(t, ['attach', 'add', t.id, '--name', 'blob', 'bin.dat']));
  await mkdir(join(t.cwd, 'out'));
  const r = await run(t, ['attach', 'get', t.id, 'blob', '-o', 'out/copy.dat']);
  expect(ok(r)).toBe(`${join(t.cwd, 'out/copy.dat')}\n`);
  expect((await readFile(join(t.cwd, 'out/copy.dat'))).equals(bytes)).toBe(true);
  const j = await run(t, ['attach', 'get', t.id, 'blob', '-o', 'out/copy.dat', '--json']);
  expect(JSON.parse(ok(j))).toMatchObject({ name: 'blob', path: join(t.cwd, 'out/copy.dat') });
  expect(errorOf(await run(t, ['attach', 'get', t.id, 'nope', '--json'])).code).toBe('not_found');
});

test('attach add --json - reads stdin; --format json prints the outcome', async () => {
  const t = await setupTools();
  const r = await run(
    t,
    ['attach', 'add', t.id, '--name', 'cfg', '--json', '-', '--format', 'json'],
    {
      input: '{"x":true}',
    },
  );
  const out = JSON.parse(ok(r)) as { commit: string; op: { op: string; name: string }; id: string };
  expect(out.commit).toMatch(/^[0-9a-f]{40}$/);
  expect(out.op).toMatchObject({ op: 'attach.add', name: 'cfg' });
  expect(out.id).toBe(t.id);
  const bad = await run(t, [
    'attach',
    'add',
    t.id,
    '--name',
    'bad',
    '--json',
    '{nope',
    '--format',
    'json',
  ]);
  expect(bad.code).toBe(2);
  expect(errorOf(bad).code).toBe('validation');
});

test('attach add needs exactly one source', async () => {
  const t = await setupTools();
  await writeFile(join(t.cwd, 'a.txt'), 'a');
  const none = await run(t, ['attach', 'add', t.id, '--name', 'x']);
  expect(none.code).toBe(2);
  const two = await run(t, [
    'attach',
    'add',
    t.id,
    '--name',
    'x',
    'a.txt',
    '--url',
    'https://e.com',
  ]);
  expect(two.code).toBe(2);
  expect(two.stderr).toContain('Fehler:');
});

test('attach add over max_bytes exits 2 with lfs hint', async () => {
  const t = await setupTools();
  const cfgPath = join(t.b.root, '.backe/backlog.jsonc');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8')) as Record<string, unknown>;
  cfg.attachments = { max_bytes: 4, lfs: false };
  await writeFile(cfgPath, JSON.stringify(cfg));
  execFileSync('git', ['-C', t.b.root, 'commit', '-qam', 'cfg', '--no-gpg-sign'], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.com',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.com',
    },
  });
  await writeFile(join(t.cwd, 'big.bin'), '12345');
  const r = await run(t, ['attach', 'add', t.id, '--name', 'big', 'big.bin', '--format', 'json']);
  expect(r.code).toBe(2);
  expect(errorOf(r).hint).toContain('attachments.lfs');
  await writeFile(join(t.cwd, 'fits.bin'), '1234');
  ok(await run(t, ['attach', 'add', t.id, '--name', 'fits', 'fits.bin']));
});

test('attach add with a directory or a missing file', async () => {
  const t = await setupTools();
  await mkdir(join(t.cwd, 'dir'));
  const dir = await run(t, ['attach', 'add', t.id, '--name', 'd', 'dir']);
  expect(dir.code).toBe(2);
  expect(norm(t, dir.stderr)).toContain('<cwd>/dir ist keine Datei');
  const missing = await run(t, ['attach', 'add', t.id, '--name', 'm', 'gibts-nicht.txt']);
  expect(missing.code).toBe(3);
  expect(missing.stderr).toContain('»gibts-nicht.txt«');
});

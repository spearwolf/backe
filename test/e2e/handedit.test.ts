import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { git } from '../../src/git/exec.ts';
import { issueFile } from '../../src/store/layout.ts';
import { tempDir } from '../helpers/backlog.ts';
import { transcript } from './cli.ts';
import { editor, errorOf, norm, ok, run, setupTools, type Tools } from './tools.ts';

const head = async (t: Tools) =>
  (await git(['rev-parse', 'HEAD'], { cwd: t.b.root })).stdout.trim();
const status = async (t: Tools) =>
  (await git(['status', '--short'], { cwd: t.b.root })).stdout.trim();

async function handEdit(t: Tools, f: (text: string) => string): Promise<void> {
  const file = join(t.b.root, issueFile(t.id));
  await writeFile(file, f(await readFile(file, 'utf8')));
}

test('commit translates hand edits and prints one line per commit', async () => {
  const t = await setupTools();
  await handEdit(t, (s) => s.replace(/^title: .*/m, 'title: Handtitel'));
  await writeFile(join(t.b.root, 'notizen.txt'), 'frei\n');
  const text = await run(t, ['commit', '-m', 'Notizen dazu']);
  await expect(transcript(text, t.names)).toMatchFileSnapshot('golden/commit.txt');
  expect(await status(t)).toBe('');

  await handEdit(t, (s) =>
    s.replace(/^title: .*/m, 'title: Noch ein Titel').replace(/^id: .*/m, '$&\ncolour: red'),
  );
  const asJson = await run(t, ['commit', '--json']);
  await expect(norm(t, ok(asJson))).toMatchFileSnapshot('golden/commit.json');
  expect(await status(t)).toBe('');

  // Text-Modus: Warnung und Hinweis stehen auf stderr, stdout nur die Zeile je Commit.
  await handEdit(t, (s) => s.replace(/^colour: .*/m, 'colour: blue'));
  const warned = await run(t, ['commit', '-m', 'ohne manuellen Anteil']);
  expect(warned.stdout).toBe('ohne manuellen Anteil\n');
  expect(norm(t, warned.stderr)).toBe(
    'Warnung: <issue-dir>/issue.md: unbekannte Keys colour — eigene Daten gehören nach props\n',
  );
  await handEdit(t, (s) => s.replace(/^title: .*/m, 'title: Dritter Titel'));
  const hinted = await run(t, ['commit', '-m', 'wird nicht gebraucht']);
  expect(norm(t, hinted.stdout)).toBe('issue edit <id>\n');
  // `-m` ohne manuellen Anteil steht unter `warnings`, im Text also als Warnung.
  expect(hinted.stderr).toContain('Warnung: -m gilt nur für manuelle Änderungen\n');
  await handEdit(t, (s) => s.replace(/^title: .*/m, 'title: Vierter Titel'));
  const asJsonHint = JSON.parse(ok(await run(t, ['commit', '-m', 'x', '--json']))) as {
    warnings?: string[];
    notices?: unknown;
  };
  expect(asJsonHint.warnings).toEqual(['-m gilt nur für manuelle Änderungen']);
  expect(asJsonHint.notices).toBeUndefined();
});

test('commit with nothing changed', async () => {
  const t = await setupTools();
  const before = await head(t);
  expect(ok(await run(t, ['commit']))).toBe('Nichts zu committen\n');
  expect(ok(await run(t, ['commit', '--json']))).toBe('{"commits":[]}\n');
  expect(await head(t)).toBe(before);
});

test('an editor with arguments edits the issue', async () => {
  const t = await setupTools();
  const BACKE_EDITOR = `sh ${editor('retitle.sh')} --title Neu`;
  const r = await run(t, ['issue', 'edit', t.id], { env: { BACKE_EDITOR } });
  expect(norm(t, ok(r))).toBe('issue edit <id>\n');
  expect(ok(await run(t, ['issue', 'show', t.id]))).toContain('Neu');
  expect(await status(t)).toBe('');
});

test('the editor gets a file only the user can read, removed after success', async () => {
  const t = await setupTools();
  const tmp = await tempDir();
  const seen = join(await tempDir(), 'seen');
  const script = join(await tempDir(), 'record.sh');
  // Merkt sich Pfad und Rechte der Temp-Datei, dann ändert es den Titel.
  await writeFile(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$1" > ${seen}\nls -l "$1" | cut -c1-10 >> ${seen}\n` +
      `sh ${editor('retitle.sh')} --title Neu "$1"\n`,
  );
  const r = await run(t, ['issue', 'edit', t.id], {
    env: { BACKE_EDITOR: `sh ${script}`, TMPDIR: tmp },
  });
  expect(norm(t, ok(r))).toBe('issue edit <id>\n');
  const [file, mode] = (await readFile(seen, 'utf8')).trimEnd().split('\n');
  expect(file).toMatch(new RegExp(`^${tmp}/backe-${t.id}-[0-9a-f]{6}\\.md$`));
  expect(mode).toBe('-rw-------');
  expect(await readdir(tmp)).toEqual([]);
  expect(ok(await run(t, ['issue', 'show', t.id]))).toContain('Neu');
});

test('an editor that changes nothing reports unchanged', async () => {
  const t = await setupTools();
  const before = await head(t);
  const r = await run(t, ['issue', 'edit', t.id], {
    env: { BACKE_EDITOR: `sh ${editor('noop.sh')}` },
  });
  expect(norm(t, ok(r))).toBe('unverändert: issue edit <id>\n');
  expect(await head(t)).toBe(before);
});

test('an edit with several operations is one batch commit', async () => {
  const t = await setupTools();
  const r = await run(t, ['issue', 'edit', t.id], {
    env: { BACKE_EDITOR: `sh ${editor('retitle-move.sh')}` },
  });
  expect(ok(r)).toBe('batch: 1 move, 1 edit\n');
  const j = await run(t, ['issue', 'edit', t.id, '--json'], {
    env: { BACKE_EDITOR: `sh ${editor('noop.sh')}` },
  });
  expect(JSON.parse(ok(j))).toMatchObject({ commit: null });
});

test('a failing editor changes nothing', async () => {
  const t = await setupTools();
  const before = await head(t);
  const r = await run(t, ['issue', 'edit', t.id], {
    env: { BACKE_EDITOR: `sh ${editor('fail.sh')}` },
  });
  expect(r.code).toBe(1);
  expect(r.stderr).toContain('Editor endete mit Exit-Code 1; nichts geändert');
  expect(await head(t)).toBe(before);
  expect(await status(t)).toBe('');
  expect(ok(await run(t, ['issue', 'show', t.id]))).not.toContain('Nie gespeichert');
});

test('without tty and BACKE_EDITOR no editor is started', async () => {
  const t = await setupTools();
  const r = await run(t, ['issue', 'edit', t.id], {
    env: { EDITOR: 'false-editor-that-would-hang', VISUAL: 'false-editor-that-would-hang' },
  });
  expect(r.code).toBe(2);
  expect(r.stderr).toContain('Nichts zu ändern');
  expect(r.stderr).toContain('BACKE_EDITOR');
});

test('editor output with unknown keys is refused with a commit hint', async () => {
  const t = await setupTools();
  const before = await head(t);
  const r = await run(t, ['issue', 'edit', t.id, '--format', 'json'], {
    env: { BACKE_EDITOR: `sh ${editor('unknown-key.sh')}` },
  });
  expect(r.code).toBe(2);
  const e = errorOf(r);
  expect(e.message).toBe('Diese Änderung lässt sich nicht als Operation ausdrücken');
  expect(e.hint).toContain('backe commit');
  expect(await head(t)).toBe(before);
});

test('a schema error names the draft file and keeps it', async () => {
  const t = await setupTools();
  const r = await run(t, ['issue', 'edit', t.id, '--format', 'json'], {
    env: { BACKE_EDITOR: `sh ${editor('bad-state.sh')}` },
  });
  expect(r.code).toBe(2);
  const e = errorOf(r);
  expect(e.message).not.toContain('issues/');
  const draft = /(\S*backe-bk-\w+-[0-9a-f]{6}\.md)/.exec(`${e.message} ${e.hint}`)?.[1];
  expect(draft).toBeDefined();
  expect(e.hint).toContain(draft as string);
  expect(e.message).toContain(`${draft}:`);
  expect(await readFile(draft as string, 'utf8')).toContain('state: nonsense');
});

test('batch from stdin and file prints placeholders', async () => {
  const t = await setupTools();
  const bom = '﻿';
  const stdin = [
    '{"op":"issue.create","ref":"$a","title":"Batch A"}',
    '{"op":"issue.create","ref":"$b","title":"Batch B","parent":"$a"}',
    `{"op":"comment.add","id":"${t.id}","body":"Notiz"}`,
  ].join('\r\n');
  const r1 = await run(t, ['batch', '-'], { input: `${bom}${stdin}\r\n\r\n` });
  const out1 = ok(r1);
  const ids = [...out1.matchAll(/^\$(\w+) {2}(bk-\w+)$/gm)];
  expect(ids).toHaveLength(2);
  for (const [, ref, id] of ids) t.names[id as string] = `<${ref}>`;
  await expect(norm(t, out1)).toMatchFileSnapshot('golden/batch.txt');

  const file = join(t.cwd, 'ops.jsonl');
  await writeFile(file, '{"op":"issue.create","ref":"$c","title":"Aus Datei"}\n');
  const r2 = await run(t, ['batch', '-f', file, '--json']);
  const out2 = JSON.parse(ok(r2)) as { commit: string; refs: Record<string, string>; ops: number };
  expect(out2.commit).toMatch(/^[0-9a-f]{40}$/);
  t.names[out2.refs.$c as string] = '<c>';
  await expect(
    norm(t, r2.stdout).replace(/"commit":"[0-9a-f]{40}"/, '"commit":"<sha>"'),
  ).toMatchFileSnapshot('golden/batch.json');
});

test('batch errors name the line', async () => {
  const t = await setupTools();
  const before = await head(t);
  const input = ['{"op":"issue.create","title":"ok"}', '{"op":"issue.create","title":', ''].join(
    '\n',
  );
  const r = await run(t, ['batch', '-', '--format', 'json'], { input });
  expect(r.code).toBe(2);
  expect(errorOf(r).details).toMatchObject({ line: 2 });
  expect(await head(t)).toBe(before);
  const none = await run(t, ['batch']);
  expect(none.code).toBe(2);
  expect(none.stderr).toContain('Fehler:');
  const forbidden = await run(t, ['batch', '-', '--format', 'json'], {
    input: `{"op":"attach.add","id":"${t.id}","name":"x","file":"x.txt"}\n`,
  });
  expect(errorOf(forbidden).details).toMatchObject({ line: 1 });
});

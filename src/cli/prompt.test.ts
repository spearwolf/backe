import { readFile, writeFile } from 'node:fs/promises';
import type { ManualConflictPath } from '../services/replay.ts';
import type { CliIo } from './io.ts';
import { interactiveResolver } from './prompt.ts';

type Fake = { io: CliIo; err: string[]; questions: string[]; edited: string[] };

/**
 * Ein CliIo mit festen Antworten; `edits` sind die Texte, die der Editor-Fake nacheinander in die
 * Datei schreibt (der Fake sieht den Inhalt vorher in `edited`).
 */
function fake(answers: string[], edits: string[] = [], env = { BACKE_EDITOR: 'fake' }): Fake {
  const err: string[] = [];
  const questions: string[] = [];
  const edited: string[] = [];
  const io: CliIo = {
    argv: [],
    env,
    cwd: '/',
    stdout: () => {},
    stdoutBytes: () => {},
    stderr: (s) => err.push(s),
    readStdin: async () => '',
    isTTY: true,
    stdinIsTTY: true,
    runEditor: async (_command, file) => {
      edited.push(await readFile(file, 'utf8'));
      const next = edits.shift();
      if (next !== undefined) await writeFile(file, next);
      return 0;
    },
    prompt: async (q) => {
      questions.push(q);
      return answers.shift() ?? '';
    },
  };
  return { io, err, questions, edited };
}

const conflict = (
  merged: string | undefined,
  path = 'notes.md',
): { sha: string; subject: string; paths: ManualConflictPath[] } => ({
  sha: 'abcdef1234567',
  subject: 'Notiz',
  paths: [
    {
      path,
      base: null,
      ours: Buffer.from('a'),
      theirs: Buffer.from('b'),
      ...(merged === undefined ? {} : { merged: Buffer.from(merged) }),
    } satisfies ManualConflictPath,
  ],
});

const MERGED = '<<<<<<< remote\nA\n=======\nB\n>>>>>>> lokal\n';

test('interactive resolver maps l, r, a and retries on unknown input', async () => {
  const f = fake(['x', ' R ', 'a', '']);
  const resolve = interactiveResolver(f.io);
  expect(await resolve(conflict(MERGED))).toEqual({ kind: 'remote' });
  expect(f.questions).toHaveLength(2);
  expect(f.err.join('')).toContain('Textkonflikt in manual-Commit abcdef1 (Notiz): notes.md');
  expect(await resolve(conflict(MERGED))).toEqual({ kind: 'abort' });
  expect(await resolve(conflict(MERGED))).toEqual({ kind: 'abort' });
});

test('l takes the local side', async () => {
  const f = fake(['l']);
  expect(await interactiveResolver(f.io)(conflict(MERGED))).toEqual({ kind: 'local' });
});

test('edit loops until no conflict markers remain', async () => {
  const f = fake(['e', 'e'], ['noch\n<<<<<<< remote\nx\n', 'fertig\n']);
  const r = await interactiveResolver(f.io)(conflict(MERGED));
  expect(r).toEqual({ kind: 'edit', files: new Map([['notes.md', Buffer.from('fertig\n')]]) });
  expect(f.edited).toEqual([MERGED, MERGED]);
  expect(f.err.join('')).toContain('notes.md hat noch Konfliktmarker');
});

test('a bare ======= line and a >>>>>>> line count as markers, a setext underline does not', async () => {
  const f = fake(
    ['e', 'e', 'e'],
    ['a\n=======\nb\n', 'a\n>>>>>>> lokal\n', 'Titel\n========\ntext\n'],
  );
  const r = await interactiveResolver(f.io)(conflict(MERGED));
  expect(r).toEqual({
    kind: 'edit',
    files: new Map([['notes.md', Buffer.from('Titel\n========\ntext\n')]]),
  });
  expect(f.questions).toHaveLength(3);
});

test('edit without an editor asks again', async () => {
  const f = fake(['e', 'a'], [], {} as { BACKE_EDITOR: string });
  expect(await interactiveResolver(f.io)(conflict(MERGED))).toEqual({ kind: 'abort' });
  expect(f.err.join('')).toContain('Kein Editor verfügbar');
});

test('paths without mergeable text stay as in the remote', async () => {
  const f = fake(['e'], ['gut\n']);
  const both = conflict(MERGED);
  both.paths.push(conflict(undefined, 'bild.png').paths[0] as ManualConflictPath);
  const r = await interactiveResolver(f.io)(both);
  expect(r).toEqual({ kind: 'edit', files: new Map([['notes.md', Buffer.from('gut\n')]]) });
  expect(f.err.join('')).toContain('bild.png lässt sich nicht im Editor lösen');
});

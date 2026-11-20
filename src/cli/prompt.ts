/**
 * Rückfragen im Terminal: der Resolver von `sync --interactive` (backe.md §2.16.2), der je
 * `manual`-Textkonflikt entscheidet.
 */
import { rm } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ManualConflictPath, ManualResolver } from '../services/replay.ts';
import { editorCommand, editText } from './editor.ts';
import type { CliIo } from './io.ts';
import { renderHints, safeText } from './output.ts';

const short = (sha: string) => sha.slice(0, 7);

/**
 * Ein übrig gebliebener Konfliktmarker: eine Zeile, die mit `<<<<<<< ` oder `>>>>>>> ` beginnt,
 * oder genau `=======`. Eine längere Reihe (`========`, Setext-Unterstreichung in Markdown) ist
 * keiner.
 */
const MARKER = /^(<<<<<<< |>>>>>>> |=======$)/m;

/**
 * `e` bei einem Textkonflikt: je Konfliktpfad mit Markern der Text in den Editor; der Inhalt danach
 * darf keine Marker mehr tragen. Pfade ohne Text mit Markern (Binär, Löschen gegen Ändern) bleiben
 * wie im Remote. Ein Rest von Markern heißt: noch einmal fragen (`undefined`).
 */
async function editConflicts(
  io: CliIo,
  sha: string,
  paths: readonly ManualConflictPath[],
): Promise<Map<string, Buffer> | undefined> {
  const files = new Map<string, Buffer>();
  for (const c of paths) {
    if (c.merged === undefined) {
      io.stderr(renderHints([`${c.path} lässt sich nicht im Editor lösen; bleibt wie im Remote`]));
      continue;
    }
    const ext = extname(c.path).slice(1) || 'txt';
    const edited = await editText(io, `sync-${short(sha)}`, c.merged.toString('utf8'), ext);
    await rm(edited.file, { force: true });
    if (MARKER.test(edited.text)) {
      io.stderr(renderHints([`${c.path} hat noch Konfliktmarker`]));
      return undefined;
    }
    files.set(c.path, Buffer.from(edited.text, 'utf8'));
  }
  return files;
}

/**
 * Der Resolver von `sync --interactive`: je `manual`-Textkonflikt
 * `[e]ditieren, [l]okal nehmen, [r]emote behalten, [a]bbrechen`, bis eine gültige Antwort kommt.
 * Eine leere Antwort (Ende der Eingabe) bricht ab, sonst fragte sie ewig.
 */
export function interactiveResolver(io: CliIo): ManualResolver {
  return async ({ sha, subject, paths }) => {
    io.stderr(
      `${safeText(
        `Textkonflikt in manual-Commit ${short(sha)} (${subject}): ${paths.map((p) => p.path).join(', ')}`,
      )}\n`,
    );
    for (;;) {
      const answer = (
        await io.prompt('[e]ditieren, [l]okal nehmen, [r]emote behalten, [a]bbrechen? ')
      )
        .trim()
        .toLowerCase();
      if (answer === '' || answer === 'a') return { kind: 'abort' };
      if (answer === 'l') return { kind: 'local' };
      if (answer === 'r') return { kind: 'remote' };
      if (answer !== 'e') continue;
      if (editorCommand(io) === undefined) {
        io.stderr(renderHints(['Kein Editor verfügbar (BACKE_EDITOR, VISUAL oder EDITOR)']));
        continue;
      }
      const files = await editConflicts(io, sha, paths);
      if (files !== undefined) return { kind: 'edit', files };
    }
  };
}

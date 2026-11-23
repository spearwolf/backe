/**
 * Externer Editor für `issue edit` und `config edit` (backe.md §2.17): welcher Editor läuft und
 * wie ein Text in einer Temp-Datei durch ihn geht.
 */
import { randomBytes } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envValue } from '../context/paths.ts';
import { BackeError } from '../core/errors.ts';
import { m } from './editor.messages.ts';
import type { CliIo } from './io.ts';

/**
 * `BACKE_EDITOR` gilt immer; `VISUAL`, dann `EDITOR` nur, wenn stdin und stdout Terminals sind.
 * Ohne Terminal würde ein Editor aus der Umgebung eines Agents nie zurückkehren.
 */
export function editorCommand(io: CliIo): string | undefined {
  const explicit = envValue(io.env, 'BACKE_EDITOR');
  if (explicit !== undefined) return explicit;
  if (!io.stdinIsTTY || !io.isTTY) return undefined;
  return envValue(io.env, 'VISUAL') ?? envValue(io.env, 'EDITOR');
}

/**
 * Kein Editor verfügbar bei einem Befehl, der auch Flags kennt (`issue edit`): der Aufruf passt
 * nicht, ohne Flags gibt es nichts zu ändern. `config edit` meldet `Kein Editor verfügbar`.
 */
export function noEditorError(): BackeError {
  return new BackeError('usage', m.nothingToChange, {
    hint: m.nothingToChangeHint,
  });
}

/**
 * Legt `text` in eine Temp-Datei `<tmpdir>/backe-<label>-<6 hex>.<ext>` (nur für den User lesbar),
 * startet den Editor und liest das Ergebnis. Endet der Editor mit Exit ≠ 0, ist nichts geändert und
 * die Datei weg. Nach Erfolg löscht der Aufrufer die Datei; bleibt sie nach einem Fehler liegen,
 * nennt er sie dem User als Entwurf.
 */
export async function editText(
  io: CliIo,
  label: string,
  text: string,
  ext = 'md',
): Promise<{ text: string; file: string }> {
  const command = editorCommand(io);
  if (command === undefined) throw noEditorError();
  const file = join(tmpdir(), `backe-${label}-${randomBytes(3).toString('hex')}.${ext}`);
  await writeFile(file, text, { mode: 0o600, flag: 'wx' });
  let code: number;
  try {
    code = await io.runEditor(command, file);
  } catch (error) {
    await rm(file, { force: true });
    throw new BackeError('unexpected', m.editorStartFailed((error as Error).message));
  }
  if (code !== 0) {
    await rm(file, { force: true });
    throw new BackeError('unexpected', m.editorFailed(code));
  }
  return { text: await readFile(file, 'utf8'), file };
}

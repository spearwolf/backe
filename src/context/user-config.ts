import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyEdits, modify } from 'jsonc-parser';
import { BackeError } from '../core/errors.ts';
import { type UserConfig, UserConfigSchema } from '../core/schemas.ts';
import { writeFileAtomic } from '../store/files.ts';
import { readJsonc } from '../store/jsonc.ts';
import { withFileLock } from './lock.ts';

export type ConfigEdit = { path: readonly (string | number)[]; value: unknown };

export function userConfigPath(backeHome: string): string {
  return join(backeHome, 'config.jsonc');
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Parst Text als User-Config; Syntaxfehler mit `datei:zeile`, Schemafehler je Issue eine Zeile. */
function parseUserConfig(text: string, file: string): UserConfig {
  const result = UserConfigSchema.safeParse(readJsonc(text, file));
  if (result.success) return result.data;
  const lines = result.error.issues.map(
    (issue) => `${file}: ${issue.path.join('.') || '(Wurzel)'}: ${issue.message}`,
  );
  throw new BackeError('validation', lines.join('\n'));
}

export async function readUserConfig(backeHome: string): Promise<UserConfig> {
  const file = userConfigPath(backeHome);
  const text = await readText(file);
  return text === undefined ? {} : parseUserConfig(text, file);
}

/**
 * Ändert die User-Config unter Datei-Lock und erhält Kommentare und Formatierung.
 * `edit` sieht die frisch gelesene Config; ein Edit mit `value: undefined` entfernt den Key.
 * Das Ergebnis wird gegen das Schema geprüft, bevor etwas geschrieben wird.
 */
export async function updateUserConfig(
  backeHome: string,
  edit: (current: UserConfig) => readonly ConfigEdit[],
): Promise<UserConfig> {
  await mkdir(backeHome, { recursive: true, mode: 0o700 });
  return withFileLock(join(backeHome, 'config.lock'), async () => {
    const file = userConfigPath(backeHome);
    const text = (await readText(file)) ?? '{}\n';
    const current = parseUserConfig(text, file);
    const edits = edit(current);
    if (edits.length === 0) return current;
    let next = text;
    for (const { path, value } of edits) {
      next = applyEdits(
        next,
        modify(next, [...path], value, {
          formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
        }),
      );
    }
    const updated = parseUserConfig(next, file);
    await writeFileAtomic(file, next);
    return updated;
  });
}

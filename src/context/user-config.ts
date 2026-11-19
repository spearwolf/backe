import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { applyEdits, modify, type Node, parseTree } from 'jsonc-parser';
import type { ZodError } from 'zod';
import { BackeError } from '../core/errors.ts';
import { type UserConfig, UserConfigSchema } from '../core/schemas.ts';
import { writeFileAtomic } from '../store/files.ts';
import { readJsonc } from '../store/jsonc.ts';
import { withFileLock } from './lock.ts';

export type ConfigEdit = { path: readonly (string | number)[]; value: unknown };

export function userConfigPath(backeHome: string): string {
  return join(backeHome, 'config.jsonc');
}

/** Lock-Datei, unter der die User-Config geändert und ein Clone abgeschlossen wird. */
export function configLockPath(backeHome: string): string {
  return join(backeHome, 'config.lock');
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Schemafehler als `validation`: je Issue eine Zeile `<datei>: <key.pfad>: <meldung>`. */
export function schemaError(file: string, error: ZodError, hint?: string): BackeError {
  const lines = error.issues.map(
    (issue) => `${file}: ${issue.path.join('.') || '(Wurzel)'}: ${issue.message}`,
  );
  return new BackeError('validation', lines.join('\n'), hint === undefined ? undefined : { hint });
}

/** Parst Text als User-Config; Syntaxfehler mit `datei:zeile`, Schemafehler je Issue eine Zeile. */
function parseUserConfig(text: string, file: string): UserConfig {
  const result = UserConfigSchema.safeParse(readJsonc(text, file));
  if (result.success) return result.data;
  throw schemaError(file, result.error);
}

export async function readUserConfig(backeHome: string): Promise<UserConfig> {
  const file = userConfigPath(backeHome);
  const text = await readText(file);
  return text === undefined ? {} : parseUserConfig(text, file);
}

type Style = { unit: string; eol: string };
type TextEdit = { offset: number; length: number; content: string };

/** Einrückungseinheit (erste eingerückte Zeile; Standard zwei Leerzeichen) und Zeilenende der Datei. */
function detectStyle(text: string): Style {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  return { unit: /^([ \t]+)\S/m.exec(text)?.[1] ?? '  ', eol };
}

function lineIndent(text: string, offset: number): string {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  return text.slice(start, offset).replace(/[^ \t].*$/s, '');
}

function render(value: unknown, indent: string, style: Style): string {
  return JSON.stringify(value, null, style.unit).replace(/\n/g, style.eol + indent);
}

function skipBlanks(text: string, from: number): number {
  let i = from;
  while (text[i] === ' ' || text[i] === '\t') i++;
  return i;
}

/** Ende der Zeile, die `from` enthält (vor dem Zeilenende). */
function lineEndOf(text: string, from: number): number {
  return from + text.slice(from).search(/\r?\n|$/);
}

function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  // Von hinten nach vorn, damit die Offsets gültig bleiben; bei gleichem Offset steht der später angegebene Text vorn.
  return [...edits]
    .sort((a, b) => b.offset - a.offset)
    .reduce((acc, e) => acc.slice(0, e.offset) + e.content + acc.slice(e.offset + e.length), text);
}

function insertProperty(
  text: string,
  obj: Node,
  key: string,
  value: unknown,
  style: Style,
): string {
  const props = obj.children as Node[];
  const last = props.at(-1);
  const propText = (indent: string) => `${JSON.stringify(key)}: ${render(value, indent, style)}`;
  if (!last) {
    const parentIndent = lineIndent(text, obj.offset);
    const open = obj.offset + 1;
    const close = obj.offset + obj.length - 1;
    const body = `${style.eol}${parentIndent}${style.unit}${propText(parentIndent + style.unit)}`;
    const empty = text.slice(open, close).trim() === '';
    return applyTextEdits(text, [
      {
        offset: open,
        length: empty ? close - open : 0,
        content: empty ? body + style.eol + parentIndent : body,
      },
    ]);
  }
  const lastEnd = last.offset + last.length;
  const commaAt = skipBlanks(text, lastEnd);
  const comma = text[commaAt] === ',';
  const anchor = comma ? commaAt + 1 : lastEnd;
  const multiline = text.slice(obj.offset, obj.offset + obj.length).includes('\n');
  const edits: TextEdit[] = [];
  if (multiline) {
    const indent = lineIndent(text, last.offset);
    const lineEnd = lineEndOf(text, anchor);
    const trailing = /^[ \t]*(\/\/.*)?$/.test(text.slice(anchor, lineEnd));
    edits.push({
      offset: trailing ? lineEnd : anchor,
      length: 0,
      content: `${style.eol}${indent}${propText(indent)}${comma ? ',' : ''}`,
    });
  } else {
    edits.push({
      offset: anchor,
      length: 0,
      content: `${comma ? '' : ','} ${propText('')}${comma ? ',' : ''}`,
    });
  }
  if (multiline && !comma) edits.push({ offset: lastEnd, length: 0, content: ',' });
  return applyTextEdits(text, edits);
}

function removeProperty(text: string, props: readonly Node[], prop: Node): string {
  const end = prop.offset + prop.length;
  const commaAt = skipBlanks(text, end);
  const comma = text[commaAt] === ',';
  const after = comma ? commaAt + 1 : end;
  const lineStart = text.lastIndexOf('\n', prop.offset - 1) + 1;
  const lineEnd = lineEndOf(text, after);
  const ownLine =
    text.slice(lineStart, prop.offset).trim() === '' && text.slice(after, lineEnd).trim() === '';
  const edits: TextEdit[] = [];
  if (ownLine) {
    const eolLen = text.startsWith('\r\n', lineEnd) ? 2 : 1;
    edits.push({ offset: lineStart, length: lineEnd + eolLen - lineStart, content: '' });
  } else {
    edits.push({ offset: prop.offset, length: skipBlanks(text, after) - prop.offset, content: '' });
  }
  const before = props[props.indexOf(prop) - 1];
  if (!comma && before) {
    const prevComma = skipBlanks(text, before.offset + before.length);
    if (text[prevComma] === ',') edits.push({ offset: prevComma, length: 1, content: '' });
  }
  return applyTextEdits(text, edits);
}

/**
 * Wendet einen Edit an und ändert nur die betroffene Stelle: Einrückung und Zeilenende
 * werden aus der Datei übernommen, ein Kommentar hinter der Vorgänger-Property bleibt dort.
 */
function applyConfigEdit(text: string, path: readonly (string | number)[], value: unknown): string {
  const style = detectStyle(text);
  let node = parseTree(text, [], { allowTrailingComma: true });
  for (const [i, segment] of path.entries()) {
    if (node?.type !== 'object' || typeof segment !== 'string') break;
    const props = node.children as Node[];
    // Bei doppeltem Key gilt wie beim Parsen das letzte Vorkommen.
    const index = props.findLastIndex((p) => p.children?.[0]?.value === segment);
    const prop = props[index];
    const rest = path.slice(i + 1);
    if (!prop) {
      if (value === undefined) return text;
      if (!rest.every((s) => typeof s === 'string')) break;
      const nested = rest.reduceRight<unknown>((acc, key) => ({ [key]: acc }), value);
      return insertProperty(text, node, segment, nested, style);
    }
    const child = prop.children?.[1] as Node;
    if (rest.length > 0) {
      node = child;
      continue;
    }
    if (value === undefined) return removeProperty(text, props, prop);
    const replacement = render(value, lineIndent(text, prop.offset), style);
    return applyTextEdits(text, [
      { offset: child.offset, length: child.length, content: replacement },
    ]);
  }
  // Pfad läuft durch einen Nicht-Objekt-Wert oder enthält Indizes: Standardpfad ohne Formatierung.
  try {
    return applyEdits(text, modify(text, [...path], value, {}));
  } catch {
    throw new BackeError(
      'validation',
      `Config-Pfad "${path.join('.')}" läuft durch einen Wert, der kein Objekt ist`,
    );
  }
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
  return withFileLock(configLockPath(backeHome), async () => {
    const file = userConfigPath(backeHome);
    const text = (await readText(file)) ?? '{}\n';
    const current = parseUserConfig(text, file);
    const edits = edit(current);
    if (edits.length === 0) return current;
    let next = text;
    for (const { path, value } of edits) next = applyConfigEdit(next, path, value);
    const updated = parseUserConfig(next, file);
    await writeFileAtomic(file, next);
    return updated;
  });
}

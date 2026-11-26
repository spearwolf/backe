/**
 * Die reine Hülle (ui.md §2.2): alle Module, die das Web-Bundle aus `src/` importieren darf, samt
 * ihrer transitiven Laufzeit-Imports. Typ-Importe zählen nicht, sie verschwinden beim Bauen.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');

/** Einstiegspunkte des Web-Bundles in `src/`. */
export const WEB_ENTRIES: readonly string[] = [
  'src/ops/graph.ts',
  'src/ops/issue-query.ts',
  'src/core/schemas.ts',
  'src/core/state.ts',
  'src/core/ids.ts',
  'src/i18n/catalog.ts',
  'src/ui/api.ts',
];

/** Nackte Imports, die das Web-Bundle mitbringen darf. */
const ALLOWED_PACKAGES = new Set(['zod']);

export type ClosureFile = { imports: string[]; text: string };

/** `import`/`export … from` und `import '…'`, auch mehrzeilig; ohne `import type`/`export type`. */
const IMPORT_RE = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;

export function runtimeImports(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    if (m[1] === undefined && m[2] !== undefined) found.push(m[2]);
  }
  return found;
}

/** Entfernt Block- und Zeilenkommentare, damit Doku-Kommentare nicht zählen. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
}

/** Verstöße einer Datei gegen die Reinheitsregel, je `datei: was`. */
export function webOffenses(rel: string, f: ClosureFile): string[] {
  const hits = f.imports
    .filter((s) => s.startsWith('node:') || (!s.startsWith('.') && !ALLOWED_PACKAGES.has(s)))
    .map((s) => `${rel}: import ${s}`);
  // Modulnamen wie `'node:process'` sind keine Verwendung; die Imports prüft die Liste oben.
  const code = stripComments(f.text).replace(IMPORT_RE, '');
  if (/\bBuffer\b/.test(code)) hits.push(`${rel}: Buffer`);
  // `process` nur als `globalThis.process?.…`: Im Browser fehlt es, ein ungeschützter Zugriff wirft.
  if (/(?<!globalThis\.)\bprocess\b|\bglobalThis\.process(?!\?\.)/.test(code)) {
    hits.push(`${rel}: process`);
  }
  return hits;
}

/** Transitive Hülle der Einstiegspunkte; Schlüssel sind Pfade relativ zum Repo. */
export async function webClosure(entries: readonly string[]): Promise<Map<string, ClosureFile>> {
  const files = new Map<string, ClosureFile>();
  const visit = async (abs: string): Promise<void> => {
    const rel = relative(ROOT, abs);
    if (files.has(rel)) return;
    const text = await readFile(abs, 'utf8');
    const imports = runtimeImports(text);
    files.set(rel, { imports, text });
    for (const spec of imports) {
      if (spec.startsWith('.')) await visit(resolve(dirname(abs), spec));
    }
  };
  for (const entry of entries) await visit(join(ROOT, entry));
  return files;
}

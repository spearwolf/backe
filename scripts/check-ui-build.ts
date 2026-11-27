/**
 * Prüft den gebauten Client in `dist/ui/` gegen die Regeln, die der Server voraussetzt: Die CSP
 * verbietet Inline-Skripte, `theme.js` muss vor dem ersten Stylesheet und Modul-Skript laufen
 * (sonst blitzt das falsche Theme auf), und der initiale Chunk bleibt im Budget von 300 KB gzip.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { argv, stderr } from 'node:process';
import { gzipSync } from 'node:zlib';

/** Budget des initialen Chunks: Einstiegs-Skript samt Modulepreloads, gzip Level 9. */
export const INITIAL_CHUNK_BUDGET = 307_200;

type Tag = { name: 'script' | 'link'; attrs: Map<string, string>; body: string; at: number };

const TAG_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<link\b([^>]*)>/gi;
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(text: string): Map<string, string> {
  const attrs = new Map<string, string>();
  for (const m of text.matchAll(ATTR_RE)) {
    if (m[1] !== undefined) attrs.set(m[1].toLowerCase(), m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

function tags(html: string): Tag[] {
  return [...html.matchAll(TAG_RE)].map((m) =>
    m[3] === undefined
      ? { name: 'script', attrs: parseAttrs(m[1] ?? ''), body: m[2] ?? '', at: m.index }
      : { name: 'link', attrs: parseAttrs(m[3]), body: '', at: m.index },
  );
}

const rels = (t: Tag): string[] => (t.attrs.get('rel') ?? '').toLowerCase().split(/\s+/);
const isModule = (t: Tag): boolean => t.name === 'script' && t.attrs.get('type') === 'module';
const isStylesheet = (t: Tag): boolean => t.name === 'link' && rels(t).includes('stylesheet');
const isPreload = (t: Tag): boolean => t.name === 'link' && rels(t).includes('modulepreload');

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Verstöße des Builds in `dir`; leer heißt: gut. */
export async function checkUiBuild(dir: string): Promise<string[]> {
  const index = join(dir, 'index.html');
  if (!(await exists(index))) return [`${index} is missing`];
  const all = tags(await readFile(index, 'utf8'));
  const problems: string[] = [];

  const scripts = all.filter((t) => t.name === 'script');
  for (const s of scripts) {
    if (!s.attrs.has('src') || s.body.trim() !== '') {
      problems.push('index.html has an inline script; the CSP blocks it');
    }
  }

  const theme = scripts[0];
  if (theme === undefined || theme.attrs.get('src') !== '/theme.js') {
    problems.push('the first script in index.html must be <script src="/theme.js">');
  } else {
    if (isModule(theme) || theme.attrs.has('async') || theme.attrs.has('defer')) {
      problems.push('<script src="/theme.js"> must be a blocking classic script');
    }
    const early = all.find((t) => t.at < theme.at && (isStylesheet(t) || isModule(t)));
    if (early !== undefined) {
      problems.push('a stylesheet or module script comes before <script src="/theme.js">');
    }
  }
  if (!(await exists(join(dir, 'theme.js')))) problems.push('theme.js is missing');
  if (!(await exists(join(dir, 'favicon.svg')))) problems.push('favicon.svg is missing');

  const initial = new Set([
    ...scripts.filter(isModule).flatMap((t) => t.attrs.get('src') ?? []),
    ...all.filter(isPreload).flatMap((t) => t.attrs.get('href') ?? []),
  ]);
  let gzipped = 0;
  for (const url of initial) {
    const path = join(dir, url.replace(/^\//, ''));
    if (await exists(path)) {
      gzipped += gzipSync(await readFile(path), { level: 9 }).length;
    } else {
      problems.push(`${url} is referenced by index.html but missing`);
    }
  }
  if (gzipped > INITIAL_CHUNK_BUDGET) {
    problems.push(
      `the initial chunk is ${gzipped} bytes gzip, over the budget of ${INITIAL_CHUNK_BUDGET}`,
    );
  }
  return problems;
}

if (import.meta.main) {
  const dir = argv[2] ?? join(import.meta.dirname, '..', 'dist', 'ui');
  const problems = await checkUiBuild(dir);
  for (const p of problems) stderr.write(`check-ui-build: ${p}\n`);
  if (problems.length > 0) process.exitCode = 1;
}

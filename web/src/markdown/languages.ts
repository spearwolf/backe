import type { LanguageFn } from 'highlight.js';

type Loader = () => Promise<{ default: LanguageFn }>;

/** Kanonischer Name (so registriert ihn lowlight) → Loader und Aliasse. */
const DEFINITIONS: Record<string, { load: Loader; aliases: string[] }> = {
  bash: { load: () => import('highlight.js/lib/languages/bash'), aliases: ['sh', 'shell', 'zsh'] },
  css: { load: () => import('highlight.js/lib/languages/css'), aliases: [] },
  diff: { load: () => import('highlight.js/lib/languages/diff'), aliases: ['patch'] },
  dockerfile: {
    load: () => import('highlight.js/lib/languages/dockerfile'),
    aliases: ['docker'],
  },
  go: { load: () => import('highlight.js/lib/languages/go'), aliases: ['golang'] },
  xml: {
    load: () => import('highlight.js/lib/languages/xml'),
    aliases: ['html', 'svg', 'xhtml'],
  },
  ini: { load: () => import('highlight.js/lib/languages/ini'), aliases: ['toml'] },
  java: { load: () => import('highlight.js/lib/languages/java'), aliases: [] },
  javascript: {
    load: () => import('highlight.js/lib/languages/javascript'),
    aliases: ['js', 'jsx', 'mjs', 'cjs'],
  },
  json: { load: () => import('highlight.js/lib/languages/json'), aliases: ['jsonc'] },
  markdown: { load: () => import('highlight.js/lib/languages/markdown'), aliases: ['md'] },
  python: { load: () => import('highlight.js/lib/languages/python'), aliases: ['py'] },
  rust: { load: () => import('highlight.js/lib/languages/rust'), aliases: ['rs'] },
  sql: { load: () => import('highlight.js/lib/languages/sql'), aliases: [] },
  typescript: {
    load: () => import('highlight.js/lib/languages/typescript'),
    aliases: ['ts', 'tsx', 'mts', 'cts'],
  },
  yaml: { load: () => import('highlight.js/lib/languages/yaml'), aliases: ['yml'] },
};

const CANONICAL = new Map<string, string>();
const entries: [string, Loader][] = [];
for (const [name, { load, aliases }] of Object.entries(DEFINITIONS)) {
  for (const key of [name, ...aliases]) {
    CANONICAL.set(key, name);
    entries.push([key, load]);
  }
}

/** Je Sprache ein dynamischer Import (eigener Chunk); Aliasse zeigen auf denselben Loader. */
export const LANGUAGES: Readonly<Record<string, Loader>> = Object.freeze(
  Object.fromEntries(entries),
);

/** Kanonischer Sprachname zu Name oder Dateiendung (`ts` → `typescript`), sonst `undefined`. */
export function languageOf(nameOrExtension: string): string | undefined {
  return CANONICAL.get(nameOrExtension.trim().toLowerCase().replace(/^\./, ''));
}

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');
const STRAIGHT_QUOTED_VALUE = /"\$\{[^}]+\}"/;

/** Dateien, in denen `"${…}"` gewollt ist, mit dem Grund. */
const ALLOWED: Record<string, string> = {
  'store/frontmatter.ts':
    'der Hinweis zeigt buchstäblich, wie ein Zahlenwert in YAML mit Anführungszeichen zu schreiben ist',
};

async function sources(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await sources(path)));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) found.push(path);
  }
  return found;
}

test('messages quote values with »…«, not "…"', async () => {
  const hits: string[] = [];
  for (const file of await sources(SRC)) {
    const rel = file.slice(SRC.length + 1);
    if (rel in ALLOWED) continue;
    const lines = (await readFile(file, 'utf8')).split('\n');
    for (const [i, line] of lines.entries()) {
      if (STRAIGHT_QUOTED_VALUE.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
    }
  }
  expect(hits).toEqual([]);
});

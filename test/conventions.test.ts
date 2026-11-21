import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');
/**
 * Grenze des Tests: Er sucht zeilenweise nach einem einzeiligen `"${…}"`. Ein Wert, der über
 * mehrere Zeilen läuft, oder gerade Anführungszeichen um etwas anderes als eine Interpolation
 * (etwa eine Konstante) bleiben ungeprüft.
 */
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

const GOLDEN = join(import.meta.dirname, 'e2e', 'golden');
const CAMEL_CASE = /[a-z][A-Z]/;

/** Pfade aller Objekt-Keys in `value`, die camelCase sind (`user.canWrite`). */
function camelKeys(value: unknown, at: string): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => camelKeys(v, `${at}[${i}]`));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [
    ...(CAMEL_CASE.test(k) ? [`${at}.${k}`] : []),
    ...camelKeys(v, `${at}.${k}`),
  ]);
}

test('CLI JSON keys are snake_case in every golden file', async () => {
  const files = (await readdir(GOLDEN)).filter((f) => f.endsWith('.json'));
  expect(files.length).toBeGreaterThan(0);
  const hits: string[] = [];
  for (const file of files) {
    const text = await readFile(join(GOLDEN, file), 'utf8');
    for (const line of text.split('\n').filter((l) => l.trim() !== '')) {
      hits.push(...camelKeys(JSON.parse(line), file));
    }
  }
  expect(hits).toEqual([]);
});

/** Schichten unter den Adaptern und der MCP-Adapter selbst: stdout gehört dort dem Protokoll. */
const QUIET_LAYERS = ['core', 'store', 'context', 'git', 'ops', 'services', 'mcp'];
const STDOUT_WRITE = /process\.stdout|console\.(log|info|debug)/;

test('no layer below the adapters writes to stdout', async () => {
  const hits: string[] = [];
  for (const layer of QUIET_LAYERS) {
    for (const file of await sources(join(SRC, layer))) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      for (const [i, line] of lines.entries()) {
        if (STDOUT_WRITE.test(line))
          hits.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  expect(hits).toEqual([]);
});

test('flag names are not quoted', async () => {
  const hits: string[] = [];
  for (const file of await sources(SRC)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    for (const [i, line] of lines.entries()) {
      if (line.includes('»--')) hits.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
    }
  }
  expect(hits).toEqual([]);
});

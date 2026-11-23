import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findGermanLiterals } from './helpers/german-literals.ts';

const SRC = join(import.meta.dirname, '..', 'src');
/**
 * Grenze des Tests: Er sucht zeilenweise nach einem einzeiligen `"${…}"`. Ein Wert, der über
 * mehrere Zeilen läuft, oder gerade Anführungszeichen um etwas anderes als eine Interpolation
 * (etwa eine Konstante) bleiben ungeprüft.
 */
const STRAIGHT_QUOTED_VALUE = /"\$\{[^}]+\}"/;

/** Dateien, in denen `"${…}"` gewollt ist, mit dem Grund. */
const ALLOWED: Record<string, string> = {
  'store/frontmatter.messages.ts':
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
/** Zeilenweise: `process.stdout` und jede `console`-Methode, die nach stdout schreibt. */
const STDOUT_WRITE =
  /process\.stdout|console\.(log|info|debug|dir|dirxml|table|group|groupCollapsed|count|timeLog|timeEnd)\b/;
/** Über die ganze Datei, auch mehrzeilig: `stdout` aus `node:process` importiert. */
const STDOUT_IMPORT = /import\s*\{[^}]*\bstdout\b[^}]*\}\s*from\s*['"](node:)?process['"]/;

/** Fundstellen in einer Quelldatei, je `datei:zeile: text`. */
function stdoutWrites(rel: string, text: string): string[] {
  const hits: string[] = [];
  const lines = text.split('\n');
  for (const [i, line] of lines.entries()) {
    if (STDOUT_WRITE.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
  }
  const imported = STDOUT_IMPORT.exec(text);
  if (imported !== null) {
    const line = text.slice(0, imported.index).split('\n').length;
    hits.push(`${rel}:${line}: ${imported[0].replace(/\s+/g, ' ')}`);
  }
  return hits;
}

test('the stdout check catches every form it names', () => {
  const caught = [
    'process.stdout.write(x);',
    'console.log(x);',
    'console.dir(x);',
    'console.table(rows);',
    "import { stdout } from 'node:process';",
    "import { argv, stdout as out } from 'process';",
    "import {\n  env,\n  stdout,\n} from 'node:process';",
  ];
  for (const text of caught) expect(stdoutWrites('x.ts', text), text).toHaveLength(1);
  const allowed = [
    'console.error(x);',
    'console.warn(x);',
    "import { stderr } from 'node:process';",
    "import { stdout } from './io.ts';",
  ];
  for (const text of allowed) expect(stdoutWrites('x.ts', text), text).toEqual([]);
});

test('no layer below the adapters writes to stdout', async () => {
  const hits: string[] = [];
  for (const layer of QUIET_LAYERS) {
    for (const file of await sources(join(SRC, layer))) {
      hits.push(...stdoutWrites(file.slice(SRC.length + 1), await readFile(file, 'utf8')));
    }
  }
  expect(hits).toEqual([]);
});

test('flag names are not quoted', async () => {
  const hits: string[] = [];
  for (const file of await sources(SRC)) {
    const lines = (await readFile(file, 'utf8')).split('\n');
    for (const [i, line] of lines.entries()) {
      // Deutsch »--x«, Englisch '--x' (nur in Katalogen; im Code sind '--x' gewöhnliche Literale).
      // Ein Text, der mit einem Flag beginnt (`'--force gehört zu --purge'`), zitiert es nicht:
      // gesucht ist das Flag direkt zwischen den Anführungszeichen.
      const quoted =
        line.includes('»--') || (file.endsWith('.messages.ts') && /'--[\w-]+'/.test(line));
      if (quoted) hits.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
    }
  }
  expect(hits).toEqual([]);
});

/**
 * Bereiche, deren Texte noch nicht in Katalogen liegen (Pfadpräfixe relativ zu `src/`). Jeder
 * migrierte Bereich fällt heraus; danach entfällt die Liste.
 */
const PENDING = ['mcp/', 'services/commit.ts'];

/** Dateien mit gewolltem deutschen Text außerhalb eines Katalogs, mit dem Grund. */
const GERMAN_ALLOWED: Record<string, string> = {
  'ops/delete-op.ts':
    'der Text des Transition-Kommentars ist Backlog-Inhalt, kein Ausgabetext: er steht in der Datei und muss beim Replay auf jedem Rechner gleich entstehen, egal in welcher Sprache der Akteur arbeitet',
};

test('the German-literal check ignores comments and catches literals', () => {
  const text = [
    '// Datei fehlt',
    '/** Zeile',
    ' * nicht */',
    "const a = 'ok'; // ungültig",
    'throw new Error(`Datei fehlt`);',
    "const b = 'Grüße';",
    "const url = 'https://example.org'; const c = 'keine';",
  ].join('\n');
  expect(findGermanLiterals('x.ts', text)).toEqual([
    'x.ts:5: throw new Error(`Datei fehlt`);',
    "x.ts:6: const b = 'Grüße';",
    "x.ts:7: const url = 'https://example.org'; const c = 'keine';",
  ]);
});

test('user-facing literals live in *.messages.ts', async () => {
  const hits: string[] = [];
  for (const file of await sources(SRC)) {
    const rel = file.slice(SRC.length + 1);
    if (rel.endsWith('.messages.ts') || rel.startsWith('i18n/') || rel in GERMAN_ALLOWED) continue;
    if (PENDING.some((prefix) => rel.startsWith(prefix))) continue;
    hits.push(...findGermanLiterals(rel, await readFile(file, 'utf8')));
  }
  expect(hits).toEqual([]);
});

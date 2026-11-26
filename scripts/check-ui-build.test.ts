import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkUiBuild } from './check-ui-build.ts';

const THEME = '<script src="/theme.js"></script>';
const STYLE = '<link rel="stylesheet" crossorigin href="/assets/index.css">';
const ENTRY = '<script type="module" crossorigin src="/assets/index.js"></script>';
const PRELOAD = '<link rel="modulepreload" crossorigin href="/assets/vendor.js">';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'backe-ui-build-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Schreibt einen Build wie den von Vite: `head` sind die Tags im `<head>`, in dieser Reihenfolge. */
async function writeBuild(
  head: string[],
  assets: Record<string, string | Buffer> = {},
): Promise<void> {
  await mkdir(join(dir, 'assets'));
  const html = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    ...head,
    '</head>',
    '<body><div id="root"></div></body>',
    '</html>',
  ].join('\n');
  await writeFile(join(dir, 'index.html'), html);
  await writeFile(join(dir, 'theme.js'), '(() => {})();\n');
  const files = { 'index.js': 'console.log(1);', 'index.css': 'body{}', ...assets };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, 'assets', name), content);
  }
}

test('a proper build passes', async () => {
  await writeBuild([THEME, ENTRY, PRELOAD, STYLE], { 'vendor.js': 'export {};' });
  expect(await checkUiBuild(dir)).toEqual([]);
});

test('check-ui-build rejects a missing index.html or theme.js', async () => {
  expect(await checkUiBuild(dir)).toHaveLength(1);
  await writeBuild([THEME, ENTRY, STYLE]);
  await rm(join(dir, 'theme.js'));
  expect(await checkUiBuild(dir)).toHaveLength(1);
});

test('check-ui-build rejects an inline script', async () => {
  await writeBuild([THEME, '<script>document.title = "x";</script>', ENTRY, STYLE]);
  expect(await checkUiBuild(dir)).toHaveLength(1);
});

test('check-ui-build rejects a stylesheet before theme.js', async () => {
  await writeBuild([STYLE, THEME, ENTRY]);
  expect(await checkUiBuild(dir)).toHaveLength(1);
});

test('check-ui-build rejects a module script before theme.js', async () => {
  await writeBuild([ENTRY, THEME, STYLE]);
  expect(await checkUiBuild(dir)).not.toEqual([]);
});

test('check-ui-build rejects a theme.js that does not block', async () => {
  for (const attr of ['type="module"', 'async', 'defer']) {
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir);
    await writeBuild([`<script ${attr} src="/theme.js"></script>`, ENTRY, STYLE]);
    expect(await checkUiBuild(dir), attr).not.toEqual([]);
  }
});

test('check-ui-build rejects an initial chunk over budget', async () => {
  await writeBuild([THEME, ENTRY, STYLE], { 'index.js': randomBytes(307_201) });
  expect(await checkUiBuild(dir)).toHaveLength(1);
});

test('check-ui-build counts modulepreload chunks into the budget', async () => {
  await writeBuild([THEME, ENTRY, PRELOAD, STYLE], {
    'index.js': randomBytes(160_000),
    'vendor.js': randomBytes(160_000),
  });
  expect(await checkUiBuild(dir)).toHaveLength(1);
});

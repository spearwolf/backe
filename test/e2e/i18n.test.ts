/**
 * Ausgabesprache des echten Prozesses (backe.md §2.18): Englisch ohne Locale, Deutsch bei `de`,
 * `BACKE_LANG` vor `LANG`. Das Kind-Env setzt `BACKE_LANG` ausdrücklich, damit die deutsche
 * Vorgabe der Testsuite nicht durchschlägt.
 */
import type { Env } from '../../src/context/paths.ts';
import { findGermanLiterals } from '../helpers/german-literals.ts';
import { testBacklog } from '../helpers/git.ts';
import { cli } from './cli.ts';

async function run(args: string[], lang: Env) {
  const b = await testBacklog();
  return cli(args, { env: { ...b.env, BACKE_USER: 'spw', NO_COLOR: '1', ...lang }, cwd: b.root });
}

/** Text wie ein Literal, damit `findGermanLiterals` ihn Zeile für Zeile prüft. */
const asLiterals = (text: string): string =>
  text
    .split('\n')
    .map((line) => `'${line}'`)
    .join('\n');

test('without a locale, help and errors are English', async () => {
  const help = await run(['--help'], { BACKE_LANG: '' });
  expect(help.code).toBe(0);
  expect(help.stdout).toContain('Usage:');
  expect(help.stdout).toContain('Quick start:');
  expect(findGermanLiterals('help', asLiterals(help.stdout))).toEqual([]);

  const missing = await run(['show', 'bk-zzzzz'], { BACKE_LANG: '' });
  expect(missing.code).toBe(3);
  expect(missing.stderr).toMatch(/^Error: /);
  expect(findGermanLiterals('stderr', asLiterals(missing.stderr))).toEqual([]);

  const format = await run(['ls', '--format', 'xml'], { BACKE_LANG: '' });
  expect(format.stderr).toBe(
    "Error: Unknown output format 'xml' (source: --format)\nHint: text, json or md\n",
  );
});

test('LANG=de_DE.UTF-8 switches help and errors to German', async () => {
  const help = await run(['--help'], { BACKE_LANG: '', LANG: 'de_DE.UTF-8' });
  expect(help.stdout).toContain('Aufruf:');
  expect(help.stdout).toContain('Schnellstart:');
  const missing = await run(['show', 'bk-zzzzz'], { BACKE_LANG: '', LANG: 'de_DE.UTF-8' });
  expect(missing.stderr).toMatch(/^Fehler: /);
});

test('BACKE_LANG wins over LANG', async () => {
  const help = await run(['--help'], { BACKE_LANG: 'en', LANG: 'de_DE.UTF-8' });
  expect(help.stdout).toContain('Quick start:');
  expect(help.stdout).not.toContain('Schnellstart:');
});

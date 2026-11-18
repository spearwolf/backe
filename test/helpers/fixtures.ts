import { readFileSync } from 'node:fs';

/** Liest eine Datei aus `test/fixtures/` als UTF-8-Text. */
export function readFixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

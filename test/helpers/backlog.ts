import { cp, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'vitest';

/** Absoluter Pfad einer Fixture unter `test/fixtures/`. */
export function fixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * Leeres Temp-Verzeichnis (realpath), das nach dem Test entfernt wird. Physisch, weil backe
 * Arbeitskopien über das Git-Toplevel auflöst; auf macOS ist `tmpdir()` ein Symlink-Pfad.
 */
export async function tempDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'backe-test-')));
  tempDirs.push(dir);
  return dir;
}

/** Kopiert eine Fixture in ein frisches Temp-Verzeichnis (Aufräumen nach dem Test) und gibt es zurück. */
export async function copyFixture(name: string): Promise<string> {
  const dir = await tempDir();
  await cp(fixture(name), dir, { recursive: true });
  return dir;
}

/**
 * Lädt Lazy-Chunks, bevor die Tests einer Datei laufen. `React.lazy` und die Loader der
 * Hervorhebung lösen danach in Mikrotasks auf, statt auf ein erstes `import()` durch den Transform
 * von Vitest zu warten; das dauert auf langsamen Runnern länger als die Frist von `waitFor` und
 * `findBy`. Tests, die das Nachladen selbst prüfen, halten ihr Modul hinter einem Tor im Mock und
 * laden hier nur das Original vor (`vi.importActual`); der Mock zählt dann weiter jede Anforderung.
 */
import { beforeAll } from 'vitest';

export function preload(...loaders: (() => Promise<unknown>)[]): void {
  beforeAll(async () => {
    await Promise.all(loaders.map((load) => load()));
  });
}

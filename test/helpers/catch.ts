import { BackeError } from '../../src/core/errors.ts';

/** Ruft `fn` auf und gibt die geworfene BackeError zurück; scheitert, wenn nichts oder etwas anderes fliegt. */
export function catchErr(fn: () => unknown): BackeError {
  try {
    fn();
  } catch (err) {
    if (err instanceof BackeError) return err;
    throw new Error(`expected BackeError, got ${String(err)}`);
  }
  throw new Error('expected function to throw a BackeError, but it did not throw');
}

/** Wie `catchErr`, für asynchrone Funktionen. */
export async function catchErrAsync(fn: () => Promise<unknown>): Promise<BackeError> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof BackeError) return err;
    throw new Error(`expected BackeError, got ${String(err)}`);
  }
  throw new Error('expected function to throw a BackeError, but it did not throw');
}

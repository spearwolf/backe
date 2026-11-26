import { useEffect, useState } from 'react';

/**
 * Ein Objekt mit `dispose` je Schlüssel: entsteht, wenn der Schlüssel kommt, und geht, wenn er
 * wechselt oder die Komponente abbaut. Bis das neue steht, liefert der Hook `undefined`, nie das
 * alte eines anderen Schlüssels.
 */
export function useOwned<T extends { dispose(): void }>(
  key: string | undefined,
  create: (key: string) => T,
): T | undefined {
  const [owned, setOwned] = useState<{ key: string; value: T }>();
  useEffect(() => {
    if (key === undefined) return;
    const value = create(key);
    setOwned({ key, value });
    return () => {
      value.dispose();
      setOwned((cur) => (cur?.value === value ? undefined : cur));
    };
  }, [key, create]);
  return owned !== undefined && owned.key === key ? owned.value : undefined;
}

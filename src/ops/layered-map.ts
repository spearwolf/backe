/**
 * Unveränderliche Sicht auf eine Basis-Map plus Änderungen, ohne die Basis zu kopieren: Ein
 * Draft gibt nach jeder Änderung eine neue Sicht aus und zahlt dafür nur die Zahl seiner
 * Änderungen, nicht die Größe des Backlogs (backe.md §2.16.6, Batch-Tempo).
 */

/**
 * `changes` hält je Schlüssel den neuen Wert, `undefined` heißt entfernt. Die Iteration folgt
 * der Reihenfolge der Basis, ersetzte Werte an ihrem Platz; kommen neue Schlüssel hinzu, ist das
 * Ganze nach Schlüssel sortiert — genau wie die Maps, die `loadSnapshot` liefert. Die Liste wird
 * erst bei der ersten Iteration gebaut und dann behalten. Schreibende Methoden werfen.
 */
export class LayeredMap<V> implements Map<string, V> {
  readonly base: ReadonlyMap<string, V>;
  readonly changes: ReadonlyMap<string, V | undefined>;
  readonly size: number;
  readonly #added: boolean;
  #entries: [string, V][] | undefined;

  constructor(base: ReadonlyMap<string, V>, changes: ReadonlyMap<string, V | undefined>) {
    this.base = base;
    this.changes = changes;
    let size = base.size;
    let added = false;
    for (const [key, value] of changes) {
      const known = base.has(key);
      if (value === undefined && known) size--;
      if (value !== undefined && !known) {
        size++;
        added = true;
      }
    }
    this.size = size;
    this.#added = added;
  }

  get [Symbol.toStringTag](): string {
    return 'LayeredMap';
  }

  get(key: string): V | undefined {
    return this.changes.has(key) ? this.changes.get(key) : this.base.get(key);
  }

  has(key: string): boolean {
    return this.changes.has(key) ? this.changes.get(key) !== undefined : this.base.has(key);
  }

  forEach(fn: (value: V, key: string, map: Map<string, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.#list()) fn.call(thisArg, value, key, this);
  }

  *entries(): MapIterator<[string, V]> {
    for (const [key, value] of this.#list()) yield [key, value];
  }

  *keys(): MapIterator<string> {
    for (const [key] of this.#list()) yield key;
  }

  *values(): MapIterator<V> {
    for (const [, value] of this.#list()) yield value;
  }

  [Symbol.iterator](): MapIterator<[string, V]> {
    return this.entries();
  }

  set(): this {
    throw new TypeError('LayeredMap ist unveränderlich');
  }

  delete(): boolean {
    throw new TypeError('LayeredMap ist unveränderlich');
  }

  clear(): void {
    throw new TypeError('LayeredMap ist unveränderlich');
  }

  #list(): [string, V][] {
    if (this.#entries !== undefined) return this.#entries;
    const list: [string, V][] = [];
    for (const [key, value] of this.base) {
      if (!this.changes.has(key)) list.push([key, value]);
      else {
        const now = this.changes.get(key);
        if (now !== undefined) list.push([key, now]);
      }
    }
    if (this.#added) {
      for (const [key, value] of this.changes) {
        if (value !== undefined && !this.base.has(key)) list.push([key, value]);
      }
      // Die Basis ist ein sortierter Lauf; die Sortierung fügt im Wesentlichen den Rest ein.
      list.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    }
    this.#entries = list;
    return list;
  }
}

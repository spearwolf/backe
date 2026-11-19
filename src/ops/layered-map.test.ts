import { LayeredMap } from './layered-map.ts';

describe('LayeredMap', () => {
  const base = new Map([
    ['b', 2],
    ['d', 4],
    ['f', 6],
  ]);

  test('reads replaced, removed and added keys through the changes', () => {
    const m = new LayeredMap(
      base,
      new Map<string, number | undefined>([
        ['d', 40],
        ['f', undefined],
        ['a', 1],
        ['x', undefined],
      ]),
    );
    expect([m.get('b'), m.get('d'), m.get('f'), m.get('a'), m.get('x')]).toEqual([
      2,
      40,
      undefined,
      1,
      undefined,
    ]);
    expect([m.has('b'), m.has('f'), m.has('a'), m.has('x'), m.size]).toEqual([
      true,
      false,
      true,
      false,
      3,
    ]);
    expect([...m]).toEqual([
      ['a', 1],
      ['b', 2],
      ['d', 40],
    ]);
    expect([...base.keys()]).toEqual(['b', 'd', 'f']);
  });

  test('keeps the order of the base when no key is added', () => {
    const unsorted = new Map([
      ['z', 1],
      ['a', 2],
    ]);
    const m = new LayeredMap(unsorted, new Map([['z', 10]]));
    expect([...m.keys()]).toEqual(['z', 'a']);
    expect([...m.values()]).toEqual([10, 2]);
  });

  test('offers the read side of a Map and refuses writes', () => {
    const m = new LayeredMap(base, new Map([['c', 3]]));
    const seen: string[] = [];
    m.forEach(function (this: unknown, value, key, map) {
      seen.push(`${key}=${value}:${map === m}:${this === seen}`);
    }, seen);
    expect(seen).toEqual(['b=2:true:true', 'c=3:true:true', 'd=4:true:true', 'f=6:true:true']);
    expect([...m.entries()]).toEqual([...new Map(m)]);
    expect(Object.prototype.toString.call(m)).toBe('[object LayeredMap]');
    expect(() => m.set()).toThrow(TypeError);
    expect(() => m.delete()).toThrow(TypeError);
    expect(() => m.clear()).toThrow(TypeError);
  });
});

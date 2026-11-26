import { readJson, readText, writeJson, writeText } from './storage.ts';

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

/** Lässt jeden Zugriff auf `localStorage` werfen, wie bei gesperrtem Speicher. */
function blockStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('denied', 'SecurityError');
    },
  });
}

afterEach(() => {
  if (original !== undefined) Object.defineProperty(globalThis, 'localStorage', original);
  localStorage.clear();
  vi.restoreAllMocks();
});

test('values round-trip through the storage', () => {
  writeJson('tabs', ['BCK-1', 'BCK-2']);
  expect(readJson('tabs', [], isStrings)).toEqual(['BCK-1', 'BCK-2']);
  writeText('theme', 'dark');
  expect(readText('theme')).toBe('dark');
  expect(readText('missing')).toBeUndefined();
  expect(readJson('missing', ['x'], isStrings)).toEqual(['x']);
});

test('a throwing storage yields the fallback', () => {
  localStorage.setItem('tabs', '["BCK-1"]');
  blockStorage();
  expect(readJson('tabs', [], isStrings)).toEqual([]);
  expect(readText('tabs')).toBeUndefined();
});

test('broken json yields the fallback', () => {
  localStorage.setItem('tabs', '["BCK-1"');
  expect(readJson('tabs', ['fallback'], isStrings)).toEqual(['fallback']);
});

test('a value failing the guard yields the fallback', () => {
  localStorage.setItem('tabs', '[1, 2]');
  expect(readJson('tabs', [], isStrings)).toEqual([]);
  localStorage.setItem('tabs', 'null');
  expect(readJson('tabs', [], isStrings)).toEqual([]);
});

test('writes survive a throwing storage', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError');
  });
  expect(() => writeJson('tabs', ['BCK-1'])).not.toThrow();
  expect(() => writeText('theme', 'dark')).not.toThrow();
  vi.restoreAllMocks();
  blockStorage();
  expect(() => writeJson('tabs', ['BCK-1'])).not.toThrow();
  expect(() => writeText('theme', 'dark')).not.toThrow();
});

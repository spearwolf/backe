import { setLocale } from '@backe/i18n/locale.ts';
import { formatBytes, formatDate } from './format.ts';

afterEach(() => setLocale('de'));

test('format bytes and dates in both languages', () => {
  setLocale('en');
  expect(formatBytes(1536)).toBe('1.5 KiB');
  expect(formatDate('2026-11-18T10:00:00Z')).toMatch(/Nov 18, 2026/);
  setLocale('de');
  expect(formatBytes(1536)).toBe('1,5 KiB');
  expect(formatDate('2026-11-18T10:00:00Z')).toMatch(/18\.11\.2026/);
});

test('bytes pick the unit by size', () => {
  setLocale('en');
  expect(formatBytes(0)).toBe('0 B');
  expect(formatBytes(1023)).toBe('1,023 B');
  expect(formatBytes(1024 * 1024)).toBe('1 MiB');
  expect(formatBytes(5 * 1024 ** 3)).toBe('5,120 MiB');
});

import { z } from 'zod';
import { catalog } from './catalog.ts';
import { initLocale, locale, localeFromEnv, setLocale } from './locale.ts';

afterEach(() => setLocale('de'));

test.each([
  [{}, 'en'],
  [{ LANG: 'de_DE.UTF-8' }, 'de'],
  [{ LANG: 'de' }, 'de'],
  [{ LANG: 'de-AT' }, 'de'],
  [{ LANG: 'de@euro' }, 'de'],
  [{ LANG: 'C' }, 'en'],
  [{ LANG: '' }, 'en'],
  [{ LANG: 'dense' }, 'en'],
  [{ LANG: 'en_US.UTF-8', LC_ALL: 'de_DE.UTF-8' }, 'de'],
  [{ LC_ALL: 'en_US.UTF-8', LANG: 'de_DE' }, 'en'],
  [{ LC_ALL: '', LANG: 'de_DE' }, 'de'],
  [{ LC_MESSAGES: 'de_AT', LANG: 'en' }, 'de'],
  [{ BACKE_LANG: 'en', LC_ALL: 'de_DE' }, 'en'],
  [{ BACKE_LANG: 'DE' }, 'de'],
])('localeFromEnv(%o) is %s', (env, want) => expect(localeFromEnv(env)).toBe(want));

test('initLocale sets the locale from the given environment', () => {
  expect(initLocale({ LANG: 'en_GB.UTF-8' })).toBe('en');
  expect(locale()).toBe('en');
  expect(initLocale({ LANG: 'de_DE.UTF-8' })).toBe('de');
  expect(locale()).toBe('de');
});

test('a catalog resolves its texts at access time', () => {
  const c = catalog({
    en: { hi: 'hi', named: (k: string) => `named '${k}'` },
    de: { hi: 'hallo', named: (k: string) => `benannt »${k}«` },
  });
  setLocale('en');
  expect(c.hi).toBe('hi');
  expect(c.named('x')).toBe("named 'x'");
  setLocale('de');
  expect(c.hi).toBe('hallo');
  expect(c.named('x')).toBe('benannt »x«');
});

test('zod default messages follow the locale', () => {
  setLocale('de');
  expect(z.string().safeParse(1).error?.issues[0]?.message).toMatch(/^Ungültige Eingabe/);
  setLocale('en');
  expect(z.string().safeParse(1).error?.issues[0]?.message).toMatch(/^Invalid input/);
});

test('locale falls back to en without process', () => {
  try {
    expect(initLocale({})).toBe('en');
  } finally {
    setLocale('de');
  }
});

import { locale, setLocale } from '@backe/i18n/locale.ts';
import { afterEach, expect, test } from 'vitest';
import { BOARD_GROUP_KEY, EXTERNAL_IMAGES_KEY, LANG_KEY, UiPrefs } from './ui-prefs.ts';

afterEach(() => {
  localStorage.clear();
  setLocale('en');
});

test('defaults follow the server and tolerate garbage', () => {
  localStorage.setItem(LANG_KEY, 'fr');
  localStorage.setItem(EXTERNAL_IMAGES_KEY, 'x');
  localStorage.setItem(BOARD_GROUP_KEY, 'foo');
  const root = document.createElement('html');
  const prefs = new UiPrefs('de', root);
  expect(prefs.serverLang).toBe('de');
  expect(prefs.langChoice.value).toBe('server');
  expect(prefs.lang()).toBe('de');
  expect(locale()).toBe('de');
  expect(root.lang).toBe('de');
  expect(prefs.externalImages.value).toBe(true);
  expect(prefs.boardGroup.value).toBe('sprint');
  prefs.dispose();
});

test('a language choice persists, sets the locale and the html lang', () => {
  const root = document.createElement('html');
  const prefs = new UiPrefs('en', root);
  expect(locale()).toBe('en');
  prefs.setLang('de');
  expect(prefs.langChoice.value).toBe('de');
  expect(prefs.lang()).toBe('de');
  expect(locale()).toBe('de');
  expect(root.lang).toBe('de');
  prefs.dispose();

  const again = new UiPrefs('en', root);
  expect(again.langChoice.value).toBe('de');
  expect(again.lang()).toBe('de');
  again.setLang('server');
  expect(again.lang()).toBe('en');
  expect(locale()).toBe('en');
  expect(root.lang).toBe('en');
  expect(localStorage.getItem(LANG_KEY) ?? '').toBe('');
  again.dispose();

  const third = new UiPrefs('de', root);
  expect(third.langChoice.value).toBe('server');
  expect(third.lang()).toBe('de');
  third.dispose();
});

test('the focus request is taken once', () => {
  const prefs = new UiPrefs('en', document.createElement('html'));
  expect(prefs.takeLangFocus()).toBe(false);
  prefs.setLang('de');
  expect(prefs.takeLangFocus()).toBe(true);
  expect(prefs.takeLangFocus()).toBe(false);
  prefs.dispose();
});

test('image and board settings persist', () => {
  const prefs = new UiPrefs('en', document.createElement('html'));
  prefs.setExternalImages(false);
  prefs.setBoardGroup('project');
  expect(prefs.externalImages.value).toBe(false);
  expect(prefs.boardGroup.value).toBe('project');
  prefs.dispose();

  const again = new UiPrefs('en', document.createElement('html'));
  expect(again.externalImages.value).toBe(false);
  expect(again.boardGroup.value).toBe('project');
  again.setExternalImages(true);
  again.dispose();
  expect(new UiPrefs('en', document.createElement('html')).externalImages.value).toBe(true);
});

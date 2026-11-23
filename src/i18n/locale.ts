/**
 * Ausgabesprache des Prozesses (backe.md §2.18): Englisch, außer die Umgebung verlangt Deutsch.
 * Die Sprache gilt prozessweit, weil Meldungen tief in Services entstehen, die keine Runtime
 * kennen; der MCP-Modus setzt sie fest auf Englisch.
 */
import { z } from 'zod';
import { type Env, envValue } from '../context/paths.ts';

export type Locale = 'en' | 'de';

/** In dieser Reihenfolge entscheidet der erste gesetzte, nicht leere Wert. */
const SOURCES = ['BACKE_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG'] as const;

const GERMAN = /^de(?:[_.@-]|$)/i;

let current: Locale | undefined;

/** Locale aus der Umgebung: `de`, wenn der maßgebliche Wert mit `de` beginnt, sonst `en`. */
export function localeFromEnv(env: Env): Locale {
  for (const name of SOURCES) {
    const value = envValue(env, name);
    if (value !== undefined) return GERMAN.test(value) ? 'de' : 'en';
  }
  return 'en';
}

/** Setzt die Prozess-Locale, auch für die Standardmeldungen von Zod. */
export function setLocale(l: Locale): void {
  current = l;
  z.config(z.locales[l]());
}

/** Bestimmt die Locale aus `env` und setzt sie. */
export function initLocale(env: Env = process.env): Locale {
  const l = localeFromEnv(env);
  setLocale(l);
  return l;
}

/** Aktuelle Locale; beim ersten Aufruf ohne `setLocale` aus `process.env`. */
export function locale(): Locale {
  return current ?? initLocale();
}

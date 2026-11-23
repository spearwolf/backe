/**
 * Zweisprachige Textkataloge. Eine Quelldatei `x.ts` hält ihre nutzersichtbaren Texte in
 * `x.messages.ts` als `export const m = catalog({ en: {…}, de: {…} })`. Der Typ von `de` folgt
 * `en`: fehlt ein Key oder weicht eine Signatur ab, scheitert der Typcheck.
 */
import { locale } from './locale.ts';

// biome-ignore lint/suspicious/noExplicitAny: Parameterlisten der Texte sind beliebig.
type Entry = string | ((...args: any[]) => string);

/**
 * Katalog, der bei jedem Zugriff den Text der aktuellen Locale liefert. So darf ein Modul ihn
 * beim Import anlegen, bevor die Locale feststeht.
 */
export function catalog<T extends Record<string, Entry>>(texts: {
  en: T;
  de: NoInfer<T>;
}): Readonly<T> {
  return new Proxy(texts.en, {
    get: (_target, key) => texts[locale()][key as keyof T],
  });
}

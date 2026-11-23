import { initLocale } from '../src/i18n/locale.ts';

// Auch die Standardmeldungen von Zod folgen der Locale; die setzt erst `initLocale`.
initLocale();

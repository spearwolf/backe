import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    errorPrefix: 'Error:',
    hintPrefix: 'Hint:',
    warningPrefix: 'Warning:',
    unchanged: 'unchanged:',
    unknownFormat: (value: string, source: string) =>
      `Unknown output format '${value}' (source: ${source})`,
    formatChoices: 'text, json or md',
  },
  de: {
    errorPrefix: 'Fehler:',
    hintPrefix: 'Hinweis:',
    warningPrefix: 'Warnung:',
    unchanged: 'unverändert:',
    unknownFormat: (value: string, source: string) =>
      `Unbekanntes Ausgabeformat »${value}« (Quelle: ${source})`,
    formatChoices: 'text, json oder md',
  },
});

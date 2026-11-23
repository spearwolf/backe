import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    subjectNotSingleLine: 'Commit subject must be exactly one non-empty line',
    invalidTrailer: (key: string) => `Invalid commit trailer '${key}'`,
  },
  de: {
    subjectNotSingleLine: 'Commit-Subject muss genau eine nicht leere Zeile sein',
    invalidTrailer: (key: string) => `Ungültiger Commit-Trailer »${key}«`,
  },
});

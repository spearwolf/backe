import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    unknownFields: (fields: readonly string[]) =>
      `Unknown fields for --fields: ${fields.map((f) => `'${f}'`).join(', ')}`,
    allowedFields: (fields: string) => `Allowed: ${fields}`,
    unexpectedError: (reason: string) => `Unexpected error: ${reason}`,
  },
  de: {
    unknownFields: (fields: readonly string[]) =>
      `Unbekannte Felder für --fields: ${fields.map((f) => `»${f}«`).join(', ')}`,
    allowedFields: (fields: string) => `Erlaubt: ${fields}`,
    unexpectedError: (reason: string) => `Unerwarteter Fehler: ${reason}`,
  },
});

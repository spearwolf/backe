import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    invalidConflictId: (id: string) => `Invalid conflict ID '${id}'`,
    conflictNotFound: (id: string) => `Conflict ${id} not found`,
  },
  de: {
    invalidConflictId: (id: string) => `Ungültige Konflikt-ID »${id}«`,
    conflictNotFound: (id: string) => `Konflikt ${id} nicht gefunden`,
  },
});

import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    attachmentContentGone: (file: string | undefined, id: string) =>
      `Content of attachment '${file}' on ${id} is no longer available`,
    conflictNotFound: (id: string) => `Conflict ${id} not found`,
  },
  de: {
    attachmentContentGone: (file: string | undefined, id: string) =>
      `Inhalt des Anhangs »${file}« an ${id} ist nicht mehr vorhanden`,
    conflictNotFound: (id: string) => `Konflikt ${id} nicht gefunden`,
  },
});

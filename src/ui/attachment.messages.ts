import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    linkAttachment: (id: string, name: string) =>
      `Attachment '${name}' of ${id} is a link and has no bytes`,
  },
  de: {
    linkAttachment: (id: string, name: string) =>
      `Anhang »${name}« von ${id} ist ein Link und hat keine Bytes`,
  },
});

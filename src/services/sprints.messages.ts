import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    sprintNotFound: (slug: string) => `Sprint '${slug}' not found`,
  },
  de: {
    sprintNotFound: (slug: string) => `Sprint »${slug}« nicht gefunden`,
  },
});

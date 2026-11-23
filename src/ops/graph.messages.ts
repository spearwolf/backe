import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: { issueNotFound: (id: string) => `Issue ${id} not found` },
  de: { issueNotFound: (id: string) => `Issue ${id} nicht gefunden` },
});

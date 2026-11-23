import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    nodeTooOld: (min: number, found: string) => `backe needs Node.js ≥ ${min} (found ${found})`,
  },
  de: {
    nodeTooOld: (min: number, found: string) =>
      `backe braucht Node.js ≥ ${min} (gefunden ${found})`,
  },
});

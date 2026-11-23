import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    idCollision: (old: string, fresh: string) => `ID collision: ${old} is now ${fresh}`,
  },
  de: {
    idCollision: (old: string, fresh: string) => `ID-Kollision: ${old} heißt jetzt ${fresh}`,
  },
});

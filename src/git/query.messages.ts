import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    revParseFailed: (stderr: string) => `git rev-parse failed: ${stderr}`,
  },
  de: {
    revParseFailed: (stderr: string) => `git rev-parse fehlgeschlagen: ${stderr}`,
  },
});

import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    textConflict: (sha: string, paths: string) => `Text conflict in manual commit ${sha}: ${paths}`,
  },
  de: {
    textConflict: (sha: string, paths: string) => `Textkonflikt in manual-Commit ${sha}: ${paths}`,
  },
});

import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    lfsRequired: 'attachments.lfs requires git-lfs',
    lfsPullFailed: (detail: string) => `git lfs pull failed: ${detail}`,
  },
  de: {
    lfsRequired: 'attachments.lfs verlangt git-lfs',
    lfsPullFailed: (detail: string) => `git lfs pull fehlgeschlagen: ${detail}`,
  },
});

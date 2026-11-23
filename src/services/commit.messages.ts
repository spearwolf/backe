import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    unsettled: (paths: string, reason: string) => `Working copy not settled (${paths}): ${reason}`,
    messageOnlyForManual: '-m only applies to manual changes',
  },
  de: {
    unsettled: (paths: string, reason: string) =>
      `Arbeitskopie nicht angeglichen (${paths}): ${reason}`,
    messageOnlyForManual: '-m gilt nur für manuelle Änderungen',
  },
});

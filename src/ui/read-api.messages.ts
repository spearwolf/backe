import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    noEndpoint: (what: string) => `No endpoint '${what}'`,
  },
  de: {
    noEndpoint: (what: string) => `Kein Endpunkt »${what}«`,
  },
});

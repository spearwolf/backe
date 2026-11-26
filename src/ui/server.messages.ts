import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    portInUse: (port: number) => `Port ${port} is in use`,
    noEndpoint: (path: string) => `No endpoint '${path}'`,
  },
  de: {
    portInUse: (port: number) => `Port ${port} ist belegt`,
    noEndpoint: (path: string) => `Kein Endpunkt »${path}«`,
  },
});

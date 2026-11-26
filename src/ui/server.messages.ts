import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    portInUse: (port: number) => `Port ${port} is in use`,
    noEndpoint: (path: string) => `No endpoint '${path}'`,
    badRequestUrl: 'The request URL cannot be parsed',
    shuttingDown: 'backe ui is shutting down',
  },
  de: {
    portInUse: (port: number) => `Port ${port} ist belegt`,
    noEndpoint: (path: string) => `Kein Endpunkt »${path}«`,
    badRequestUrl: 'Die URL der Anfrage lässt sich nicht lesen',
    shuttingDown: 'backe ui wird beendet',
  },
});

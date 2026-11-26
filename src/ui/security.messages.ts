import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    foreignHost: (host: string) => `Host '${host}' is not allowed`,
    foreignOrigin: (origin: string) => `Origin '${origin}' is not allowed`,
    originRequired: (method: string) => `${method} requires an Origin header`,
    wrongToken: 'The session token is wrong',
    noSession: 'No session',
    openConsoleUrl: 'Open the URL that backe ui printed to its console',
  },
  de: {
    foreignHost: (host: string) => `Host »${host}« ist nicht erlaubt`,
    foreignOrigin: (origin: string) => `Origin »${origin}« ist nicht erlaubt`,
    originRequired: (method: string) => `${method} verlangt einen Origin-Header`,
    wrongToken: 'Das Sitzungs-Token stimmt nicht',
    noSession: 'Keine Sitzung',
    openConsoleUrl: 'Öffne die URL, die backe ui in seiner Konsole ausgegeben hat',
  },
});

import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    placeholderText: 'backe ui is running; the frontend is not built (pnpm build).',
    noSessionTitle: 'No session',
    noSessionText:
      'Open the URL that backe ui printed to its console; it carries the session token.',
    forbiddenTitle: 'Access denied',
  },
  de: {
    placeholderText: 'backe ui läuft; das Frontend ist nicht gebaut (pnpm build).',
    noSessionTitle: 'Keine Sitzung',
    noSessionText:
      'Öffne die URL, die backe ui in seiner Konsole ausgegeben hat; sie trägt das Sitzungs-Token.',
    forbiddenTitle: 'Zugriff verweigert',
  },
});

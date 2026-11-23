import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    nextNeedsIdentity: "'next' needs an identity",
    identityHint: 'pass --as <handle> or set an identity',
    nothingReadyWaiting: (ids: string) =>
      `Nothing ready: everything waits on dependencies (${ids})`,
    nothingFreeAllAssigned: 'Nothing free: all ready issues are assigned',
    nothingReadyAllBlocked: 'Nothing ready: everything is blocked',
    nothingOpen: 'Nothing open',
  },
  de: {
    nextNeedsIdentity: '»next« braucht eine Identität',
    identityHint: 'mit --as <handle> angeben oder eine Identität setzen',
    nothingReadyWaiting: (ids: string) => `Nichts bereit: alles wartet auf Abhängigkeiten (${ids})`,
    nothingFreeAllAssigned: 'Nichts frei: alle bereiten Issues sind vergeben',
    nothingReadyAllBlocked: 'Nichts bereit: alles ist blockiert',
    nothingOpen: 'Nichts offen',
  },
});

import { catalog } from '@backe/i18n/catalog.ts';

export const m = catalog({
  en: {
    meNeedsIdentity: '`me` needs an identity',
    unknownMode: (mode: string) => `Unknown mode: ${mode} (ready, blocked, unblockable)`,
  },
  de: {
    meNeedsIdentity: '`me` braucht eine Identität',
    unknownMode: (mode: string) => `Unbekannter Modus: ${mode} (ready, blocked, unblockable)`,
  },
});

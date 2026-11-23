import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    backgroundSyncNotStarted: (reason: string) => `Background sync not started: ${reason}`,
  },
  de: {
    backgroundSyncNotStarted: (reason: string) => `Hintergrund-Sync nicht gestartet: ${reason}`,
  },
});

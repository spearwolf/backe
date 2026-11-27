import { catalog } from '@backe/i18n/catalog.ts';

export const m = catalog({
  en: {
    assigned: (by: string) => `Assigned to you by ${by}`,
    changed: (by: string) => `Changed by ${by}`,
    deleted: (by: string) => `Deleted by ${by}`,
    syncConflict: 'Sync conflict',
    summaryTitle: (n: number) => `${n} of your issues changed`,
    summaryBody: (by: string) => `By ${by}`,
  },
  de: {
    assigned: (by: string) => `Dir zugewiesen von ${by}`,
    changed: (by: string) => `Geändert von ${by}`,
    deleted: (by: string) => `Gelöscht von ${by}`,
    syncConflict: 'Sync-Konflikt',
    summaryTitle: (n: number) => `${n} deiner Issues geändert`,
    summaryBody: (by: string) => `Von ${by}`,
  },
});

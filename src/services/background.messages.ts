import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    noUserResolved: 'No user resolved; the sync status belongs to an identity',
    noUserResolvedHint: (configPath: string) =>
      `--as <handle>, BACKE_USER or 'user' in ${configPath}`,
    noWorkingCopy: (wc: string) => `No working copy at ${wc}`,
    noWorkingCopyHint: 'backe sync creates it',
    statusUnpushed: (count: number) => `${count} unpushed`,
    statusConflicts: (count: number) => `${count} ${count === 1 ? 'conflict' : 'conflicts'}`,
    statusLastFailed: (message: string) => `last sync failed: ${message}`,
  },
  de: {
    noUserResolved: 'Kein User aufgelöst, der Sync-Status gehört zu einer Identität',
    noUserResolvedHint: (configPath: string) =>
      `--as <handle>, BACKE_USER oder »user« in ${configPath}`,
    noWorkingCopy: (wc: string) => `Keine Arbeitskopie unter ${wc}`,
    noWorkingCopyHint: 'backe sync legt sie an',
    statusUnpushed: (count: number) => `${count} ungepusht`,
    statusConflicts: (count: number) => `${count} ${count === 1 ? 'Konflikt' : 'Konflikte'}`,
    statusLastFailed: (message: string) => `letzter Sync fehlgeschlagen: ${message}`,
  },
});

import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    labelRemote: 'remote',
    labelBase: 'base',
    labelLocal: 'local',
    textConflict: (sha: string, paths: string) => `Text conflict in manual commit ${sha}: ${paths}`,
  },
  de: {
    labelRemote: 'remote',
    labelBase: 'basis',
    labelLocal: 'lokal',
    textConflict: (sha: string, paths: string) => `Textkonflikt in manual-Commit ${sha}: ${paths}`,
  },
});

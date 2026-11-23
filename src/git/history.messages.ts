import { catalog } from '../i18n/catalog.ts';

export const m = catalog({
  en: {
    catFileTruncated: 'Output of git cat-file is truncated',
    revisionNotFound: (rev: string) => `Revision ${rev} not found`,
  },
  de: {
    catFileTruncated: 'Ausgabe von git cat-file ist abgeschnitten',
    revisionNotFound: (rev: string) => `Revision ${rev} nicht gefunden`,
  },
});
